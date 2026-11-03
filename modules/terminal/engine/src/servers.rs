//! The servers started in Banda (ADR 0044): programs that listen on a
//! loopback or wildcard address and carry a Space's ID in their
//! environment, as all a terminal or a Harness starts does.
//!
//! One look finds every Space's, every 3 seconds while a window listens:
//! `/proc` on Linux; `lsof`, `sysinfo` and `ps` on macOS. Nothing is sent
//! to a server found: bytes it does not speak may break it.

use crate::model::{Server, Servers, StartedBy};
use banda_kernel::{SPACE_VARIABLE, SpaceId, Stream};
use rustix::process::{Pid, Signal, kill_process, kill_process_group};
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, watch};

/// The variable that names its terminal in the environment of what a
/// terminal starts (ADR 0044, decision 2).
pub const TERMINAL_VARIABLE: &str = "BANDA_TERMINAL";

/// How often it looks while a window listens.
const EVERY: Duration = Duration::from_secs(3);
/// How long a stopped server has to end before it is killed, as T3
/// Code's: longer than a closed terminal's, as a server may finish a
/// request or write its files.
const GRACE: Duration = Duration::from_secs(3);

/// A server, and the Space it carries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Found {
    pub space: SpaceId,
    pub server: Server,
}

/// A process, as the system's table of them says: what started it, and
/// its process group.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Row {
    pub parent: u32,
    pub group: u32,
}

/// Every process, by its number.
pub type Table = HashMap<u32, Row>;

/// Every Space's servers, looked for while one is heard.
#[derive(Default)]
pub struct Scanner {
    found: watch::Sender<Arc<[Found]>>,
    looking: Mutex<bool>,
}

impl Scanner {
    /// `space`'s servers, then their list again each time it changes.
    pub fn stream(self: &Arc<Self>, space: SpaceId) -> Stream {
        let mut found = self.watch();
        // One list waits at a time; a newer one replaces it.
        let (say, heard) = mpsc::channel(1);
        tokio::spawn(async move {
            let mut told = None;
            loop {
                let servers = of(space, &found.borrow_and_update());
                if told.as_ref() != Some(&servers) {
                    let Ok(said) = serde_json::to_value(&servers) else {
                        return;
                    };
                    if say.send(said).await.is_err() {
                        return;
                    }
                    told = Some(servers);
                }
                tokio::select! {
                    changed = found.changed() => if changed.is_err() {
                        return;
                    },
                    () = say.closed() => return,
                }
            }
        });
        heard
    }

    /// Every Space's servers, now and as they change. It looks while one
    /// of these is held.
    fn watch(self: &Arc<Self>) -> watch::Receiver<Arc<[Found]>> {
        let mut looking = self.looking.lock().unwrap();
        let heard = self.found.subscribe();
        if !*looking {
            *looking = true;
            tokio::spawn(self.clone().look_while_heard());
        }
        heard
    }

    async fn look_while_heard(self: Arc<Self>) {
        loop {
            let now = look().await;
            self.found.send_if_modified(|found| {
                let now = in_order(found, now);
                let changed = **found != *now;
                if changed {
                    *found = now.into();
                }
                changed
            });
            tokio::time::sleep(EVERY).await;
            let mut looking = self.looking.lock().unwrap();
            if self.found.receiver_count() == 0 {
                // What it found is old by the time one listens again.
                self.found.send_replace(Arc::from([]));
                *looking = false;
                return;
            }
        }
    }
}

/// `space`'s servers out of every Space's.
fn of(space: SpaceId, found: &[Found]) -> Servers {
    Servers {
        servers: (found.iter())
            .filter(|found| found.space == space)
            .map(|found| found.server.clone())
            .collect(),
    }
}

/// Every Space's servers now: one for each Space and port, the process
/// that holds it first, as IPv4 and IPv6 on one port are one server.
pub async fn look() -> Vec<Found> {
    let mut found = system::look().await;
    found.sort_by_key(|found| (found.space, found.server.port, found.server.process));
    found.dedup_by_key(|found| (found.space, found.server.port));
    found
}

/// `now` in the order its servers came: those found `before` as they
/// were, then the new ones.
fn in_order(before: &[Found], now: Vec<Found>) -> Vec<Found> {
    let (mut kept, new): (Vec<_>, Vec<_>) = now.into_iter().partition(|f| before.contains(f));
    kept.sort_by_key(|kept| before.iter().position(|was| was == kept));
    kept.extend(new);
    kept
}

/// The terminal named in the engine's own environment, where it was
/// started in another Banda's terminal: what the engine starts inherits
/// it, and it names no terminal of this Banda's.
static INHERITED: LazyLock<Option<String>> =
    LazyLock::new(|| std::env::var(TERMINAL_VARIABLE).ok());

/// The Space a process's environment names, and what started it: a
/// terminal when it names one too.
fn carried<'a>(environ: impl IntoIterator<Item = &'a [u8]>) -> Option<(SpaceId, StartedBy)> {
    let (mut space, mut by) = (None, StartedBy::Agent);
    for pair in environ {
        let Some((key, value)) = (std::str::from_utf8(pair).ok()).and_then(|p| p.split_once('='))
        else {
            continue;
        };
        match key {
            SPACE_VARIABLE => space = value.parse().ok(),
            TERMINAL_VARIABLE if INHERITED.as_deref() != Some(value) => {
                by = StartedBy::Terminal;
            }
            _ => {}
        }
    }
    Some((space?, by))
}

/// Whether a socket bound to `address` is served on this computer only or
/// on every address it has: a loopback or wildcard address (ADR 0044,
/// decision 1).
fn served_here(address: IpAddr) -> bool {
    let address = address.to_canonical();
    address.is_loopback() || address.is_unspecified()
}

/// Leaves out what a Harness listens on itself, as Claude Code's CLI does
/// for an editor: a process in the group of the Harness's process, the
/// engine's child it comes from. What an Agent runs, its tool's shell
/// gives a group of its own, as a shell with job control does.
fn no_harness_s(found: &mut Vec<Found>, table: &Table, engine: u32) {
    found.retain(|found| {
        found.server.by == StartedBy::Terminal || !harness_s(found.server.process, table, engine)
    });
}

fn harness_s(process: u32, table: &Table, engine: u32) -> bool {
    let Some(&own) = table.get(&process) else {
        return false;
    };
    let mut row = own;
    // A cycle in a table read as processes came and went ends it too.
    for _ in 0..table.len() {
        if row.parent == engine {
            return row.group == own.group;
        }
        let Some(&up) = table.get(&row.parent) else {
            // Not under the engine: its Harness is gone.
            return false;
        };
        row = up;
    }
    false
}

/// What stopping a server signals.
#[derive(Debug, PartialEq, Eq)]
enum Stopped {
    /// Its process group: the job a shell or an Agent's tool gave it.
    Group(u32),
    /// The server and what it started, where its group is shared.
    Processes(Vec<u32>),
}

/// What stopping `process` signals: its process group, unless the group
/// holds the engine, what started the engine, or what the engine started
/// (a terminal's program, a Harness's process, and so a Harness's CLI);
/// then `process` and what it started, which none of those are.
fn stopped(process: u32, table: &Table, engine: u32) -> Stopped {
    let group = table.get(&process).map(|row| row.group);
    let mut spared = HashSet::from([engine]);
    let mut up = table.get(&engine).map(|row| row.parent);
    while let Some(parent) = up.filter(|&parent| parent > 1 && spared.insert(parent)) {
        up = table.get(&parent).map(|row| row.parent);
    }
    let shared = |group| {
        (table.iter())
            .any(|(at, row)| row.group == group && (spared.contains(at) || row.parent == engine))
    };
    match group {
        Some(group) if group > 1 && !shared(group) => Stopped::Group(group),
        _ => Stopped::Processes(and_descendants(process, table)),
    }
}

/// `process` and every process it started, and they started.
fn and_descendants(process: u32, table: &Table) -> Vec<u32> {
    let mut found = vec![process];
    let mut at = 0;
    while let Some(&parent) = found.get(at) {
        let children: Vec<u32> = (table.iter())
            .filter(|&(child, row)| row.parent == parent && !found.contains(child))
            .map(|(&child, _)| child)
            .collect();
        found.extend(children);
        at += 1;
    }
    found
}

impl Stopped {
    fn send(&self, signal: Signal) {
        let pid = |process: u32| i32::try_from(process).ok().and_then(Pid::from_raw);
        match self {
            Stopped::Group(group) => {
                if let Some(group) = pid(*group) {
                    let _ = kill_process_group(group, signal);
                }
            }
            Stopped::Processes(processes) => {
                for process in processes.iter().filter_map(|&p| pid(p)) {
                    let _ = kill_process(process, signal);
                }
            }
        }
    }
}

/// Stops `process`, a server just found, and what it started: a request
/// to stop, then a kill after a grace.
pub async fn stop(process: u32) {
    let stopped = stopped(process, &system::table().await, std::process::id());
    stopped.send(Signal::TERM);
    tokio::spawn(async move {
        tokio::time::sleep(GRACE).await;
        stopped.send(Signal::KILL);
    });
}

/// Reads `/proc`.
#[cfg(not(target_os = "macos"))]
mod system {
    use super::{Found, Row, Table, carried, no_harness_s, served_here};
    use crate::front::{program_of, words_of};
    use crate::model::{Server, StartedBy};
    use std::collections::HashMap;
    use std::fs;
    use std::net::IpAddr;
    use std::path::Path;
    use std::sync::Mutex;

    /// The sockets that listened at the last look, and the servers found:
    /// while the same ones listen and their processes run, nothing else
    /// changed, and the look reads no process.
    static LAST: Mutex<Option<(Vec<u64>, Vec<Found>)>> = Mutex::new(None);

    pub async fn look() -> Vec<Found> {
        tokio::task::spawn_blocking(read).await.unwrap_or_default()
    }

    pub async fn table() -> Table {
        tokio::task::spawn_blocking(read_table)
            .await
            .unwrap_or_default()
    }

    fn read() -> Vec<Found> {
        let mut listening = listening();
        // What the engine holds is its own, or a socket the window's
        // process left open to it, which all it starts holds too (#436):
        // no server.
        let ours: Vec<u64> = sockets("self").collect();
        listening.retain(|inode, _| !ours.contains(inode));
        let mut sockets: Vec<u64> = listening.keys().copied().collect();
        sockets.sort_unstable();
        let mut last = LAST.lock().unwrap();
        if let Some((was, found)) = last.as_ref()
            && *was == sockets
            && (found.iter())
                .all(|found| Path::new(&format!("/proc/{}", found.server.process)).exists())
        {
            return found.clone();
        }
        let found = held(&listening);
        *last = Some((sockets, found.clone()));
        found
    }

    /// The processes that carry a Space and hold one of the `listening`
    /// sockets.
    fn held(listening: &HashMap<u64, u16>) -> Vec<Found> {
        let engine = std::process::id();
        let mut found = Vec::new();
        if listening.is_empty() {
            return found;
        }
        let Ok(processes) = fs::read_dir("/proc") else {
            return found;
        };
        for entry in processes.flatten() {
            let Some(process) = (entry.file_name().to_str()).and_then(|name| name.parse().ok())
            else {
                continue;
            };
            if process == engine {
                continue;
            }
            // Another user's process reads as an error.
            let Ok(environ) = fs::read(format!("/proc/{process}/environ")) else {
                continue;
            };
            let Some((space, by)) = carried(environ.split(|byte| *byte == 0)) else {
                continue;
            };
            let ports: Vec<u16> = sockets(process)
                .filter_map(|inode| listening.get(&inode).copied())
                .collect();
            if ports.is_empty() {
                continue;
            }
            let program = (words_of(process).as_deref())
                .and_then(program_of)
                .unwrap_or_default();
            found.extend(ports.into_iter().map(|port| Found {
                space,
                server: Server {
                    port,
                    process,
                    program: program.clone(),
                    by,
                },
            }));
        }
        if found
            .iter()
            .any(|found| found.server.by == StartedBy::Agent)
        {
            no_harness_s(&mut found, &read_table(), engine);
        }
        found
    }

    /// The inodes of the sockets `process` holds: none where it cannot
    /// be read, as another user's.
    fn sockets(process: impl std::fmt::Display) -> impl Iterator<Item = u64> {
        let held = fs::read_dir(format!("/proc/{process}/fd"))
            .into_iter()
            .flatten();
        held.flatten()
            .filter_map(|fd| socket(&fs::read_link(fd.path()).ok()?))
    }

    /// The inode of a link to `socket:[12345]`.
    fn socket(link: &Path) -> Option<u64> {
        let inode = link.to_str()?.strip_prefix("socket:[")?.strip_suffix(']')?;
        inode.parse().ok()
    }

    /// The sockets that listen on a loopback or wildcard address: their
    /// ports, by inode.
    fn listening() -> HashMap<u64, u16> {
        let mut found = HashMap::new();
        for table in ["/proc/net/tcp", "/proc/net/tcp6"] {
            if let Ok(table) = fs::read_to_string(table) {
                found.extend(table.lines().skip(1).filter_map(listener));
            }
        }
        found
    }

    /// A row of `/proc/net/tcp` or `tcp6` that listens (`0A`) on a
    /// loopback or wildcard address: its inode and port.
    pub(super) fn listener(row: &str) -> Option<(u64, u16)> {
        let mut fields = row.split_whitespace();
        let (address, port) = fields.nth(1)?.split_once(':')?;
        if fields.nth(1)? != "0A" || !served_here(address_of(address)?) {
            return None;
        }
        let inode = fields.nth(5)?.parse().ok().filter(|&inode| inode != 0)?;
        Some((inode, u16::from_str_radix(port, 16).ok()?))
    }

    /// An address as `/proc/net/tcp` writes it: 32-bit words in hex, each
    /// in the machine's order, as Linux's are on every machine Banda runs.
    fn address_of(hex: &str) -> Option<IpAddr> {
        let bytes = (0..hex.len())
            .step_by(8)
            .map(|at| u32::from_str_radix(hex.get(at..at + 8)?, 16).ok())
            .collect::<Option<Vec<_>>>()?
            .into_iter()
            .flat_map(u32::to_le_bytes)
            .collect::<Vec<_>>();
        match bytes.len() {
            4 => Some(IpAddr::from(<[u8; 4]>::try_from(bytes).ok()?)),
            16 => Some(IpAddr::from(<[u8; 16]>::try_from(bytes).ok()?)),
            _ => None,
        }
    }

    /// Every process this user can see, from its `stat`.
    fn read_table() -> Table {
        let Ok(processes) = fs::read_dir("/proc") else {
            return Table::new();
        };
        (processes.flatten())
            .filter_map(|entry| {
                let process = entry.file_name().to_str()?.parse().ok()?;
                let stat = fs::read_to_string(format!("/proc/{process}/stat")).ok()?;
                Some((process, row(&stat)?))
            })
            .collect()
    }

    /// What `/proc/<pid>/stat` says of its parent and group.
    pub(super) fn row(stat: &str) -> Option<Row> {
        // Its name, in parentheses, may hold spaces and parentheses.
        let (_, after) = stat.rsplit_once(')')?;
        let mut fields = after.split_whitespace().skip(1);
        Some(Row {
            parent: fields.next()?.parse().ok()?,
            group: fields.next()?.parse().ok()?,
        })
    }
}

/// Asks `lsof` and `ps`, and reads what each process carries through
/// `sysinfo`.
#[cfg(target_os = "macos")]
mod system {
    use super::{Found, Row, Table, carried, no_harness_s, served_here};
    use crate::front::{program_of, words};
    use crate::model::{Server, StartedBy};
    use std::net::IpAddr;
    use std::process::Stdio;
    use std::time::Duration;
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    /// How long `lsof` or `ps` has to answer.
    const ASKING: Duration = Duration::from_secs(2);

    pub async fn look() -> Vec<Found> {
        // It answers 1 when nothing listens.
        let said = ask("lsof", &["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pcn"]).await;
        let mut listening = listening(&said.unwrap_or_default());
        // What the engine holds is its own, or a socket the window's
        // process left open to it, which all it starts holds too (#436):
        // no server.
        let engine = std::process::id();
        let ours: Vec<u16> = (listening.iter())
            .filter(|&&(process, _)| process == engine)
            .map(|&(_, port)| port)
            .collect();
        listening.retain(|(_, port)| !ours.contains(port));
        if listening.is_empty() {
            return Vec::new();
        }
        let mut found = tokio::task::spawn_blocking(move || read(listening))
            .await
            .unwrap_or_default();
        if found
            .iter()
            .any(|found| found.server.by == StartedBy::Agent)
        {
            no_harness_s(&mut found, &table().await, engine);
        }
        found
    }

    pub async fn table() -> Table {
        let said = ask("ps", &["-A", "-o", "pid=,ppid=,pgid="]).await;
        rows(&said.unwrap_or_default())
    }

    async fn ask(program: &str, args: &[&str]) -> Option<String> {
        let asked = tokio::process::Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .output();
        let said = tokio::time::timeout(ASKING, asked).await.ok()?.ok()?;
        Some(String::from_utf8_lossy(&said.stdout).into_owned())
    }

    /// What `lsof -F pcn` says listens on a loopback or wildcard address:
    /// each process and port.
    pub(super) fn listening(said: &str) -> Vec<(u32, u16)> {
        let mut process = None;
        let mut found = Vec::new();
        for line in said.lines() {
            match line.split_at_checked(1) {
                Some(("p", pid)) => process = pid.parse().ok(),
                Some(("n", name)) => {
                    if let (Some(process), Some(port)) = (process, port_of(name)) {
                        found.push((process, port));
                    }
                }
                _ => {}
            }
        }
        found
    }

    /// The port of `127.0.0.1:5173`, `*:5173` or `[::1]:5173`, served here.
    fn port_of(name: &str) -> Option<u16> {
        let (host, port) = name.rsplit_once(':')?;
        let host = host.trim_start_matches('[').trim_end_matches(']');
        let here = host == "*" || host.parse::<IpAddr>().is_ok_and(served_here);
        here.then(|| port.parse().ok()).flatten()
    }

    fn read(listening: Vec<(u32, u16)>) -> Vec<Found> {
        let Ok(mut system) = System::new() else {
            return Vec::new();
        };
        let asked: Vec<Pid> = listening.iter().map(|&(p, _)| Pid::from_u32(p)).collect();
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&asked),
            true,
            ProcessRefreshKind::nothing()
                .with_cmd(UpdateKind::Always)
                .with_environ(UpdateKind::Always)
                .without_tasks(),
        );
        (listening.into_iter())
            .filter_map(|(process, port)| {
                let found = system.process(Pid::from_u32(process))?;
                let (space, by) = carried(found.environ().iter().map(|p| p.as_encoded_bytes()))?;
                Some(Found {
                    space,
                    server: Server {
                        port,
                        process,
                        program: program_of(&words(found)).unwrap_or_default(),
                        by,
                    },
                })
            })
            .collect()
    }

    /// `ps -o pid=,ppid=,pgid=`'s table.
    pub(super) fn rows(said: &str) -> Table {
        (said.lines())
            .filter_map(|line| {
                let mut numbers = line.split_whitespace().map(|n| n.parse().ok());
                let (process, parent, group) =
                    (numbers.next()??, numbers.next()??, numbers.next()??);
                Some((process, Row { parent, group }))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(space: SpaceId, process: u32, by: StartedBy) -> Found {
        Found {
            space,
            server: Server {
                port: u16::try_from(process).unwrap(),
                process,
                program: "vite".to_owned(),
                by,
            },
        }
    }

    /// The engine is 100, started by 10 in group 10. Its Harness's process
    /// 200 shares its group, through `npx` 201, as its CLI 202 does; the
    /// CLI's tool shell 300 leads a group, and runs `pnpm` 301 and `vite`
    /// 302. A terminal's shell 400 leads its own; its job 500 too, and a
    /// server 401 it started without job control stays in the shell's.
    /// 600 was left alone by what started it.
    fn processes() -> Table {
        [
            (10, 1, 10),
            (100, 10, 10),
            (200, 100, 10),
            (201, 200, 10),
            (202, 201, 10),
            (300, 202, 300),
            (301, 300, 300),
            (302, 301, 300),
            (400, 100, 400),
            (401, 400, 400),
            (500, 400, 500),
            (501, 500, 500),
            (600, 1, 600),
        ]
        .into_iter()
        .map(|(process, parent, group)| (process, Row { parent, group }))
        .collect()
    }

    #[test]
    fn a_process_carries_its_space_and_whether_a_terminal_started_it() {
        let space = SpaceId::new();
        let carried = |pairs: &[&str]| carried(pairs.iter().map(|p| p.as_bytes()));
        let at = format!("BANDA_SPACE={space}");
        let terminal = format!("BANDA_TERMINAL={}", SpaceId::new());
        assert_eq!(
            carried(&["PATH=/bin", &at, &terminal]),
            Some((space, StartedBy::Terminal))
        );
        assert_eq!(carried(&[&at]), Some((space, StartedBy::Agent)));
        assert_eq!(carried(&["BANDA_SPACE=nonsense"]), None);
        assert_eq!(carried(&["HOME=/home/me"]), None);
    }

    #[test]
    fn servers_keep_the_order_they_came_in() {
        let space = SpaceId::new();
        let by = StartedBy::Agent;
        let before = [server(space, 5173, by), server(space, 3000, by)];
        let now = vec![
            server(space, 3000, by),
            server(space, 5173, by),
            server(space, 6006, by),
        ];
        let ports: Vec<u16> = (in_order(&before, now).iter())
            .map(|f| f.server.port)
            .collect();
        assert_eq!(ports, [5173, 3000, 6006]);
    }

    #[test]
    fn a_space_sees_its_own_servers() {
        let (here, there) = (SpaceId::new(), SpaceId::new());
        let by = StartedBy::Terminal;
        let found = [
            server(here, 5173, by),
            server(there, 3000, by),
            server(here, 6006, by),
        ];
        let ports: Vec<u16> = of(here, &found).servers.iter().map(|s| s.port).collect();
        assert_eq!(ports, [5173, 6006]);
    }

    #[test]
    fn a_server_listens_on_a_loopback_or_wildcard_address() {
        for here in [
            "127.0.0.1",
            "127.0.0.2",
            "0.0.0.0",
            "::1",
            "::",
            "::ffff:127.0.0.1",
        ] {
            assert!(served_here(here.parse().unwrap()), "{here}");
        }
        for elsewhere in ["192.168.1.5", "fe80::1", "::ffff:10.0.0.1"] {
            assert!(!served_here(elsewhere.parse().unwrap()), "{elsewhere}");
        }
    }

    #[test]
    fn what_a_harness_listens_on_itself_is_no_server() {
        let table = processes();
        assert!(harness_s(202, &table, 100), "its CLI");
        assert!(harness_s(200, &table, 100), "its process");
        assert!(!harness_s(302, &table, 100), "what its tool runs");
        assert!(
            !harness_s(600, &table, 100),
            "one no longer under the engine"
        );
        assert!(!harness_s(999, &table, 100), "one gone");
        let space = SpaceId::new();
        let mut found = vec![
            server(space, 202, StartedBy::Agent),
            server(space, 302, StartedBy::Agent),
            server(space, 401, StartedBy::Terminal),
        ];
        no_harness_s(&mut found, &table, 100);
        let left: Vec<u32> = found.iter().map(|f| f.server.process).collect();
        assert_eq!(left, [302, 401]);
    }

    #[test]
    fn a_stopped_server_takes_its_job_and_spares_what_started_it() {
        let table = processes();
        assert_eq!(
            stopped(302, &table, 100),
            Stopped::Group(300),
            "an Agent's job"
        );
        assert_eq!(
            stopped(501, &table, 100),
            Stopped::Group(500),
            "a shell's job"
        );
        assert_eq!(
            stopped(600, &table, 100),
            Stopped::Group(600),
            "one left alone"
        );
        // In the group of a terminal's shell, or of the engine.
        assert_eq!(stopped(401, &table, 100), Stopped::Processes(vec![401]));
        let Stopped::Processes(mut theirs) = stopped(201, &table, 100) else {
            panic!("the engine's group stops whole");
        };
        theirs.sort_unstable();
        assert_eq!(theirs, [201, 202, 300, 301, 302]);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn proc_net_tcp_names_the_sockets_that_listen_here() {
        let row = |address: &str, state: &str, inode: u64| {
            format!(
                "   0: {address} 00000000:0000 {state} 00000000:00000000 00:00000000 00000000  1000        0 {inode} 1 0000000000000000 100 0 0 10 0"
            )
        };
        let listener = |row: String| system::listener(&row);
        assert_eq!(listener(row("0100007F:1435", "0A", 11)), Some((11, 5173)));
        assert_eq!(listener(row("00000000:0BB8", "0A", 12)), Some((12, 3000)));
        let loopback6 = "00000000000000000000000001000000:1435";
        assert_eq!(listener(row(loopback6, "0A", 13)), Some((13, 5173)));
        let wildcard6 = "00000000000000000000000000000000:1435";
        assert_eq!(listener(row(wildcard6, "0A", 14)), Some((14, 5173)));
        // Another address, a connection, a socket with no inode.
        assert_eq!(listener(row("0501A8C0:1435", "0A", 15)), None);
        assert_eq!(listener(row("0100007F:1435", "01", 16)), None);
        assert_eq!(listener(row("0100007F:1435", "0A", 0)), None);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn proc_stat_names_a_process_s_parent_and_group() {
        let stat = "4035131 (node (worker) 2) S 4035054 4033985 4032481 0 -1 4194560";
        let row = system::row(stat).unwrap();
        assert_eq!((row.parent, row.group), (4035054, 4033985));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn lsof_and_ps_name_the_sockets_that_listen_here_and_the_processes() {
        let said = "p501\nfnode\nn127.0.0.1:5173\nf12\nn[::1]:5173\np502\nn*:3000\np503\nn192.168.1.5:8080\n";
        assert_eq!(
            system::listening(said),
            [(501, 5173), (501, 5173), (502, 3000)]
        );
        let rows = system::rows("  501     1   501\n  502   501   501\nnonsense\n");
        assert_eq!(
            rows.get(&502),
            Some(&Row {
                parent: 501,
                group: 501
            })
        );
        assert_eq!(rows.len(), 2);
    }
}
