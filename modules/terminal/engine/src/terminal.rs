//! One terminal: a program on a PTY, what it printed, and who watches it.
//!
//! The program leads a session of its own, so a close reaches everything it
//! started: a hangup and a request to stop, then a kill a second later. When
//! the engine stops, the PTY closes and the program hears the hangup.

use crate::history::{Decoder, History, Since};
use crate::model::{Ended, Open, Piece, Size};
use bandaso_kernel::{SpaceId, Stream};
use pty_process::{OwnedReadPty, OwnedWritePty};
use rustix::process::{Pid, Signal, kill_process_group};
use std::os::unix::process::ExitStatusExt;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

/// How long a closed program has to stop before it is killed.
const GRACE: Duration = Duration::from_secs(1);
/// How long what a program printed may still come after it ended: a
/// program it started may hold the PTY open.
const LAST_WORDS: Duration = Duration::from_millis(200);

pub struct Terminal {
    pub space: SpaceId,
    group: Option<Pid>,
    input: tokio::sync::Mutex<OwnedWritePty>,
    now: Mutex<Now>,
    /// Ticks at every change, so watchers look again.
    changed: watch::Sender<()>,
}

#[derive(Default)]
struct Now {
    history: History,
    size: Size,
    ended: Option<Ended>,
    closed: bool,
}

impl Terminal {
    /// Starts `open.program`, or the Person's shell, in `folder`.
    pub fn start(space: SpaceId, folder: &Path, open: Open) -> Result<Arc<Terminal>, String> {
        let (pty, pts) = pty_process::open().map_err(plain)?;
        pty.resize(open.size.pty()).map_err(plain)?;
        let program = open.program.clone().unwrap_or_else(shell);
        let mut command = pty_process::Command::new(&program)
            .args(&open.args)
            .current_dir(folder)
            .env("TERM", "xterm-256color")
            .env("COLORTERM", "truecolor");
        // What Electron tells its own children is not for a Person's program.
        for (key, _) in std::env::vars_os() {
            if key.to_string_lossy().starts_with("ELECTRON_") {
                command = command.env_remove(key);
            }
        }
        let child = command
            .envs(&open.env)
            .spawn(pts)
            .map_err(|e| format!("{program} could not start: {e}."))?;
        let group = child
            .id()
            .and_then(|id| i32::try_from(id).ok())
            .and_then(Pid::from_raw);
        let (output, input) = pty.into_split();
        let terminal = Arc::new(Terminal {
            space,
            group,
            input: tokio::sync::Mutex::new(input),
            now: Mutex::new(Now {
                size: open.size,
                ..Now::default()
            }),
            changed: watch::Sender::new(()),
        });
        let reading = tokio::spawn(terminal.clone().read(output));
        tokio::spawn(terminal.clone().wait(child, reading));
        Ok(terminal)
    }

    async fn read(self: Arc<Self>, mut output: OwnedReadPty) {
        let mut decoder = Decoder::default();
        let mut buffer = vec![0; 16 * 1024];
        // A PTY whose program ended reads as an error.
        while let Ok(read @ 1..) = output.read(&mut buffer).await {
            let text = decoder.decode(&buffer[..read]);
            if !text.is_empty() {
                self.now.lock().unwrap().history.add(text);
                self.changed.send_replace(());
            }
        }
    }

    async fn wait(self: Arc<Self>, mut child: tokio::process::Child, reading: JoinHandle<()>) {
        let ended = match child.wait().await {
            Ok(status) => Ended {
                code: status.code(),
                signal: status.signal(),
            },
            Err(_) => Ended {
                code: None,
                signal: None,
            },
        };
        // Everything it printed comes before that it ended.
        let _ = tokio::time::timeout(LAST_WORDS, reading).await;
        self.now.lock().unwrap().ended = Some(ended);
        self.changed.send_replace(());
    }

    /// Types `data` into the program.
    pub async fn write(&self, data: &str) -> Result<(), String> {
        let mut input = self.input.lock().await;
        input.write_all(data.as_bytes()).await.map_err(plain)
    }

    pub async fn resize(&self, size: Size) -> Result<(), String> {
        self.input.lock().await.resize(size.pty()).map_err(plain)?;
        self.now.lock().unwrap().size = size;
        Ok(())
    }

    /// Stops the program and everything it started, and ends every watch.
    pub fn close(self: &Arc<Self>) {
        self.now.lock().unwrap().closed = true;
        self.changed.send_replace(());
        let Some(group) = self.group else {
            return;
        };
        if self.now.lock().unwrap().ended.is_some() {
            return;
        }
        let _ = kill_process_group(group, Signal::HUP);
        let _ = kill_process_group(group, Signal::TERM);
        let terminal = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(GRACE).await;
            if terminal.now.lock().unwrap().ended.is_none() {
                let _ = kill_process_group(group, Signal::KILL);
            }
        });
    }

    /// What the terminal shows, then what it prints and whether it ended,
    /// until it is closed. A watcher that falls behind gets the whole
    /// screen again.
    pub fn watch(self: &Arc<Self>) -> Stream {
        let (say, heard) = mpsc::channel(16);
        let terminal = self.clone();
        let mut changed = self.changed.subscribe();
        tokio::spawn(async move {
            let mut heard_up_to = None;
            let mut told_end = false;
            loop {
                changed.mark_unchanged();
                let pieces = terminal.since(&mut heard_up_to, &mut told_end);
                let Some(pieces) = pieces else {
                    return;
                };
                for piece in pieces {
                    let Ok(piece) = serde_json::to_value(piece) else {
                        return;
                    };
                    if say.send(piece).await.is_err() {
                        return;
                    }
                }
                if changed.changed().await.is_err() {
                    return;
                }
            }
        });
        heard
    }

    /// What a watcher that heard up to `heard_up_to` has not heard yet;
    /// `None` once the terminal is closed.
    fn since(&self, heard_up_to: &mut Option<u64>, told_end: &mut bool) -> Option<Vec<Piece>> {
        let now = self.now.lock().unwrap();
        if now.closed {
            return None;
        }
        let snapshot = || Piece::Snapshot {
            history: now.history.all(),
            size: now.size,
            ended: now.ended,
        };
        let mut pieces = Vec::new();
        match heard_up_to.map(|from| now.history.since(from)) {
            None => pieces.push(snapshot()),
            Some(Since::Gone) => pieces.push(snapshot()),
            Some(Since::Pieces(texts)) if !texts.is_empty() => pieces.push(Piece::Output {
                text: texts.concat(),
            }),
            Some(Since::Pieces(_)) => {}
        }
        let snapshot_told = matches!(pieces.first(), Some(Piece::Snapshot { .. }));
        if let Some(ended) = now.ended
            && !*told_end
        {
            if !snapshot_told {
                pieces.push(Piece::Exited { ended });
            }
            *told_end = true;
        }
        *heard_up_to = Some(now.history.next());
        Some(pieces)
    }
}

/// The Person's shell.
fn shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/sh".to_owned())
}

fn plain(error: impl std::fmt::Display) -> String {
    error.to_string()
}
