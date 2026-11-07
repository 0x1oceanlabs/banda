//! A Harness's program on pipes. Its Project's environment starts it as
//! the connection begins (ADR 0084, decision 4), and ACP's frames go one
//! a line, on its stdin and its stdout. What it writes on stderr is heard
//! line by line, and the last of it is kept: a program that ended with
//! another code than 0 says it as the connection ends.
//!
//! The program leads a process group of its own. That group is killed as
//! the program ends, so a launcher such as `npx` leaves nothing behind,
//! and as the connection is dropped, so what it started stops too.

use agent_client_protocol::util::internal_error;
use agent_client_protocol::{Agent, Client, ConnectTo, Lines};
use banda_kernel::{Environment, Input, Program};
use rustix::process::{Pid, Signal, kill_process_group};
use std::collections::VecDeque;
use std::io;
use std::process::ExitStatus;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::{oneshot, watch};
use tokio::time::timeout;

/// The most of stderr kept, and the longest line of it heard whole.
const KEPT: usize = 64 * 1024;
/// How long a program that ended may still say why, how long one whose
/// connection ended may take to end, and how long a write may wait on a
/// program that closed its stdout.
const GRACE: Duration = Duration::from_secs(1);

/// Where a line went.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Said {
    /// To the Harness, on its stdin.
    ToHarness,
    /// To Banda, on its stdout.
    ToBanda,
    /// On its stderr.
    Stderr,
}

/// Hears each line as it goes.
pub(super) type Hears = Arc<dyn Fn(&str, Said) + Send + Sync>;

/// A Harness's program, started in `environment` once connected to.
pub(super) struct Pipes {
    pub environment: Arc<dyn Environment>,
    pub program: Program,
    pub hears: Hears,
}

impl ConnectTo<Client> for Pipes {
    async fn connect_to(
        self,
        client: impl ConnectTo<Agent>,
    ) -> Result<(), agent_client_protocol::Error> {
        let Pipes {
            environment,
            program,
            hears,
        } = self;
        let mut child = (environment.spawn(&program, Input::Piped)).map_err(internal_error)?;
        let mut group = Group::of(&child);
        let (Some(stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            return Err(internal_error("The Harness's pipes did not open."));
        };
        let tail = Tail::default();
        let (heard_all, stderr_ended) = oneshot::channel();
        let hearing = {
            let (hears, tail) = (hears.clone(), tail.clone());
            async move {
                hear(stderr, &hears, &tail).await;
                let _ = heard_all.send(());
            }
        };
        let (closed, stdout_closed) = watch::channel(false);
        let incoming = incoming(stdout, hears.clone(), closed);
        let outgoing = outgoing(stdin, hears, stdout_closed);
        let protocol = ConnectTo::<Client>::connect_to(Lines::new(outgoing, incoming), client);
        let running = async {
            tokio::pin!(protocol);
            tokio::select! {
                spoken = &mut protocol => {
                    spoken?;
                    // Given a moment, a program that ended badly says so;
                    // one that goes on is killed as its group is dropped.
                    match timeout(GRACE, child.wait()).await {
                        Ok(status) => ended(status, &mut group, stderr_ended, &tail).await,
                        Err(_) => Ok(()),
                    }
                }
                status = child.wait() => {
                    ended(status, &mut group, stderr_ended, &tail).await?;
                    timeout(GRACE, protocol).await.unwrap_or(Ok(()))
                }
            }
        };
        tokio::pin!(running, hearing);
        tokio::select! {
            result = &mut running => result,
            () = &mut hearing => running.await,
        }
    }
}

/// After the program ended: its group is killed, and an end with another
/// code than 0 is an error that says the last of its stderr.
async fn ended(
    status: io::Result<ExitStatus>,
    group: &mut Group,
    stderr_ended: oneshot::Receiver<()>,
    tail: &Tail,
) -> Result<(), agent_client_protocol::Error> {
    let status =
        status.map_err(|error| internal_error(format!("Failed to wait for process: {error}")))?;
    // A launcher may end while what it started holds its pipes.
    group.kill();
    if status.success() {
        return Ok(());
    }
    let _ = timeout(GRACE, stderr_ended).await;
    let said = tail.take();
    Err(internal_error(match said.is_empty() {
        true => format!("Process exited with {status}"),
        false => format!("Process exited with {status}: {said}"),
    }))
}

/// The process group a program leads, killed when dropped.
struct Group(Option<Pid>);

impl Group {
    fn of(child: &Child) -> Group {
        let id = child.id().and_then(|id| i32::try_from(id).ok());
        Group(id.and_then(Pid::from_raw))
    }

    /// Kills it; a group already gone stays so.
    fn kill(&mut self) {
        if let Some(group) = self.0 {
            let _ = kill_process_group(group, Signal::KILL);
        }
    }
}

impl Drop for Group {
    fn drop(&mut self) {
        self.kill();
    }
}

/// The lines it writes on stdout, each heard; once it closed its stdout,
/// `closed` says so.
fn incoming(
    stdout: ChildStdout,
    hears: Hears,
    closed: watch::Sender<bool>,
) -> impl futures::Stream<Item = io::Result<String>> + Send + 'static {
    let lines = BufReader::new(stdout).lines();
    futures::stream::unfold(
        (lines, hears, closed),
        |(mut lines, hears, closed)| async move {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    hears(&line, Said::ToBanda);
                    Some((Ok(line), (lines, hears, closed)))
                }
                Ok(None) => {
                    closed.send_replace(true);
                    None
                }
                Err(error) => Some((Err(error), (lines, hears, closed))),
            }
        },
    )
}

/// Writes each line to its stdin, heard first.
fn outgoing(
    stdin: ChildStdin,
    hears: Hears,
    stdout_closed: watch::Receiver<bool>,
) -> impl futures::Sink<String, Error = io::Error> + Send + 'static {
    futures::sink::unfold(
        (stdin, hears, stdout_closed),
        |(mut stdin, hears, mut stdout_closed), line: String| async move {
            hears(&line, Said::ToHarness);
            write(&mut stdin, line, &mut stdout_closed).await?;
            Ok((stdin, hears, stdout_closed))
        },
    )
}

/// Writes `line` and its newline. A program that closed its stdout and
/// reads no more cannot hold the write open for longer than [`GRACE`].
async fn write(
    stdin: &mut ChildStdin,
    line: String,
    stdout_closed: &mut watch::Receiver<bool>,
) -> io::Result<()> {
    let mut bytes = line.into_bytes();
    bytes.push(b'\n');
    let writing = async {
        stdin.write_all(&bytes).await?;
        stdin.flush().await
    };
    tokio::pin!(writing);
    let closing = async { stdout_closed.wait_for(|closed| *closed).await.is_ok() };
    tokio::select! {
        written = &mut writing => written,
        closed = closing => match closed {
            // Only a stdout that closed bounds it, not one let go of.
            false => writing.await,
            true => timeout(GRACE, writing).await.unwrap_or_else(|_| {
                Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "The Harness closed its stdout and did not read what was left to send.",
                ))
            }),
        },
    }
}

/// Hears what it writes on stderr, a line at a time, and keeps the last
/// of it.
async fn hear(mut stderr: ChildStderr, hears: &Hears, tail: &Tail) {
    let mut buffer = vec![0; 8 * 1024];
    let mut line = Line::default();
    loop {
        match stderr.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => {
                tail.push(&buffer[..read]);
                for &byte in &buffer[..read] {
                    match byte {
                        b'\n' => line.say(hears),
                        byte => line.push(byte),
                    }
                }
            }
            Err(error) => {
                tracing::warn!(%error, "a Harness's stderr could not be read");
                break;
            }
        }
    }
    if !line.bytes.is_empty() || line.cut {
        line.say(hears);
    }
}

/// A line of stderr as it comes, up to [`KEPT`] of it.
#[derive(Default)]
struct Line {
    bytes: Vec<u8>,
    /// It ran longer than is kept.
    cut: bool,
}

impl Line {
    fn push(&mut self, byte: u8) {
        match self.bytes.len() < KEPT {
            true => self.bytes.push(byte),
            false => self.cut = true,
        }
    }

    fn say(&mut self, hears: &Hears) {
        let bytes = self.bytes.strip_suffix(b"\r").unwrap_or(&self.bytes);
        let mut said = String::from_utf8_lossy(bytes).into_owned();
        if self.cut {
            said.push_str("… [stderr line truncated]");
        }
        hears(&said, Said::Stderr);
        self.bytes.clear();
        self.cut = false;
    }
}

/// The last [`KEPT`] bytes of stderr, and whether more came before them.
#[derive(Clone, Default)]
struct Tail(Arc<Mutex<(VecDeque<u8>, bool)>>);

impl Tail {
    fn push(&self, bytes: &[u8]) {
        let mut kept = self.0.lock().unwrap();
        let (last, cut) = &mut *kept;
        let over = (last.len() + bytes.len()).saturating_sub(KEPT);
        if over > 0 {
            *cut = true;
            let from_last = over.min(last.len());
            last.drain(..from_last);
        }
        let skip = bytes.len().saturating_sub(KEPT);
        last.extend(&bytes[skip..]);
    }

    fn take(&self) -> String {
        let (mut last, cut) = std::mem::take(&mut *self.0.lock().unwrap());
        let said = String::from_utf8_lossy(last.make_contiguous()).into_owned();
        match cut {
            true => format!("[stderr truncated; showing last {KEPT} bytes]\n{said}"),
            false => said,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_last_of_stderr_is_kept() {
        let tail = Tail::default();
        tail.push(b"first\n");
        assert_eq!(tail.take(), "first\n");
        tail.push(&vec![b'a'; KEPT]);
        tail.push(b"end");
        let kept = tail.take();
        assert!(kept.starts_with("[stderr truncated"), "{}", &kept[..40]);
        assert!(kept.ends_with("aend"));
        assert_eq!(kept.lines().nth(1).unwrap().len(), KEPT);
    }
}
