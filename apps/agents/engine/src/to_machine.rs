//! A Thread moves to a Project on another machine (ADR 0116). No engine
//! talks to another, so the Person's window carries it: this machine
//! packs the Thread into one artefact ([`pack`]), the window reads it in
//! pieces ([`packed`]) and writes each to the other machine's engine
//! ([`take_piece`]), which unpacks it into its Project ([`unpack`]); then
//! the Thread leaves here ([`leave`]). If it does not, the other machine
//! gives its copy back ([`give_back`]).
//!
//! It goes as it does to another Project of this machine
//! ([`crate::to_project`]), whose rules and writes these are: only a
//! Thread at rest, its rows and the files they name, the copy first and
//! the leave second, which writes nothing if the Thread changed since it
//! was packed. Cut short between the two, the Thread is in both Projects
//! and nothing of it is lost.
//!
//! An artefact is a tar in the Project's data, `moves/<move>.tar`:
//! `thread.json`, what [`Carried`] says, and each file beneath `data/` as
//! it is named beneath a Project's data. Beside it, `moves/<move>/` keeps
//! what the next step reads: here the rows as they were packed, there the
//! rows as they came. Both go as the move ends, and what a move left
//! behind goes after a day ([`sweep`]).
//!
//! Only a Person packs, carries, unpacks, leaves and gives back: the
//! artefact holds the whole conversation, and takes it across the wall
//! between Projects and machines.

use crate::effects::Arrived;
use crate::handoff;
use crate::images::blocking;
use crate::kept;
use crate::live::{Hold, Live};
use crate::model::Moved;
use crate::model::{Fact, ThreadId, VERSION};
use crate::notices::NOTICE;
use crate::rules::to_project::{may_go_to, notice, notice_across};
use crate::store::{self, ImageRow, ThreadRows};
use crate::to_project::{self, Files, Leaving};
use crate::{BASE64, emit};
use banda_harnesses::{Harnesses, claude_sessions};
use banda_kernel::{Call, Error, ProjectId, Refusal};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use ts_rs::TS;
use uuid::Uuid;

/// The most bytes of an artefact one piece carries.
pub const PIECE: usize = 512 * 1024;
/// The largest artefact an engine takes.
const MOST: u64 = 8 * 1024 * 1024 * 1024;
/// How long a move that never ended keeps its files.
const DAY: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// What `agents.pack_thread` answers: the move, and its artefact's size
/// and SHA-256, in hex, which `unpack_thread` is given.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Packed {
    #[serde(rename = "move")]
    pub id: String,
    pub thread: ThreadId,
    #[ts(type = "number")]
    pub size: u64,
    pub sha256: String,
    /// The account it runs on here, for the window to ask the other
    /// machine for one of the same Harness before it carries anything.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness: Option<Ran>,
}

/// The account a Thread runs on, as its machine has it: the entry's ID,
/// where its sessions live, which another machine's account of the same
/// Harness shares (`claude`, or a Codex Harness's ID), and the Harness's
/// name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Ran {
    pub entry: String,
    pub sessions: String,
    pub name: String,
}

/// Which of a move's files a piece is of: the Thread's artefact, or the
/// bundle of its folder's work, which the Git App writes beside it and
/// reads there (ADR 0116, decision 8).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum Part {
    #[default]
    Thread,
    Folder,
}

impl Part {
    fn extension(self) -> &'static str {
        match self {
            Part::Thread => "tar",
            Part::Folder => "bundle",
        }
    }
}

/// What `agents.packed` and `agents.take_piece` name: one of a move's
/// files from byte `at`.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
pub struct PieceAsk {
    #[serde(rename = "move")]
    pub id: String,
    #[serde(default)]
    #[ts(optional)]
    pub part: Option<Part>,
    #[ts(type = "number")]
    pub at: u64,
}

/// A piece of an artefact, in base64, and whether more comes after it.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Piece {
    pub data: String,
    pub more: bool,
}

/// What `agents.take_piece` is given: a piece for byte `at`.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
pub struct TakePiece {
    #[serde(rename = "move")]
    pub id: String,
    #[serde(default)]
    #[ts(optional)]
    pub part: Option<Part>,
    #[ts(type = "number")]
    pub at: u64,
    pub data: String,
}

/// What `agents.unpack_thread` is asked: the move, and the SHA-256 its
/// artefact was packed with.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
pub struct Unpack {
    #[serde(rename = "move")]
    pub id: String,
    pub sha256: String,
    /// The name of the machine it comes from, and of this one, as the
    /// window shows them: what the Thread's line says of its move.
    #[serde(default)]
    #[ts(optional)]
    pub from: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub on: Option<String>,
    /// Whether the folder's work that was not committed was unpacked
    /// here before it (`git.unpack_folder`), which the line says too.
    #[serde(default)]
    pub folder: bool,
}

/// What `agents.unpack_thread` answers: the Thread that came.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Unpacked {
    pub thread: ThreadId,
}

/// What `agents.leave_thread` is asked: the move, and the Project the
/// Thread went to, as its machine names it.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
pub struct Leave {
    #[serde(rename = "move")]
    pub id: String,
    pub project: ProjectId,
    /// The name of the machine that Project is on, as the window shows
    /// it.
    #[serde(default)]
    #[ts(optional)]
    pub machine: Option<String>,
}

/// What `agents.give_back` is asked: the move whose copy goes.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
pub struct OneMove {
    #[serde(rename = "move")]
    pub id: String,
}

/// A Thread as its artefact carries it.
#[derive(Serialize, Deserialize)]
struct Carried {
    /// The version of the facts' payloads there, and the tables and
    /// columns a Thread's rows are in: only an engine that keeps a Thread
    /// the same way takes it.
    version: u32,
    shape: Vec<(String, Vec<String>)>,
    thread: ThreadId,
    from: From,
    rows: ThreadRows,
    images: Vec<ImageRow>,
    files: Files,
    earlier: Option<String>,
    /// The account it ran on there.
    #[serde(default)]
    ran: Option<Ran>,
}

/// The Project a Thread comes from, as its machine has it.
#[derive(Clone, Serialize, Deserialize)]
struct From {
    project: ProjectId,
    name: String,
    folder: String,
    data: String,
}

/// A Thread as it came here, kept until the move ends: its rows as they
/// were written, to give the copy back while nothing went on with it.
#[derive(Serialize, Deserialize)]
struct Came {
    thread: ThreadId,
    from: ProjectId,
    rows: ThreadRows,
}

fn person_only(call: &Call) -> Result<(), Refusal> {
    if call.participant().agent().is_some() {
        return Err(Refusal::forbidden(
            "Only a Person moves a Thread to another machine.",
        ));
    }
    Ok(())
}

/// A move's ID as its files are named: a UUID as it is written, so never
/// a path.
fn named(id: &str) -> Result<Uuid, Refusal> {
    Uuid::try_parse(id)
        .ok()
        .filter(|named| named.to_string() == id)
        .ok_or_else(|| Refusal::invalid("That is no move's ID."))
}

fn moves(data: &Path) -> PathBuf {
    data.join("moves")
}

fn artefact(data: &Path, id: Uuid) -> PathBuf {
    packed_file(data, id, Part::Thread)
}

fn part(data: &Path, id: Uuid) -> PathBuf {
    carried_file(data, id, Part::Thread)
}

/// One of a move's files as it was packed here.
fn packed_file(data: &Path, id: Uuid, part: Part) -> PathBuf {
    moves(data).join(format!("{id}.{}", part.extension()))
}

/// One of a move's files as it is carried here, piece by piece.
fn carried_file(data: &Path, id: Uuid, part: Part) -> PathBuf {
    moves(data).join(format!("{id}.{}.part", part.extension()))
}

fn staging(data: &Path, id: Uuid) -> PathBuf {
    moves(data).join(id.to_string())
}

fn no_move() -> Refusal {
    Refusal::not_found("There is no such move: pack the Thread again.")
}

/// A machine's name as a window gave it: one short line, or none.
fn machine(name: Option<String>) -> Option<String> {
    let name = name?.trim().to_owned();
    let short = !name.is_empty() && name.chars().count() <= 32;
    (short && !name.chars().any(char::is_control)).then_some(name)
}

/// The account entry `id` is, as another machine reads it.
fn ran(harnesses: &Harnesses, id: &str) -> Ran {
    let Some(entry) = harnesses.find(id) else {
        return Ran {
            entry: id.to_owned(),
            sessions: id.to_owned(),
            name: id.to_owned(),
        };
    };
    let of = (entry.of.as_deref()).and_then(|of| harnesses.find(of));
    Ran {
        entry: entry.id.clone(),
        sessions: entry.sessions().to_owned(),
        name: of.map_or_else(|| entry.name.clone(), |of| of.name),
    }
}

/// Packs `thread`, at rest, into an artefact in this Project's data.
pub async fn pack(
    live: &Live,
    harnesses: &Harnesses,
    call: &Call,
    thread: ThreadId,
) -> Result<Packed, Refusal> {
    person_only(call)?;
    let here = call.project();
    let _held = live.hold(thread, Hold::Moving).map_err(Hold::refused)?;
    let (leaving, shape, on) = here
        .read(move |sql| {
            let leaving = to_project::leaving(sql, thread)?;
            let on = store::thread(sql, thread)?.map(|found| found.harness);
            Ok((leaving, ThreadRows::shape(sql)?, on))
        })
        .await?;
    let ran = on.filter(|id| !id.is_empty()).map(|id| ran(harnesses, &id));
    let Leaving {
        rows,
        images,
        mut files,
        earlier,
    } = leaving;
    files.kept = rows.kept_in(&kept::folder(here.data()));
    let carried = Carried {
        version: VERSION,
        shape,
        thread,
        from: From {
            project: here.id(),
            name: here.name(),
            folder: here.folder().display().to_string(),
            data: here.data().display().to_string(),
        },
        rows,
        images,
        files,
        earlier,
        ran: ran.clone(),
    };
    let (data, id) = (here.data().to_owned(), Uuid::new_v4());
    let (size, sha256) = blocking(move || write_artefact(&data, id, &carried))
        .await
        .map_err(Error::from)?;
    Ok(Packed {
        id: id.to_string(),
        thread,
        size,
        sha256,
        harness: ran,
    })
}

/// What a Thread from another machine goes on with here, written with
/// its rows: the account it came from and the one it runs on now, and the
/// Harness whose history it is handed, when its session stayed there.
struct Pending {
    from: String,
    to: String,
    hand: Option<String>,
}

/// `rows`, a Thread's that ran on `ran` on another machine, as it goes on
/// here (ADR 0116, decision 5), on `here`'s name for a refusal: on the
/// account of the same ID and Harness, else on one of that Harness that
/// is on; its session the same where `carried` says it came along, as
/// Claude Code's, and none where it stayed there, as Codex's, whose
/// history its next turn is handed.
fn settled(
    harnesses: &Harnesses,
    mut rows: ThreadRows,
    ran: &Ran,
    carried: &dyn Fn(&str) -> bool,
    here: &str,
) -> Result<(ThreadRows, Option<Pending>), Refusal> {
    let entry = match harnesses.get(&ran.entry) {
        Ok(same) if same.sessions() == ran.sessions => same,
        _ => harnesses.keeping(&ran.sessions).ok_or_else(|| {
            Refusal::conflict(format!(
                "{here} has no {}: add it there, or move the Thread to another Harness first.",
                ran.name
            ))
        })?,
    };
    if entry.id != ran.entry {
        rows = rows.with_own("harness", entry.id.clone());
    }
    let session = |evidence: &Value| {
        evidence
            .get("session")
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    let mut hand = false;
    let evidence = rows.own("evidence").map(serde_json::from_str::<Value>);
    if let Some(Ok(mut evidence)) = evidence {
        if session(&evidence).is_some_and(|id| carried(&id)) {
            // An account of another ID here goes on with it as its own.
            if evidence.get("harness").and_then(Value::as_str) == Some(&ran.entry) {
                evidence["harness"] = entry.id.clone().into();
            }
            rows = rows.with_own("evidence", evidence.to_string());
        } else {
            rows = rows.with_own_or_none("evidence", None);
            hand = true;
        }
    }
    // The sessions of the Harnesses it ran on before: only those that
    // came, each the account's here that keeps its Harness's sessions.
    let earlier = rows.own("sessions").map(serde_json::from_str::<Value>);
    if let Some(Ok(Value::Object(earlier))) = earlier {
        let came = earlier.into_iter().filter_map(|(sessions, mut evidence)| {
            session(&evidence).filter(|id| carried(id))?;
            if let Some(keeps) = harnesses.keeping(&sessions) {
                evidence["harness"] = keeps.id.into();
            }
            Some((sessions, evidence))
        });
        rows = rows.with_own("sessions", Value::Object(came.collect()).to_string());
    }
    let pending = (hand || entry.id != ran.entry).then(|| Pending {
        from: ran.entry.clone(),
        to: entry.id,
        hand: hand.then(|| ran.name.clone()),
    });
    Ok((rows, pending))
}

/// Writes what `pending` says a Thread's next turn starts with: its
/// history, when it is handed any, and its divider.
fn arrive_there(
    tx: &mut banda_kernel::Tx<'_>,
    thread: ThreadId,
    pending: Pending,
) -> Result<String, Error> {
    let history = match &pending.hand {
        Some(name) => handoff::handoff(thread, name, &store::items(tx.sql(), thread)?),
        None => None,
    };
    let how = match (&pending.hand, &history) {
        (None, _) => Moved::Same,
        (Some(_), history) => Moved::Handoff {
            handed: history
                .as_ref()
                .map(|h| h.handed.clone())
                .unwrap_or_default(),
        },
    };
    let arrived = Arrived {
        shown: false,
        history: history.map(|h| h.text),
        divider: (pending.from, pending.to, how),
    };
    store::set_arrival(tx.sql(), thread, Some(&arrived))?;
    Ok(serde_json::to_string(&arrived)?)
}

/// Writes `carried` and its files as move `id`'s artefact beneath `data`,
/// and answers its size and SHA-256. Its files are copied through no link
/// into a folder of the move's own first, so the tar holds plain files
/// only.
fn write_artefact(data: &Path, id: Uuid, carried: &Carried) -> io::Result<(u64, String)> {
    sweep(data);
    let staged = staging(data, id);
    fs::create_dir_all(staged.join("data"))?;
    to_project::copy_files(data, &staged.join("data"), &carried.files)?;
    let said = serde_json::to_vec(carried).map_err(io::Error::other)?;
    fs::write(staged.join("thread.json"), &said)?;
    let path = artefact(data, id);
    let mut tar = tar::Builder::new(File::create(&path)?);
    tar.mode(tar::HeaderMode::Deterministic);
    let mut header = tar::Header::new_gnu();
    header.set_size(said.len() as u64);
    header.set_mode(0o600);
    header.set_cksum();
    tar.append_data(&mut header, "thread.json", said.as_slice())?;
    append_files(&mut tar, &staged.join("data"), Path::new("data"))?;
    tar.into_inner()?.sync_all()?;
    fs::remove_dir_all(staged.join("data"))?;
    let size = fs::metadata(&path)?.len();
    Ok((size, sha256(&path)?))
}

/// Appends each plain file beneath `folder` to `tar`, named beneath
/// `name`, in the order of their names.
fn append_files(tar: &mut tar::Builder<File>, folder: &Path, name: &Path) -> io::Result<()> {
    let mut entries = fs::read_dir(folder)?.collect::<io::Result<Vec<_>>>()?;
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        let (path, name) = (entry.path(), name.join(entry.file_name()));
        let found = fs::symlink_metadata(&path)?;
        if found.is_dir() {
            append_files(tar, &path, &name)?;
        } else if found.is_file() {
            let mut header = tar::Header::new_gnu();
            header.set_size(found.len());
            header.set_mode(0o600);
            header.set_cksum();
            tar.append_data(&mut header, &name, File::open(&path)?)?;
        }
    }
    Ok(())
}

fn sha256(path: &Path) -> io::Result<String> {
    let (mut file, mut hash) = (File::open(path)?, Sha256::new());
    io::copy(&mut file, &mut hash)?;
    Ok(hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Takes what moves that never ended left beneath `data`, a day after
/// each was last written.
fn sweep(data: &Path) {
    let Ok(entries) = fs::read_dir(moves(data)) else {
        return;
    };
    for entry in entries.flatten() {
        let old = (fs::symlink_metadata(entry.path()).and_then(|found| found.modified()))
            .is_ok_and(|at| at.elapsed().is_ok_and(|since| since > DAY));
        if old {
            let path = entry.path();
            let gone = fs::remove_dir_all(&path).or_else(|_| fs::remove_file(&path));
            if let Err(error) = gone {
                tracing::warn!(%error, "what a move left behind could not be taken away");
            }
        }
    }
}

/// A plain file at `path` that no link leads to, or the refusal that
/// there is no such move.
fn plain(path: &Path) -> io::Result<()> {
    for path in [path.parent(), Some(path)].into_iter().flatten() {
        match fs::symlink_metadata(path) {
            Ok(found) if found.file_type().is_symlink() => {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "a link"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

/// The piece of a packed move's artefact from byte `at`.
pub async fn packed(call: &Call, PieceAsk { id, part, at }: PieceAsk) -> Result<Piece, Refusal> {
    person_only(call)?;
    let of = part.unwrap_or_default();
    let path = packed_file(call.project().data(), named(&id)?, of);
    let read = blocking(move || {
        plain(&path)?;
        let mut file = File::open(&path)?;
        let size = file.metadata()?.len();
        file.seek(SeekFrom::Start(at.min(size)))?;
        let mut piece = Vec::with_capacity(PIECE);
        file.take(PIECE as u64).read_to_end(&mut piece)?;
        let more = at.saturating_add(piece.len() as u64) < size;
        Ok((piece, more))
    });
    let (piece, more) = read.await.map_err(|_| no_move())?;
    Ok(Piece {
        data: BASE64.encode(piece),
        more,
    })
}

/// Keeps a piece of a move's artefact in this Project's data, at byte
/// `at`: the next one, or one kept already, as a piece sent again.
pub async fn take_piece(
    call: &Call,
    TakePiece { id, part, at, data }: TakePiece,
) -> Result<(), Refusal> {
    let of = part.unwrap_or_default();
    person_only(call)?;
    let here = call.project();
    may_go_to(here.scratch())?;
    let piece = (BASE64.decode(data)).map_err(|_| Refusal::invalid("A piece is base64."))?;
    if piece.len() > PIECE {
        return Err(Refusal::invalid("A piece is 512 KiB at most."));
    }
    let (data, id) = (here.data().to_owned(), named(&id)?);
    let kept = blocking(move || {
        sweep(&data);
        fs::create_dir_all(moves(&data))?;
        let path = carried_file(&data, id, of);
        plain(&path)?;
        let mut file = File::options().create(true).append(true).open(&path)?;
        let size = file.metadata()?.len();
        let end = at.saturating_add(piece.len() as u64);
        if at == size && end <= MOST {
            file.write_all(&piece)?;
            return Ok(true);
        }
        Ok(end <= size)
    });
    match kept.await.map_err(Error::from)? {
        true => Ok(()),
        false => Err(Refusal::conflict(
            "That piece is not the next one: carry the Thread again.",
        )),
    }
}

/// Unpacks the artefact carried here as move `id` into this Project: the
/// Thread whole, as it comes from another Project.
pub async fn unpack(
    live: &Live,
    harnesses: &Harnesses,
    call: &Call,
    ask: Unpack,
) -> Result<Unpacked, Refusal> {
    let Unpack {
        id,
        sha256,
        from: from_machine,
        on,
        folder,
    } = ask;
    person_only(call)?;
    let here = call.project();
    may_go_to(here.scratch())?;
    let (author, id) = (call.participant(), named(&id)?);
    let data = here.data().to_owned();
    let opened = blocking(move || open_artefact(&data, id, &sha256)).await;
    let carried = opened.map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => no_move(),
        io::ErrorKind::InvalidData => {
            Refusal::conflict("The Thread did not come whole: carry it again.")
        }
        _ => Error::from(error).into(),
    })?;
    let Carried {
        version,
        shape,
        thread,
        from,
        rows,
        images,
        files,
        earlier,
        ran,
    } = carried;
    let ours = here.read(ThreadRows::shape).await?;
    if version != VERSION || shape != ours {
        return Err(Refusal::conflict(
            "This machine keeps a Thread another way than the one it comes from: update Banda \
             on both, then move the Thread.",
        ));
    }
    let _held = live.hold(thread, Hold::Moving).map_err(Hold::refused)?;
    let theirs = kept::folder(Path::new(&from.data));
    let mut came = rows.kept_moved(&theirs, &kept::folder(here.data()), &files.kept);
    if let Some(earlier) = earlier {
        came = came.with_own("sessions", earlier);
    }
    let (staged, data) = (staging(here.data(), id), here.data().to_owned());
    let copied = staged.join("data");
    // From a Project that is none of this machine's, it comes from
    // another machine: its Person is this one's here, and its account and
    // session are this machine's to say.
    let elsewhere = from.project != here.id() && call.other(from.project).await.is_err();
    let (from_machine, on) = (machine(from_machine), machine(on));
    let mut images = images;
    let mut pending = None;
    if elsewhere {
        came = came.persons_as(author)?;
        images = (images.into_iter())
            .map(|image| image.persons_as(author))
            .collect::<Result<_, _>>()?;
        if let Some(ran) = &ran {
            let sessions = claude_sessions(&copied);
            let carried = |session: &str| {
                banda_kernel::plain_name(session) == Some(session)
                    && sessions.join(format!("{session}.jsonl")).is_file()
            };
            let here = on.as_deref().unwrap_or("This machine");
            (came, pending) = settled(harnesses, came, ran, &carried, here)?;
        }
    }
    let found = came.clone();
    here.read(move |sql| to_project::already(sql, thread, &found))
        .await?;
    blocking(move || {
        if copied.is_dir() {
            to_project::copy_files(&copied, &data, &files)?;
        }
        Ok(())
    })
    .await
    .map_err(to_project::apart)?;
    let said = match elsewhere {
        true => notice_across(
            (
                &from.name,
                from_machine.as_deref().unwrap_or("another machine"),
                Path::new(&from.folder),
            ),
            (on.as_deref().unwrap_or("this machine"), &here.folder()),
            folder,
            NOTICE,
        ),
        false => notice(&from.name, Path::new(&from.folder), &here.folder(), NOTICE),
    };
    let home = (from.project, from_machine.filter(|_| elsewhere));
    let written = came.clone();
    let arrival = call
        .command(move |tx| {
            to_project::arrive(tx, author, thread, &written, &images, home, &said)?;
            pending
                .map(|pending| arrive_there(tx, thread, pending))
                .transpose()
        })
        .await?;
    // As it came, with what its next turn starts with: its copy is given
    // back only while it is still so.
    if let Some(arrival) = arrival {
        came = came.with_own("arrival", arrival);
    }
    let kept = Came {
        thread,
        from: from.project,
        rows: came,
    };
    let data = here.data().to_owned();
    let tidied = blocking(move || {
        fs::write(
            staged.join("came.json"),
            serde_json::to_vec(&kept).map_err(io::Error::other)?,
        )?;
        let _ = fs::remove_dir_all(staged.join("data"));
        let _ = fs::remove_file(staged.join("thread.json"));
        fs::remove_file(part(&data, id))
    });
    if let Err(error) = tidied.await {
        tracing::warn!(%error, "what a move carried here could not be tidied");
    }
    Ok(Unpacked { thread })
}

/// Opens the artefact carried here as move `id`, if it is `sha256`'s,
/// into the move's own folder, and answers what it carries. Only plain
/// files beneath `data/` and `thread.json` come out of it.
fn open_artefact(data: &Path, id: Uuid, sha: &str) -> io::Result<Carried> {
    let path = part(data, id);
    plain(&path)?;
    let bad = |why: &str| io::Error::new(io::ErrorKind::InvalidData, why.to_owned());
    if !sha256(&path)?.eq_ignore_ascii_case(sha) {
        return Err(bad("another hash"));
    }
    let staged = staging(data, id);
    if fs::symlink_metadata(&staged).is_ok() {
        fs::remove_dir_all(&staged)?;
    }
    fs::create_dir_all(&staged)?;
    let mut tar = tar::Archive::new(File::open(&path)?);
    for entry in tar.entries()? {
        let mut entry = entry?;
        let name = entry.path()?.into_owned();
        let within = name
            .components()
            .all(|part| matches!(part, Component::Normal(_)));
        let ours = name == Path::new("thread.json") || name.starts_with("data");
        if !within || !ours || entry.header().entry_type() != tar::EntryType::Regular {
            return Err(bad("an entry no artefact has"));
        }
        let to = staged.join(&name);
        if let Some(folder) = to.parent() {
            fs::create_dir_all(folder)?;
        }
        io::copy(&mut entry, &mut File::create_new(&to)?)?;
    }
    let said = fs::read(staged.join("thread.json")).map_err(|_| bad("no thread.json"))?;
    serde_json::from_slice(&said).map_err(|_| bad("thread.json of another shape"))
}

/// Takes the Thread packed as move `id` out of this Project, for the
/// `project` it went to, if it is still as it was packed and at rest.
pub async fn leave(live: &Live, call: &Call, ask: Leave) -> Result<(), Refusal> {
    let Leave {
        id,
        project,
        machine: to,
    } = ask;
    let to = (project, machine(to));
    person_only(call)?;
    let here = call.project();
    let (author, id) = (call.participant(), named(&id)?);
    let staged = staging(here.data(), id);
    let said = staged.join("thread.json");
    let carried: Carried = blocking(move || {
        plain(&said)?;
        serde_json::from_slice(&fs::read(&said)?).map_err(io::Error::other)
    })
    .await
    .map_err(|_| no_move())?;
    let (thread, rows) = (carried.thread, carried.rows);
    let _held = live.hold(thread, Hold::Moving).map_err(Hold::refused)?;
    call.command(move |tx| to_project::leave(tx, author, thread, &rows, to))
        .await?;
    live.forget_thread(here.id(), thread).await;
    let path = artefact(here.data(), id);
    let folder = packed_file(here.data(), id, Part::Folder);
    let tidied = blocking(move || {
        // Its folder's work, where the Git App packed any.
        let _ = fs::remove_file(&folder);
        fs::remove_dir_all(&staged)?;
        fs::remove_file(&path)
    });
    if let Err(error) = tidied.await {
        tracing::warn!(%error, "a move's artefact could not be taken away");
    }
    Ok(())
}

/// Takes the copy move `id` wrote here back out, as the Thread stayed
/// where it was: only while the copy is as it came, so nothing done with
/// it here since is lost. A copy that is gone leaves nothing to do.
pub async fn give_back(live: &Live, call: &Call, OneMove { id }: OneMove) -> Result<(), Refusal> {
    person_only(call)?;
    let here = call.project();
    let (author, id) = (call.participant(), named(&id)?);
    let staged = staging(here.data(), id);
    let said = staged.join("came.json");
    let came = blocking(move || {
        plain(&said)?;
        serde_json::from_slice::<Came>(&fs::read(&said)?).map_err(io::Error::other)
    });
    let Ok(Came { thread, from, rows }) = came.await else {
        return Ok(());
    };
    let _held = live.hold(thread, Hold::Moving).map_err(Hold::refused)?;
    call.command(move |tx| {
        match ThreadRows::read(tx.sql(), thread)? {
            None => return Ok(()),
            Some(there) if !there.came_with(&rows) => {
                let went_on = "The Thread went on here since it came, so its copy stays.";
                return Err(Refusal::conflict(went_on).into());
            }
            Some(_) => {}
        }
        store::forget_thread(tx.sql(), thread, tx.now())?;
        let left = Fact::ThreadLeft {
            thread,
            to: from,
            machine: None,
        };
        emit(tx, author, thread, &left)
    })
    .await?;
    live.forget_thread(here.id(), thread).await;
    if let Err(error) = blocking(move || fs::remove_dir_all(&staged)).await {
        tracing::warn!(%error, "a move's copy could not be tidied");
    }
    Ok(())
}
