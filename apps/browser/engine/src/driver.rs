//! The driver's process, as the engine part runs it (ADR 0132, decision
//! 3): `apps/browser/driver`'s program on the engine's Node, one for every
//! Project, started on the first call that needs it. A request is a line
//! of JSON on its input and its answer a line on its output; what it says
//! besides goes to the engine's log. It ends when the engine lets go of
//! it, and a driver that ended by itself refuses what waited for it.
//!
//! Where Banda carries it: the folder [`VARIABLE`] names when set; else
//! [`FOLDER`] beside the engine's program; else, for a build from a
//! checkout, what the driver's package built in it
//! (`apps/browser/driver/dist`), as the adapters are found
//! (`platform/harnesses/engine/src/carried.rs`).

use banda_kernel::host::Node;
use banda_kernel::{Code, Refusal};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::oneshot;

/// The variable that names the driver's folder, over where the engine
/// looks: a test's or a trial's.
pub const VARIABLE: &str = "BANDA_BROWSER_DRIVER";

/// The driver's folder beside the engine's program.
pub const FOLDER: &str = "browser-driver";

/// The driver's program in its folder, with Playwright beside it.
pub const PROGRAM: &str = "browser-driver.mjs";

/// The folders the driver may be in on this host, the first that has it
/// first: for an engine whose program is `program`, built from a checkout
/// or not.
pub fn folders(program: Option<&Path>, checkout: bool) -> Vec<PathBuf> {
    if let Some(named) = std::env::var_os(VARIABLE).filter(|named| !named.is_empty()) {
        return vec![named.into()];
    }
    let beside = program
        .and_then(Path::parent)
        .map(|folder| folder.join(FOLDER));
    let built = checkout.then(|| {
        let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("../driver/dist");
        dunce::canonicalize(&dist).unwrap_or(dist)
    });
    beside.into_iter().chain(built).collect()
}

type Answered = oneshot::Sender<Result<Value, Refusal>>;

/// What the driver was asked and has not answered. `asked` is none once
/// the driver ended: what waited then hears its answer will not come.
struct Waiting {
    next: u64,
    asked: Option<HashMap<u64, Answered>>,
}

/// A driver that runs, or ran.
pub(crate) struct Driver {
    input: tokio::sync::Mutex<ChildStdin>,
    waiting: Arc<Mutex<Waiting>>,
    /// Killed once the engine lets go of it.
    _process: Child,
}

/// A line of the driver's output.
#[derive(Deserialize)]
struct Answer {
    id: u64,
    #[serde(default)]
    ok: Value,
    refused: Option<Value>,
}

impl Driver {
    /// Starts `program`, the driver, on `node`, for the Chromium at
    /// `chromium`; the first tab it opens is `first_tab`.
    pub(crate) fn start(
        node: &Node,
        program: &Path,
        chromium: &Path,
        first_tab: u32,
    ) -> std::io::Result<Driver> {
        let mut command = banda_kernel::host::command(&node.program)?;
        command
            .arg(program)
            .arg("--chromium")
            .arg(chromium)
            .args(["--first-tab", &first_tab.to_string()])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Its Chromiums go with it, as its input closes.
            .kill_on_drop(true);
        if node.electron {
            command.env("ELECTRON_RUN_AS_NODE", "1");
        }
        let mut process = command.spawn()?;
        let pipes = (
            process.stdin.take(),
            process.stdout.take(),
            process.stderr.take(),
        );
        let (Some(input), Some(output), Some(errors)) = pipes else {
            return Err(std::io::Error::other("it started with no pipes"));
        };
        let waiting = Arc::new(Mutex::new(Waiting {
            next: 1,
            asked: Some(HashMap::new()),
        }));
        tokio::spawn(async move {
            let mut lines = BufReader::new(errors).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::warn!("the browser's driver: {line}");
            }
        });
        let heard = waiting.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(output).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(answer) = serde_json::from_str::<Answer>(&line) else {
                    let line = &line[..line.floor_char_boundary(200)];
                    tracing::warn!("the browser's driver said what is no answer: {line}");
                    continue;
                };
                let mut waiting = heard.lock().unwrap_or_else(PoisonError::into_inner);
                let asked = waiting.asked.as_mut();
                if let Some(answered) = asked.and_then(|asked| asked.remove(&answer.id)) {
                    let _ = answered.send(match answer.refused {
                        Some(refused) => Err(refusal(refused)),
                        None => Ok(answer.ok),
                    });
                }
            }
            tracing::warn!("the browser's driver ended");
            // Each asker hears, as its sender goes, that no answer comes.
            heard.lock().unwrap_or_else(PoisonError::into_inner).asked = None;
        });
        Ok(Driver {
            input: tokio::sync::Mutex::new(input),
            waiting,
            _process: process,
        })
    }

    /// Whether it ended: its tabs went with it.
    pub(crate) fn ended(&self) -> bool {
        let waiting = self.waiting.lock().unwrap_or_else(PoisonError::into_inner);
        waiting.asked.is_none()
    }

    /// Asks it `method` with `params`, and waits for its answer at most
    /// `within`. A driver that ends first, or answers too late, refuses:
    /// what `writes` may then have been done.
    pub(crate) async fn ask(
        &self,
        method: &str,
        params: Value,
        within: Duration,
        writes: bool,
    ) -> Result<Value, Refusal> {
        let (id, answer) = {
            let mut waiting = self.waiting.lock().unwrap_or_else(PoisonError::into_inner);
            let id = waiting.next;
            waiting.next += 1;
            let (answered, answer) = oneshot::channel();
            // Nothing of it ran in a driver that ended before it was asked.
            let asked = waiting.asked.as_mut().ok_or_else(|| stopped(false))?;
            asked.insert(id, answered);
            (id, answer)
        };
        let line = format!(
            "{}\n",
            json!({ "id": id, "method": method, "params": params })
        );
        let asked = async {
            let sent = async {
                let mut input = self.input.lock().await;
                input.write_all(line.as_bytes()).await?;
                input.flush().await
            };
            if sent.await.is_err() {
                return Err(stopped(false));
            }
            answer.await.unwrap_or_else(|_| Err(stopped(writes)))
        };
        let answered = tokio::time::timeout(within, asked).await;
        answered.unwrap_or_else(|_| {
            let mut waiting = self.waiting.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(asked) = waiting.asked.as_mut() {
                asked.remove(&id);
            }
            Err(late(within))
        })
    }
}

/// What the driver refused, as it said it by the engine's codes; what is
/// no refusal of the engine's is the driver's own fault.
fn refusal(said: Value) -> Refusal {
    serde_json::from_value(said.clone()).unwrap_or_else(|_| {
        let message = said.get("message").and_then(Value::as_str);
        Refusal::new(
            Code::Internal,
            message.unwrap_or("Banda's browser refused, and did not say why."),
        )
    })
}

/// The driver ended before it answered. A call that changes nothing ran
/// nothing to look for; one that does may have been done.
fn stopped(may_have_run: bool) -> Refusal {
    const STOPPED: &str =
        "Banda's browser stopped before it answered, and its tabs closed with it.";
    if may_have_run {
        Refusal::may_have_run(format!("{STOPPED} What was asked may have been done."))
    } else {
        Refusal::conflict(format!("{STOPPED} Open a tab again."))
    }
}

/// No answer came in time, as the window's road says it of the window.
fn late(within: Duration) -> Refusal {
    Refusal::may_have_run(format!(
        "Banda's browser did not answer within {} s. What was asked may have been done.",
        within.as_secs_f64()
    ))
}
