//! Codex's limits (ADR 0043, decision 3): the entry's `codex app-server`,
//! with its CLI and its `CODEX_HOME`, asked `initialize`, then
//! `account/rateLimits/read`, and `account/read` for the plan when the
//! limits name none. Codex reads its own sign-in. The process stops after.

use super::{Failure, Found, window};
use crate::model::{LimitWindow, WindowKind};
use crate::{Harness, cli};
use serde_json::{Value, json};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::time::timeout;

/// How long each question may take.
const ASKING: Duration = Duration::from_secs(8);

const MINUTE: i64 = 60 * 1000;

pub(super) async fn read(harness: &Harness) -> Result<Found, Failure> {
    let program = harness.cli.as_ref().map_or("codex", |cli| &cli.program);
    let path = cli::located(program)
        .ok_or_else(|| Failure::new(format!("`{program}` is not installed on this computer.")))?;
    let mut child = tokio::process::Command::new(path)
        .args(["-s", "read-only", "-a", "on-request", "app-server"])
        .envs(&harness.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| Failure::new(format!("Codex's app-server did not start: {e}.")))?;
    let mut server = Server::of(&mut child)?;
    let client = json!({ "clientInfo": { "name": "banda", "version": banda_kernel::version() } });
    server.ask("initialize", client).await?;
    server
        .say(json!({ "method": "initialized", "params": {} }))
        .await?;
    let limits = server.ask("account/rateLimits/read", json!({})).await;
    let account = match &limits {
        Ok(limits) if plan_of(limits).is_some() => None,
        _ => server.ask("account/read", json!({})).await.ok(),
    };
    found(limits, account.as_ref())
}

/// What the app-server's answers say.
fn found(limits: Result<Value, Failure>, account: Option<&Value>) -> Result<Found, Failure> {
    let signed_in = account.map(|answer| answer.pointer("/account/type").and_then(Value::as_str));
    match signed_in {
        Some(None) => return Ok(Found::none("No one is signed in to Codex.")),
        Some(Some("apiKey")) => {
            return Ok(Found::none(
                "Codex is signed in with an API key, which has no limits.",
            ));
        }
        _ => {}
    }
    let limits = limits?;
    let plan = plan_of(&limits)
        .or_else(|| account?.pointer("/account/planType")?.as_str())
        .map(plan_name);
    let windows = windows(&limits);
    if windows.is_empty() {
        return Err(Failure::new("Codex's app-server answered no limits."));
    }
    Ok(Found {
        plan,
        windows,
        note: None,
    })
}

/// Each bucket's windows, the account's own (`codex`) first: a newer
/// app-server names every bucket in `rateLimitsByLimitId`, an older one
/// only the account's in `rateLimits`.
fn windows(limits: &Value) -> Vec<LimitWindow> {
    let mut buckets: Vec<(&str, &Value)> = match limits.get("rateLimitsByLimitId") {
        Some(Value::Object(buckets)) if !buckets.is_empty() => buckets
            .iter()
            .map(|(id, bucket)| (id.as_str(), bucket))
            .collect(),
        _ => limits
            .get("rateLimits")
            .map(|b| ("codex", b))
            .into_iter()
            .collect(),
    };
    buckets.sort_by_key(|(id, _)| *id != "codex");
    let only = buckets.len() == 1;
    let mut windows = Vec::new();
    for (id, bucket) in buckets {
        let name = bucket.get("limitName").and_then(Value::as_str);
        let own = id == "codex" || (only && name.is_none());
        for side in ["primary", "secondary"] {
            let Some(said) = bucket.get(side).filter(|said| said.is_object()) else {
                continue;
            };
            let Some(used) = said.get("usedPercent").and_then(Value::as_f64) else {
                continue;
            };
            let minutes = said.get("windowDurationMins").and_then(Value::as_i64);
            let (kind, label) = span(minutes);
            let label = match (own, name.unwrap_or(id)) {
                (true, _) => label,
                (false, name) => format!("{label} · {name}"),
            };
            let resets = (said.get("resetsAt").and_then(Value::as_i64))
                .filter(|&at| at > 0)
                .map(|seconds| seconds * 1000);
            let lasts = minutes.map(|minutes| minutes * MINUTE);
            windows.push(window(
                format!("{id}:{side}"),
                (kind, label),
                used,
                resets,
                lasts,
            ));
        }
    }
    windows
}

/// A window by how many minutes it lasts.
fn span(minutes: Option<i64>) -> (WindowKind, String) {
    match minutes {
        Some(300) => (WindowKind::Session, "Session".into()),
        Some(10_080) => (WindowKind::Weekly, "Weekly".into()),
        Some(minutes) if minutes >= 28 * 24 * 60 => (WindowKind::Monthly, "Monthly".into()),
        Some(minutes) if minutes > 0 && minutes % (24 * 60) == 0 => {
            (WindowKind::Other, format!("{} days", minutes / (24 * 60)))
        }
        Some(minutes) if minutes > 0 && minutes % 60 == 0 => {
            (WindowKind::Other, format!("{} hours", minutes / 60))
        }
        _ => (WindowKind::Other, "Limit".into()),
    }
}

/// The plan the limits name, in a bucket or the older single view.
fn plan_of(limits: &Value) -> Option<&str> {
    let buckets = limits.get("rateLimitsByLimitId").and_then(Value::as_object);
    let mut said = buckets.into_iter().flat_map(|b| b.values());
    let plan = said.find_map(|bucket| bucket.get("planType")?.as_str());
    plan.or_else(|| limits.pointer("/rateLimits/planType")?.as_str())
}

/// The plan as Codex's own `/status` names it; one newer than this
/// table keeps its own name, made readable.
fn plan_name(plan: &str) -> String {
    let named = match plan {
        "free" => "Free",
        "go" => "Go",
        "plus" => "Plus",
        "pro" => "Pro",
        "prolite" => "Pro Lite",
        "team" | "self_serve_business_usage_based" => "Business",
        "business" | "enterprise" => "Enterprise",
        "edu" => "Edu",
        other => return other.replace('_', " "),
    };
    named.to_owned()
}

/// The app-server, spoken to a line of JSON a message.
struct Server {
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    next: u64,
}

impl Server {
    /// Takes the pipes of `child`, which stops as it drops.
    fn of(child: &mut Child) -> Result<Self, Failure> {
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            return Err(Failure::new("Codex's app-server has no pipes."));
        };
        Ok(Self {
            stdin,
            lines: BufReader::new(stdout).lines(),
            next: 1,
        })
    }

    async fn say(&mut self, message: Value) -> Result<(), Failure> {
        let mut line = message.to_string();
        line.push('\n');
        (self.stdin.write_all(line.as_bytes()).await)
            .map_err(|_| Failure::new("Codex's app-server stopped."))
    }

    /// Asks `method` and waits for its answer, past the notifications
    /// between.
    async fn ask(&mut self, method: &str, params: Value) -> Result<Value, Failure> {
        let id = self.next;
        self.next += 1;
        self.say(json!({ "id": id, "method": method, "params": params }))
            .await?;
        let answer = timeout(ASKING, async {
            while let Ok(Some(line)) = self.lines.next_line().await {
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if message.get("id").and_then(Value::as_u64) == Some(id) {
                    return Some(message);
                }
            }
            None
        });
        let message = (answer.await)
            .map_err(|_| Failure::new(format!("Codex's app-server did not answer {method}.")))?
            .ok_or_else(|| Failure::new(format!("Codex's app-server stopped before {method}.")))?;
        if let Some(error) = message.get("error") {
            let said = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("an error");
            return Err(Failure::new(format!(
                "Codex's app-server answered {method} with {said}."
            )));
        }
        Ok(message.get("result").cloned().unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What Codex 0.166.0's app-server answered on 2026-11-04.
    fn answered() -> Value {
        json!({
            "ordinaryUsageAllowed": true,
            "rateLimits": {
                "limitId": "codex", "limitName": null,
                "primary": { "usedPercent": 5, "windowDurationMins": 10080, "resetsAt": 1_793_774_984 },
                "secondary": null, "planType": "pro"
            },
            "rateLimitsByLimitId": {
                "codex": {
                    "limitId": "codex", "limitName": null,
                    "primary": { "usedPercent": 5, "windowDurationMins": 10080, "resetsAt": 1_793_774_984 },
                    "secondary": null, "planType": "pro"
                }
            }
        })
    }

    #[test]
    fn the_app_servers_answer_reads_as_windows() {
        let found = found(Ok(answered()), None).unwrap();
        assert_eq!(found.plan.as_deref(), Some("Pro"));
        assert_eq!(found.windows.len(), 1, "one view of the bucket, not both");
        let week = &found.windows[0];
        assert_eq!((week.label.as_str(), week.used), ("Weekly", 5.0));
        assert_eq!(week.resets_at, Some(1_793_774_984_000));
        assert_eq!(week.lasts, Some(7 * 24 * 60 * MINUTE));
    }

    #[test]
    fn a_models_bucket_is_named_after_the_accounts() {
        let mut limits = answered();
        limits["rateLimitsByLimitId"]["fast"] = json!({
            "limitName": "GPT-6 Fast",
            "primary": { "usedPercent": 40, "windowDurationMins": 300 }
        });
        let labels: Vec<String> = (windows(&limits).into_iter()).map(|w| w.label).collect();
        assert_eq!(labels, ["Weekly", "Session · GPT-6 Fast"]);
    }

    #[test]
    fn an_account_with_no_limits_says_why() {
        let refused = || Err(Failure::new("wants ChatGPT"));
        let key = json!({ "account": { "type": "apiKey" } });
        assert!(
            found(refused(), Some(&key))
                .unwrap()
                .note
                .unwrap()
                .contains("API key")
        );
        let none = json!({ "account": null });
        assert!(
            found(refused(), Some(&none))
                .unwrap()
                .note
                .unwrap()
                .contains("No one")
        );
        let plan = json!({ "account": { "type": "chatgpt", "planType": "plus" } });
        let mut limits = answered();
        limits["rateLimitsByLimitId"]["codex"]["planType"] = Value::Null;
        limits["rateLimits"]["planType"] = Value::Null;
        assert_eq!(
            found(Ok(limits), Some(&plan)).unwrap().plan.as_deref(),
            Some("Plus")
        );
    }
}
