//! With `FAKE_AGENT_REPLAY` naming a recording (a Harness entry's
//! `record`), the fake agent says again what a real Harness said, frame by
//! frame, in place of its script.
//!
//! A recording is what the client sent, each frame followed by what the
//! Harness said before the client's next one. A frame that arrives takes
//! the first unused recorded frame of its kind: a request or a
//! notification by its method, an answer by its ID. It must say what that
//! one said, its params or its answer, in the recorded session's folder
//! moved to this session's; only `initialize` may differ, as it changes
//! with each version of Banda. What the Harness said after it is said
//! again, fitted to this run: answers carry this run's request IDs, and
//! the folder is this session's.
//!
//! A request the recording holds nothing for, or other params than it
//! holds, is refused. A notification or an answer that differs ends the
//! replay, as a Harness that stops.

use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::path::Path;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Stdout};

/// A frame the client sent in the recording, and what the Harness said
/// after it.
struct Heard {
    frame: Value,
    then: Vec<Value>,
    used: bool,
}

pub async fn replay(recording: &Path) -> std::io::Result<()> {
    let mut first = Vec::new();
    let mut heard: Vec<Heard> = Vec::new();
    for line in std::fs::read_to_string(recording)?.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let entry: Value = serde_json::from_str(line)?;
        let frame = entry["frame"].clone();
        match (entry["to"].as_str(), heard.last_mut()) {
            (Some("agent"), _) => heard.push(Heard {
                frame,
                then: Vec::new(),
                used: false,
            }),
            (_, Some(last)) => last.then.push(frame),
            (_, None) => first.push(frame),
        }
    }
    let mut out = tokio::io::stdout();
    let mut fit = Fit::default();
    say(&mut out, &fit, &first).await?;
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await? {
        let Ok(frame) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let method = frame.get("method");
        let found = heard.iter_mut().find(|h| {
            !h.used
                && match method {
                    Some(method) => h.frame.get("method") == Some(method),
                    None => h.frame.get("method").is_none() && h.frame.get("id") == frame.get("id"),
                }
        });
        let recorded = found.map(|found| {
            fit.learn(&found.frame, &frame);
            (fit.moved(&found.frame), found)
        });
        match (recorded, method, frame.get("id")) {
            (Some((recorded, found)), ..) if same(&recorded, &frame) => {
                found.used = true;
                say(&mut out, &fit, &found.then).await?;
            }
            (recorded, Some(_), Some(id)) => {
                let message = match recorded {
                    Some((recorded, _)) => {
                        format!("The recording holds other params: {}", recorded["params"])
                    }
                    None => "The recording holds nothing for this.".to_owned(),
                };
                let refused = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32603, "message": message },
                });
                write(&mut out, &refused).await?;
            }
            (Some((recorded, _)), ..) => {
                let differs = format!("the recording holds {recorded}, not {frame}");
                return Err(std::io::Error::other(differs));
            }
            (None, ..) => {}
        }
    }
    Ok(())
}

async fn say(out: &mut Stdout, fit: &Fit, frames: &[Value]) -> std::io::Result<()> {
    for frame in frames {
        write(out, &fit.fitted(frame)).await?;
    }
    Ok(())
}

async fn write(out: &mut Stdout, frame: &Value) -> std::io::Result<()> {
    let mut line = frame.to_string();
    line.push('\n');
    out.write_all(line.as_bytes()).await?;
    out.flush().await
}

/// What this run calls what the recording called otherwise.
#[derive(Default)]
struct Fit {
    /// This run's request ID for each recorded one.
    ids: HashMap<String, Value>,
    /// The recorded session's folder, and this one's.
    folder: Option<(String, String)>,
}

impl Fit {
    fn learn(&mut self, recorded: &Value, live: &Value) {
        if let (Some(_), Some(was), Some(is)) =
            (recorded.get("method"), recorded.get("id"), live.get("id"))
        {
            self.ids.insert(was.to_string(), is.clone());
        }
        let cwd = |frame: &Value| frame["params"]["cwd"].as_str().map(str::to_owned);
        if let (Some(was), Some(is)) = (cwd(recorded), cwd(live)) {
            self.folder = Some((was, is));
        }
    }

    /// `frame` in this session's folder.
    fn moved(&self, frame: &Value) -> Value {
        match &self.folder {
            Some((was, is)) => moved(frame, was, is),
            None => frame.clone(),
        }
    }

    /// `frame` in this session's folder, answering this run's request.
    fn fitted(&self, frame: &Value) -> Value {
        let mut frame = self.moved(frame);
        let answer = frame.get("method").is_none();
        let id = frame.get("id").and_then(|id| self.ids.get(&id.to_string()));
        if let (true, Some(id)) = (answer, id) {
            frame["id"] = id.clone();
        }
        frame
    }
}

/// Whether `live` says what `recorded` did: the same params, or the same
/// answer. What a client says when it starts changes with its version.
fn same(recorded: &Value, live: &Value) -> bool {
    match recorded.get("method").and_then(Value::as_str) {
        Some("initialize") => true,
        Some(_) => recorded.get("params") == live.get("params"),
        None => {
            recorded.get("result") == live.get("result")
                && recorded.get("error") == live.get("error")
        }
    }
}

/// `value` with each `was` in its text and its keys written as `is`.
fn moved(value: &Value, was: &str, is: &str) -> Value {
    match value {
        Value::String(text) => Value::String(text.replace(was, is)),
        Value::Array(items) => items.iter().map(|v| moved(v, was, is)).collect(),
        Value::Object(fields) => fields
            .iter()
            .map(|(key, v)| (key.replace(was, is), moved(v, was, is)))
            .collect::<Map<_, _>>()
            .into(),
        other => other.clone(),
    }
}
