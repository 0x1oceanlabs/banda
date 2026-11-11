//! A Thread moves to another Project of this machine (ADR 0098, decision
//! 14: the card's "Move to Project…"). It goes whole: its rows in the
//! module's tables, with its Person's marks, its Later, the parent it
//! names, what its turns changed in lines and its sub-agents' lanes (ADR
//! 0103); the images its items name, a fork's of its source too (ADR
//! 0027); and the files they name in the Project's data, its images, its
//! Visuals' pages, the files kept for its Person's messages (ADR 0026),
//! which its messages name in the new Project's data from then on, and its
//! Claude Code sessions with their sub-agents' (ADR 0078, decision 3). Its
//! messages are found in the new Project's search, and no more in the old
//! one's. Its session goes on there from its next turn, in the new
//! Project's folder, and the Thread says so in a notice its Agent reads
//! before its next message. What its Agent changed stays in the old
//! folder: a Thread has no worktree of its own yet (ADR 0034, decision
//! 11), so there is none to move or to refuse. The old Project's log keeps
//! what the Thread said there, and a Thread whose parent it is, or that
//! is its parent, names it still.
//!
//! Only a Thread at rest moves ([`may_move`]), so no turn, sub-agent,
//! Question or answer from another Thread is left behind, and only one
//! move of it at a time, and no delete of it meanwhile ([`Live::hold`]).
//! Its session here closes only once the Thread left. A turn or sub-agent
//! that begins here while it moves changes it, so the old Project refuses
//! to let it go, and that work goes on here: a move that does not happen
//! cuts nothing off.
//! Its files go first, each through no link, as either Project's Agent may
//! write its sessions ([`banda_kernel::host::copy_beneath`]): a session
//! file there already is replaced only by one that goes on from it, so a
//! fork that names its source's session never takes back what the source
//! said since. Then its rows go into the new Project, then out of the old
//! one in the command itself, which writes nothing there if anything of
//! the Thread changed meanwhile, or it is at rest no more: the copy is
//! then taken back, while the Thread is still here and its copy as it was
//! written, and the Person is asked to try again. Cut short between the
//! two writes, as by a crash, the Thread is in both Projects, and nothing
//! of it is lost; moved again from where it was, the move goes on, while
//! its copy is as it came.

use crate::acp::Evidence;
use crate::emit;
use crate::images::{Images, blocking};
use crate::kept;
use crate::live::{Hold, Live};
use crate::model::{Fact, ImageId, ThreadId, TurnState, VisualId};
use crate::notices::{self, NOTICE};
use crate::rules::to_project::{Stands, may_go_to, may_move, notice};
use crate::search;
use crate::store::{self, ImageRow, ThreadRows};
use crate::visuals::Visuals;
use banda_harnesses::claude_sessions;
use banda_kernel::{Call, Error, ModuleProject, Participant, ProjectId, Refusal, Tx};
use rusqlite::Connection;
use serde::Deserialize;
use std::io;
use std::path::{Path, PathBuf};
use ts_rs::TS;

/// What `agents.move_thread` is asked: the Thread, and the Project it
/// moves to.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
pub struct MoveThread {
    /// The Thread's ID, as `threads` lists it.
    pub thread: ThreadId,
    /// The Project it moves to, another of this machine's.
    pub project: ProjectId,
}

/// Moves `thread` from the call's Project to `project`, for the Person
/// who calls. One there already stays as it is.
pub async fn move_thread(
    live: &Live,
    call: &Call,
    MoveThread { thread, project }: MoveThread,
) -> Result<(), Refusal> {
    let author = call.participant();
    if author.agent().is_some() {
        return Err(Refusal::forbidden(
            "Only a Person moves a Thread to another Project.",
        ));
    }
    let here = call.project();
    if project == here.id() {
        return Ok(());
    }
    // One move of it at a time, and no delete meanwhile.
    let _held = live.hold(thread, Hold::Moving).map_err(Hold::refused)?;
    let there = call.other(project).await?;
    may_go_to(there.scratch())?;
    let Leaving {
        rows,
        images,
        mut files,
        earlier,
    } = here.read(move |sql| leaving(sql, thread)).await?;
    // The files kept for its Person's messages go too, and there its
    // messages name them there.
    let ours = kept::folder(here.data());
    files.kept = rows.kept_in(&ours);
    let mut came = rows.kept_moved(&ours, &kept::folder(there.data()), &files.kept);
    if let Some(earlier) = earlier {
        came = came.with_own("sessions", earlier);
    }
    // One there already is refused before anything of it is copied, as
    // what it says there would be lost.
    let found = came.clone();
    there.read(move |sql| already(sql, thread, &found)).await?;
    let (from, to) = (here.data().to_owned(), there.data().to_owned());
    blocking(move || copy_files(&from, &to, &files))
        .await
        .map_err(apart)?;
    let said = notice(&here.name(), &here.folder(), &there.folder(), NOTICE);
    let home = here.id();
    let arrived = there
        .write(move |tx| arrive(tx, author, thread, &came, &images, (home, None), &said))
        .await?;
    let left = call
        .command(move |tx| leave(tx, author, thread, &rows, (project, None)))
        .await;
    match &left {
        // It is here no more, so nothing of it goes on here by itself.
        Ok(()) => live.forget_thread(here.id(), thread).await,
        Err(_) => take_back(here, &there, author, thread, arrived).await,
    }
    left
}

/// A Thread about to move: its rows, the images its items name, and the
/// files they name.
pub(crate) struct Leaving {
    pub(crate) rows: ThreadRows,
    pub(crate) images: Vec<ImageRow>,
    pub(crate) files: Files,
    /// The sessions of the Harnesses it ran on before as it has them in
    /// the Project it moves to, as JSON, when one of them stays here.
    pub(crate) earlier: Option<String>,
}

/// The files a Thread's rows name in its Project's data.
#[derive(Clone, Debug, serde::Serialize, Deserialize)]
pub(crate) struct Files {
    pub(crate) images: Vec<ImageId>,
    pub(crate) visuals: Vec<VisualId>,
    /// Its sessions' IDs, the one it has and those of the Harnesses it ran
    /// on before (ADR 0078, decision 5): Claude Code's are files here.
    pub(crate) sessions: Vec<String>,
    /// The folders of the files kept for its Person's messages, by their
    /// names ([`ThreadRows::kept_in`]).
    pub(crate) kept: Vec<String>,
}

/// `thread` whole, if it may move.
pub(crate) fn leaving(sql: &Connection, thread: ThreadId) -> Result<Leaving, Error> {
    let rows = ThreadRows::read(sql, thread)?
        .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
    may_move(stands(sql, thread)?)?;
    let images = store::thread_images(sql, thread)?;
    let now = store::evidence::<Evidence>(sql, thread)?;
    let mut before = store::sessions::<Evidence>(sql, thread)?;
    // A session of a Harness it ran on before that forks, as a fork's
    // that went to another Harness before its own opened, is its
    // source's, which says what came after the fork too: it stays here,
    // and there the Thread has none on that Harness, so going back to it
    // hands it its history, as to a Harness it never ran on.
    let all = before.len();
    before.retain(|_, earlier| !earlier.forks());
    let earlier = (before.len() < all)
        .then(|| serde_json::to_string(&before))
        .transpose()?;
    let sessions = now.into_iter().chain(before.into_values());
    let files = Files {
        images: images.iter().map(|named| named.image.id).collect(),
        visuals: store::thread_visuals(sql, thread)?,
        sessions: sessions.map(|e| e.session().to_owned()).collect(),
        // As the rows name them in the Project's data, which the caller has.
        kept: Vec::new(),
    };
    Ok(Leaving {
        rows,
        images,
        files,
        earlier,
    })
}

/// Where `thread`'s work stands, as the store has it now.
pub(crate) fn stands(sql: &Connection, thread: ThreadId) -> Result<Stands, Error> {
    let forks = store::evidence::<Evidence>(sql, thread)?.is_some_and(|now| now.forks());
    Ok(Stands {
        works: store::running(sql, thread)?.is_some(),
        lanes: store::lanes_unended(sql, thread)?,
        asks: store::asks(sql, thread)?,
        waits: !store::turns_in(sql, thread, TurnState::Queued)?.is_empty(),
        awaited: store::awaited(sql, thread)?,
        forks,
    })
}

/// Copies the files of `files` from one Project's data, `from`, into
/// another's, `to`, each whole: an image, a Visual's page, a kept file's
/// folder, and of a Claude Code session its transcript, its sub-agents'
/// and the project key it was written under, as the adapter Banda carries
/// keeps them (`sessions.ts`). One that is not there is passed over, and
/// one a session ID names that is no plain file name too.
pub(crate) fn copy_files(from: &Path, to: &Path, files: &Files) -> io::Result<()> {
    // Each as it is named beneath a Project's data.
    let data = Path::new("");
    let (images, visuals) = (Images::of(data), Visuals::of(data));
    let mut paths: Vec<PathBuf> = (files.images.iter())
        .map(|&image| images.path(image))
        .collect();
    paths.extend((files.visuals.iter()).map(|&page| visuals.path(page)));
    paths.extend((files.kept.iter()).map(|name| kept::folder(data).join(name)));
    let sessions = claude_sessions(data);
    // Listed through no link; each is copied through none either.
    let kept = from.join(sessions.join("keys"));
    let keys = match std::fs::symlink_metadata(&kept) {
        Ok(found) if found.is_dir() => std::fs::read_dir(&kept)?
            .map(|key| key.map(|k| k.file_name()))
            .collect::<io::Result<_>>()?,
        _ => Vec::new(),
    };
    let plain = |session: &&String| banda_kernel::plain_name(session) == Some(session.as_str());
    for session in files.sessions.iter().filter(plain) {
        paths.push(sessions.join(format!("{session}.jsonl")));
        paths.push(sessions.join(session));
        for key in &keys {
            paths.push(sessions.join("keys").join(key).join(session));
        }
    }
    banda_kernel::host::copy_beneath(from, to, &paths)
}

/// The refusal of a copy that found a file of the Thread's gone another
/// way in the other Project, as a session two copies of the Thread went
/// on with; any other failure as it is.
pub(crate) fn apart(error: io::Error) -> Error {
    if error.kind() != io::ErrorKind::AlreadyExists {
        return Error::from(error);
    }
    let apart = "This Thread's session went on another way in that Project, so it stays here.";
    Refusal::conflict(apart).into()
}

/// `thread` as the Project it moves to has it already: none, as it should
/// be; or its rows, when a move cut short left it there as it came with
/// `rows`, and the move goes on. One that went on there is refused.
pub(crate) fn already(
    sql: &Connection,
    thread: ThreadId,
    rows: &ThreadRows,
) -> Result<Option<ThreadRows>, Error> {
    match ThreadRows::read(sql, thread)? {
        Some(there) if !there.came_with(rows) => {
            Err(Refusal::conflict("This Thread is in that Project already.").into())
        }
        there => Ok(there),
    }
}

/// Writes `rows` and `images`, `thread` whole, into this Project, from
/// `from`, with the line that says so, and answers its rows as they are
/// now. One here already, as it came before, is not written again.
pub(crate) fn arrive(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    rows: &ThreadRows,
    images: &[ImageRow],
    (from, machine): (ProjectId, Option<String>),
    said: &str,
) -> Result<ThreadRows, Error> {
    if let Some(came) = already(tx.sql(), thread, rows)? {
        return Ok(came);
    }
    rows.insert(tx.sql())?;
    // Its messages are found here now, and no more there (ADR 0098,
    // decision 17).
    search::index_thread(tx.sql(), thread)?;
    store::keep_images(tx.sql(), images)?;
    let arrived = Fact::ThreadArrived {
        thread,
        from,
        machine,
    };
    emit(tx, author, thread, &arrived)?;
    notices::post(tx, author, thread, said)?;
    ThreadRows::read(tx.sql(), thread)?.ok_or_else(|| Refusal::internal().into())
}

/// Takes `thread` out of this Project for `to`, if it is still as `rows`,
/// what was copied there, has it, and still at rest: what other Threads
/// do for it is no row of its own.
pub(crate) fn leave(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    rows: &ThreadRows,
    (to, machine): (ProjectId, Option<String>),
) -> Result<(), Error> {
    if ThreadRows::read(tx.sql(), thread)?.as_ref() != Some(rows) {
        let changed = "The Thread changed as it moved, and stays here: move it again.";
        return Err(Refusal::conflict(changed).into());
    }
    may_move(stands(tx.sql(), thread)?)?;
    store::forget_thread(tx.sql(), thread, tx.now())?;
    let left = Fact::ThreadLeft {
        thread,
        to,
        machine,
    };
    emit(tx, author, thread, &left)
}

/// Takes the copy of `thread` back out of `there`, as it stayed `here`:
/// only while it is still here, so the copy is never the one left, and
/// while the copy is as it `arrived`, so nothing done with it there since
/// is lost.
async fn take_back(
    here: &ModuleProject,
    there: &ModuleProject,
    author: Participant,
    thread: ThreadId,
    arrived: ThreadRows,
) {
    let home = here.id();
    let stayed = here.read(move |sql| Ok(ThreadRows::read(sql, thread)?.is_some()));
    if !matches!(stayed.await, Ok(true)) {
        tracing::warn!("a Thread whose move failed is not where it was, so its copy stays");
        return;
    }
    let taken = there
        .write(move |tx| leave(tx, author, thread, &arrived, (home, None)))
        .await;
    if let Err(error) = taken {
        tracing::warn!(%error, "a Thread that did not move is in both Projects");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_threads_files_go_whole_to_the_other_projects_data_and_what_is_gone_is_passed_over() {
        let (here, there) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let (image, page, gone) = (ImageId::new(), VisualId::new(), ImageId::new());
        let write = |path: PathBuf, text: &str| {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        };
        write(Images::of(here.path()).path(image), "png");
        write(Visuals::of(here.path()).path(page), "<p>Hi</p>");
        let sessions = claude_sessions(here.path());
        write(sessions.join("s1.jsonl"), "{}");
        write(sessions.join("s1/agent-1.jsonl"), "{}");
        write(sessions.join("keys/-code-work/s1"), "");
        write(sessions.join("other.jsonl"), "{}");
        let files = Files {
            images: vec![image, gone],
            visuals: vec![page],
            sessions: vec!["s1".to_owned(), "../other".to_owned()],
            kept: Vec::new(),
        };
        copy_files(here.path(), there.path(), &files).unwrap();

        let read = |path: PathBuf| std::fs::read_to_string(path).unwrap();
        assert_eq!(read(Images::of(there.path()).path(image)), "png");
        assert_eq!(read(Visuals::of(there.path()).path(page)), "<p>Hi</p>");
        let moved = claude_sessions(there.path());
        assert_eq!(read(moved.join("s1.jsonl")), "{}");
        assert_eq!(read(moved.join("s1/agent-1.jsonl")), "{}");
        assert!(moved.join("keys/-code-work/s1").is_file());
        assert!(
            !moved.join("other.jsonl").exists(),
            "no path out of its folder"
        );
        assert!(!Images::of(there.path()).path(gone).exists());
        assert!(
            Images::of(here.path()).path(image).is_file(),
            "the old Project's sweep lets go of its own"
        );
        // Copied again, as a move tried again copies, it is the same.
        copy_files(here.path(), there.path(), &files).unwrap();
        assert_eq!(read(moved.join("s1.jsonl")), "{}");
        // A session that went on there, as its source's that a fork names,
        // keeps what it said since; one that went another way refuses.
        write(moved.join("s1.jsonl"), "{}\n{\"more\":1}");
        copy_files(here.path(), there.path(), &files).unwrap();
        assert_eq!(read(moved.join("s1.jsonl")), "{}\n{\"more\":1}");
        write(moved.join("s1.jsonl"), "[]");
        let refused = copy_files(here.path(), there.path(), &files).unwrap_err();
        let refused = Refusal::from(apart(refused));
        assert_eq!(refused.code, banda_kernel::Code::Conflict, "{refused:?}");
    }
}
