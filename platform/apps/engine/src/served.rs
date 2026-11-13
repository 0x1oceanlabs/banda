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

use crate::folder::kept;
use crate::folder::{Declared, Folder};
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
    /// The Projects one of its commands runs in now, each held by it.
    turns: Mutex<HashMap<ProjectId, Arc<tokio::sync::Mutex<()>>>>,
}

impl Served {
    /// The App `app`, run from the `copy` of its folder by Banda's loop at
    /// `runner`, on `node`; with none, it is installed and does not run.
    pub fn new(app: Folder, copy: &Path, runner: &Path, node: Option<Node>) -> Served {
        let steps: Vec<&'static str> = app.migrations.iter().cloned().map(kept).collect();
        Served {
            worker: Worker::new(&app, copy.to_owned(), runner.to_owned(), node),
            name: kept(app.id.clone()),
            steps: Box::leak(steps.into_boxed_slice()),
            app,
            turns: Default::default(),
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
        self.app
            .methods
            .iter()
            .find(|declared| declared.name == method)
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
                return Err(amiss(
                    "it is a call, and a call writes nothing: declare it a command in methods.json."
                        .into(),
                ));
            }
            return Ok(answer);
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
