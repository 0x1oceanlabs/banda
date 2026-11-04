//! The usage summary `day` (ADR 0039, decision 6): once a day, the day
//! before, counted from the events Banda already keeps, from a list. The
//! Threads started by Harness and the Turns come from every Space's log,
//! as numbers only, through the kernel's tally; the Panes opened by kind
//! and the workspaces from this machine's own log; how many Spaces there
//! are from the kernel. Nothing else is read, and no code to count
//! anything is spread through Banda.
//!
//! A day is in UTC, so what goes says no time of day: it is stamped with
//! its day's midnight, not with when it went. Only a day that usage was
//! on for the whole of is counted, and one in which nothing was counted
//! makes no event.

use crate::exception::{Banda, TOKEN};
use banda_kernel::{Error, Event, EventFilter, ModuleSpace, Tally};
use banda_workspaces::model::{Arrangement, PaneId, panes};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// A day, in ms.
pub(crate) const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// What one day counted.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    /// The Threads started, by Harness: `unknown` for one that names none.
    pub threads: BTreeMap<String, u64>,
    pub turns: u64,
    /// The Panes opened, by kind, as `agents.thread`.
    pub panes: BTreeMap<String, u64>,
    /// How many Spaces and workspaces there are.
    pub spaces: u64,
    pub workspaces: u64,
}

impl Counts {
    /// Whether the day saw anything done.
    pub fn any(&self) -> bool {
        !self.threads.is_empty() || self.turns > 0 || !self.panes.is_empty()
    }
}

/// The UTC day `ms` falls in, in days since the epoch.
pub(crate) fn day_of(ms: i64) -> i64 {
    ms.div_euclid(DAY_MS)
}

/// The day `day`, in days since the epoch, as `2026-11-03`.
pub fn date(day: i64) -> String {
    banda_kernel::utc_date(day * DAY_MS)
}

/// The system's language and the country in it, as `ru_UA`, from the
/// Person's own settings; none when the system says only `C`.
pub fn locale() -> Option<String> {
    locale_of(&sys_locale::get_locale()?)
}

fn locale_of(said: &str) -> Option<String> {
    // `ru-UA`, `ru_UA.UTF-8` or `sr-Latn-RS`: the language and the country.
    let said = said.split(['.', '@']).next()?;
    let parts: Vec<&str> = said.split(['-', '_']).collect();
    let language = parts
        .first()
        .filter(|l| l.len() >= 2 && l.chars().all(|c| c.is_ascii_alphabetic()))?;
    let country = parts[1..]
        .iter()
        .find(|p| p.len() == 2 && p.chars().all(|c| c.is_ascii_alphabetic()));
    Some(match country {
        Some(country) => format!("{}_{}", language.to_lowercase(), country.to_uppercase()),
        None => language.to_lowercase(),
    })
}

/// Counts the day `day`, in days since the epoch.
pub(crate) async fn count(space: &ModuleSpace, day: i64) -> Result<Counts, Error> {
    let (from, to) = (day * DAY_MS, (day + 1) * DAY_MS);
    let tally = |kind: &str, by: Option<&str>| Tally {
        module: "agents".to_owned(),
        kind: kind.to_owned(),
        by: by.map(str::to_owned),
        from,
        to,
    };
    let mut threads = space
        .tally(tally("thread.started", Some("harness")))
        .await?
        .unwrap_or_default();
    if let Some(none) = threads.remove("") {
        *threads.entry("unknown".to_owned()).or_default() += none;
    }
    let turns = space
        .tally(tally("turn.started", None))
        .await?
        .unwrap_or_default();
    let spaces = space.spaces().await.unwrap_or_default() as u64;
    let (panes, workspaces) = arranged(space, from, to).await?;
    Ok(Counts {
        threads,
        turns: turns.values().sum(),
        panes,
        spaces,
        workspaces,
    })
}

/// An arrangement as a change of the workspaces says it whole.
#[derive(Deserialize)]
pub(crate) struct Whole {
    workspaces: Arrangement,
}

/// From this machine's log, the Panes opened in `from..to`, by kind, and
/// how many workspaces hold a Pane at `to`. Each change of the workspaces
/// says the whole arrangement after it, but a Pane's args, so a Pane
/// opened is one an `opened` arrangement has that the one before did not.
async fn arranged(
    space: &ModuleSpace,
    from: i64,
    to: i64,
) -> Result<(BTreeMap<String, u64>, u64), Error> {
    let filter = EventFilter {
        module: Some("workspaces".to_owned()),
        ..EventFilter::default()
    };
    let whole = |event: &Event| serde_json::from_value::<Whole>(event.payload.clone()).ok();
    let (start, end) = (space.position_at(from).await?, space.position_at(to).await?);
    let mut before = None;
    let mut at = start + 1;
    while let Some(event) = space.event_before(at, filter.clone()).await? {
        if let Some(found) = whole(&event) {
            before = Some(found);
            break;
        }
        at = event.seq;
    }
    let span = usize::try_from(end - start).unwrap_or_default();
    let events = space.events_after(start, filter, span).await?;
    let changes: Vec<(String, Whole)> = (events.iter())
        .filter_map(|event| Some((event.kind.clone(), whole(event)?)))
        .collect();
    Ok(opened(before.as_ref(), &changes))
}

/// The Panes opened by kind over `changes`, each `(kind, arrangement)`,
/// after the arrangement `before`, and how many workspaces hold a Pane
/// after the last.
pub(crate) fn opened(
    before: Option<&Whole>,
    changes: &[(String, Whole)],
) -> (BTreeMap<String, u64>, u64) {
    let ids =
        |whole: &Whole| -> BTreeSet<PaneId> { panes(&whole.workspaces).map(|p| p.id).collect() };
    let mut shown = before.map(ids).unwrap_or_default();
    let mut counted = BTreeMap::new();
    for (kind, whole) in changes {
        if kind == "opened" {
            for pane in panes(&whole.workspaces).filter(|p| !shown.contains(&p.id)) {
                *counted.entry(pane.shows.kind.clone()).or_default() += 1;
            }
        }
        shown = ids(whole);
    }
    let last = changes.last().map(|(_, whole)| whole).or(before);
    // The empty workspace at the bottom is no workspace.
    let workspaces = last.map_or(0, |whole| {
        whole
            .workspaces
            .iter()
            .filter(|w| !w.columns.is_empty())
            .count() as u64
    });
    (counted, workspaces)
}

/// The day `day`'s counts as `day`, sent with the random `id`.
pub fn day(day: i64, counts: &Counts, locale: Option<&str>, id: &str, banda: &Banda) -> Value {
    let date = date(day);
    let country = locale
        .and_then(|l| l.split_once('_'))
        .map(|(_, country)| country);
    json!({
        "api_key": TOKEN,
        "event": "day",
        "distinct_id": id,
        // Its day's midnight: when it went says nothing.
        "timestamp": format!("{date}T00:00:00Z"),
        "properties": {
            "$process_person_profile": false,
            "$geoip_disable": true,
            "day": date,
            "version": banda.version,
            "channel": banda.channel,
            "os": banda.os,
            "locale": locale,
            "country": country,
            "threads": counts.threads,
            "turns": counts.turns,
            "panes": counts.panes,
            "spaces": counts.spaces,
            "workspaces": counts.workspaces,
        },
    })
}

/// What `day` is about, in a few words, for "Sent by Banda".
pub fn about(day: i64, counts: &Counts) -> String {
    let threads: u64 = counts.threads.values().sum();
    let panes: u64 = counts.panes.values().sum();
    format!(
        "{} · {threads} Threads, {} Turns, {panes} Panes",
        date(day),
        counts.turns
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_day_is_its_utc_date() {
        assert_eq!(date(0), "1970-01-01");
        assert_eq!(date(day_of(1_793_750_400_000)), "2026-11-04");
        assert_eq!(date(day_of(1_793_750_399_999)), "2026-11-03");
        assert_eq!(date(day_of(951_782_400_000)), "2000-02-29");
    }

    #[test]
    fn the_locale_is_the_language_and_the_country() {
        assert_eq!(locale_of("ru-UA").as_deref(), Some("ru_UA"));
        assert_eq!(locale_of("en_US.UTF-8").as_deref(), Some("en_US"));
        assert_eq!(locale_of("sr-Latn-RS").as_deref(), Some("sr_RS"));
        assert_eq!(locale_of("de").as_deref(), Some("de"));
        assert_eq!(locale_of("C"), None);
    }

    const UUID: &str = "00000000-0000-4000-8000-000000000000";

    fn arrangement(panes: &[(&str, &str)]) -> Whole {
        let panes: Vec<Value> = panes
            .iter()
            .map(|(id, kind)| {
                let id = format!("00000000-0000-4000-8000-00000000000{id}");
                let space = UUID;
                json!({ "id": id, "kind": kind, "space": space, "args": {} })
            })
            .collect();
        let whole = json!({ "workspaces": [
            { "id": UUID.replace('0', "1"), "columns": [{ "id": UUID, "panes": panes }] },
            { "id": UUID.replace('0', "2"), "columns": [] },
        ] });
        serde_json::from_value(whole).unwrap()
    }

    #[test]
    fn a_pane_opened_is_one_the_arrangement_did_not_have() {
        let before = arrangement(&[("1", "agents.thread")]);
        let changes = [
            (
                "opened".to_owned(),
                arrangement(&[("1", "agents.thread"), ("2", "terminal.terminal")]),
            ),
            // Moved: no Pane opened.
            (
                "moved".to_owned(),
                arrangement(&[("2", "terminal.terminal"), ("1", "agents.thread")]),
            ),
            (
                "closed".to_owned(),
                arrangement(&[("2", "terminal.terminal")]),
            ),
            (
                "opened".to_owned(),
                arrangement(&[("2", "terminal.terminal"), ("3", "agents.thread")]),
            ),
        ];
        let (panes, workspaces) = opened(Some(&before), &changes);
        assert_eq!(
            panes,
            [
                ("agents.thread".to_owned(), 1),
                ("terminal.terminal".to_owned(), 1)
            ]
            .into()
        );
        // The empty workspace at the bottom is no workspace.
        assert_eq!(workspaces, 1);
        assert_eq!(opened(None, &[]), (BTreeMap::new(), 0));
    }

    #[test]
    fn a_day_goes_as_numbers_stamped_with_its_midnight() {
        let banda = Banda {
            version: "0.2.0".to_owned(),
            channel: "stable",
            os: "linux",
        };
        let counts = Counts {
            threads: [("claude".to_owned(), 4)].into(),
            turns: 31,
            panes: [("agents.thread".to_owned(), 6)].into(),
            spaces: 2,
            workspaces: 3,
        };
        let day_ = day_of(1_793_750_400_000) - 1;
        let sent = day(day_, &counts, Some("ru_UA"), "7c2e", &banda);
        assert_eq!(sent["event"], "day");
        assert_eq!(sent["distinct_id"], "7c2e");
        assert_eq!(sent["timestamp"], "2026-11-03T00:00:00Z");
        assert_eq!(
            sent["properties"],
            json!({
                "$process_person_profile": false, "$geoip_disable": true,
                "day": "2026-11-03", "version": "0.2.0", "channel": "stable", "os": "linux",
                "locale": "ru_UA", "country": "UA", "threads": { "claude": 4 }, "turns": 31,
                "panes": { "agents.thread": 6 }, "spaces": 2, "workspaces": 3,
            })
        );
        assert_eq!(
            about(day_, &counts),
            "2026-11-03 · 4 Threads, 31 Turns, 6 Panes"
        );
    }
}
