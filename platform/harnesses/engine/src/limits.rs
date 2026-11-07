//! How much of each Harness account's usage limits is spent (ADR 0043,
//! decisions 1 to 4). Claude Code's come from Anthropic with its own
//! sign-in, which the engine reads on its host for that one request
//! ([`claude`]); Codex's from its app-server, which reads its own
//! ([`codex`]). Neither needs a window.
//!
//! The engine reads them every `[limits] every` while a window is open,
//! and, window or not, after an account changed and when a client or an
//! Agent asks, at most once a minute for each Harness. The last read is
//! kept in the machine's store, with when; one that failed keeps the read
//! before it, and says why. Each kept read says `limits_changed`, whose
//! subject is the Harness's ID.

mod claude;
mod codex;

use crate::model::{LimitWindow, Limits, LimitsFailed, WindowKind};
use crate::{Harness, Harnesses, LimitsSettings, account_changed};
use banda_kernel::{Error, ModuleProject, Participant};
use rusqlite::{Connection, OptionalExtension};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// What a kept read says; its subject is the Harness's ID.
pub(crate) const LIMITS_CHANGED: &str = "limits_changed";

/// The version of `limits_changed`.
const VERSION: u32 = 1;

/// How often the engine looks whether a read is due.
const LOOK: Duration = Duration::from_secs(60);

/// How soon a window's asking reads a Harness again.
const ASKED: Duration = Duration::from_secs(60);

/// How long a Harness that asked Banda to wait is left alone.
const WAIT: Duration = Duration::from_secs(15 * 60);

/// The module's table: the last read of each Harness, as JSON.
pub(crate) const TABLE: &str = "CREATE TABLE harnesses_limits (
    harness TEXT PRIMARY KEY,
    kept TEXT NOT NULL
)";

/// Which Harness's limits Banda can read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Claude,
    Codex,
}

impl Kind {
    /// What `harness` runs: the Harness it is an account of (ADR 0078),
    /// else the CLI its adapter is told of, by the variable or the
    /// program's name, else its ID. So a second account, an entry of its
    /// own with Claude Code's adapter, is Claude Code's.
    pub(crate) fn of(harness: &Harness) -> Option<Kind> {
        let named = |name: &str| match name {
            "claude" | "CLAUDE_CODE_EXECUTABLE" => Some(Kind::Claude),
            "codex" | "CODEX_PATH" => Some(Kind::Codex),
            _ => None,
        };
        if let Some(kind) = harness.of.as_deref().and_then(named) {
            return Some(kind);
        }
        let Some(cli) = &harness.cli else {
            return named(&harness.id);
        };
        let program = std::path::Path::new(&cli.program).file_stem();
        named(&cli.variable).or_else(|| named(program?.to_str()?))
    }

    /// The ID Banda knows it by, as its built-in entry's.
    pub(crate) fn id(self) -> &'static str {
        match self {
            Kind::Claude => "claude",
            Kind::Codex => "codex",
        }
    }
}

/// What a read found.
#[derive(Debug, Default, PartialEq)]
struct Found {
    plan: Option<String>,
    /// The address the account is signed in with.
    email: Option<String>,
    windows: Vec<LimitWindow>,
    note: Option<String>,
}

impl Found {
    /// An account with no limits, and why.
    fn none(note: &str) -> Found {
        Found {
            note: Some(note.to_owned()),
            ..Found::default()
        }
    }
}

/// Why a read failed, and how long to leave the Harness alone after.
#[derive(Debug, PartialEq)]
struct Failure {
    why: String,
    wait: Option<Duration>,
    /// The address the account is signed in with, when the read still
    /// said it, as an expired sign-in does.
    email: Option<String>,
}

impl Failure {
    fn new(why: impl Into<String>) -> Failure {
        Failure {
            why: why.into(),
            wait: None,
            email: None,
        }
    }
}

/// When each Harness was last read in this run of the engine.
#[derive(Default)]
struct Tried {
    at: Option<Instant>,
    /// It asked Banda to wait till then.
    until: Option<Instant>,
    reading: bool,
}

/// Reads the limits and keeps them.
#[derive(Clone)]
pub(crate) struct Reader {
    harnesses: Harnesses,
    /// Where Claude Code's are asked for.
    anthropic: claude::Anthropic,
    tried: Arc<Mutex<HashMap<String, Tried>>>,
}

impl Reader {
    pub fn new(harnesses: Harnesses) -> Self {
        Self {
            harnesses,
            anthropic: claude::Anthropic::at(claude::USAGE),
            tried: Arc::default(),
        }
    }

    /// Asks for Claude Code's limits at `url`, a stand-in of Anthropic's:
    /// only a test does.
    pub fn anthropic_at(self, url: &str) -> Self {
        Self {
            anthropic: claude::Anthropic::at(url),
            ..self
        }
    }

    /// Reads each Harness as it is due, and again after its account
    /// changed, till the machine's Project closes.
    pub async fn start(&self, project: ModuleProject) -> Result<(), Error> {
        // It holds the Project only as it reads: the reaction lets it go.
        let mut changed = project.react(project.at().await?, account_changed());
        let reader = self.clone();
        tokio::spawn(async move {
            let mut look = tokio::time::interval(LOOK);
            loop {
                tokio::select! {
                    heard = changed.next() => {
                        let Ok(Some(event)) = heard else { break };
                        let found = event.subject.and_then(|id| reader.harnesses.find(&id));
                        if let (Some(harness), Some(project)) = (found, changed.project()) {
                            // A reaction answers at once: the read runs on its own.
                            reader.read(&project, harness, Duration::ZERO);
                        }
                    }
                    _ = look.tick() => {
                        let Some(project) = changed.project() else { break };
                        if project.window_open() {
                            let (harnesses, settings) = reader.limited();
                            for harness in harnesses {
                                reader.read(&project, harness, settings.every);
                            }
                        }
                    }
                }
            }
        });
        Ok(())
    }

    /// Every Harness on whose limits Banda reads, none while `[limits]
    /// read` is off, and `[limits]`: one read of the file.
    fn limited(&self) -> (Vec<Harness>, LimitsSettings) {
        let (harnesses, settings) = self.harnesses.followed();
        let limited = (harnesses.iter())
            .filter(|harness| settings.read && harness.enabled && Kind::of(harness).is_some())
            .cloned()
            .collect();
        (limited, settings)
    }

    /// The last read of every Harness Banda reads, as a window or an
    /// Agent sees it; with `again`, each not read within a minute is read
    /// anew, and says so once kept. With `[limits]` as it read them.
    pub async fn now(
        &self,
        project: &ModuleProject,
        again: bool,
    ) -> Result<(Vec<Limits>, LimitsSettings), Error> {
        let (harnesses, settings) = self.limited();
        if again {
            for harness in &harnesses {
                self.read(project, harness.clone(), ASKED);
            }
        }
        let ids: Vec<String> = harnesses.iter().map(|h| h.id.clone()).collect();
        let mut kept = project.read(move |tx| kept_all(tx, &ids)).await?;
        let now = banda_kernel::now_ms();
        for (limits, harness) in kept.iter_mut().zip(&harnesses) {
            limits.name.clone_from(&harness.name);
            limits.kind = Kind::of(harness).map(|kind| kind.id().to_owned());
            for window in &mut limits.windows {
                if window.resets_at.is_some_and(|at| at <= now) {
                    window.used = 0.0;
                }
            }
        }
        let kinds = harnesses.iter().map(Kind::of);
        Ok((shared(kept.into_iter().zip(kinds)), settings))
    }

    /// Reads `harness` on its own, unless it was within `since`, it is
    /// being read, or it asked Banda to wait.
    fn read(&self, project: &ModuleProject, harness: Harness, since: Duration) {
        let Some(kind) = Kind::of(&harness) else {
            return;
        };
        {
            let mut tried = self.tried.lock().unwrap();
            let tried = tried.entry(harness.id.clone()).or_default();
            let now = Instant::now();
            let recent = tried.at.is_some_and(|at| now - at < since);
            if tried.reading || recent || tried.until.is_some_and(|until| now < until) {
                return;
            }
            (tried.reading, tried.at) = (true, Some(now));
        }
        let (reader, project) = (self.clone(), project.clone());
        tokio::spawn(async move {
            let read = match kind {
                Kind::Claude => claude::read(&harness, &reader.anthropic).await,
                Kind::Codex => codex::read(&harness).await,
            };
            let wait = read.as_ref().err().and_then(|failure| failure.wait);
            if let Err(error) = keep(&project, &harness.id, read).await {
                tracing::warn!(%error, harness = harness.id, "the limits read were not kept");
            }
            let mut tried = reader.tried.lock().unwrap();
            let tried = tried.entry(harness.id).or_default();
            tried.reading = false;
            tried.until = wait.map(|wait| Instant::now() + wait);
        });
    }
}

/// Keeps a read of Harness `id`'s limits, over the one before when it
/// failed, and says so.
async fn keep(
    project: &ModuleProject,
    id: &str,
    read: Result<Found, Failure>,
) -> Result<(), Error> {
    let id = id.to_owned();
    let owner = Participant::Person(project.owner());
    project
        .write(move |tx| {
            let now = banda_kernel::now_ms();
            let before = kept(tx.sql(), &id)?.unwrap_or_else(|| unread(&id));
            let limits = match read {
                Ok(Found {
                    plan,
                    email,
                    windows,
                    note,
                }) => Limits {
                    plan,
                    email,
                    windows,
                    note,
                    read_at: Some(now),
                    failed: None,
                    ..before
                },
                Err(Failure { why, email, .. }) => Limits {
                    failed: Some(LimitsFailed { at: now, why }),
                    email: email.or(before.email),
                    ..before
                },
            };
            let text = serde_json::to_string(&limits)?;
            tx.sql().execute(
                "INSERT INTO harnesses_limits (harness, kept) VALUES (?1, ?2)
                 ON CONFLICT (harness) DO UPDATE SET kept = excluded.kept",
                (&id, &text),
            )?;
            tx.emit(
                LIMITS_CHANGED,
                VERSION,
                Some(&id),
                owner,
                &serde_json::Value::Null,
            )?;
            Ok(())
        })
        .await
}

/// The limits of `kept`, in their order, each with its entry's Kind: an
/// entry signed in to the same account as an earlier one of its Kind
/// shares its limits, so it is not listed, and its ID goes in the
/// earlier one's `also` (ADR 0055, decision 1). One with no email is
/// never merged.
fn shared(kept: impl IntoIterator<Item = (Limits, Option<Kind>)>) -> Vec<Limits> {
    let mut listed: Vec<(Limits, Option<Kind>)> = Vec::new();
    for (mut limits, kind) in kept {
        limits.also.clear();
        let first = limits.email.as_deref().and_then(|email| {
            listed.iter_mut().find(|(earlier, of)| {
                *of == kind
                    && (earlier.email.as_deref()).is_some_and(|e| e.eq_ignore_ascii_case(email))
            })
        });
        match first {
            Some((earlier, _)) => earlier.also.push(limits.harness),
            None => listed.push((limits, kind)),
        }
    }
    listed.into_iter().map(|(limits, _)| limits).collect()
}

/// A Harness not read yet. Its name is the list's, as a window reads it.
fn unread(id: &str) -> Limits {
    Limits {
        harness: id.to_owned(),
        ..Limits::default()
    }
}

fn kept(sql: &Connection, id: &str) -> Result<Option<Limits>, Error> {
    let text: Option<String> = sql
        .query_row(
            "SELECT kept FROM harnesses_limits WHERE harness = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    // A row from an older Banda that does not read is read again.
    Ok(text.and_then(|text| serde_json::from_str(&text).ok()))
}

/// The kept read of each of `ids`, in their order: unread for one never
/// read.
fn kept_all(sql: &Connection, ids: &[String]) -> Result<Vec<Limits>, Error> {
    (ids.iter())
        .map(|id| Ok(kept(sql, id)?.unwrap_or_else(|| unread(id))))
        .collect()
}

/// A window from a share spent, which a Harness says out of 100.
fn window(
    id: String,
    (kind, label): (WindowKind, String),
    used: f64,
    resets_at: Option<i64>,
    lasts: Option<i64>,
) -> LimitWindow {
    LimitWindow {
        id,
        kind,
        label,
        used: used.clamp(0.0, 100.0),
        resets_at,
        lasts,
    }
}

/// The milliseconds since 1970 of an RFC 3339 time, as Anthropic writes
/// one: `2026-11-04T12:00:00.123456+00:00`.
pub(crate) fn instant(text: &str) -> Option<i64> {
    let (date, time) = text.split_once(['T', 't', ' '])?;
    let mut date = date.splitn(3, '-').map(str::parse::<i64>);
    let (year, month, day) = (date.next()?.ok()?, date.next()?.ok()?, date.next()?.ok()?);
    let zone = time.find(['Z', 'z', '+', '-'])?;
    let (clock, offset) = time.split_at(zone);
    let (clock, fraction) = clock.split_once('.').unwrap_or((clock, ""));
    let mut clock = clock.splitn(3, ':').map(str::parse::<i64>);
    let (hour, minute, second) = (
        clock.next()?.ok()?,
        clock.next()?.ok()?,
        clock.next()?.ok()?,
    );
    let millis = format!("{fraction:0<3}")
        .get(..3)
        .and_then(|ms| ms.parse::<i64>().ok())?;
    let offset = match offset.as_bytes().first()? {
        b'Z' | b'z' => 0,
        sign => {
            let (hours, minutes) = offset[1..].split_once(':')?;
            let minutes = hours.parse::<i64>().ok()? * 60 + minutes.parse::<i64>().ok()?;
            if *sign == b'-' { -minutes } else { minutes }
        }
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    // Days from 1970-01-01 of a date in the Gregorian calendar.
    let (y, m) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = y.div_euclid(400);
    let of_era = y - era * 400;
    let of_year = (153 * m + 2) / 5 + day - 1;
    let of_cycle = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
    let days = era * 146_097 + of_cycle - 719_468;
    let seconds = days * 86_400 + hour * 3600 + minute * 60 + second - offset * 60;
    Some(seconds * 1000 + millis)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_read_as_anthropic_writes_them() {
        assert_eq!(instant("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            instant("2026-11-04T12:30:15.123456+00:00"),
            Some(1_793_795_415_123)
        );
        assert_eq!(
            instant("2026-11-04T14:30:15+02:00"),
            instant("2026-11-04T12:30:15Z")
        );
        assert_eq!(instant("2024-02-29T00:00:00Z"), Some(1_709_164_800_000));
        assert_eq!(instant("tomorrow"), None);
    }

    #[test]
    fn entries_signed_in_to_one_account_share_its_limits() {
        let entry = |id: &str, email: Option<&str>, kind| {
            let limits = Limits {
                harness: id.into(),
                email: email.map(Into::into),
                ..Limits::default()
            };
            (limits, Some(kind))
        };
        let listed = shared([
            entry("claude", Some("p@example.com"), Kind::Claude),
            entry("codex", Some("p@example.com"), Kind::Codex),
            entry("work", Some("w@example.com"), Kind::Claude),
            entry("again", Some("P@example.com"), Kind::Claude),
            entry("nobody", None, Kind::Claude),
            entry("nobody-too", None, Kind::Claude),
        ]);
        let said: Vec<(&str, Vec<&str>)> = (listed.iter())
            .map(|l| {
                (
                    l.harness.as_str(),
                    l.also.iter().map(String::as_str).collect(),
                )
            })
            .collect();
        assert_eq!(
            said,
            [
                ("claude", vec!["again"]),
                ("codex", vec![]),
                ("work", vec![]),
                ("nobody", vec![]),
                ("nobody-too", vec![]),
            ]
        );
    }

    #[test]
    fn a_harness_is_read_by_what_it_runs() {
        let mut harness = Harnesses::known().find("claude").unwrap();
        assert_eq!(Kind::of(&harness), Some(Kind::Claude));
        harness.id = "work".into();
        assert_eq!(Kind::of(&harness), Some(Kind::Claude), "a second account");
        harness.cli.as_mut().unwrap().program = "/opt/claude-work".into();
        assert_eq!(Kind::of(&harness), Some(Kind::Claude), "by its variable");
        harness.cli = None;
        assert_eq!(Kind::of(&harness), None);
        let codex = Harnesses::known().find("codex").unwrap();
        assert_eq!(Kind::of(&codex), Some(Kind::Codex));
    }
}
