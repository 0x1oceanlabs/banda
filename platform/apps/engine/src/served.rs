//! An installed App as the kernel runs it: one [`Module`] built from the
//! App's folder (ADR 0126, decisions 3 and 4). Its name is the App's id,
//! its migrations the folder's steps, its methods and tools what
//! `methods.json` declares; and each call goes to the App's worker.
//!
//! The engine does the writing. A call's answer is the worker's. A
//! command's writes and events come back as data, and are kept here in one
//! transaction with the command's receipt, each statement under the App's
//! authorizer: SQL that reaches another App's table is refused, and
//! nothing of the command is kept.
//!
//! One command of the App runs in a Project at a time, from its call to
//! its commit, so what it read is still so as its writes land. Calls read
//! beside it.

use crate::folder::{Declared, Folder};
use crate::folder::{kept, kept_steps};
use crate::worker::{Answered, Worker, to_sql};
use banda_kernel::host::Node;
use banda_kernel::{Call, Code, Kind, Module, ProjectId, Refusal, Right, Tool};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// An App installed from a folder, served by its worker.
pub struct Served {
    app: Folder,
    /// Its id and its steps, which the kernel takes for as long as the
    /// engine runs.
    name: &'static str,
    steps: &'static [&'static str],
    worker: Worker,
    turns: Turns,
}

/// The turns of one App's commands, by Project: one runs at a time in
/// each. They are the App's, not one module's: the module put in its
/// place as it is installed again takes them, so a command of the old one
/// and one of the new never run side by side.
pub type Turns = Arc<Mutex<HashMap<ProjectId, Arc<tokio::sync::Mutex<()>>>>>;

impl Served {
    /// The App `app`, run from the `copy` of its folder by Banda's loop at
    /// `runner`, on `node`; with none, it is installed and does not run.
    /// Its commands take their turns in `turns`.
    pub fn new(
        app: Folder,
        copy: &Path,
        runner: &Path,
        node: Option<Node>,
        turns: Turns,
    ) -> Served {
        let steps = app.migrations.iter().cloned().map(kept).collect();
        Served {
            worker: Worker::new(&app, copy.to_owned(), runner.to_owned(), node),
            name: kept(app.id.clone()),
            steps: kept_steps(steps),
            app,
            turns,
        }
    }

    /// The App, whose methods have `within` to answer in.
    pub fn answering_within(mut self, within: Duration) -> Served {
        self.worker.answers_within = within;
        self
    }

    /// The App it serves, as its folder read.
    pub fn app(&self) -> &Folder {
        &self.app
    }

    fn declared(&self, method: &str) -> Option<&Declared> {
        self.app.declared(method)
    }

    /// The turn of the App's commands in `project`: one runs at a time.
    fn turn(&self, project: ProjectId) -> Arc<tokio::sync::Mutex<()>> {
        self.turns
            .lock()
            .unwrap()
            .entry(project)
            .or_default()
            .clone()
    }
}

#[async_trait::async_trait]
impl Module for Served {
    fn name(&self) -> &'static str {
        self.name
    }

    fn migrations(&self) -> &'static [&'static str] {
        self.steps
    }

    fn right(&self, method: &str) -> Option<Right> {
        self.declared(method).map(|declared| declared.right)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        self.declared(method).map(|declared| declared.kind)
    }

    fn tools(&self) -> Vec<Tool> {
        self.app.tools()
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        let kind = (self.kind(method))
            .ok_or_else(|| Refusal::invalid(format!("{} has no method {method}.", self.name)))?;
        let project = call.project().clone();
        let turn = (kind == Kind::Command).then(|| self.turn(project.id()));
        let _turn = match &turn {
            Some(turn) => Some(turn.lock().await),
            None => None,
        };
        let line = json!({
            "params": params,
            "by": call.participant(),
            "project": { "id": project.id(), "folder": project.folder().display().to_string() },
        });
        // A view shows the log's place it had before it read: what lands
        // while it reads comes after it, and is read again.
        let at = match kind {
            Kind::View => project.at().await?,
            _ => 0,
        };
        let Answered {
            answer,
            write,
            emit,
        } = self.worker.ask(&project, method, line).await?;
        let named = format!("{}.{method}", self.name);
        // What follows is the App's own to put right, not its caller's.
        let amiss = |why: String| Refusal::new(Code::Internal, format!("{named} failed: {why}"));
        if kind != Kind::Command {
            if !(write.is_empty() && emit.is_empty()) {
                let what = if kind == Kind::View { "view" } else { "call" };
                return Err(amiss(format!(
                    "it is a {what}, and a {what} writes nothing: declare it a command in methods.json."
                )));
            }
            return match kind {
                // Its screen: read here, so no client draws what is no
                // Tree.
                Kind::View => {
                    let tree = crate::tree::resolved(answer, &self.app, at)
                        .map_err(|why| amiss(format!("its Tree does not read. {why}")))?;
                    banda_kernel::methods::answer(tree)
                }
                _ => Ok(answer),
            };
        }
        let author = call.participant();
        call.command(move |tx| {
            for (place, statement) in (1..).zip(&write) {
                let params = rusqlite::params_from_iter(statement.params.iter().map(to_sql));
                tx.sql()
                    .execute(&statement.sql, params)
                    .map_err(|error| unwritten(&named, place, &error))?;
            }
            for said in &emit {
                let version = said.version.unwrap_or(1);
                let subject = said.subject.as_deref();
                tx.emit(&said.kind, version, subject, author, &said.payload)?;
            }
            Ok(())
        })
        .await?;
        Ok(answer)
    }
}

/// The refusal for a command whose write `place` failed, of which nothing
/// is kept. What a table's own rules refuse, a row there already or a
/// value it does not take, is how things stand: `conflict`. Anything else
/// is the App's to put right, a table that is not its own among them.
fn unwritten(named: &str, place: usize, error: &rusqlite::Error) -> Refusal {
    let rules = error.sqlite_error_code() == Some(rusqlite::ErrorCode::ConstraintViolation);
    let code = if rules {
        Code::Conflict
    } else {
        Code::Internal
    };
    Refusal::new(code, format!("{named} failed: its write {place}: {error}."))
}
