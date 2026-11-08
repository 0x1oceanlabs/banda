//! Whether what a Harness's process started still serves (ADR 0083): a
//! server or a trial an Agent started, listening on a TCP port. Behind the
//! fence it ends with the process, so a host that serves is not let go
//! for having nothing to do ([`Host::serving`](crate::hosts::Host)).
//!
//! Only what an Agent ran counts: its tool's shell gives it a process
//! group of its own, as a shell with job control does. What listens in
//! the group of the Harness's process is the Harness's own, as Claude
//! Code's CLI listens for an editor (the terminal module's servers leave
//! it out alike), and a socket the engine holds too is the engine's, one
//! its Harness got from it.

/// Whether a process under `leader`, the Harness's process, in a group
/// other than `leader`'s, listens on a TCP port the engine does not hold.
#[cfg(target_os = "linux")]
pub fn serves(leader: u32) -> bool {
    use std::collections::{HashMap, HashSet};
    let mut listening: HashSet<u64> = ["/proc/net/tcp", "/proc/net/tcp6"]
        .into_iter()
        .filter_map(|table| std::fs::read_to_string(table).ok())
        .flat_map(|table| {
            (table.lines().skip(1))
                .filter_map(|row| {
                    let columns: Vec<&str> = row.split_whitespace().collect();
                    (columns.get(3) == Some(&"0A")).then(|| columns.get(9)?.parse().ok())?
                })
                .collect::<Vec<u64>>()
        })
        .collect();
    for held in sockets("self") {
        listening.remove(&held);
    }
    if listening.is_empty() {
        return false;
    }
    // Each process by its number: its parent's, and its group's.
    let table: HashMap<u32, (u32, u32)> = std::fs::read_dir("/proc")
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok()?.file_name().to_str()?.parse::<u32>().ok())
        .filter_map(|process| {
            let stat = std::fs::read_to_string(format!("/proc/{process}/stat")).ok()?;
            let mut fields = stat.rsplit_once(')')?.1.split_whitespace().skip(1);
            let parent = fields.next()?.parse().ok()?;
            let group = fields.next()?.parse().ok()?;
            Some((process, (parent, group)))
        })
        .collect();
    let Some(&(_, harness_s)) = table.get(&leader) else {
        return false;
    };
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (&process, &(parent, _)) in &table {
        children.entry(parent).or_default().push(process);
    }
    let mut under = vec![leader];
    let mut at = 0;
    while let Some(&process) = under.get(at) {
        under.extend(children.get(&process).into_iter().flatten());
        at += 1;
    }
    under
        .into_iter()
        .filter(|process| {
            table
                .get(process)
                .is_some_and(|&(_, group)| group != harness_s)
        })
        .any(|process| {
            (sockets(&process.to_string()).into_iter()).any(|socket| listening.contains(&socket))
        })
}

/// Whether a process under `leader` listens: not looked at here yet.
#[cfg(not(target_os = "linux"))]
pub fn serves(_leader: u32) -> bool {
    false
}

/// The sockets the process `process` (a number, or `self`) holds, by
/// their inodes.
#[cfg(target_os = "linux")]
fn sockets(process: &str) -> Vec<u64> {
    let Ok(fds) = std::fs::read_dir(format!("/proc/{process}/fd")) else {
        return Vec::new();
    };
    fds.filter_map(|fd| std::fs::read_link(fd.ok()?.path()).ok())
        .filter_map(|link| {
            let link = link.to_str()?.strip_prefix("socket:[")?.strip_suffix(']')?;
            link.parse::<u64>().ok()
        })
        .collect()
}

// Where it looks, Linux.
#[cfg(target_os = "linux")]
#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::CommandExt;
    use std::process::{Child, Command, Stdio};
    use std::time::Duration;

    /// Ends `child` and its group, which it leads.
    fn ended(mut child: Child) {
        let group = rustix::process::Pid::from_child(&child);
        let _ = rustix::process::kill_process_group(group, rustix::process::Signal::KILL);
        child.wait().unwrap();
    }

    /// A Harness's process, `sh`, whose child holds `listener` as its
    /// stdin: in a group of its own, as an Agent's tool starts it, or in
    /// the Harness's. With `setsid`, not `set -m`, and through fd 3: a
    /// shell with no terminal, as CI's `dash`, has no job control, and
    /// gives what it starts in the background `/dev/null` as its stdin.
    fn harness(listener: Option<std::net::TcpListener>, own_group: bool) -> Child {
        let child = if own_group { "setsid " } else { "" };
        let script = format!("exec 3<&0; {child}sleep 30 <&3 3<&- & exec sleep 31 <&- 3<&-");
        let stdin = match listener {
            Some(listener) => Stdio::from(std::os::fd::OwnedFd::from(listener)),
            None => Stdio::null(),
        };
        (Command::new("sh").args(["-c", &script]))
            .stdin(stdin)
            .process_group(0)
            .spawn()
            .unwrap()
    }

    /// Whether `serves` finds that `leader` serves within two seconds.
    fn found(leader: u32) -> bool {
        (0..100).any(|_| {
            std::thread::sleep(Duration::from_millis(20));
            serves(leader)
        })
    }

    /// A Harness serves while what an Agent ran under it holds a listening
    /// socket, not while what listens is the Harness's own or the
    /// engine's.
    #[test]
    fn a_harness_serves_while_what_an_agent_ran_under_it_listens() {
        let quiet = harness(None, true);
        std::thread::sleep(Duration::from_millis(100));
        assert!(!serves(quiet.id()), "nothing under it listens");
        ended(quiet);

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let serving = harness(Some(listener), true);
        let leader = serving.id();
        let served = found(leader);
        ended(serving);
        assert!(
            served,
            "its `sleep`, in a group of its own, holds a listening socket"
        );

        // In the Harness's own group: its own, as an editor's port.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let own = harness(Some(listener), false);
        let leader = own.id();
        let served = found(leader);
        ended(own);
        assert!(
            !served,
            "the Harness's own listening is not an Agent's server"
        );

        // One the engine holds too: the engine's.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let kept = listener.try_clone().unwrap();
        let handed = harness(Some(listener), true);
        let leader = handed.id();
        let served = found(leader);
        ended(handed);
        drop(kept);
        assert!(!served, "a socket the engine holds is the engine's");
    }
}
