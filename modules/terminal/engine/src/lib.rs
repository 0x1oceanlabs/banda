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

use bandaso_kernel::{Call, Module, Refusal, Right, SpaceId, Stream, decode};
use model::{Open, Size, TerminalId};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::sync::{Arc, Mutex};
use terminal::Terminal;

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
                Refusal::not_found("This terminal is gone: it was closed, or Bandaso stopped.")
            })
    }
}

enum Method {
    Open,
    Write,
    Resize,
    Close,
    Watch,
}

impl Method {
    fn parse(name: &str) -> Option<Method> {
        Some(match name {
            "open" => Method::Open,
            "write" => Method::Write,
            "resize" => Method::Resize,
            "close" => Method::Close,
            "watch" => Method::Watch,
            _ => return None,
        })
    }
}

#[derive(Deserialize)]
struct One {
    terminal: TerminalId,
}

#[derive(Deserialize)]
struct Write {
    terminal: TerminalId,
    data: String,
}

#[derive(Deserialize)]
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
        // Watching shows what a Person types, such as a sign-in's code.
        Method::parse(method).map(|_| Right::Run)
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        let space = call.space();
        let method = Method::parse(method).ok_or_else(|| Refusal::invalid("No such method."))?;
        match method {
            // Opening one that runs leaves it as it is; opening one whose
            // program ended starts the program again.
            Method::Open => {
                let open: Open = decode(params)?;
                allowed(open.size)?;
                let mut open_now = self.open.lock().unwrap();
                let ended = match open_now.get(&open.terminal) {
                    Some(found) if found.space != space.id() => {
                        return Err(Refusal::conflict(
                            "That terminal ID is taken: open a new terminal.",
                        ));
                    }
                    Some(found) if !found.ended() => return Ok(Value::Null),
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
                Ok(Value::Null)
            }
            Method::Write => {
                let Write { terminal, data } = decode(params)?;
                if data.len() > AT_ONCE {
                    return Err(Refusal::invalid("Type at most 64 KB at once."));
                }
                let terminal = self.find(space.id(), terminal)?;
                terminal.write(&data).await.map_err(Refusal::conflict)?;
                Ok(Value::Null)
            }
            Method::Resize => {
                let Resize { terminal, size } = decode(params)?;
                allowed(size)?;
                let terminal = self.find(space.id(), terminal)?;
                terminal.resize(size).await.map_err(Refusal::conflict)?;
                Ok(Value::Null)
            }
            Method::Close => {
                let One { terminal } = decode(params)?;
                let closed = match self.open.lock().unwrap().entry(terminal) {
                    Entry::Occupied(found) if found.get().space == space.id() => {
                        Some(found.remove())
                    }
                    _ => None,
                };
                if let Some(closed) = closed {
                    closed.close();
                }
                Ok(Value::Null)
            }
            Method::Watch => Err(Refusal::invalid("terminal.watch is a stream.")),
        }
    }

    async fn stream(&self, call: Call, method: &str, params: Value) -> Result<Stream, Refusal> {
        match Method::parse(method) {
            Some(Method::Watch) => {
                let One { terminal } = decode(params)?;
                Ok(self.find(call.space().id(), terminal)?.watch())
            }
            _ => Err(Refusal::invalid(format!(
                "terminal.{method} is not a stream."
            ))),
        }
    }
}
