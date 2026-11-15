//! A file that comes from another machine (ADR 0120, decision 4). No
//! engine talks to another, so the Person's window carries it: it reads
//! the file from the machine that has it and writes each piece to this
//! one ([`take`]), which then puts the file in its folder ([`plan`],
//! [`land`]), as a move from the Project's data does, by the rule a copy
//! keeps for a name taken.
//!
//! A copy on its way is a folder of the Project's data, `copies/<job>/`:
//! its pieces as `part`, then, as it is placed, under the file's own
//! name. It goes as the copy lands or is cancelled
//! ([`forget`]), and what a copy left behind goes after a day ([`sweep`]).
//!
//! Only a Person carries, as for a Thread's move (ADR 0116, decision 4).

use crate::model::{Clash, Clashing, Done};
use crate::ops::{self, Plan, Run};
use banda_kernel::{Call, Refusal};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The most bytes one piece carries, as a piece of a Thread's move.
pub const PIECE: usize = 512 * 1024;
/// How long a copy that never landed keeps its pieces.
const DAY: Duration = Duration::from_secs(24 * 60 * 60);
/// The pieces of a copy, in its folder.
const PART: &str = "part";

pub fn person_only(call: &Call) -> Result<(), Refusal> {
    if call.participant().agent().is_some() {
        return Err(Refusal::forbidden(
            "Only a Person copies a file from another machine.",
        ));
    }
    Ok(())
}

/// The folder of copy `job` in the Project's data: the job's name is one
/// a window gives, letters, digits and `-`, so never a path.
pub fn folder(data: &Path, job: &str) -> Result<PathBuf, Refusal> {
    let plain = |c: char| c.is_ascii_alphanumeric() || c == '-';
    if job.is_empty() || job.len() > 64 || !job.chars().all(plain) {
        return Err(Refusal::invalid("That is no copy's job."));
    }
    Ok(copies(data).join(job))
}

fn copies(data: &Path) -> PathBuf {
    data.join("copies")
}

/// Keeps a piece of a copy at byte `at`: the next one, or the first,
/// which begins the copy anew. `false` for any other.
pub fn take(folder: &Path, at: u64, piece: &[u8]) -> io::Result<bool> {
    if at == 0 {
        folder.parent().map(sweep);
        forget(folder);
    }
    fs::create_dir_all(folder)?;
    let mut file = File::options()
        .create(true)
        .append(true)
        .open(folder.join(PART))?;
    let size = file.metadata()?.len();
    if at != size {
        return Ok(false);
    }
    // A piece is kept whole or not at all, so the same one may come again.
    file.write_all(piece).inspect_err(|_| {
        let _ = file.set_len(size);
    })?;
    Ok(true)
}

/// What puts the file carried into `folder` in `dir` as `name`, when all
/// `size` bytes of it came: a move from the copy's folder, undone as a
/// copy is; or the name taken, to ask about.
pub fn plan(
    folder: &Path,
    dir: &Path,
    name: &str,
    size: u64,
    taken: Clash,
) -> Result<Result<Plan, Vec<Clashing>>, Refusal> {
    let again = || Refusal::conflict(format!("{name} did not come whole: copy it again."));
    let from = named(folder, name, size).map_err(|_| again())?;
    let came = fs::symlink_metadata(&from).ok();
    if came.is_none_or(|found| found.len() != size) {
        forget(folder);
        return Err(again());
    }
    let sources = [(name.to_owned(), from)];
    let plan = ops::plan(&sources, dir, false, taken, &BTreeMap::new());
    Ok(plan.map(|plan| Plan {
        arrives: true,
        ..plan
    }))
}

/// Runs `plan`, and removes what the copy kept once the file landed or
/// was skipped: stopped or refused by the disk, it stays for the next
/// try, a cancel or the sweep.
pub fn land(folder: &Path, plan: Plan, run: &mut Run<'_>) -> Done {
    let done = ops::run(plan, false, run);
    if done.failed.is_none() && !done.stopped {
        forget(folder);
    }
    done
}

/// The copy's pieces under the file's own name, in the copy's folder, so
/// they go from there as any file does: there already where a name taken
/// was asked about. A file of no bytes has no piece.
fn named(folder: &Path, name: &str, size: u64) -> io::Result<PathBuf> {
    let (part, named) = (folder.join(PART), folder.join(name));
    if size == 0 && !ops::there(&part) && !ops::there(&named) {
        fs::create_dir_all(folder)?;
        File::create_new(&part)?;
    }
    if ops::there(&part) {
        fs::rename(&part, &named)?;
    }
    Ok(named)
}

/// Removes what copy `folder` kept.
pub fn forget(folder: &Path) {
    ops::remove(folder);
}

/// Removes the copies nothing was written to for a day.
fn sweep(copies: &Path) {
    let Ok(entries) = fs::read_dir(copies) else {
        return;
    };
    let old = |path: &Path| {
        (fs::symlink_metadata(path).and_then(|found| found.modified()))
            .is_ok_and(|at| at.elapsed().is_ok_and(|since| since > DAY))
    };
    for entry in entries.flatten() {
        let folder = entry.path();
        let mut inside = fs::read_dir(&folder).into_iter().flatten().flatten();
        if old(&folder) && inside.all(|kept| old(&kept.path())) {
            forget(&folder);
        }
    }
}

// Unix only: Windows opens no folder to age it.
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::SystemTime;

    #[test]
    fn a_copy_nothing_was_written_to_for_a_day_goes_with_the_next_piece() {
        let data = tempfile::tempdir().unwrap();
        let data = data.path();
        let aged = |path: &Path| {
            let then = SystemTime::now() - DAY - Duration::from_secs(60);
            File::open(path).unwrap().set_modified(then).unwrap();
        };
        let job = |name: &str| folder(data, name).unwrap();
        for name in ["left", "slow"] {
            assert!(take(&job(name), 0, b"abc").unwrap());
            aged(&job(name));
        }
        // Left a day ago, and one begun then that a piece still came to.
        aged(&job("left").join(PART));
        assert!(take(&job("new"), 0, b"abc").unwrap());
        assert!(!job("left").exists());
        assert!(job("slow").join(PART).exists() && job("new").join(PART).exists());
    }
}
