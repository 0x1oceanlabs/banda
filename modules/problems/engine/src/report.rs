//! A Problem's report in Markdown, for an Agent to read, an issue to
//! hold, or the Person to copy (ADR 0039, decisions 1 and 3).

use crate::model::{Report, word};
use std::fmt::Write as _;

/// The report: what broke, where, the system, and the logs' last lines.
pub fn markdown(report: &Report) -> String {
    let mut out = String::new();
    // Writing to a String does not fail.
    let _ = write(&mut out, report);
    out
}

fn write(out: &mut String, report: &Report) -> std::fmt::Result {
    let problem = &report.problem;
    writeln!(out, "# Problem {}\n", problem.fingerprint)?;
    writeln!(out, "- Banda {}, {}", problem.version, report.system)?;
    writeln!(
        out,
        "- In the {}, {}, first {}, last {}\n",
        word(problem.source),
        match problem.times {
            1 => "once".to_owned(),
            times => format!("{times} times"),
        },
        utc(problem.first),
        utc(problem.last),
    )?;
    writeln!(
        out,
        "## What broke\n\n`{}`: {}",
        problem.kind, problem.message
    )?;
    if !problem.frames.is_empty() {
        writeln!(out, "\n## Where\n")?;
        for frame in &problem.frames {
            let at = frame.place();
            match frame.function.as_str() {
                "" => writeln!(out, "- `{at}`")?,
                function => writeln!(out, "- `{at}` in `{function}`")?,
            }
        }
    }
    for log in &report.logs {
        let lines = log.lines.join("\n");
        writeln!(
            out,
            "\n## The last lines of {}\n\n```text\n{lines}\n```",
            log.name
        )?;
    }
    Ok(())
}

/// `ms` since the epoch as a UTC minute: `2026-11-03 18:41 UTC`.
fn utc(ms: i64) -> String {
    let minutes = ms.div_euclid(60_000);
    let (days, minute) = (minutes.div_euclid(1440), minutes.rem_euclid(1440));
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year}-{month:02}-{day:02} {:02}:{:02} UTC",
        minute / 60,
        minute % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_time_is_said_as_a_utc_minute() {
        assert_eq!(utc(0), "1970-01-01 00:00 UTC");
        // 2026-11-03 17:41:30 UTC.
        assert_eq!(utc(1_793_727_690_000), "2026-11-03 17:41 UTC");
        assert_eq!(utc(951_782_400_000), "2000-02-29 00:00 UTC");
    }

    #[test]
    fn a_report_says_what_broke_where_and_the_logs_last_lines() {
        let report: Report = serde_json::from_value(json!({
            "problem": {
                "fingerprint": "7f3a91c0de12", "source": "page", "kind": "TypeError",
                "message": "reading 'undefined'", "version": "0.1.0", "times": 2,
                "first": 0, "last": 0,
                "frames": [{ "file": "browser/BrowserPane.tsx", "function": "title", "line": 83 }],
            },
            "system": "linux x86_64",
            "logs": [{ "name": "engine.log", "lines": ["line 149", "line 150"] }],
            "text": "",
        }))
        .unwrap();
        let text = markdown(&report);
        assert!(text.starts_with("# Problem 7f3a91c0de12\n"));
        assert!(text.contains("- Banda 0.1.0, linux x86_64\n- In the page, 2 times"));
        assert!(text.contains("`TypeError`: reading 'undefined'"));
        assert!(text.contains("- `browser/BrowserPane.tsx:83` in `title`"));
        assert!(
            text.contains("## The last lines of engine.log\n\n```text\nline 149\nline 150\n```")
        );
    }
}
