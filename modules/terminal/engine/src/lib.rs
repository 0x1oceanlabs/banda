//! The terminal module: programs a Person runs in a terminal, such as a
//! shell or a Harness's sign-in (ADR 0004).
//!
//! The engine runs each program on a PTY in the Space's folder, keeps what
//! it printed in memory, and lets windows watch it as a stream: none of it
//! goes to the event log, which keeps the work, and a restart ends every
//! terminal. Only a Person runs a terminal (the `Run` right): an Agent runs
//! programs through its Harness, under its Thread's mode.

pub mod model;

mod history;
mod terminal;

use banda_kernel::{Call, Module, ModuleSpace, Refusal, Right, SpaceId, Stream};
use model::{Open, Piece, Size, TerminalId};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::sync::{Arc, Mutex};
use terminal::Terminal;
use ts_rs::TS;

/// The most a window types at once.
const AT_ONCE: usize = 64 * 1024;

#[derive(Default)]
pub struct Terminals {
    open: Mutex<HashMap<TerminalId, Arc<Terminal>>>,
}

impl Terminals {
    pub fn new() -> Self {
        Self::default()
    }

    fn find(&self, space: SpaceId, id: TerminalId) -> Result<Arc<Terminal>, Refusal> {
        self.open
            .lock()
            .unwrap()
            .get(&id)
            .filter(|t| t.space == space)
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
        stream watch(One) -> Piece, Run;
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
struct Resize {
    terminal: TerminalId,
    size: Size,
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

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }

    async fn stream(&self, call: Call, method: &str, params: Value) -> Result<Stream, Refusal> {
        self.dispatch_stream(call, method, params).await
    }

    /// A removed Space's programs stop, as `close` stops one.
    async fn closing(&self, space: ModuleSpace) {
        let closed: Vec<_> = (self.open.lock().unwrap())
            .extract_if(|_, terminal| terminal.space == space.id())
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
        let space = call.space();
        let mut open_now = self.open.lock().unwrap();
        let ended = match open_now.get(&open.terminal) {
            Some(found) if found.space != space.id() => {
                return Err(Refusal::conflict(
                    "That terminal ID is taken: open a new terminal.",
                ));
            }
            Some(found) if !found.ended() => return Ok(()),
            found => found.cloned(),
        };
        let id = open.terminal;
        let started =
            Terminal::start(space.id(), space.folder(), open).map_err(Refusal::invalid)?;
        open_now.insert(id, started);
        drop(open_now);
        if let Some(ended) = ended {
            ended.close();
        }
        Ok(())
    }

    async fn write(&self, call: Call, Write { terminal, data }: Write) -> Result<(), Refusal> {
        if data.len() > AT_ONCE {
            return Err(Refusal::invalid("Type at most 64 KB at once."));
        }
        let terminal = self.find(call.space().id(), terminal)?;
        terminal.write(&data).await.map_err(Refusal::conflict)
    }

    async fn resize(&self, call: Call, Resize { terminal, size }: Resize) -> Result<(), Refusal> {
        allowed(size)?;
        let terminal = self.find(call.space().id(), terminal)?;
        terminal.resize(size).await.map_err(Refusal::conflict)
    }

    async fn close(&self, call: Call, One { terminal }: One) -> Result<(), Refusal> {
        let closed = match self.open.lock().unwrap().entry(terminal) {
            Entry::Occupied(found) if found.get().space == call.space().id() => {
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
        Ok(self.find(call.space().id(), terminal)?.watch())
    }
}
