//! One terminal: a program on a PTY, what it printed, and who watches it.
//!
//! The program starts in its Project's environment (ADR 0084), and leads
//! a session and a process group of its own there. A close while it runs
//! reaches its group: a hangup and a request to stop, then a kill a
//! second later; a shell passes the hangup on to its jobs. Once the
//! program ended, its number may name another process, so a close sends
//! nothing: the kernel hung up the terminal when its session's leader
//! ended. When the engine stops, the PTY closes and the program hears the
//! hangup.

use crate::front::Front;
use crate::history::{Decoder, History, Since};
use crate::model::{Ended, Open, Piece, Size, Title};
use crate::servers::TERMINAL_VARIABLE;
use banda_kernel::{Environment, Program, ProjectId, Stream, project_env};
use pty_process::{OwnedReadPty, OwnedWritePty};
use rustix::process::{Pid, Signal, kill_process_group};
use std::collections::BTreeMap;
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
/// How long typing may wait for a program that does not read.
const TYPING: Duration = Duration::from_secs(5);
/// When, after a shell printed, its terminal looks what runs in front: a
/// command typed has mostly started at the first, and one whose shell is
/// slow to start it at the second.
const LOOKS: [Duration; 2] = [Duration::from_millis(250), Duration::from_secs(1)];

pub struct Terminal {
    pub project: ProjectId,
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
    title: Option<Title>,
    closed: bool,
}

impl Terminal {
    /// Starts `open.program`, or the Person's shell, in `folder`, in the
    /// Project's `environment`.
    pub fn start(
        project: ProjectId,
        environment: &dyn Environment,
        folder: &Path,
        open: Open,
    ) -> Result<Arc<Terminal>, String> {
        let (pty, pts) = pty_process::open().map_err(plain)?;
        pty.resize(open.size.pty()).map_err(plain)?;
        let mut env = BTreeMap::from([
            ("TERM".to_owned(), "xterm-256color".to_owned()),
            ("COLORTERM".to_owned(), "truecolor".to_owned()),
        ]);
        // What it carries tells its servers (ADR 0044, decision 2).
        env.extend(open.env.clone());
        env.extend(project_env(project).map(|(key, id)| (key.to_owned(), id)));
        env.insert(TERMINAL_VARIABLE.to_owned(), open.terminal.to_string());
        let program = Program {
            program: open.program.clone().unwrap_or_else(shell),
            args: open.args.clone(),
            env,
            // What Electron tells its own children is not for a Person's
            // program.
            unset: (std::env::vars_os())
                .filter_map(|(key, _)| key.into_string().ok())
                .filter(|key| key.starts_with("ELECTRON_"))
                .collect(),
            cwd: Some(folder.to_owned()),
        };
        let child = (environment.pty(&program, pts))
            .map_err(|e| format!("{} could not start: {e}.", program.program))?;
        let group = child
            .id()
            .and_then(|id| i32::try_from(id).ok())
            .and_then(Pid::from_raw);
        // A shell's header says what runs in it; another program's keeps
        // the title it was opened with.
        let front = match open.program {
            None => Some(rustix::io::dup(&pty).map_err(plain)?),
            Some(_) => None,
        };
        let (output, input) = pty.into_split();
        let terminal = Arc::new(Terminal {
            project,
            group,
            input: tokio::sync::Mutex::new(input),
            now: Mutex::new(Now {
                size: open.size,
                ..Now::default()
            }),
            changed: watch::Sender::new(()),
        });
        let reading = tokio::spawn(terminal.clone().read(output));
        if let Some(front) = front {
            let shell = group.map(Pid::as_raw_pid);
            tokio::spawn(terminal.clone().title(Front::new(front, shell)));
        }
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

    /// Follows what runs in front of a shell until it ends: a shell
    /// prints as a command starts and as it ends, so it looks a moment
    /// after something changed, and at most that often.
    async fn title(self: Arc<Self>, mut front: Front) {
        let mut changed = self.changed.subscribe();
        while changed.changed().await.is_ok() {
            for wait in LOOKS {
                tokio::time::sleep(wait).await;
                if self.ended() {
                    return;
                }
                let Some(title) = front.look() else {
                    continue;
                };
                let mut now = self.now.lock().unwrap();
                if now.title.as_ref() != Some(&title) {
                    now.title = Some(title);
                    drop(now);
                    self.changed.send_replace(());
                }
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

    pub fn ended(&self) -> bool {
        self.now.lock().unwrap().ended.is_some()
    }

    /// Types `data` into the program.
    pub async fn write(&self, data: &str) -> Result<(), String> {
        let mut input = self.input.lock().await;
        match tokio::time::timeout(TYPING, input.write_all(data.as_bytes())).await {
            Ok(written) => written.map_err(plain),
            Err(_) => Err("The program in this terminal does not read what you type.".to_owned()),
        }
    }

    pub async fn resize(&self, size: Size) -> Result<(), String> {
        self.input.lock().await.resize(size.pty()).map_err(plain)?;
        self.now.lock().unwrap().size = size;
        self.changed.send_replace(());
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
        // One piece waits at a time; what comes meanwhile goes in the next.
        let (say, heard) = mpsc::channel(1);
        let terminal = self.clone();
        let mut changed = self.changed.subscribe();
        tokio::spawn(async move {
            let mut told = Told::default();
            loop {
                changed.mark_unchanged();
                let Some(pieces) = terminal.since(&mut told) else {
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
                // A watcher the window let go of ends now, not at the next
                // output.
                tokio::select! {
                    changed = changed.changed() => if changed.is_err() {
                        return;
                    },
                    () = say.closed() => return,
                }
            }
        });
        heard
    }

    /// What a watcher that was `told` this much has not heard yet; `None`
    /// once the terminal is closed.
    fn since(&self, told: &mut Told) -> Option<Vec<Piece>> {
        let now = self.now.lock().unwrap();
        if now.closed {
            return None;
        }
        let output = told.up_to.map(|from| now.history.since(from));
        told.up_to = Some(now.history.next());
        let mut pieces = Vec::new();
        match output {
            None | Some(Since::Gone) => {
                told.size = Some(now.size);
                told.end = now.ended.is_some();
                // Its title, if it has one, comes next.
                pieces.push(Piece::Snapshot {
                    history: now.history.all(),
                    size: now.size,
                    ended: now.ended,
                });
            }
            Some(Since::Pieces(texts)) if !texts.is_empty() => pieces.push(Piece::Output {
                text: texts.concat(),
            }),
            Some(Since::Pieces(_)) => {}
        }
        if told.size != Some(now.size) {
            told.size = Some(now.size);
            pieces.push(Piece::Resized { size: now.size });
        }
        if told.title != now.title
            && let Some(title) = now.title.clone()
        {
            told.title = Some(title.clone());
            pieces.push(Piece::Titled { title });
        }
        if let Some(ended) = now.ended
            && !told.end
        {
            told.end = true;
            pieces.push(Piece::Exited { ended });
        }
        Some(pieces)
    }
}

/// What a watcher has heard so far.
#[derive(Default)]
struct Told {
    /// The number of the first piece of output it has not heard.
    up_to: Option<u64>,
    size: Option<Size>,
    title: Option<Title>,
    end: bool,
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
