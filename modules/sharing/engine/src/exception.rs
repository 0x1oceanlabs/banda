//! A Problem as the one event it goes as, `$exception` (ADR 0039,
//! decision 6), in PostHog's own words for error tracking: its type and
//! its message, its frames in Banda's code, and Banda's version, channel
//! and system. Nothing else: no path outside Banda's source and no
//! address (the problems module keeps none in a message), no time of
//! day, and no person behind the random ID (decision 7).

use banda_problems::model::{Frame, Problem};
use serde_json::{Value, json};

/// Banda's PostHog project's token. It is public by design: with it,
/// anyone can send events, and no one can read them (ADR 0039).
pub const TOKEN: &str = "phc_tf7tVXvPn4DyjtNhwGFYggUcKiyfS4ZWYbhgeBuCem7e";

/// Which Banda sends: its version, its channel and its system.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Banda {
    pub version: String,
    pub channel: &'static str,
    pub os: &'static str,
}

impl Banda {
    /// This Banda, of `channel`.
    pub fn this(channel: &'static str) -> Self {
        Self {
            version: banda_kernel::version().to_owned(),
            channel,
            os: std::env::consts::OS,
        }
    }
}

/// `problem` as `$exception`, sent with the random `id`.
pub fn exception(problem: &Problem, id: &str, banda: &Banda) -> Value {
    let frames: Vec<Value> = problem.frames.iter().map(frame).collect();
    json!({
        "api_key": TOKEN,
        "event": "$exception",
        "distinct_id": id,
        "properties": {
            "$process_person_profile": false,
            "$geoip_disable": true,
            "$exception_fingerprint": problem.fingerprint,
            "$exception_list": [{
                "type": problem.kind,
                "value": problem.message,
                "mechanism": { "handled": false, "synthetic": false },
                "stacktrace": { "type": "raw", "frames": frames },
            }],
            "source": problem.source,
            "version": banda.version,
            "channel": banda.channel,
            "os": banda.os,
        },
    })
}

/// What `$exception` is about, in a few words, for "Sent by Banda".
pub fn about(problem: &Problem) -> String {
    match problem.frames.first() {
        Some(top) => format!("{} · {}", problem.kind, top.place()),
        None => problem.kind.clone(),
    }
}

/// A frame, the nearest first as Banda keeps them. Its file is already
/// Banda's own, as the repository names it.
fn frame(frame: &Frame) -> Value {
    let mut value = json!({
        "filename": frame.file,
        "function": frame.function,
        "in_app": true,
        "platform": "custom",
    });
    if let Some(line) = frame.line {
        value["lineno"] = line.into();
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_problems::model::Source;

    fn problem(message: &str) -> Problem {
        Problem {
            fingerprint: "3124d1bf35ad".to_owned(),
            source: Source::Page,
            kind: "TypeError".to_owned(),
            message: message.to_owned(),
            frames: vec![Frame {
                file: "app/web/src/browser/Tabs.tsx".to_owned(),
                function: "Tabs".to_owned(),
                line: Some(41),
            }],
            version: "0.2.0".to_owned(),
            first: 1,
            last: 2,
            times: 3,
        }
    }

    #[test]
    fn a_problem_goes_with_its_frames_and_banda_and_nothing_of_the_person() {
        let banda = Banda {
            version: "0.2.0".to_owned(),
            channel: "stable",
            os: "linux",
        };
        let sent = exception(&problem("reading 'tabs'"), "7c2e", &banda);
        assert_eq!(sent["event"], "$exception");
        assert_eq!(sent["distinct_id"], "7c2e");
        let said = &sent["properties"];
        assert_eq!(said["$process_person_profile"], false);
        assert_eq!(said["$geoip_disable"], true);
        assert_eq!(said["$exception_fingerprint"], "3124d1bf35ad");
        let thrown = &said["$exception_list"][0];
        assert_eq!(thrown["type"], "TypeError");
        assert_eq!(thrown["value"], "reading 'tabs'");
        assert_eq!(
            thrown["stacktrace"]["frames"][0],
            json!({
                "filename": "app/web/src/browser/Tabs.tsx", "function": "Tabs",
                "lineno": 41, "in_app": true, "platform": "custom",
            })
        );
        assert_eq!(
            (
                &said["version"],
                &said["channel"],
                &said["os"],
                &said["source"]
            ),
            (
                &json!("0.2.0"),
                &json!("stable"),
                &json!("linux"),
                &json!("page")
            )
        );
        // No time of day, no person.
        assert!(sent.get("timestamp").is_none());
        assert!(said.get("$set").is_none());
        assert_eq!(
            about(&problem("")),
            "TypeError · app/web/src/browser/Tabs.tsx:41"
        );
    }
}
