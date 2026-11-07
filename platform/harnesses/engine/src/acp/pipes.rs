//! A Harness's program on pipes. Its Project's environment starts it as
//! the connection begins (ADR 0084, decision 4), and ACP's frames go one
//! a line, on its stdin and its stdout. What it writes on stderr is heard
//! line by line, and the last of it is kept: a program that ended with
//! another code than 0 says it as the connection ends.
//!
//! The program leads a process group of its own. That group is killed as
//! the program ends, so a launcher such as `npx` leaves nothing behind,
//! and as the connection is dropped, so what it started stops too. Windows
//! has no process groups: there the program alone is killed as it is
//! dropped, until it is born in a Job Object (ADR 0090, step 3).
//!
//! It keeps the transport of ACP's own `AcpAgent` as of
//! agent-client-protocol 3.6: its grace periods, its "Process exited
//! with …" and how much of stderr it keeps. Compare it with that on an
//! upgrade.

use agent_client_protocol::util::internal_error;
use agent_client_protocol::{Agent, Client, ConnectTo, Lines};
#[cfg(unix)]
use banda_kernel::ProcessGroup;
use banda_kernel::{Environment, Input, Program};
#[cfg(unix)]
use rustix::process::Signal;
use std::collections::VecDeque;
use std::io;
use std::process::ExitStatus;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStderr, ChildStdin, ChildStdout};
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
        let mut group = Killed::of(&child);
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
    group: &mut Killed,
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

/// The process group the program leads, killed when dropped.
#[cfg(unix)]
struct Killed(Option<ProcessGroup>);

/// None on Windows, where the program is killed alone (ADR 0090, step 3).
#[cfg(not(unix))]
struct Killed;

impl Killed {
    #[cfg(unix)]
    fn of(child: &tokio::process::Child) -> Killed {
        Killed(ProcessGroup::of(child))
    }

    #[cfg(not(unix))]
    fn of(_: &tokio::process::Child) -> Killed {
        Killed
    }

    /// Kills it; a group already gone stays so.
    #[cfg(unix)]
    fn kill(&mut self) {
        if let Some(group) = self.0 {
            group.signal(Signal::KILL);
        }
    }

    #[cfg(not(unix))]
    fn kill(&mut self) {}
}

impl Drop for Killed {
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

// They run `sh` and look for processes by number, as Unix has them.
#[cfg(unix)]
#[cfg(test)]
mod tests {
    use super::*;
    use banda_environments::Local;
    use banda_kernel::Holes;
    use rustix::process::{Pid, test_kill_process};
    use std::path::Path;
    use std::time::Instant;

    /// How long a test waits for what should come at once.
    const SOON: Duration = Duration::from_secs(5);

    /// `script` run by `sh` on the host, with `file` as its `$1`; each
    /// line of stderr it says heard into `heard`.
    fn sh(script: &str, file: &Path, heard: &Arc<Mutex<Vec<String>>>) -> Pipes {
        let heard = heard.clone();
        Pipes {
            environment: Arc::new(Local),
            program: Program::harness(
                "sh",
                ["-c", script, "sh", &file.display().to_string()]
                    .map(str::to_owned)
                    .to_vec(),
                Holes::default(),
            ),
            hears: Arc::new(move |line, said| {
                if said == Said::Stderr {
                    heard.lock().unwrap().push(line.to_owned());
                }
            }),
        }
    }

    /// The process whose number the script wrote to `file`, once it has.
    async fn written(file: &Path) -> Pid {
        let reading = async {
            loop {
                let said = std::fs::read_to_string(file).unwrap_or_default();
                if let Ok(id) = said.trim().parse() {
                    return Pid::from_raw(id).unwrap();
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        };
        timeout(SOON, reading)
            .await
            .expect("the script said its child")
    }

    /// Whether `pid` still runs: a killed one may stay a zombie a moment,
    /// till it is reaped.
    fn runs(pid: Pid) -> bool {
        if test_kill_process(pid).is_err() {
            return false;
        }
        let stat = std::fs::read_to_string(format!("/proc/{}/stat", pid.as_raw_pid()));
        stat.map_or(true, |stat| {
            let state = stat.rsplit(')').next().unwrap_or_default().trim_start();
            !state.starts_with('Z')
        })
    }

    async fn gone(pid: Pid) {
        let ending = async {
            while runs(pid) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        };
        timeout(SOON, ending)
            .await
            .expect("what it started is gone");
    }

    #[tokio::test]
    async fn a_program_that_ends_badly_says_why_with_the_last_of_its_stderr() {
        let folder = tempfile::tempdir().unwrap();
        let heard = Arc::default();
        let pipes = sh("echo oops >&2; exit 3", &folder.path().join("pid"), &heard);
        let ended = timeout(SOON, Client.builder().connect_to(pipes)).await;
        let error = ended.expect("it ends with the program").unwrap_err();
        let said = error.data.map(|data| data.to_string()).unwrap_or_default();
        assert!(said.contains("Process exited with"), "{said}");
        assert!(said.contains('3'), "{said}");
        assert!(said.contains("oops"), "{said}");
        assert_eq!(*heard.lock().unwrap(), ["oops"]);
    }

    #[tokio::test]
    async fn what_a_launcher_left_behind_is_killed_as_it_ends() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("pid");
        // As `npx` may: it ends, and what it started holds its pipes.
        let pipes = sh(
            "sleep 30 & echo $! > \"$1\"; exit 0",
            &file,
            &Arc::default(),
        );
        let ended = timeout(SOON, Client.builder().connect_to(pipes)).await;
        ended.expect("it ends with the launcher").unwrap();
        gone(written(&file).await).await;
    }

    #[tokio::test]
    async fn what_it_started_is_killed_as_the_connection_is_dropped() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("pid");
        let pipes = sh("sleep 30 & echo $! > \"$1\"; wait", &file, &Arc::default());
        let connection = tokio::spawn(Client.builder().connect_to(pipes));
        let child = written(&file).await;
        assert!(runs(child));
        connection.abort();
        let _ = connection.await;
        gone(child).await;
    }

    #[tokio::test]
    async fn a_write_to_a_program_that_closed_its_stdout_ends_soon() {
        let args = ["-c", "exec 1>&-; exec sleep 30"].map(str::to_owned);
        let program = Program::harness("sh", args.to_vec(), Holes::default());
        let mut child = Local.spawn(&program, Input::Piped).unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let (_closed, mut stdout_closed) = watch::channel(true);
        // More than a pipe holds, which it never reads.
        let line = "x".repeat(4 * 1024 * 1024);
        let began = Instant::now();
        let written = timeout(SOON, write(&mut stdin, line, &mut stdout_closed)).await;
        let error = written.expect("bounded by the grace").unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(began.elapsed() < GRACE * 3, "{:?}", began.elapsed());
    }

    #[tokio::test]
    async fn each_line_of_stderr_is_heard_without_its_return() {
        let args = ["-c", "printf 'one\\r\\ntwo\\n\\nlast' >&2"].map(str::to_owned);
        let program = Program::harness("sh", args.to_vec(), Holes::default());
        let mut child = Local.spawn(&program, Input::Null).unwrap();
        let heard = Arc::new(Mutex::new(Vec::new()));
        let hears: Hears = {
            let heard = heard.clone();
            Arc::new(move |line, _| heard.lock().unwrap().push(line.to_owned()))
        };
        let tail = Tail::default();
        let stderr = child.stderr.take().unwrap();
        timeout(SOON, hear(stderr, &hears, &tail)).await.unwrap();
        assert_eq!(*heard.lock().unwrap(), ["one", "two", "", "last"]);
        assert_eq!(tail.take(), "one\r\ntwo\n\nlast");
    }

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
