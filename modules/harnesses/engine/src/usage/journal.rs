//! Provider journal records, without retaining conversation text.
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::model::UsageTokens as Tokens;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(super) struct Record {
    pub key: String,
    pub timestamp: String,
    pub model: String,
    pub tokens: Tokens,
    pub session: String,
    pub prompt: bool,
    pub recorded_cost: Option<f64>,
    pub cache_write_long: u64,
}

fn number(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// Claude repeats one message's usage on each content block. The store
/// upserts this key instead of adding each appearance to the totals.
pub(super) fn claude(value: &Value) -> Option<Record> {
    if value["type"] != "assistant" {
        return None;
    }
    let message = value.get("message")?;
    let usage = message.get("usage")?.as_object()?;
    let usage = Value::Object(usage.clone());
    let id = message["id"].as_str()?;
    let request = value["requestId"].as_str().unwrap_or("");
    Some(Record {
        key: serde_json::to_string(&(id, request)).ok()?,
        timestamp: value["timestamp"].as_str()?.to_owned(),
        model: message["model"].as_str()?.to_owned(),
        session: value["sessionId"].as_str().unwrap_or("").to_owned(),
        prompt: false,
        recorded_cost: cost(value).or_else(|| cost(message)),
        cache_write_long: number(&usage["cache_creation"], "ephemeral_1h_input_tokens"),
        tokens: Tokens {
            input: number(&usage, "input_tokens"),
            cache_read: number(&usage, "cache_read_input_tokens"),
            cache_write: number(&usage, "cache_creation_input_tokens"),
            output: number(&usage, "output_tokens"),
        },
    })
}

/// Only an explicit per-request cost is accepted; never a session total.
fn cost(value: &Value) -> Option<f64> {
    value
        .get("costUSD")
        .or_else(|| value.get("cost_usd"))?
        .as_f64()
        .filter(|n| n.is_finite() && *n >= 0.0)
}

pub(super) fn claude_prompt(value: &Value, offset: u64) -> Option<Record> {
    if value["type"] != "user" || value["isMeta"] == true {
        return None;
    }
    let content = &value["message"]["content"];
    if !content.is_string()
        && !content.as_array().is_some_and(|parts| {
            parts
                .iter()
                .any(|part| matches!(part["type"].as_str(), Some("text" | "image")))
        })
    {
        return None;
    }
    Some(Record {
        key: format!(
            "prompt:{}",
            value["uuid"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| offset.to_string())
        ),
        timestamp: value["timestamp"].as_str()?.to_owned(),
        model: "unknown".into(),
        session: value["sessionId"].as_str().unwrap_or("").into(),
        prompt: true,
        tokens: Tokens::default(),
        recorded_cost: None,
        cache_write_long: 0,
    })
}

/// State is kept beside a file's byte offset: later token counts can
/// omit the model and repeat the same cumulative total.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(super) struct Codex {
    model: Option<String>,
    totals: Option<Tokens>,
    session: String,
    /// The turn under way already counted its prompt, or was an Agent's.
    #[serde(default)]
    prompted: bool,
}

impl Codex {
    pub fn read(&mut self, value: &Value, offset: u64) -> Option<Record> {
        if value["type"] == "session_meta" {
            self.session = value["payload"]["id"].as_str().unwrap_or("").to_owned();
        }
        if value["type"] == "turn_context" {
            self.model = value["payload"]["model"].as_str().map(str::to_owned);
            return None;
        }
        // Codex starts a turn for each prompt: a Person's has no parent
        // turn, an Agent it spawned has one. Older Codex also wrote a
        // `user_message` in the same turn, and Codex before turns only that.
        let started = value["type"] == "event_msg" && value["payload"]["type"] == "task_started";
        let said = value["type"] == "event_msg" && value["payload"]["type"] == "user_message";
        if said && std::mem::take(&mut self.prompted) {
            return None;
        }
        if started {
            self.prompted = true;
            let parent = &value["payload"]["turn_attribution"]["parent_turn_id"];
            if !parent.is_null() {
                return None;
            }
        }
        if started || said {
            return Some(Record {
                key: format!("prompt:{offset}"),
                timestamp: value["timestamp"].as_str()?.to_owned(),
                model: self.model.clone().unwrap_or_else(|| "unknown".into()),
                session: self.session.clone(),
                prompt: true,
                recorded_cost: None,
                cache_write_long: 0,
                tokens: Tokens::default(),
            });
        }
        if value["type"] != "event_msg" || value["payload"]["type"] != "token_count" {
            return None;
        }
        let usage = value.pointer("/payload/info/total_token_usage")?;
        if !usage.is_object() {
            return None;
        }
        let timestamp = value["timestamp"].as_str()?.to_owned();
        let totals = Tokens {
            input: number(usage, "input_tokens"),
            cache_read: number(usage, "cached_input_tokens"),
            cache_write: number(usage, "cache_write_input_tokens"),
            // Reasoning is already part of output_tokens.
            output: number(usage, "output_tokens"),
        };
        let before = self.totals.clone().unwrap_or_default();
        if self.totals.as_ref() == Some(&totals) {
            return None;
        }
        // A reset starts a new cumulative series; never subtract it from
        // earlier usage or lose the first request of the new series.
        let before = if totals.input < before.input || totals.output < before.output {
            Tokens::default()
        } else {
            before
        };
        let cached = totals.cache_read.saturating_sub(before.cache_read);
        let input = totals.input.saturating_sub(before.input);
        let tokens = Tokens {
            input: input.saturating_sub(cached),
            cache_read: cached,
            cache_write: totals.cache_write.saturating_sub(before.cache_write),
            output: totals.output.saturating_sub(before.output),
        };
        let key = serde_json::to_string(&(&timestamp, &totals)).ok()?;
        self.totals = Some(totals);
        Some(Record {
            key,
            timestamp,
            model: self.model.clone().unwrap_or_else(|| "unknown".into()),
            tokens,
            session: self.session.clone(),
            prompt: false,
            recorded_cost: cost(&value["payload"]),
            cache_write_long: 0,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_content_blocks_have_one_key_and_preserve_separate_cache_tokens() {
        let mut value = json!({"type":"assistant","timestamp":"2026-11-04T01:00:00Z","requestId":"r","message":{"id":"m","model":"claude","usage":{"input_tokens":2,"cache_read_input_tokens":10,"cache_creation_input_tokens":20,"output_tokens":7}}});
        let first = claude(&value).unwrap();
        value["message"]["content"] = json!([{"type":"text","text":"not retained"}]);
        assert_eq!(first, claude(&value).unwrap());
        assert_eq!(
            first.tokens,
            Tokens {
                input: 2,
                cache_read: 10,
                cache_write: 20,
                output: 7
            }
        );
    }

    fn count(input: u64, cached: u64, output: u64) -> Value {
        json!({"type":"event_msg","timestamp":"2026-11-04T01:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":input,"cached_input_tokens":cached,"output_tokens":output,"reasoning_output_tokens":3}}}})
    }

    #[test]
    fn codex_repeated_totals_do_not_count_twice_and_cache_is_not_extra_input() {
        let mut reader = Codex::default();
        reader.read(
            &json!({"type":"turn_context","payload":{"model":"codex"}}),
            0,
        );
        let first = reader.read(&count(100, 60, 10), 1).unwrap();
        assert_eq!(
            first.tokens,
            Tokens {
                input: 40,
                cache_read: 60,
                cache_write: 0,
                output: 10
            }
        );
        assert!(reader.read(&count(100, 60, 10), 2).is_none());
        let saved = serde_json::to_string(&reader).unwrap();
        let mut reader: Codex = serde_json::from_str(&saved).unwrap();
        let next = reader.read(&count(150, 80, 20), 3).unwrap();
        assert_eq!(next.model, "codex");
        assert_eq!(
            next.tokens,
            Tokens {
                input: 30,
                cache_read: 20,
                cache_write: 0,
                output: 10
            }
        );
        assert_eq!(reader.read(&count(10, 0, 2), 4).unwrap().tokens.input, 10);
    }

    fn event(kind: &str, payload: Value) -> Value {
        let mut payload = payload;
        payload["type"] = json!(kind);
        json!({"type":"event_msg","timestamp":"2026-11-04T01:00:00Z","payload":payload})
    }

    #[test]
    fn codex_counts_a_prompt_per_turn_a_person_started() {
        let prompts = |lines: &[Value]| {
            let mut reader = Codex::default();
            lines
                .iter()
                .enumerate()
                .filter_map(|(at, line)| reader.read(line, at as u64))
                .filter(|record| record.prompt)
                .count()
        };
        let person = || {
            event(
                "task_started",
                json!({"turn_attribution":{"parent_turn_id":null}}),
            )
        };
        let agent = || {
            event(
                "task_started",
                json!({"turn_attribution":{"parent_turn_id":"t"}}),
            )
        };
        let said = || event("user_message", json!({"message":"hi"}));
        // Codex now: turns alone, an Agent's not counted.
        assert_eq!(prompts(&[person(), agent(), person()]), 2);
        // Older Codex: a turn and its message are one prompt.
        assert_eq!(prompts(&[person(), said(), person(), said()]), 2);
        // Before turns: the message alone.
        assert_eq!(prompts(&[said(), said()]), 2);
    }
}
