//! The terminal module: programs a Person runs in a terminal, such as a
//! shell or a Harness's sign-in (ADR 0004).
//!
//! The engine runs each program on a PTY in the Project's folder, keeps what
//! it printed in memory, and lets windows watch it as a stream: none of it
//! goes to the event log, which keeps the work, and a restart ends every
//! terminal. Only a Person runs a terminal (the `Run` right): an Agent runs
//! programs through its Harness, under its Thread's mode.
//!
//! Windows has neither terminals nor servers yet (ADR 0090): a ConPTY comes
//! with its step 7, and Windows' own tables of sockets and processes with
//! its step 8. Until then `open`, `ports` and `stop_server` refuse there
//! and say so.

pub mod model;
pub mod settings;

#[cfg(unix)]
mod front;
#[cfg(unix)]
mod history;
#[cfg(unix)]
mod servers;
#[cfg(unix)]
mod terminal;
#[cfg(not(unix))]
mod windows;
#[cfg(not(unix))]
pub use windows::{NO_SERVERS, NO_TERMINALS};

use banda_kernel::{Call, Kind, Module, ModuleProject, Nothing, ProjectId, Refusal, Right, Stream};
use model::{Open, Piece, Running, Servers, Size, TerminalId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(unix)]
use servers::Scanner;
use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::sync::{Arc, Mutex};
#[cfg(unix)]
use terminal::Terminal;
use tokio::sync::{mpsc, watch};
use ts_rs::TS;
#[cfg(not(unix))]
use windows::Terminal;

/// The module's settings file in `~/.config/banda` (ADR 0016): how the
/// terminal writes, which the look resolves for the window (ADR 0047).
pub const SETTINGS: [banda_look::SettingsFile; 1] =
    [banda_look::SettingsFile::of::<settings::TerminalSettings>()];

/// The most a window types at once.
const AT_ONCE: usize = 64 * 1024;

#[derive(Default)]
pub struct Terminals {
    /// Every Project's open terminals: each Project's `running` counts
    /// its own.
    open: Arc<Mutex<HashMap<TerminalId, Arc<Terminal>>>>,
    /// Ticks as a terminal opens or closes, or a program comes to its
    /// front or leaves it, so each Project's `running` counts again.
    fronts: watch::Sender<()>,
    /// The servers started in Banda, a terminal's or an Agent's (ADR 0044).
    #[cfg(unix)]
    servers: Arc<Scanner>,
}

impl Terminals {
    pub fn new() -> Self {
        Self::default()
    }

    fn find(&self, project: ProjectId, id: TerminalId) -> Result<Arc<Terminal>, Refusal> {
        self.open
            .lock()
            .unwrap()
            .get(&id)
            .filter(|t| t.project == project)
            .cloned()
            .ok_or_else(|| {
                Refusal::not_found("This terminal is gone: it was closed, or Banda stopped.")
            })
    }
}

banda_kernel::methods! {
    Terminals(Call) as "TerminalMethods" in "terminal/" {
        /// Starts a program on a PTY, or again once it ended; one that runs
        /// stays as it is.
        call open(Open) -> (), Run;
        /// What the Person types.
        call write(Write) -> (), Run;
        /// The size a window gives it.
        call resize(Resize) -> (), Run;
        /// Stops the program and what it started.
        call close(One) -> (), Run;
        /// The screen so far, then what it prints, then how it ended.
        /// Watching shows what a Person types, such as a sign-in's code.
        // It needs Run, for what the screen shows, and only reads it.
        stream watch(One) -> Piece, Run, read;
        /// The Project's servers, then their list again each time it
        /// changes: what a terminal or an Agent started that listens on
        /// this computer (ADR 0044).
        stream ports(Nothing) -> Servers, Read;
        /// Stops a server of the Project's, and what it started.
        call stop_server(StopServer) -> (), Run;
        /// How many of the Project's terminals run a program in front,
        /// then that again each time it changes, so a machine's update can
        /// wait while one does (ADR 0106, decision 4).
        stream running(Nothing) -> Running, Read;
    }
}

#[derive(Deserialize, TS)]
#[ts(export_to = "terminal/")]
struct One {
    terminal: TerminalId,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "terminal/")]
struct Write {
    terminal: TerminalId,
    data: String,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "terminal/")]
// Windows refuses it unread (ADR 0090, step 8).
#[cfg_attr(not(unix), allow(dead_code))]
struct StopServer {
    port: u16,
    process: u32,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "terminal/")]
struct Resize {
    terminal: TerminalId,
    size: Size,
}

/// What `now` makes of `changes`, then that again each time they tick and
/// it differs, until the window lets go. One answer waits at a time; a
/// newer one follows it.
fn follow<V, T>(
    mut changes: watch::Receiver<V>,
    mut now: impl FnMut(&V) -> T + Send + 'static,
) -> Stream
where
    V: Clone + Send + Sync + 'static,
    T: Serialize + PartialEq + Send + 'static,
{
    let (say, heard) = mpsc::channel(1);
    tokio::spawn(async move {
        let mut told = None;
        loop {
            // A copy, so the watch is not held while `now` takes its locks.
            let value = changes.borrow_and_update().clone();
            let answer = now(&value);
            if told.as_ref() != Some(&answer) {
                let Ok(said) = serde_json::to_value(&answer) else {
                    return;
                };
                if say.send(said).await.is_err() {
                    return;
                }
                told = Some(answer);
            }
            tokio::select! {
                changed = changes.changed() => if changed.is_err() {
                    return;
                },
                () = say.closed() => return,
            }
        }
    });
    heard
}

/// How many of `project`'s terminals run a program in front.
fn count(open: &HashMap<TerminalId, Arc<Terminal>>, project: ProjectId) -> Running {
    let terminals = (open.values())
        .filter(|terminal| terminal.project == project && terminal.runs_a_program())
        .count();
    Running {
        terminals: u32::try_from(terminals).unwrap_or(u32::MAX),
    }
}

fn allowed(size: Size) -> Result<(), Refusal> {
    match size.fits() {
        true => Ok(()),
        false => Err(Refusal::invalid(
            "A terminal has 1 to 1000 columns and 1 to 500 rows.",
        )),
    }
}

#[async_trait::async_trait]
impl Module for Terminals {
    fn name(&self) -> &'static str {
        "terminal"
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }

    async fn stream(&self, call: Call, method: &str, params: Value) -> Result<Stream, Refusal> {
        self.dispatch_stream(call, method, params).await
    }

    async fn can_move(&self, project: ModuleProject) -> Result<(), Refusal> {
        if self
            .open
            .lock()
            .unwrap()
            .values()
            .any(|terminal| terminal.project == project.id())
        {
            return Err(Refusal::conflict(
                "Close the open terminals in this Project before moving its folder.",
            ));
        }
        Ok(())
    }

    /// A removed Project's programs stop, as `close` stops one.
    async fn closing(&self, project: ModuleProject) {
        let closed: Vec<_> = (self.open.lock().unwrap())
            .extract_if(|_, terminal| terminal.project == project.id())
            .map(|(_, terminal)| terminal)
            .collect();
        for terminal in closed {
            terminal.close();
        }
    }
}

impl Terminals {
    async fn open(&self, call: Call, open: Open) -> Result<(), Refusal> {
        allowed(open.size)?;
        let project = call.project();
        let mut open_now = self.open.lock().unwrap();
        let ended = match open_now.get(&open.terminal) {
            Some(found) if found.project != project.id() => {
                return Err(Refusal::conflict(
                    "That terminal ID is taken: open a new terminal.",
                ));
            }
            Some(found) if !found.ended() => return Ok(()),
            found => found.cloned(),
        };
        let id = open.terminal;
        let started =
            Terminal::start(project, open, self.fronts.clone()).map_err(Refusal::invalid)?;
        open_now.insert(id, started);
        drop(open_now);
        // A program opened as a terminal's own runs in front from now.
        self.fronts.send_replace(());
        if let Some(ended) = ended {
            ended.close();
        }
        Ok(())
    }

    async fn write(&self, call: Call, Write { terminal, data }: Write) -> Result<(), Refusal> {
        if data.len() > AT_ONCE {
            return Err(Refusal::invalid("Type at most 64 KB at once."));
        }
        let terminal = self.find(call.project().id(), terminal)?;
        terminal.write(&data).await.map_err(Refusal::conflict)
    }

    async fn resize(&self, call: Call, Resize { terminal, size }: Resize) -> Result<(), Refusal> {
        allowed(size)?;
        let terminal = self.find(call.project().id(), terminal)?;
        terminal.resize(size).await.map_err(Refusal::conflict)
    }

    async fn close(&self, call: Call, One { terminal }: One) -> Result<(), Refusal> {
        let closed = match self.open.lock().unwrap().entry(terminal) {
            Entry::Occupied(found) if found.get().project == call.project().id() => {
                Some(found.remove())
            }
            _ => None,
        };
        if let Some(closed) = closed {
            closed.close();
        }
        Ok(())
    }

    async fn watch(&self, call: Call, One { terminal }: One) -> Result<Stream, Refusal> {
        Ok(self.find(call.project().id(), terminal)?.watch())
    }

    async fn running(&self, call: Call, _: Nothing) -> Result<Stream, Refusal> {
        let project = call.project().id();
        let open = self.open.clone();
        let fronts = self.fronts.subscribe();
        Ok(follow(fronts, move |()| {
            count(&open.lock().unwrap(), project)
        }))
    }

    #[cfg(unix)]
    async fn ports(&self, call: Call, _: Nothing) -> Result<Stream, Refusal> {
        Ok(self.servers.stream(call.project().id()))
    }

    #[cfg(not(unix))]
    async fn ports(&self, _: Call, _: Nothing) -> Result<Stream, Refusal> {
        Err(Refusal::invalid(windows::NO_SERVERS))
    }

    #[cfg(unix)]
    async fn stop_server(
        &self,
        call: Call,
        StopServer { port, process }: StopServer,
    ) -> Result<(), Refusal> {
        let project = call.project().id();
        // It may have ended since, and its number name another process.
        let still = (servers::look().await).into_iter().any(|found| {
            found.project == project && found.server.port == port && found.server.process == process
        });
        if !still {
            return Err(Refusal::not_found("This server is no longer running."));
        }
        servers::stop(process).await;
        Ok(())
    }

    #[cfg(not(unix))]
    async fn stop_server(&self, _: Call, _: StopServer) -> Result<(), Refusal> {
        Err(Refusal::invalid(windows::NO_SERVERS))
    }
}
