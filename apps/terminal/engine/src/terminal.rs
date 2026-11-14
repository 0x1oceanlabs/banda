//! One terminal: a program on a PTY, what it printed, and who watches it.
//!
//! The program starts in its Project's environment (ADR 0084), which hands
//! back the terminal and the handle that stops the program and what it
//! started: on Unix the session and the process group it leads. A close
//! while it runs asks it to stop, a hangup and a request on Unix, then
//! kills it a second later; a shell passes the hangup on to its jobs. Once
//! the program ended, a close sends nothing: the kernel hung up the
//! terminal when its session's leader ended. When the engine stops, the
//! PTY closes and the program hears the hangup.

use crate::front::Front;
use crate::history::{Decoder, History, Since};
use crate::model::{Drawn, Ended, Open, Piece, Size, Title};
use crate::servers::TERMINAL_VARIABLE;
use banda_kernel::{
    ModuleProject, PANE_VARIABLE, Program, ProjectId, PtyControl, Started, Stream, project_env,
};
use std::collections::BTreeMap;
use std::os::unix::process::ExitStatusExt;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{Notify, mpsc, watch};
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
    input: tokio::sync::Mutex<Box<dyn AsyncWrite + Send + Unpin>>,
    control: Arc<dyn PtyControl>,
    /// Asks the program to stop: what waits for it stops it.
    closing: Notify,
    now: Mutex<Now>,
    /// Ticks at every change, so watchers look again.
    changed: watch::Sender<()>,
    /// The module's, shared by every terminal: ticks as a program comes
    /// to the front or leaves it, and as the terminal ends or closes, so
    /// `running` counts again.
    fronts: watch::Sender<()>,
}

#[derive(Default)]
struct Now {
    history: History,
    size: Size,
    ended: Option<Ended>,
    title: Option<Title>,
    /// Whether a program runs in front: the one it was opened with, or
    /// one its shell started, as the shell's last look saw.
    program: bool,
    closed: bool,
}

impl Terminal {
    /// Starts `open.program`, or the Person's shell, in `project`'s
    /// folder and environment. It ticks `fronts` as a program comes to its
    /// front or leaves it, and as it ends or closes.
    pub fn start(
        project: &ModuleProject,
        open: Open,
        fronts: watch::Sender<()>,
    ) -> Result<Arc<Terminal>, String> {
        let mut env = BTreeMap::from([
            ("TERM".to_owned(), "xterm-256color".to_owned()),
            ("COLORTERM".to_owned(), "truecolor".to_owned()),
        ]);
        // What it carries tells its servers (ADR 0044, decision 2).
        env.extend(open.env.clone());
        env.extend(project_env(project.id()).map(|(key, id)| (key.to_owned(), id)));
        env.insert(TERMINAL_VARIABLE.to_owned(), open.terminal.to_string());
        if let Some(pane) = open.pane {
            env.insert(PANE_VARIABLE.to_owned(), pane.to_string());
        }
        // The Person's, outside the fence (ADR 0083, decision 1).
        let shell_or_program = open.program.clone().unwrap_or_else(shell);
        let mut program = Program::terminal(shell_or_program, open.args.clone());
        program.env = env;
        // What Electron tells its own children is not for a Person's
        // program, nor the Pane of another Banda's terminal the engine
        // was started in.
        program.unset = (std::env::vars_os())
            .filter_map(|(key, _)| key.into_string().ok())
            .filter(|key| key.starts_with("ELECTRON_"))
            .chain([PANE_VARIABLE.to_owned()])
            .collect();
        program.cwd = Some(project.folder());
        let (started, pty) = (project.environment().pty(&program, open.size.pty()))
            .map_err(|e| format!("{} could not start: {e}.", program.program))?;
        let terminal = Arc::new(Terminal {
            project: project.id(),
            input: tokio::sync::Mutex::new(pty.input),
            control: pty.control,
            closing: Notify::new(),
            now: Mutex::new(Now {
                size: open.size,
                // A shell runs none until its look says so.
                program: open.program.is_some(),
                ..Now::default()
            }),
            changed: watch::Sender::new(()),
            fronts,
        });
        let reading = tokio::spawn(terminal.clone().read(pty.output));
        // A shell's header says what runs in it; another program's keeps
        // the title it was opened with.
        if open.program.is_none() {
            let front = Front::new(terminal.control.clone(), started.id());
            tokio::spawn(terminal.clone().title(front));
        }
        tokio::spawn(terminal.clone().wait(started, reading));
        Ok(terminal)
    }

    async fn read(self: Arc<Self>, mut output: Box<dyn AsyncRead + Send + Unpin>) {
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
                let title = front.look();
                let program = front.program();
                let mut now = self.now.lock().unwrap();
                let came_or_left = std::mem::replace(&mut now.program, program) != program;
                let titled = match title {
                    Some(title) if now.title.as_ref() != Some(&title) => {
                        now.title = Some(title);
                        true
                    }
                    _ => false,
                };
                drop(now);
                if came_or_left {
                    self.fronts.send_replace(());
                }
                if titled {
                    self.changed.send_replace(());
                }
            }
        }
    }

    /// Waits for the program to end, and stops it once the terminal is
    /// closed: asked first, killed if it has not ended a moment after.
    async fn wait(self: Arc<Self>, mut started: Started, reading: JoinHandle<()>) {
        let status = tokio::select! {
            status = started.wait() => status,
            () = self.closing.notified() => started.stop(GRACE).await,
        };
        let ended = match status {
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
        self.fronts.send_replace(());
    }

    pub fn ended(&self) -> bool {
        self.now.lock().unwrap().ended.is_some()
    }

    /// Whether a program runs in front: the one it was opened with, or one
    /// its shell started, until the terminal ends or is closed.
    pub fn runs_a_program(&self) -> bool {
        let now = self.now.lock().unwrap();
        now.program && now.ended.is_none() && !now.closed
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
        self.control.resize(size.pty()).map_err(plain)?;
        self.now.lock().unwrap().size = size;
        self.changed.send_replace(());
        Ok(())
    }

    /// Stops the program and everything it started, and ends every watch.
    pub fn close(&self) {
        self.now.lock().unwrap().closed = true;
        self.changed.send_replace(());
        self.fronts.send_replace(());
        self.closing.notify_one();
    }

    /// What the terminal shows, then what it prints and whether it ended,
    /// until it is closed. A watcher that falls behind gets the whole
    /// screen again. One that says what it drew `after` goes on from
    /// there, while the terminal still keeps it.
    pub fn watch(self: &Arc<Self>, after: Option<Drawn>) -> Stream {
        // One piece waits at a time; what comes meanwhile goes in the next.
        let (say, heard) = mpsc::channel(1);
        let terminal = self.clone();
        let mut changed = self.changed.subscribe();
        tokio::spawn(async move {
            // From what its window drew, while that is a place in what
            // the terminal keeps of this run.
            let up_to = after.and_then(|drawn| terminal.now.lock().unwrap().history.after(drawn));
            let mut told = Told {
                up_to,
                ..Told::default()
            };
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
        let place = now.history.place();
        told.up_to = Some(place.at);
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
                    // As `Terminals::in_order` tells the router.
                    in_order: true,
                    drawn: Some(place),
                });
            }
            // The first answer to a window that said what it drew: no
            // screen, only what it missed, and its size and its end as a
            // snapshot says them.
            Some(Since::Pieces(texts)) if told.size.is_none() => {
                told.size = Some(now.size);
                told.end = now.ended.is_some();
                pieces.push(Piece::Resumed {
                    missed: texts.concat(),
                    at: place.at,
                    size: now.size,
                    ended: now.ended,
                    in_order: true,
                });
            }
            Some(Since::Pieces(texts)) if !texts.is_empty() => pieces.push(Piece::Output {
                text: texts.concat(),
                at: Some(place.at),
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
