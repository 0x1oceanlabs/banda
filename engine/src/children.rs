//! What the engine starts that can outlive it, and what the next engine
//! stops after a crash (ADR 0086, decision 1, plan step 7b). On Linux the
//! engine's unit stops what is left of it (`KillMode=mixed`). macOS's
//! launchd job has nothing of the kind: there the engine keeps a note of
//! each Harness's program and Terminal while it runs, in `children.json`
//! in its state, and the next engine stops what they left, before it
//! listens, unless the run before said it stopped.
//!
//! - **What is noted.** Each program the Projects' environment starts for
//!   a Harness or a Terminal: its number, whether it leads a session of
//!   its own, as one started on a terminal does, or a process group, as
//!   any other does, and when it started (as the system says; for one that
//!   ended already and the system no longer shows, a moment before it was
//!   started). The note is written as it starts, before the engine hands
//!   it anything to do, and goes once the engine lets go of it. A
//!   Harness's CLI asked about itself and a git act end on their own once
//!   their pipes close, and are not noted: a git stopped halfway would
//!   leave its lock behind.
//! - **What is stopped.** For each note whose number no process has, or
//!   the one that started then (another has it once its group or session
//!   is gone): this user's processes in its session, or in its process
//!   group within the session the engine ran in, that started no earlier
//!   than it; and all that these started and that still runs under them,
//!   as an Agent's tool shell in a session of its own. Each is signalled
//!   by its number only while that is still the process found, started at
//!   the same time. Never this engine nor what started it, nor what that
//!   started but this engine:
//!   the window that started it, with its helpers. Nothing a note from
//!   before the system's last start names. Another state folder's engine
//!   keeps its own notes, and stops only what they name.
//! - **How.** TERM, with CONT for one stopped by job control, as systemd
//!   stops a unit. Then up to [`TERM_WITHIN`] to end, and a look again:
//!   KILL to what still runs of them, and of what they started since. The
//!   notes are read once, and go before anything is stopped, so a start
//!   that crashes as it stops them does not try again at each start.
//!
//! What an Agent's tool shell left once all above it ended is not found:
//! it is in no group or session noted, and nothing under a note leads to
//! it any more.

use crate::places::{Places, write_private_unsynced};
use crate::run::{Before, Left};
use banda_kernel::{Environment, Fence, Input, Program, Pty, PtySize, Started, Whose};
use rustix::process::{Pid, Signal, getpgid, getsid, kill_process};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use sysinfo::{ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind};

/// The file in the state that holds the notes.
const FILE: &str = "children.json";

/// How long what a crashed run left has to end on TERM before it is
/// killed: as long as a server stopped in Banda has (ADR 0044), to finish
/// a write or keep its files. The Turns it served were cut already, and
/// the engine does not listen while it waits, so the wait is short.
const TERM_WITHIN: Duration = Duration::from_secs(3);

/// How long what was killed is waited for, to say what still runs.
const KILL_WITHIN: Duration = Duration::from_secs(1);

/// How often it looks whether they ended.
const LOOKS_EVERY: Duration = Duration::from_millis(50);

/// The note of one program the engine started.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Child {
    /// Its number, which its process group has, and on a terminal its
    /// session.
    pid: u32,
    /// When it started, in seconds since the epoch, as the system says: a
    /// process of its number that started otherwise is another's.
    started: u64,
    /// It leads a session of its own, as one started on a terminal does;
    /// else a process group.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    terminal: bool,
    /// Its program, for the log.
    program: String,
}

/// What `children.json` holds.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Said {
    /// The session the engine ran in: a Harness's process group is in it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session: Option<u32>,
    #[serde(default)]
    children: Vec<Child>,
}

/// The notes of this run, as its programs start and are let go of.
struct Children {
    file: PathBuf,
    session: Option<u32>,
    now: Mutex<Now>,
}

#[derive(Default)]
struct Now {
    children: BTreeMap<u32, Child>,
    /// The run is over ([`Noting`]).
    closed: bool,
}

/// `environment`, with each Harness's and Terminal's program it starts
/// noted in `children.json` of `places` while the engine holds it, none
/// yet; and what ends the notes as it is dropped.
pub fn noted<E>(environment: E, places: &Places) -> (Noted<E>, Noting) {
    let children = Children::begin(places);
    let noting = Noting(children.clone());
    let noted = Noted {
        environment,
        children,
    };
    (noted, noting)
}

/// Ends the notes as it is dropped: the run is over, and nothing more is
/// written, so a program let go of as the engine exits does not write
/// over the next run's notes. What is noted then stays, for the next
/// engine to stop should the run not say it stopped.
pub struct Noting(Arc<Children>);

impl Drop for Noting {
    fn drop(&mut self) {
        self.0.now.lock().unwrap_or_else(|e| e.into_inner()).closed = true;
    }
}

impl Children {
    /// This run's notes, none yet, in the state of `places`.
    fn begin(places: &Places) -> Arc<Children> {
        let session = getsid(None).ok().and_then(number);
        let children = Children {
            file: places.state.join(FILE),
            session,
            now: Mutex::new(Now::default()),
        };
        children.write(&BTreeMap::new());
        Arc::new(children)
    }

    /// `started`, noted while the engine holds it when it is a Harness's
    /// or a Terminal's: on a terminal, `terminal`, it leads a session of
    /// its own, else a process group. It was started after `before`.
    fn note(
        self: &Arc<Self>,
        started: Started,
        program: &Program,
        terminal: bool,
        before: u64,
    ) -> Started {
        match program.whose() {
            Whose::Harness | Whose::Terminal | Whose::Worker => {}
            Whose::HarnessProbe | Whose::Act => return started,
        }
        let Some(pid) = started.id() else {
            return started;
        };
        // Even one that ended already, as what it started may run on: Linux
        // still shows it till it is waited for, macOS does not.
        let since = starts([pid]).get(&pid).map_or(before, |&(since, _)| since);
        let child = Child {
            pid,
            started: since,
            terminal,
            program: program.program.clone(),
        };
        self.change(|children| {
            children.insert(pid, child);
        });
        started.holding(Note {
            children: self.clone(),
            pid,
            started: since,
        })
    }

    /// Takes the note of `pid` away, while it is of the one that started
    /// at `started`: one let go of after it ended and its number went to
    /// another takes that one's note with it no more.
    fn let_go(&self, pid: u32, started: u64) {
        self.change(|children| {
            if children
                .get(&pid)
                .is_some_and(|child| child.started == started)
            {
                children.remove(&pid);
            }
        });
    }

    fn change(&self, change: impl FnOnce(&mut BTreeMap<u32, Child>)) {
        let mut now = self.now.lock().unwrap_or_else(|e| e.into_inner());
        if now.closed {
            return;
        }
        change(&mut now.children);
        self.write(&now.children);
    }

    fn write(&self, children: &BTreeMap<u32, Child>) {
        let said = Said {
            session: self.session,
            children: children.values().cloned().collect(),
        };
        // Not waited for on the disk: a note from before the system's
        // last start names nothing to stop.
        let written = serde_json::to_vec_pretty(&said)
            .map_err(io::Error::from)
            .and_then(|bytes| write_private_unsynced(&self.file, &bytes));
        if let Err(error) = written {
            tracing::error!(%error, "the engine could not note the programs it started");
        }
    }
}

/// A program's note, which goes as the [`Started`] that holds it does.
struct Note {
    children: Arc<Children>,
    pid: u32,
    started: u64,
}

impl Drop for Note {
    fn drop(&mut self) {
        self.children.let_go(self.pid, self.started);
    }
}

/// An environment whose Harnesses' and Terminals' programs are noted
/// ([`noted`]).
pub struct Noted<E> {
    environment: E,
    children: Arc<Children>,
}

impl<E: Environment> Environment for Noted<E> {
    fn spawn(&self, program: &Program, input: Input) -> io::Result<Started> {
        let before = a_moment_ago();
        let started = self.environment.spawn(program, input)?;
        Ok(self.children.note(started, program, false, before))
    }

    fn pty(&self, program: &Program, size: PtySize) -> io::Result<(Started, Pty)> {
        let before = a_moment_ago();
        let (started, pty) = self.environment.pty(program, size)?;
        Ok((self.children.note(started, program, true, before), pty))
    }

    fn fence(&self) -> Fence {
        self.environment.fence()
    }
}

/// Two seconds ago, in seconds since the epoch: before what starts now, by
/// the system's count as well, which may be a second behind the clock.
fn a_moment_ago() -> u64 {
    let now = u64::try_from(banda_kernel::now_ms() / 1000).unwrap_or(0);
    now.saturating_sub(2)
}

/// What the next engine stopped of what the run before left.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Stopped {
    /// Those that ended on TERM, by number.
    pub ended: Vec<u32>,
    /// Those killed.
    pub killed: Vec<u32>,
}

/// Stops what the notes of the run before name and still runs, unless it
/// said it stopped (`before`), and takes the notes away.
pub async fn stop_left(places: &Places, before: Before) -> Stopped {
    stop_left_within(places, before, TERM_WITHIN).await
}

/// [`stop_left`], with `within` to end on TERM.
async fn stop_left_within(places: &Places, before: Before, within: Duration) -> Stopped {
    let file = places.state.join(FILE);
    let Ok(bytes) = std::fs::read(&file) else {
        return Stopped::default();
    };
    // Read once ([the module](self)).
    let _ = std::fs::remove_file(&file);
    match before {
        // It stopped them itself.
        Before::Left(Left::Stopped) => return Stopped::default(),
        Before::Left(Left::Stopping) | Before::Crashed | Before::None => {}
    }
    match serde_json::from_slice::<Said>(&bytes) {
        Ok(said) => stop(&said, within).await,
        Err(error) => {
            tracing::warn!(%error, "the notes of what the last run started do not read");
            Stopped::default()
        }
    }
}

/// A process, as the system says, of this user's.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Process {
    parent: Option<u32>,
    group: Option<u32>,
    session: Option<u32>,
    /// When it started, in seconds since the epoch.
    started: u64,
    name: String,
}

/// This user's processes that run, by number: none that ended and was
/// not yet waited for.
type Table = HashMap<u32, Process>;

async fn stop(said: &Said, within: Duration) -> Stopped {
    let Ok(boot) = System::boot_time() else {
        tracing::warn!("the system said not when it started: what the last run left runs on");
        return Stopped::default();
    };
    let processes = table();
    let found = left(said, &processes, &spared(&processes), boot);
    if found.is_empty() {
        return Stopped::default();
    }
    let named: Vec<String> = (found.keys())
        .filter_map(|pid| Some(format!("{pid} {}", processes.get(pid)?.name)))
        .collect();
    tracing::warn!(
        ?named,
        "the engine's last run left these running: they are stopped"
    );
    send(&found, &[Signal::TERM, Signal::CONT]);
    let running = ended_within(&found, within).await;
    let ended = (found.keys())
        .filter(|pid| !running.contains_key(pid))
        .copied()
        .collect();
    // What still runs, with what they started meanwhile, as they ended too.
    let processes = table();
    let mut killed = running;
    killed.extend(left(said, &processes, &spared(&processes), boot));
    if !killed.is_empty() {
        send(&killed, &[Signal::KILL]);
        let still = ended_within(&killed, KILL_WITHIN).await;
        if !still.is_empty() {
            let still: Vec<u32> = still.into_keys().collect();
            tracing::error!(
                ?still,
                "what the engine's last run left still runs after a kill"
            );
        }
    }
    let stopped = Stopped {
        ended,
        killed: killed.into_keys().collect(),
    };
    let (ended, killed) = (&stopped.ended, &stopped.killed);
    tracing::info!(
        ?ended,
        ?killed,
        "what the engine's last run left is stopped"
    );
    stopped
}

/// Of `table`, what still runs of each note in `said`, by number and
/// start: what [the module](self) says, but those `spared` and what they
/// start, and what a note from before `boot` names.
fn left(said: &Said, table: &Table, spared: &HashSet<u32>, boot: u64) -> BTreeMap<u32, u64> {
    let mut found = BTreeMap::new();
    for child in said.children.iter().filter(|child| child.started >= boot) {
        match table.get(&child.pid) {
            // Its number is another's: its group or session was gone
            // before that one was given the number.
            Some(process) if process.started != child.started => continue,
            Some(process) => {
                found.insert(child.pid, process.started);
            }
            None => {}
        }
        let in_it = |process: &Process| match child.terminal {
            true => process.session == Some(child.pid),
            false => {
                process.group == Some(child.pid)
                    && (said.session.is_none() || process.session == said.session)
            }
        };
        for (&pid, process) in table {
            if in_it(process) && process.started >= child.started {
                found.insert(pid, process.started);
            }
        }
    }
    found.retain(|pid, _| !spared.contains(pid));
    // All they started, through what still runs under them.
    let started = under(table, found.keys().copied(), |pid| spared.contains(&pid));
    for pid in started {
        if let Some(process) = table.get(&pid) {
            found.entry(pid).or_insert(process.started);
        }
    }
    found
}

/// This engine and what started it, and all that started this engine
/// but this engine's own: the window that started it, with its helpers.
/// Never the system's first process, which a crashed engine's programs
/// are under once it is gone.
fn spared(table: &Table) -> HashSet<u32> {
    let me = std::process::id();
    let parent = (table.get(&me).and_then(|process| process.parent)).filter(|&pid| pid > 1);
    let mut spared = HashSet::from([me]);
    let mut at = parent;
    while let Some(pid) = at.filter(|&pid| pid > 1 && spared.insert(pid)) {
        at = table.get(&pid).and_then(|process| process.parent);
    }
    if let Some(parent) = parent {
        spared.extend(under(table, [parent], |pid| pid == me));
    }
    spared
}

/// All that `from` started, and what that started, but through none for
/// which `apart` holds.
fn under(
    table: &Table,
    from: impl IntoIterator<Item = u32>,
    apart: impl Fn(u32) -> bool,
) -> HashSet<u32> {
    let mut started_by: HashMap<u32, Vec<u32>> = HashMap::new();
    for (&pid, process) in table {
        if let Some(parent) = process.parent {
            started_by.entry(parent).or_default().push(pid);
        }
    }
    let mut found = HashSet::new();
    let mut at: Vec<u32> = from.into_iter().collect();
    while let Some(parent) = at.pop() {
        for &pid in started_by.get(&parent).into_iter().flatten() {
            if !apart(pid) && found.insert(pid) {
                at.push(pid);
            }
        }
    }
    found
}

/// Sends each of `signals` to each of `processes` that is still the one it
/// was found as.
fn send(processes: &BTreeMap<u32, u64>, signals: &[Signal]) {
    for pid in still(processes).into_keys().filter(|&pid| pid > 1) {
        let Some(process) = i32::try_from(pid).ok().and_then(Pid::from_raw) else {
            continue;
        };
        for &signal in signals {
            let _ = kill_process(process, signal);
        }
    }
}

/// Waits up to `within` for each of `processes` to end; returns those that
/// still run.
async fn ended_within(processes: &BTreeMap<u32, u64>, within: Duration) -> BTreeMap<u32, u64> {
    let began = tokio::time::Instant::now();
    loop {
        let running = still(processes);
        if running.is_empty() || began.elapsed() >= within {
            return running;
        }
        tokio::time::sleep(LOOKS_EVERY).await;
    }
}

/// Those of `processes` that still run as the ones found: of the same
/// number, started at the same time.
fn still(processes: &BTreeMap<u32, u64>) -> BTreeMap<u32, u64> {
    let starts = starts(processes.keys().copied());
    (processes.iter())
        .filter(|&(pid, &started)| starts.get(pid) == Some(&(started, true)))
        .map(|(&pid, &started)| (pid, started))
        .collect()
}

/// This user's processes that run, as the system says.
fn table() -> Table {
    let Ok(mut system) = System::new() else {
        return Table::new();
    };
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_user(UpdateKind::Always)
            .without_tasks(),
    );
    let user = rustix::process::getuid().as_raw();
    (system.processes().iter())
        .filter(|(_, process)| process.user_id().is_some_and(|id| **id == user) && runs(process))
        .filter_map(|(pid, process)| {
            let number = pid.as_u32();
            let pid = i32::try_from(number).ok().and_then(Pid::from_raw)?;
            let found = Process {
                parent: process.parent().map(|parent| parent.as_u32()),
                group: getpgid(Some(pid)).ok().and_then(self::number),
                session: getsid(Some(pid)).ok().and_then(self::number),
                started: process.start_time(),
                name: process.name().to_string_lossy().into_owned(),
            };
            Some((number, found))
        })
        .collect()
}

/// When each of `pids` started, in seconds since the epoch, and whether it
/// still runs.
fn starts(pids: impl IntoIterator<Item = u32>) -> HashMap<u32, (u64, bool)> {
    let Ok(mut system) = System::new() else {
        return HashMap::new();
    };
    let pids: Vec<sysinfo::Pid> = pids.into_iter().map(sysinfo::Pid::from_u32).collect();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&pids),
        true,
        ProcessRefreshKind::nothing().without_tasks(),
    );
    (system.processes().iter())
        .map(|(pid, process)| (pid.as_u32(), (process.start_time(), runs(process))))
        .collect()
}

/// Whether `process` runs: it neither ended nor waits to be waited for.
fn runs(process: &sysinfo::Process) -> bool {
    !matches!(
        process.status(),
        ProcessStatus::Zombie | ProcessStatus::Dead
    )
}

fn number(pid: Pid) -> Option<u32> {
    u32::try_from(pid.as_raw_pid()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_environments::Local;
    use banda_kernel::Holes;
    use std::os::unix::process::CommandExt;

    /// A process of the table: what started it, its group and session, and
    /// when it started.
    fn process(parent: u32, group: u32, session: u32, started: u64) -> Process {
        Process {
            parent: Some(parent),
            group: Some(group),
            session: Some(session),
            started,
            name: String::new(),
        }
    }

    fn child(pid: u32, started: u64, terminal: bool) -> Child {
        Child {
            pid,
            started,
            terminal,
            program: "sh".to_owned(),
        }
    }

    #[test]
    fn what_is_left_is_what_still_runs_in_each_noted_group_or_session_and_under_it() {
        // The engine ran in session 50; the system started at 500.
        let said = Said {
            session: Some(50),
            children: vec![
                // A Harness's program that runs, with its CLI in its group
                // and the CLI's tool shell in a session of its own.
                child(100, 1000, false),
                // A number another process has now: its group is that one's.
                child(200, 1000, false),
                // One that ended, its group still in the engine's session.
                child(400, 1000, false),
                // A Terminal whose shell ended, with a job still in its
                // session.
                child(500, 1000, true),
                // From before the system started.
                child(600, 400, false),
                // A Terminal that runs, with the window that started this
                // engine in its session, and the window's helper.
                child(800, 1000, true),
            ],
        };
        let table: Table = [
            (100, process(1, 100, 50, 1000)),
            (101, process(100, 100, 50, 1001)),
            (300, process(101, 300, 300, 1005)),
            (301, process(300, 300, 300, 1006)),
            (200, process(1, 200, 60, 2000)),
            (201, process(200, 200, 60, 2001)),
            (401, process(1, 400, 50, 1010)),
            // In another session: no group of the engine's.
            (402, process(1, 400, 70, 1010)),
            (501, process(1, 501, 500, 1020)),
            // Older than the Terminal: none of it.
            (502, process(1, 502, 500, 900)),
            (600, process(1, 600, 50, 400)),
            (800, process(1, 800, 800, 1000)),
            (801, process(800, 801, 800, 1030)),
            (802, process(801, 802, 800, 1031)),
            // Unnoted, alike.
            (900, process(1, 900, 50, 1000)),
        ]
        .into_iter()
        .collect();
        let spared = HashSet::from([801, 802]);
        let found = left(&said, &table, &spared, 500);
        let found: Vec<u32> = found.into_keys().collect();
        assert_eq!(found, [100, 101, 300, 301, 401, 501, 800]);
    }

    #[test]
    fn this_engine_and_what_started_it_are_spared_with_its_helpers() {
        let me = std::process::id();
        let table: Table = [
            // This engine, started by the window 40, which a shell started.
            (me, process(40, me, me, 1000)),
            (40, process(30, 40, 40, 900)),
            (30, process(1, 30, 30, 800)),
            // The window's helper, and what it started.
            (41, process(40, 41, 41, 950)),
            (42, process(41, 41, 41, 960)),
            // What else the shell started.
            (31, process(30, 31, 31, 850)),
            // What this engine started.
            (50, process(me, 50, 50, 1010)),
            (51, process(50, 50, 50, 1011)),
            // What the system's first process started.
            (60, process(1, 60, 60, 1000)),
        ]
        .into_iter()
        .collect();
        assert_eq!(spared(&table), HashSet::from([me, 40, 30, 41, 42]));
    }

    /// A tempdir and the places under it.
    fn places() -> (tempfile::TempDir, Places) {
        let base = tempfile::tempdir().unwrap();
        let places = Places::under(base.path());
        (base, places)
    }

    /// What `children.json` of `places` says.
    fn said(places: &Places) -> Said {
        serde_json::from_slice(&std::fs::read(places.state.join(FILE)).unwrap()).unwrap()
    }

    /// A Harness's program: `sh -c script`.
    fn harness(script: &str) -> Program {
        let args = vec!["-c".to_owned(), script.to_owned()];
        Program::harness("sh", args, Holes::default())
    }

    /// The engine crashes while it holds `started`: it never lets go of it.
    fn crash(started: Started) {
        std::mem::forget(started);
    }

    /// A process alike, which the engine did not start: in a group of its
    /// own, as each it starts is.
    fn alike() -> std::process::Child {
        std::process::Command::new("sleep")
            .arg("300")
            .process_group(0)
            .spawn()
            .unwrap()
    }

    fn ended(mut alike: std::process::Child) {
        let _ = alike.kill();
        alike.wait().unwrap();
    }

    fn running(pid: u32) -> bool {
        table().contains_key(&pid)
    }

    /// The processes of `table` for which `which` holds.
    fn those(which: impl Fn(&Process) -> bool) -> Vec<u32> {
        (table().into_iter())
            .filter(|(_, process)| which(process))
            .map(|(pid, _)| pid)
            .collect()
    }

    /// Waits up to five seconds for `done`.
    async fn until(what: &str, done: impl Fn() -> bool) {
        for _ in 0..100 {
            if done() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("not within five seconds: {what}");
    }

    const SIZE: PtySize = PtySize { rows: 24, cols: 80 };

    #[tokio::test]
    async fn a_harnesss_and_a_terminals_programs_are_noted_while_the_engine_holds_them() {
        let (_base, places) = places();
        let (environment, noting) = noted(Local, &places);
        assert!(said(&places).children.is_empty());
        let held = environment
            .spawn(&harness("exec sleep 300"), Input::Null)
            .unwrap();
        let pid = held.id().unwrap();
        let noted = said(&places);
        assert_eq!(
            noted.children,
            [Child {
                pid,
                started: starts([pid])[&pid].0,
                terminal: false,
                program: "sh".to_owned(),
            }]
        );
        assert_eq!(noted.session, getsid(None).ok().and_then(number));
        // A git act ends on its own.
        let act = Program::act("sleep", vec!["300".to_owned()]);
        let act = environment.spawn(&act, Input::Null).unwrap();
        assert_eq!(said(&places).children.len(), 1);
        let shell = Program::terminal("sh", vec!["-c".to_owned(), "sleep 300".to_owned()]);
        let (terminal, pty) = environment.pty(&shell, SIZE).unwrap();
        let on_terminal = terminal.id().unwrap();
        let noted: Vec<(u32, bool)> = (said(&places).children.iter())
            .map(|child| (child.pid, child.terminal))
            .collect();
        assert_eq!(noted.len(), 2);
        assert!(noted.contains(&(on_terminal, true)), "{noted:?}");
        drop(held);
        let noted: Vec<u32> = said(&places).children.iter().map(|c| c.pid).collect();
        assert_eq!(noted, [on_terminal], "let go of, it goes");
        drop((act, terminal, pty));
        assert!(said(&places).children.is_empty());
        // Once the run is over, nothing more is written.
        drop(noting);
        let late = environment
            .spawn(&harness("exec sleep 300"), Input::Null)
            .unwrap();
        assert!(said(&places).children.is_empty());
        drop(late);
    }

    #[tokio::test]
    async fn a_crashed_runs_harness_is_stopped_with_its_group_and_a_process_alike_is_not() {
        let (_base, places) = places();
        let (environment, _noting) = noted(Local, &places);
        let started = environment.spawn(&harness("sleep 300 & wait"), Input::Null);
        let leader = started.as_ref().unwrap().id().unwrap();
        crash(started.unwrap());
        let alike = alike();
        until("the Harness's own sleep runs", || {
            those(|process| process.group == Some(leader)).len() == 2
        })
        .await;
        let stopped = stop_left_within(&places, Before::Crashed, TERM_WITHIN).await;
        assert!(stopped.ended.contains(&leader), "{stopped:?}");
        assert_eq!(stopped.ended.len(), 2, "{stopped:?}");
        assert!(stopped.killed.is_empty(), "{stopped:?}");
        assert!(those(|process| process.group == Some(leader)).is_empty());
        assert!(running(alike.id()), "what the engine did not start runs on");
        assert!(!places.state.join(FILE).exists(), "the notes are done with");
        ended(alike);
    }

    #[tokio::test]
    async fn one_that_does_not_end_on_term_is_killed() {
        let (_base, places) = places();
        let (environment, _noting) = noted(Local, &places);
        let started = environment.spawn(&harness("trap '' TERM; sleep 300; :"), Input::Null);
        let leader = started.as_ref().unwrap().id().unwrap();
        crash(started.unwrap());
        until("its sleep runs", || {
            those(|process| process.group == Some(leader)).len() == 2
        })
        .await;
        let within = Duration::from_millis(300);
        let stopped = stop_left_within(&places, Before::Crashed, within).await;
        assert!(stopped.ended.is_empty(), "{stopped:?}");
        assert_eq!(stopped.killed.len(), 2, "{stopped:?}");
        assert!(those(|process| process.group == Some(leader)).is_empty());
    }

    #[tokio::test]
    async fn only_what_a_run_that_did_not_say_it_stopped_left_is_stopped() {
        let (_base, places) = places();
        let alike = alike();
        let pid = alike.id();
        let started = starts([pid])[&pid].0;
        let note = |started| {
            let said = Said {
                session: getsid(None).ok().and_then(number),
                children: vec![child(pid, started, false)],
            };
            crate::places::write_private(
                &places.state.join(FILE),
                &serde_json::to_vec(&said).unwrap(),
            )
            .unwrap();
        };
        // Its number is another's now: that one started at another time.
        note(started - 5);
        let stopped = stop_left_within(&places, Before::Crashed, TERM_WITHIN).await;
        assert_eq!(stopped, Stopped::default());
        assert!(running(pid));
        // The run before stopped what it started itself.
        note(started);
        let stopped = stop_left(&places, Before::Left(Left::Stopped)).await;
        assert_eq!(stopped, Stopped::default());
        assert!(running(pid));
        assert!(!places.state.join(FILE).exists());
        // Killed as it stopped, as launchd does after its 15 s.
        note(started);
        let stopped = stop_left(&places, Before::Left(Left::Stopping)).await;
        assert_eq!(stopped.ended, [pid]);
        ended(alike);
    }

    #[tokio::test]
    async fn another_state_folders_notes_are_its_own() {
        let (_one, one) = places();
        let (_other, other) = places();
        let mut leaders = Vec::new();
        for places in [&one, &other] {
            let (environment, _noting) = noted(Local, places);
            let started = environment
                .spawn(&harness("exec sleep 300"), Input::Null)
                .unwrap();
            leaders.push(started.id().unwrap());
            crash(started);
        }
        let stopped = stop_left(&one, Before::Crashed).await;
        assert_eq!(stopped.ended, [leaders[0]]);
        assert!(running(leaders[1]), "the other engine's runs on");
        let stopped = stop_left(&other, Before::Crashed).await;
        assert_eq!(stopped.ended, [leaders[1]]);
    }

    #[tokio::test]
    async fn what_a_terminals_shell_left_in_its_session_is_stopped() {
        let (_base, places) = places();
        let (environment, _noting) = noted(Local, &places);
        // A job that does not stop as the terminal hangs up, and the shell
        // that started it gone: a while after it was noted, so the system
        // says when it started.
        let script = "trap '' HUP; sleep 300 & sleep 1; exit 0".to_owned();
        let shell = Program::terminal("sh", vec!["-c".to_owned(), script]);
        let (started, pty) = environment.pty(&shell, SIZE).unwrap();
        let leader = started.id().unwrap();
        crash(started);
        until("the shell ended, and its job runs on", || {
            let in_it = those(|process| process.session == Some(leader));
            !running(leader) && in_it.len() == 1
        })
        .await;
        let stopped = stop_left(&places, Before::Crashed).await;
        assert_eq!(stopped.ended.len(), 1, "{stopped:?}");
        assert!(those(|process| process.session == Some(leader)).is_empty());
        drop(pty);
    }

    /// An Agent's tool shell is in a session of its own, under the
    /// Harness's CLI: Linux's `setsid` starts one so.
    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn what_left_the_group_is_stopped_while_what_started_it_runs() {
        let (_base, places) = places();
        let (environment, _noting) = noted(Local, &places);
        let started = environment.spawn(&harness("setsid sleep 300 & wait"), Input::Null);
        let leader = started.as_ref().unwrap().id().unwrap();
        crash(started.unwrap());
        let apart =
            || those(|process| process.parent == Some(leader) && process.group != Some(leader));
        until("its sleep runs in a session of its own", || {
            apart().len() == 1
        })
        .await;
        let apart = apart()[0];
        let stopped = stop_left(&places, Before::Crashed).await;
        assert!(stopped.ended.contains(&apart), "{stopped:?}");
        assert!(!running(apart) && !running(leader));
    }
}
