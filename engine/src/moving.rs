//! How the engine moves onto another copy of itself (ADR 0119, decision
//! 3): the updates module asks ([`banda_updates::restart::Restart`]), the
//! engine stops as a TERM stops it, and then, its runtime and every child
//! that dies with it gone, it runs the new copy's program in its own
//! place, with its own arguments: the same process, so the same systemd
//! unit or launchd job, and no moment in which none or two engines hold
//! the state's lock.
//!
//! Not a stop of the unit and a start of another: a transient unit's
//! program cannot be changed, and between the stop and the start a window
//! of the older version could start its own engine. The unit still names
//! the copy it was started with, so a crash starts that again, which then
//! moves again once nothing runs.
//!
//! On Linux it first ends what is left in its unit's cgroup, as systemd's
//! `KillMode=mixed` would on a stop: TERM, then KILL after the unit's
//! `TimeoutStopSec`. On macOS launchd ends nothing on a job's stop either.

#[cfg(unix)]
use crate::Failure;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The program asked for, once the engine stops to move.
static ONTO: OnceLock<PathBuf> = OnceLock::new();

/// The engine stops to run `program` in its place.
pub fn asked(program: PathBuf) {
    let _ = ONTO.set(program);
}

/// The program to run in this one's place, once the engine stopped for it.
#[cfg_attr(
    not(unix),
    expect(dead_code, reason = "only Unix runs a copy in its place")
)]
pub fn onto() -> Option<&'static Path> {
    ONTO.get().map(PathBuf::as_path)
}

/// Runs `program` in this process's place, with its arguments; returns
/// only why it could not.
#[cfg(unix)]
pub fn exec(program: &Path) -> Failure {
    use std::os::unix::process::CommandExt;
    #[cfg(target_os = "linux")]
    left_in_unit::end();
    tracing::info!(program = %program.display(), "the engine runs its new copy in its place");
    let error = std::process::Command::new(program)
        .args(std::env::args_os().skip(1))
        .exec();
    Failure::Broken(format!(
        "Banda's engine could not run {}: {error}",
        program.display()
    ))
}

/// What is left in the engine's unit, its own children's children.
#[cfg(target_os = "linux")]
mod left_in_unit {
    use rustix::process::{Pid, Signal, kill_process};
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    /// The unit's `TimeoutStopSec`, which `service.rs` sets.
    const STOPS_WITHIN: Duration = Duration::from_secs(15);

    /// Ends every process of the engine's unit but itself: TERM, then
    /// KILL to what is still there after [`STOPS_WITHIN`]. Outside a unit
    /// of the engine's, nothing.
    pub fn end() {
        let Some(group) = own_group() else {
            return;
        };
        let began = Instant::now();
        let mut signal = Signal::TERM;
        let mut told = Vec::new();
        loop {
            let left = left(&group);
            if left.is_empty() {
                return;
            }
            if signal == Signal::TERM && began.elapsed() > STOPS_WITHIN {
                tracing::warn!(
                    left = left.len(),
                    "killed what did not stop in the engine's unit"
                );
                signal = Signal::KILL;
                told.clear();
            }
            for pid in left {
                if told.contains(&pid) {
                    continue;
                }
                if let Some(process) = Pid::from_raw(pid) {
                    let _ = kill_process(process, signal);
                }
                told.push(pid);
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    /// The engine's own cgroup, when it is a unit of the engine's.
    fn own_group() -> Option<PathBuf> {
        let cgroup = std::fs::read_to_string("/proc/self/cgroup").ok()?;
        crate::service::unit_in(&cgroup)?;
        let path = cgroup.lines().find_map(|line| line.strip_prefix("0::"))?;
        Some(Path::new("/sys/fs/cgroup").join(path.trim_start_matches('/')))
    }

    /// The processes in `group` and the groups under it, but this one.
    fn left(group: &Path) -> Vec<i32> {
        let own = i32::try_from(std::process::id()).unwrap_or_default();
        let mut found = Vec::new();
        let mut groups = vec![group.to_owned()];
        while let Some(group) = groups.pop() {
            if let Ok(procs) = std::fs::read_to_string(group.join("cgroup.procs")) {
                found.extend(
                    (procs.lines())
                        .filter_map(|pid| pid.trim().parse::<i32>().ok())
                        .filter(|pid| *pid != own),
                );
            }
            for entry in std::fs::read_dir(&group).into_iter().flatten().flatten() {
                if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                    groups.push(entry.path());
                }
            }
        }
        found
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn what_is_left_is_read_from_the_groups_under_it_too() {
            let group = tempfile::tempdir().unwrap();
            let under = group.path().join("fence");
            std::fs::create_dir_all(&under).unwrap();
            let own = std::process::id();
            std::fs::write(group.path().join("cgroup.procs"), format!("{own}\n41\n")).unwrap();
            std::fs::write(under.join("cgroup.procs"), "42\n").unwrap();
            let mut left = left(group.path());
            left.sort_unstable();
            assert_eq!(left, vec![41, 42], "all but itself");
        }
    }
}
