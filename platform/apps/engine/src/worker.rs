//! The worker of one App: the process that runs its code, and the lines of
//! JSON the engine and it talk in (ADR 0126, decision 3).
//!
//! One process serves an App on a machine, for every Project. The engine
//! starts it when the App is first called, with the Node this host has and
//! Banda's own loop (`runner.mjs`), which loads the App's entry; and again
//! when it has ended, or did not answer in time. Each call is one line to
//! it, and its answer one line back, by the call's id; between them the
//! worker asks to read its App's tables, and the engine answers each read
//! from the call's Project.
//!
//! The worker writes nothing itself: its answer carries its writes and
//! its events as data ([`Answered`]), which the App's module keeps.
//!
//! What a call is refused with says how far it got. Before its line
//! reached a worker, `app_unavailable`: nothing ran. After, with no
//! answer, `may_have_run`: Banda wrote nothing, but the App's code may
//! have acted by itself. A refusal the method made is the caller's, as it
//! is; what its code threw is `internal`, with its words.

use banda_kernel::host::Node;
use banda_kernel::{
    Code, Environment, Error, Holes, Input, ModuleProject, Program, Refusal, Started,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

/// Banda's loop for a worker on Node.
pub(crate) const RUNNER: &str = include_str!("runner.mjs");

/// How long a worker has to say it is ready, once started.
const READY_WITHIN: Duration = Duration::from_secs(20);
/// How long a method has to answer.
pub(crate) const ANSWERS_WITHIN: Duration = Duration::from_secs(60);
/// How long a worker that did not start is left before it is tried again,
/// so a broken entry is not started once a call.
const TRIED_AGAIN_AFTER: Duration = Duration::from_secs(2);
/// The most rows one read answers.
const ROWS_MOST: usize = 10_000;
/// How many of the first and of the last lines of its stderr are kept, to
/// say why it ended: what broke is said first, and where last.
const SAID_MOST: usize = 6;
/// The longest a line of its stderr is kept.
const SAID_LONGEST: usize = 400;

/// Why an App does not run on a machine with no Node.
const NO_NODE: &str = "This machine has no Node to run it on: Banda carries none here, \
     and none new enough is on its PATH.";

/// What a worker wrote to stderr, as far as it is kept.
#[derive(Default)]
struct Stderr {
    first: Vec<String>,
    last: VecDeque<String>,
    /// Whether lines between them were let go of.
    gap: bool,
}

impl Stderr {
    fn keep(&mut self, line: &str) {
        let line: String = line.chars().take(SAID_LONGEST).collect();
        if self.first.len() < SAID_MOST {
            return self.first.push(line);
        }
        if self.last.len() == SAID_MOST {
            self.last.pop_front();
            self.gap = true;
        }
        self.last.push_back(line);
    }

    fn words(&self) -> String {
        if self.first.is_empty() {
            return "it said nothing.".to_owned();
        }
        let gap = self.gap.then(|| "…".to_owned());
        let lines = (self.first.iter().cloned())
            .chain(gap)
            .chain(self.last.iter().cloned());
        lines.collect::<Vec<_>>().join("\n")
    }
}

/// One statement a command writes, on its App's own tables.
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

/// One event a command says.
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct Said {
    pub kind: String,
    pub version: Option<u32>,
    pub subject: Option<String>,
    #[serde(default)]
    pub payload: Value,
}

/// What a method answered: its answer, and what to write.
#[derive(Debug, Default, Deserialize)]
pub(crate) struct Answered {
    #[serde(default)]
    pub answer: Value,
    #[serde(default)]
    pub write: Vec<Statement>,
    #[serde(default)]
    pub emit: Vec<Said>,
}

/// A line a worker says, by what it holds.
#[derive(Deserialize)]
#[serde(untagged)]
enum Line {
    /// It loaded its App's entry, and exports these methods.
    Ready { ready: Vec<String> },
    /// A call asks to read its App's tables.
    Read {
        id: u64,
        read: u64,
        sql: String,
        #[serde(default)]
        params: Vec<Value>,
    },
    /// A call's method refused, or threw.
    Refuse { id: u64, refuse: Refuse },
    /// A call's answer.
    Answer {
        id: u64,
        #[serde(flatten)]
        answered: Answered,
    },
}

impl Line {
    /// The call it is for; none for `ready`.
    fn call(&self) -> Option<u64> {
        match self {
            Line::Ready { .. } => None,
            Line::Read { id, .. } | Line::Refuse { id, .. } | Line::Answer { id, .. } => Some(*id),
        }
    }
}

#[derive(Deserialize)]
struct Refuse {
    code: String,
    message: String,
}

/// Who waits for a worker's lines, by call.
type Calls = Arc<Mutex<HashMap<u64, mpsc::UnboundedSender<Line>>>>;

/// A worker that runs.
struct Running {
    /// Lines for its stdin.
    lines: mpsc::UnboundedSender<String>,
    calls: Calls,
    next: AtomicU64,
    said: Arc<Mutex<Stderr>>,
    /// Closed once its process ended; dropped with this, it kills it.
    held: oneshot::Sender<()>,
}

impl Running {
    fn ended(&self) -> bool {
        self.held.is_closed()
    }

    /// What it wrote to stderr, as words.
    fn last_said(&self) -> String {
        self.said.lock().unwrap().words()
    }
}

/// Whether an App's worker runs.
#[derive(Default)]
enum State {
    /// Not started yet, or ended.
    #[default]
    Idle,
    Running(Arc<Running>),
    /// It did not start, then, and why.
    Failed(Instant, Refusal),
}

/// One App's worker, started when first asked.
pub(crate) struct Worker {
    app: String,
    /// None when this machine has no Node for it.
    node: Option<Node>,
    /// Banda's loop, a file.
    runner: PathBuf,
    /// The copy of the App's folder, and its entry in it.
    copy: PathBuf,
    entry: String,
    /// The methods its `methods.json` declares, which its entry exports.
    declared: Vec<String>,
    state: tokio::sync::Mutex<State>,
    pub answers_within: Duration,
}

impl Worker {
    pub fn new(
        app: &crate::folder::Folder,
        copy: PathBuf,
        runner: PathBuf,
        node: Option<Node>,
    ) -> Worker {
        Worker {
            app: app.id.clone(),
            node,
            runner,
            copy,
            entry: app.entry.clone(),
            declared: (app.methods.iter().map(|m| m.name.clone())).collect(),
            state: Default::default(),
            answers_within: ANSWERS_WITHIN,
        }
    }

    fn unavailable(&self, why: impl std::fmt::Display) -> Refusal {
        Refusal::app_unavailable(format!("{} does not run. {why}", self.app))
    }

    /// The worker that runs, started now when none does.
    async fn running(&self, environment: &dyn Environment) -> Result<Arc<Running>, Refusal> {
        let mut state = self.state.lock().await;
        match &*state {
            State::Running(runs) if !runs.ended() => return Ok(runs.clone()),
            State::Failed(at, refusal) if at.elapsed() < TRIED_AGAIN_AFTER => {
                return Err(refusal.clone());
            }
            _ => {}
        }
        let started = self.start(environment).await.map(Arc::new);
        *state = match &started {
            Ok(runs) => State::Running(runs.clone()),
            Err(refusal) => State::Failed(Instant::now(), refusal.clone()),
        };
        started
    }

    /// Lets go of `stuck`, a worker that did not answer in time: the next
    /// call starts another, and this one is killed once its last call
    /// lets go of it.
    async fn let_go(&self, stuck: &Arc<Running>) {
        let mut state = self.state.lock().await;
        if matches!(&*state, State::Running(runs) if Arc::ptr_eq(runs, stuck)) {
            *state = State::Idle;
        }
    }

    async fn start(&self, environment: &dyn Environment) -> Result<Running, Refusal> {
        let node = (self.node.as_ref()).ok_or_else(|| self.unavailable(NO_NODE))?;
        let path = |path: &PathBuf| path.display().to_string();
        let holes = Holes {
            reads: vec![self.copy.clone(), self.runner.clone()],
            ..Holes::default()
        };
        let args = vec![path(&self.runner), path(&self.copy.join(&self.entry))];
        let mut program = Program::worker(path(&node.program), args, holes);
        program.cwd = Some(self.copy.clone());
        if node.electron {
            (program.env).insert("ELECTRON_RUN_AS_NODE".to_owned(), "1".to_owned());
        }
        let started = environment
            .spawn(&program, Input::Piped)
            .map_err(|error| self.unavailable(format!("Its worker did not start: {error}.")))?;
        let (running, ready) = Running::of(started, &self.app)
            .ok_or_else(|| self.unavailable("Its worker started with no pipes."))?;
        let Ok(Ok(exports)) = tokio::time::timeout(READY_WITHIN, ready).await else {
            let said = running.last_said();
            return Err(self.unavailable(format!("Its worker did not start: {said}")));
        };
        // What methods.json declares and the entry does not export would
        // fail at each call: said once, as it starts.
        if let Some(missing) = (self.declared.iter()).find(|name| !exports.contains(name)) {
            return Err(self.unavailable(format!(
                "methods.json declares {missing}, and {} exports no method of that name.",
                self.entry
            )));
        }
        Ok(running)
    }

    /// Calls `method` of the App in `project`, as `line` says it, and
    /// answers what the worker did: its reads meanwhile are answered from
    /// `project`.
    pub async fn ask(
        &self,
        project: &ModuleProject,
        method: &str,
        mut line: Value,
    ) -> Result<Answered, Refusal> {
        let running = self.running(&*project.environment()).await?;
        let id = running.next.fetch_add(1, Ordering::Relaxed);
        let (said, mut hears) = mpsc::unbounded_channel();
        running.calls.lock().unwrap().insert(id, said);
        // Whatever ends the call, the worker's later lines for it are no
        // one's: a read it asks then is refused it.
        let _waits = Waits(&running.calls, id);
        line["id"] = json!(id);
        line["call"] = json!(method);
        let named = format!("{}.{method}", self.app);
        // One that ended as this call came never took the call.
        if running.ended() || running.lines.send(line.to_string()).is_err() {
            let said = running.last_said();
            return Err(self.unavailable(format!("Its worker ended: {said}")));
        }
        let unanswered = |why: String| {
            Refusal::may_have_run(format!(
                "{named} {why} Banda wrote nothing of it; what its code did by itself may be done."
            ))
        };
        let deadline = tokio::time::Instant::now() + self.answers_within;
        loop {
            let line = match tokio::time::timeout_at(deadline, hears.recv()).await {
                Ok(Some(line)) => line,
                Ok(None) => {
                    let said = running.last_said();
                    return Err(unanswered(format!(
                        "got no answer: its worker ended: {said}"
                    )));
                }
                Err(_) => {
                    self.let_go(&running).await;
                    let within = self.answers_within.as_secs();
                    return Err(unanswered(format!("did not answer in {within} s.")));
                }
            };
            match line {
                Line::Answer { answered, .. } => return Ok(answered),
                Line::Refuse { refuse, .. } => return Err(refused(&named, refuse)),
                Line::Read {
                    read: ask,
                    sql,
                    params,
                    ..
                } => {
                    let answer = match read(project, sql, params).await {
                        Ok(rows) => json!({ "read": ask, "rows": rows }),
                        Err(why) => json!({ "read": ask, "error": why }),
                    };
                    // One that ended meanwhile is heard to have, above.
                    let _ = running.lines.send(answer.to_string());
                }
                Line::Ready { .. } => {}
            }
        }
    }
}

impl Running {
    /// The worker `started` is, as it runs; and what it says once it is
    /// ready, the methods its entry exports. None when it has no pipes.
    fn of(mut started: Started, app: &str) -> Option<(Running, oneshot::Receiver<Vec<String>>)> {
        let (mut stdin, stdout, stderr) = (
            started.stdin.take()?,
            started.stdout.take()?,
            started.stderr.take()?,
        );
        let calls = Calls::default();
        let said: Arc<Mutex<Stderr>> = Default::default();
        let (lines, mut to_write) = mpsc::unbounded_channel::<String>();
        let (held, mut let_go) = oneshot::channel::<()>();
        let (ready, is_ready) = oneshot::channel();

        // Its stdin: one line a message.
        tokio::spawn(async move {
            while let Some(line) = to_write.recv().await {
                let written = async {
                    stdin.write_all(line.as_bytes()).await?;
                    stdin.write_all(b"\n").await?;
                    stdin.flush().await
                };
                if written.await.is_err() {
                    break;
                }
            }
        });
        // Its stderr: the engine's log, and the first and last of it kept.
        let (name, kept) = (app.to_owned(), said.clone());
        tokio::spawn(async move {
            let mut stderr = BufReader::new(stderr);
            while let Some(line) = next_line(&mut stderr).await {
                tracing::info!(app = name, "{line}");
                kept.lock().unwrap().keep(&line);
            }
        });
        // Its stdout, each line to the call it is for, and its process,
        // until it ends or is let go of: whoever waits then hears so.
        let (name, waiting, answers) = (app.to_owned(), calls.clone(), lines.clone());
        tokio::spawn(async move {
            let mut ready = Some(ready);
            let mut stdout = BufReader::new(stdout);
            let heard = async {
                while let Some(text) = next_line(&mut stdout).await {
                    match serde_json::from_str::<Line>(&text) {
                        Ok(Line::Ready { ready: exports }) => {
                            ready.take().map(|ready| ready.send(exports));
                        }
                        Ok(line) => route(line, &waiting, &answers),
                        Err(_) => tracing::warn!(
                            app = name,
                            "its worker said a line that is no message: {text}"
                        ),
                    }
                }
            };
            tokio::select! {
                () = heard => {
                    let status = started.wait().await;
                    tracing::warn!(app = name, ?status, "an App's worker ended");
                }
                _ = &mut let_go => started.kill(),
            }
            drop(let_go);
            waiting.lock().unwrap().clear();
        });
        let running = Running {
            lines,
            calls,
            next: AtomicU64::new(1),
            said,
            held,
        };
        Some((running, is_ready))
    }
}

/// Gives `line` to the call it is for. A call that is over reads nothing
/// more: its read is refused it, so its method ends there, in the worker.
fn route(line: Line, waiting: &Calls, answers: &mpsc::UnboundedSender<String>) {
    let waits = (line.call()).and_then(|id| waiting.lock().unwrap().get(&id).cloned());
    match (waits, line) {
        (Some(call), line) => drop(call.send(line)),
        (None, Line::Read { read, .. }) => {
            let over = json!({ "read": read, "error": "The call is over." });
            let _ = answers.send(over.to_string());
        }
        (None, _) => {}
    }
}

/// The next line `pipe` says, read as text whatever its bytes; none once
/// it is closed.
async fn next_line(pipe: &mut BufReader<impl AsyncRead + Unpin>) -> Option<String> {
    let mut line = Vec::new();
    match pipe.read_until(b'\n', &mut line).await {
        Ok(0) | Err(_) => None,
        Ok(_) => Some(String::from_utf8_lossy(&line).trim_end().to_owned()),
    }
}

/// The refusal a worker's method made: a code a caller acts on, as it is;
/// anything else broke in the App's own code, and its words say how.
fn refused(named: &str, refuse: Refuse) -> Refusal {
    match serde_json::from_value(Value::String(refuse.code)) {
        Ok(code @ (Code::Invalid | Code::NotFound | Code::Forbidden | Code::Conflict)) => {
            Refusal::new(code, refuse.message)
        }
        _ => Refusal::new(
            Code::Internal,
            format!("{named} failed: {}", refuse.message),
        ),
    }
}

/// A call that waits for its worker's lines, until it is dropped.
struct Waits<'a>(&'a Calls, u64);

impl Drop for Waits<'_> {
    fn drop(&mut self) {
        self.0.lock().unwrap().remove(&self.1);
    }
}

/// A JSON value as SQLite takes it: a list or an object as its JSON text.
pub(crate) fn to_sql(value: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as Sql;
    match value {
        Value::Null => Sql::Null,
        Value::Bool(said) => Sql::Integer(i64::from(*said)),
        Value::Number(number) => match number.as_i64() {
            Some(whole) => Sql::Integer(whole),
            None => Sql::Real(number.as_f64().unwrap_or(f64::NAN)),
        },
        Value::String(text) => Sql::Text(text.clone()),
        list_or_object => Sql::Text(list_or_object.to_string()),
    }
}

/// The rows `sql` answers of the App's own tables in `project`, each an
/// object by column; or why not, in words for the App's author.
async fn read(
    project: &ModuleProject,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    let rows = project.read(move |connection| {
        let mut statement = connection.prepare(&sql)?;
        let names: Vec<String> = statement.column_names().map(str::to_owned).collect();
        let mut rows = statement.query(rusqlite::params_from_iter(params.iter().map(to_sql)))?;
        let mut read = Vec::new();
        while let Some(row) = rows.next()? {
            if read.len() == ROWS_MOST {
                return Err(too_many().into());
            }
            let mut object = Map::with_capacity(names.len());
            for (column, name) in names.iter().enumerate() {
                let value = banda_kernel::cell(row.get_ref(column)?, |_| Err(bytes(name)))?;
                object.insert(name.clone(), value);
            }
            read.push(Value::Object(object));
        }
        Ok(read)
    });
    rows.await.map_err(|error| match error {
        Error::Database(error) => error.to_string(),
        Error::Refused(refusal) => refusal.message,
        other => {
            tracing::error!(%other, "an App's read failed");
            "The read failed inside Banda.".to_owned()
        }
    })
}

fn too_many() -> Refusal {
    Refusal::invalid(format!(
        "It answers more than {ROWS_MOST} rows: narrow it, or read it a page at a time with LIMIT."
    ))
}

fn bytes(column: &str) -> Refusal {
    Refusal::invalid(format!(
        "The column {column} holds bytes, which no line of JSON carries: keep bytes as files."
    ))
}
