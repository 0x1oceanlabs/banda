//! Claude Code's limits (ADR 0043, decision 2): Anthropic's
//! `GET /api/oauth/usage`, asked with Claude Code's own access token. The
//! window's main reads the token where Claude Code keeps it, asks with it
//! and answers what Anthropic said, with the plan its sign-in names: the
//! token stays in main for that one request, and the engine never holds
//! it. A window must be open.

use super::{Failure, Found, WAIT, instant, window};
use crate::Harness;
use crate::model::{LimitWindow, WindowKind};
use banda_kernel::{ModuleSpace, Participant};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::Duration;

/// How long main may take: its request has 10 seconds.
const ASKING: Duration = Duration::from_secs(15);

const HOUR: i64 = 60 * 60 * 1000;

/// What main answers: what Claude Code's sign-in says, and what Anthropic
/// answered. It holds no token.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct Answer {
    /// Whether Claude Code keeps a sign-in.
    signed_in: bool,
    /// Its plan and tier, as the sign-in has them: `max`,
    /// `default_claude_max_20x`.
    subscription: Option<String>,
    tier: Option<String>,
    /// Its token expired, so main asked nothing.
    expired: bool,
    status: Option<u16>,
    body: Option<Value>,
}

pub(super) async fn read(space: &ModuleSpace, harness: &Harness) -> Result<Found, Failure> {
    // The entry's own configuration folder, else Claude Code's default.
    let config = harness.env.get("CLAUDE_CONFIG_DIR");
    let owner = Participant::Person(space.owner());
    let asked = json!({ "config": config });
    let answer = space.ask_window(owner, "claude_usage", asked, ASKING).await;
    let answer = answer.map_err(|refusal| {
        Failure::new(format!(
            "Banda could not ask Anthropic: {}",
            refusal.message
        ))
    })?;
    let answer = serde_json::from_value(answer)
        .map_err(|e| Failure::new(format!("Banda's window answered amiss: {e}.")))?;
    found(answer)
}

fn found(answer: Answer) -> Result<Found, Failure> {
    if !answer.signed_in {
        return Ok(Found::none("No one is signed in to Claude Code."));
    }
    if answer.expired {
        return Err(Failure::new(
            "Claude Code renews its sign-in on its next turn.",
        ));
    }
    match answer.status {
        Some(200) => {}
        Some(401 | 403) => {
            return Err(Failure::new(
                "Claude Code's sign-in expired: start it, or sign in again, to read its limits.",
            ));
        }
        Some(429) => {
            return Err(Failure {
                why: "Anthropic asked Banda to wait before it reads the limits again.".into(),
                wait: Some(WAIT),
            });
        }
        Some(status) => return Err(Failure::new(format!("Anthropic answered {status}."))),
        None => return Err(Failure::new("Anthropic answered nothing.")),
    }
    let windows = windows(&answer.body.unwrap_or_default());
    let note = (windows.is_empty()).then(|| "Anthropic says this account has no limits.".into());
    Ok(Found {
        plan: plan(answer.subscription.as_deref(), answer.tier.as_deref()),
        windows,
        note,
    })
}

/// The windows of Anthropic's answer: the session's and the week's, then
/// each model's own.
fn windows(body: &Value) -> Vec<LimitWindow> {
    let mut windows: Vec<LimitWindow> = (["five_hour", "seven_day"].into_iter())
        .filter_map(|id| {
            let bucket = body.get(id)?;
            let used = bucket.get("utilization")?.as_f64()?;
            let (kind, label, lasts) = scope(id);
            let kind = (kind, label.to_owned());
            Some(window(id.to_owned(), kind, used, resets(bucket), lasts))
        })
        .collect();
    let scoped = body.get("limits").and_then(Value::as_array);
    for entry in scoped.into_iter().flatten() {
        let model = entry.pointer("/scope/model");
        let Some(model) = model.and_then(|model| {
            let name = model.get("display_name").or_else(|| model.get("id"));
            name?.as_str().filter(|name| !name.is_empty())
        }) else {
            continue;
        };
        let Some(used) = entry.get("percent").and_then(Value::as_f64) else {
            continue;
        };
        let kind_said = entry.get("kind").and_then(Value::as_str).unwrap_or("");
        let id = format!("{kind_said}:{model}");
        if windows.iter().any(|window| window.id == id) {
            continue;
        }
        let (kind, label, lasts) = scope(kind_said);
        let kind = (kind, format!("{label} · {model}"));
        windows.push(window(id, kind, used, resets(entry), lasts));
    }
    windows
}

/// A window by what Anthropic names it: `five_hour`, `seven_day`, or a
/// model's kind, `weekly_scoped`.
fn scope(kind: &str) -> (WindowKind, &'static str, Option<i64>) {
    let kind = kind.to_lowercase();
    if kind.contains("month") {
        (WindowKind::Monthly, "Monthly", None)
    } else if kind.contains("week") || kind.contains("seven_day") {
        (WindowKind::Weekly, "Weekly", Some(7 * 24 * HOUR))
    } else if kind.contains("hour") || kind.contains("session") {
        (WindowKind::Session, "Session", Some(5 * HOUR))
    } else {
        (WindowKind::Other, "Limit", None)
    }
}

fn resets(bucket: &Value) -> Option<i64> {
    instant(bucket.get("resets_at")?.as_str()?)
}

/// The plan as Claude Code's sign-in names it: its subscription, with
/// the multiple its tier names, `Max 20x`; a tier says the ceiling, not
/// the plan, so a Team seat on Max's tier is `Team 5x`.
fn plan(subscription: Option<&str>, tier: Option<&str>) -> Option<String> {
    let plan = subscription.filter(|s| !s.is_empty()).map(|s| {
        let mut letters = s.chars();
        letters.next().map_or_else(String::new, |first| {
            first.to_uppercase().chain(letters).collect()
        })
    });
    let multiple = tier.and_then(|tier| {
        let tier = tier.to_lowercase();
        let after = &tier[tier.find("max_")? + 4..];
        let digits = after.find(|c: char| !c.is_ascii_digit())?;
        (digits > 0 && after[digits..].starts_with('x')).then(|| after[..=digits].to_owned())
    });
    match (plan, multiple) {
        (plan, Some(multiple)) => Some(format!("{} {multiple}", plan.as_deref().unwrap_or("Max"))),
        (plan, None) => plan,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answered(body: Value) -> Answer {
        Answer {
            signed_in: true,
            subscription: Some("max".into()),
            tier: Some("default_claude_max_20x".into()),
            status: Some(200),
            body: Some(body),
            ..Answer::default()
        }
    }

    #[test]
    fn anthropics_answer_reads_as_windows() {
        let body = json!({
            "five_hour": { "utilization": 12.0, "resets_at": "2026-11-04T15:00:00+00:00" },
            "seven_day": { "utilization": 74.4, "resets_at": "2026-11-07T00:00:00Z" },
            "seven_day_opus": null,
            "limits": [
                { "kind": "weekly_scoped", "percent": 31, "resets_at": "2026-11-07T00:00:00Z",
                  "scope": { "model": { "id": "claude-fable-5-1", "display_name": "Fable" } } },
                { "kind": "weekly_scoped", "percent": 31,
                  "scope": { "model": { "id": "claude-fable-5-1", "display_name": "Fable" } } },
                { "kind": "weekly", "percent": 74.4 }
            ]
        });
        let found = found(answered(body)).unwrap();
        assert_eq!(found.plan.as_deref(), Some("Max 20x"));
        let said: Vec<(&str, f64)> = (found.windows.iter())
            .map(|w| (w.label.as_str(), w.used))
            .collect();
        assert_eq!(
            said,
            [
                ("Session", 12.0),
                ("Weekly", 74.4),
                ("Weekly · Fable", 31.0)
            ]
        );
        assert_eq!(found.windows[0].resets_at, Some(1_793_804_400_000));
        assert_eq!(found.windows[2].kind, WindowKind::Weekly);
    }

    #[test]
    fn what_goes_wrong_says_why() {
        let signed_out = found(Answer::default()).unwrap();
        assert!(signed_out.windows.is_empty() && signed_out.note.is_some());
        let expired = Answer {
            signed_in: true,
            expired: true,
            ..Answer::default()
        };
        assert!(found(expired).unwrap_err().why.contains("next turn"));
        let wait = Answer {
            status: Some(429),
            ..answered(Value::Null)
        };
        assert_eq!(found(wait).unwrap_err().wait, Some(WAIT));
        let refused = Answer {
            status: Some(401),
            ..answered(Value::Null)
        };
        assert!(found(refused).unwrap_err().why.contains("expired"));
    }

    #[test]
    fn a_plan_is_named_as_claude_code_names_it() {
        assert_eq!(plan(Some("pro"), None).as_deref(), Some("Pro"));
        assert_eq!(
            plan(Some("team"), Some("default_claude_max_5x")).as_deref(),
            Some("Team 5x")
        );
        assert_eq!(plan(None, Some("max_20x")).as_deref(), Some("Max 20x"));
        assert_eq!(plan(None, Some("default")), None);
    }
}
