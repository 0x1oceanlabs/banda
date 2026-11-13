//! The router: a call, a command, a stream or a follow, to the module that
//! owns its method, in the scope it runs in, once the Project wall and the
//! access decision allow it.

use crate::access::{self, Caller, Right};
use crate::apps::Apps;
use crate::kernel::Kernel;
use crate::methods::{Kind, needs_command_id};
use crate::module::{Call, Module, Scope, Stream};
use crate::project::Project;
use crate::projects::Own;
use crate::scopes::outside_machine;
use crate::store::{Answer, Begun};
use crate::window::Window;
use crate::{CommandId, Named, ProjectId, Refusal};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::{mpsc, watch};

/// One of a session's queues of commands, by the scope they run in
/// ([`Kernel::queue`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum Queue {
    Machine,
    Project(ProjectId),
}

/// The prefixes of the kernel's own methods, which no module takes:
/// `projects.*`, the window's road (ADR 0029, decision 2), and `apps.*`,
/// what this engine runs (ADR 0082, decision 2).
pub(crate) const OWN: [&str; 3] = ["projects", "window", "apps"];

/// A method of the kernel's own `projects.*` without its prefix, or of
/// `spaces.*`, their name before ADR 0069 (grace).
fn own_method(method: &str) -> Option<&str> {
    (method.strip_prefix("projects.")).or_else(|| method.strip_prefix("spaces."))
}

/// The stream of what this host is called and drawn by (ADR 0095,
/// decision 2): a stream of the machine's, as `window.requests` is, so it
/// is there whatever modules run.
const NAMED: &str = "machine.named";

/// The stream of this host's battery and why it is held awake (ADR 0097,
/// decision 6), a stream of the machine's as `machine.named` is.
const POWER: &str = "machine.power";

/// What `named` is now, then again each time it changes, until the one
/// who hears it stops.
fn named_stream(mut named: watch::Receiver<Named>) -> Stream {
    let (send, hear) = mpsc::channel(1);
    tokio::spawn(async move {
        loop {
            let now = serde_json::to_value(&*named.borrow_and_update());
            let Ok(now) = now else { break };
            if send.send(now).await.is_err() {
                break;
            }
            tokio::select! {
                changed = named.changed() => if changed.is_err() { break },
                () = send.closed() => break,
            }
        }
    });
    hear
}

/// Whether a command may still run by `not_after`, by this machine's clock
/// (ADR 0105): refused `expired` once past it.
fn in_time(not_after: Option<i64>) -> Result<(), Refusal> {
    match not_after {
        Some(at) if crate::now_ms() > at => {
            Err(Refusal::expired("Its time had passed, so it did not run."))
        }
        _ => Ok(()),
    }
}

fn no_method(method: &str) -> Refusal {
    Refusal::invalid(format!("There is no method \"{method}\"."))
}

impl Kernel {
    /// Routes a call: `projects.*` to the kernel, `<module>.*` to that module
    /// in the given Project. Every method passes the Project wall and the
    /// access decision first. A caller with a pass that names no Project
    /// calls in its own. See [`Kernel::answer`] for a command's receipt.
    pub async fn call(
        &self,
        caller: impl Into<Caller>,
        method: &str,
        project: Option<ProjectId>,
        command: Option<CommandId>,
        params: Value,
    ) -> Result<Value, Refusal> {
        let answer = self.answer(caller, method, project, command, params);
        answer.await.map(|answer| answer.value)
    }

    /// Routes a call as [`Kernel::call`] does, and answers a module's
    /// command with its place in the log, `at`.
    ///
    /// Every command keeps a receipt, whatever its handler does (ADR 0082,
    /// decision 4):
    ///
    /// - It is written before the handler runs, and keeps the answer once
    ///   it ends, so a resend gets that answer and runs nothing again. A
    ///   resend while the command runs waits, and gets what the run answers.
    /// - It keeps a hash of the params. The same ID from someone else, for
    ///   another method or with other params, is refused as `conflict`.
    /// - It keeps a value or a final refusal (`Code::is_final`). After a
    ///   passing refusal it is forgotten, so a resend runs, unless the
    ///   command's change was written: then it answers `may_have_run`.
    /// - A run cut short, by a crash or by a caller that went away, leaves
    ///   it unanswered. A resend then gets `may_have_run`, kept as any
    ///   answer is, as the handler may have acted outside the store before
    ///   it ended.
    /// - `at` is a seq of the log of the scope the command ran in: the
    ///   last fact it wrote with its change ([`Call::command`]). A view
    ///   current at `at` shows what the command did. One that wrote no
    ///   fact carries none, though it may have changed what it keeps: a
    ///   client has nothing in the log to wait to hear, and a read sent
    ///   after the answer shows what it did (#880). A refusal carries none
    ///   either: what a run wrote before it was refused comes through the
    ///   log alone. A resend gets the same `at`. The router runs a
    ///   session's commands to one scope in the order sent
    ///   ([`api`](crate::api)), so their `at`s go in that order too, but
    ///   for one that runs on ([`Module::runs_on`]) or hung.
    /// - A receipt is kept thirty days past its last write, as its command
    ///   began or was answered, and while its command runs, however long.
    ///   A resend comes within seven days of the first send, so each finds
    ///   its receipt. Past them the same ID runs as a new command. Those
    ///   seven days are a convention of Banda's clients, and the most a
    ///   message waits for this machine ([`Kernel::answer_until`]).
    ///
    /// A `call` keeps no receipt, whatever it changes, so `banda mcp`
    /// never sends one again ([`Tool::kind`](crate::Tool)). The kernel's own
    /// `projects.*` commands are not yet among these: they leave the
    /// kernel with A1 and A2 of the architecture vision.
    pub async fn answer(
        &self,
        caller: impl Into<Caller>,
        method: &str,
        project: Option<ProjectId>,
        command: Option<CommandId>,
        params: Value,
    ) -> Result<Answer, Refusal> {
        self.answer_until(caller, method, project, command, None, params)
            .await
    }

    /// Answers as [`Kernel::answer`] does a command that may run only
    /// until `not_after`, in ms since the epoch by this machine's clock,
    /// as one that waited for this machine is sent (ADR 0105). Its receipt
    /// is looked up first, so a resend of one that ran gets its answer
    /// however late. One not run yet is refused `expired` past that time,
    /// before its module sees it, and that is its answer, so a resend gets
    /// it too. The kernel's own commands keep no receipt, and go by none.
    pub async fn answer_until(
        &self,
        caller: impl Into<Caller>,
        method: &str,
        project: Option<ProjectId>,
        command: Option<CommandId>,
        not_after: Option<i64>,
        params: Value,
    ) -> Result<Answer, Refusal> {
        let plain = |value| Answer { value, at: None };
        let Caller {
            participant,
            only,
            thread,
            runs,
        } = caller.into();
        if let Some(own) = method.strip_prefix("window.")
            && let Some(right) = Window::right(own)
        {
            access::decide(&participant, right, self.owner)?;
            return self.window.call(participant, own, params).await.map(plain);
        }
        if let Some(own) = method.strip_prefix("apps.")
            && let Some(right) = Apps::right(own)
        {
            access::decide(&participant, right, self.owner)?;
            return self.apps.call(participant, own, params).await.map(plain);
        }
        if let Some(own) = own_method(method)
            && let Some(right) = Self::own_right(own)
        {
            access::within(only, project.or(only))?;
            access::decide(&participant, right, self.owner)?;
            let ask = Own {
                participant,
                method,
                only,
                command,
            };
            return self.own_call(ask, own, params).await.map(plain);
        }
        let (module, rest, right) = self.method(method)?;
        let kind = module.kind(rest).ok_or_else(|| no_method(method))?;
        let (project, wall) = self.place(&**module, method, rest, project, only).await?;
        let _moving = project.moving.read().await;
        let scope = project.module(module.name());
        if kind != Kind::Command {
            access::decide(&participant, right, project.owner())?;
            project.available(module.name())?;
            let call = Call::new(
                participant,
                scope,
                method.to_owned(),
                None,
                wall,
                thread,
                runs,
            );
            let call = call.reaching(self.projects.clone());
            return module.call(call, rest, params).await.map(plain);
        }
        let command = command.ok_or_else(|| needs_command_id(method))?;
        let receipt = scope.receipt(command, method, participant, &params);
        let running = match project.store().begin(receipt.clone()).await? {
            Begun::Run(running) => running,
            Begun::Answered(answer) => return answer,
        };
        // A refusal made before the handler runs is the command's answer
        // too (ADR 0002, decision 2): one past its time, not allowed, or
        // for an App turned off here, which its receipt does not keep.
        let allowed = in_time(not_after)
            .and_then(|()| access::decide(&participant, right, project.owner()))
            .and_then(|()| project.available(module.name()));
        let answer = match allowed {
            Ok(()) => {
                let call = Call::new(
                    participant,
                    scope,
                    method.to_owned(),
                    Some(receipt),
                    wall,
                    thread,
                    runs,
                );
                let call = call.reaching(self.projects.clone());
                module.call(call, rest, params).await
            }
            Err(refusal) => Err(refusal),
        };
        project.store().settle(running, answer).await
    }

    /// The queue the router keeps a call from one session in, so the
    /// session's commands to one scope commit in the order sent (ADR 0082,
    /// decision 4): a command's scope, this machine's or a Project's. The
    /// kernel's own `projects.*` are this machine's. `None` for a call or a
    /// stream, which runs as it arrives, as does a command that runs on
    /// ([`Module::runs_on`]). `None` too for what will be refused: a
    /// method there is not, or a Project there is not or outside the
    /// caller's pass, so a client makes no queue, which lasts as long as
    /// its connection, for a Project of its choosing.
    pub(crate) fn queue(
        &self,
        caller: &Caller,
        method: &str,
        project: Option<ProjectId>,
    ) -> Option<Queue> {
        if let Some(own) = own_method(method)
            && let Some(kind) = Self::own_kind(own)
        {
            return (kind == Kind::Command).then_some(Queue::Machine);
        }
        let (module, rest, _) = self.method(method).ok()?;
        if module.kind(rest)? != Kind::Command || module.runs_on(rest) {
            return None;
        }
        if module.scope() == Scope::Machine {
            return Some(Queue::Machine);
        }
        let id = project.or(caller.only)?;
        // While the list of Projects changes, a Project goes unchecked.
        let known = (self.projects.try_read()).map_or(true, |all| all.contains_key(&id));
        let within = caller.only.is_none_or(|only| only == id);
        (known && within).then_some(Queue::Project(id))
    }

    /// Opens a module's stream in a Project, or this machine's for a module
    /// of the machine, which names none, once the access decision allows
    /// it. `window.requests`, `machine.named` and `machine.power` name none
    /// either.
    pub async fn stream(
        &self,
        caller: impl Into<Caller>,
        method: &str,
        project: Option<ProjectId>,
        params: Value,
    ) -> Result<Stream, Refusal> {
        let Caller {
            participant,
            only,
            thread,
            runs,
        } = caller.into();
        if let Some(own) = method.strip_prefix("window.")
            && let Some(right) = Window::right(own)
        {
            access::decide(&participant, right, self.owner)?;
            return self.window.stream(participant, own, params).await;
        }
        if method == NAMED
            && let Some(named) = &self.named
        {
            access::decide(&participant, Right::Read, self.owner)?;
            return Ok(named_stream(named.clone()));
        }
        if method == POWER
            && let Some(power) = &self.power
        {
            access::decide(&participant, Right::Read, self.owner)?;
            return Ok(power());
        }
        let (module, rest, right) = self.method(method)?;
        let (project, wall) = self.place(&**module, method, rest, project, only).await?;
        access::decide(&participant, right, project.owner())?;
        project.available(module.name())?;
        let call = Call::new(
            participant,
            project.module(module.name()),
            method.to_owned(),
            None,
            wall,
            thread,
            runs,
        );
        module.stream(call, rest, params).await
    }

    /// The module of `method`, the method without its prefix, and the
    /// right it needs.
    fn method<'a>(&self, method: &'a str) -> Result<(&Arc<dyn Module>, &'a str, Right), Refusal> {
        let (prefix, rest) = method.split_once('.').ok_or_else(|| no_method(method))?;
        let module = self
            .modules
            .iter()
            .find(|m| m.name() == prefix)
            .ok_or_else(|| no_method(method))?;
        let right = module.right(rest).ok_or_else(|| no_method(method))?;
        Ok((module, rest, right))
    }

    /// The Project `caller` follows, once the Project wall and the access
    /// decision allow it.
    pub async fn follow(
        &self,
        caller: impl Into<Caller>,
        project: ProjectId,
    ) -> Result<Arc<Project>, Refusal> {
        let Caller {
            participant, only, ..
        } = caller.into();
        let project = match &self.machine {
            Some(machine) if machine.id() == project => {
                // Its log holds every Project's Panes: no pass follows it.
                if only.is_some() {
                    return Err(outside_machine());
                }
                machine.clone()
            }
            _ => {
                access::within(only, Some(project))?;
                self.project(project).await?
            }
        };
        access::decide(&participant, Right::Read, project.owner())?;
        Ok(project)
    }
}
