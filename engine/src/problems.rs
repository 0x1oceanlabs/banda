//! `banda problems`: what broke in Banda, and one Problem's report for an
//! Agent or an issue (ADR 0039, decision 1). The problems module gives the
//! Problem with the system and the logs' last lines; this adds the channel
//! and the workspaces by their Panes' kinds, which are not the module's.

use crate::Failure;
use crate::client::Client;
use crate::places::{FOLDER, Places};
use banda_kernel::CommandId;
use banda_problems::Listed;
use banda_problems::model::Report;
use banda_workspaces::model::Arrangement;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::fmt::Write as _;

/// Prints each Problem, the newest first, one JSON object per line.
pub async fn list(places: &Places) -> Result<(), Failure> {
    let mut client = Client::connect(places).await?;
    let listed: Listed = ask(&mut client, "problems.list", json!({})).await?;
    for problem in listed.problems {
        println!("{}", json!(problem));
    }
    Ok(())
}

/// Prints the report of the Problem whose fingerprint starts with `start`.
pub async fn report(places: &Places, start: &str) -> Result<(), Failure> {
    let mut client = Client::connect(places).await?;
    let report = ask(
        &mut client,
        "problems.problem",
        json!({ "fingerprint": start }),
    );
    let report: Report = report.await?;
    let mut arranged: Value = ask(&mut client, "workspaces.list", json!({})).await?;
    let workspaces: Arrangement =
        serde_json::from_value(arranged["workspaces"].take()).map_err(Failure::broken)?;
    print!("{}", text(&report, &workspaces));
    Ok(())
}

async fn ask<T: DeserializeOwned>(
    client: &mut Client,
    method: &str,
    params: Value,
) -> Result<T, Failure> {
    let answer = client.call(method, None, CommandId::new(), params).await?;
    serde_json::from_value(answer).map_err(Failure::broken)
}

/// The report, in Markdown, for an Agent to read or an issue to hold. A
/// Pane's args are left out: they hold the Person's work.
fn text(report: &Report, workspaces: &Arrangement) -> String {
    let mut out = String::new();
    // Writing to a String does not fail.
    let _ = write(&mut out, report, workspaces);
    out
}

fn write(out: &mut String, report: &Report, workspaces: &Arrangement) -> std::fmt::Result {
    let problem = &report.problem;
    writeln!(out, "# Problem {}\n", problem.fingerprint)?;
    writeln!(
        out,
        "- Banda {} ({FOLDER}), {}",
        problem.version, report.system
    )?;
    writeln!(
        out,
        "- In the {}, {}, first {}, last {}\n",
        banda_problems::model::word(problem.source),
        match problem.times {
            1 => "once".to_owned(),
            times => format!("{times} times"),
        },
        utc(problem.first),
        utc(problem.last),
    )?;
    writeln!(
        out,
        "## What broke\n\n`{}`: {}\n",
        problem.kind, problem.message
    )?;
    if !problem.frames.is_empty() {
        writeln!(out, "## Where\n")?;
        for frame in &problem.frames {
            let at = match frame.line {
                Some(line) => format!("{}:{line}", frame.file),
                None => frame.file.clone(),
            };
            match frame.function.as_str() {
                "" => writeln!(out, "- `{at}`")?,
                function => writeln!(out, "- `{at}` in `{function}`")?,
            }
        }
        out.push('\n');
    }
    writeln!(out, "## The workspaces, by their Panes' kinds\n")?;
    for (n, workspace) in workspaces.iter().enumerate() {
        let columns: Vec<String> = workspace
            .columns
            .iter()
            .map(|column| {
                let kinds: Vec<&str> = column.panes.iter().map(|p| p.shows.kind.as_str()).collect();
                kinds.join(", ")
            })
            .collect();
        let shown = match columns.is_empty() {
            true => "empty".to_owned(),
            false => columns.join(" | "),
        };
        writeln!(out, "{}. {shown}", n + 1)?;
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

    #[test]
    fn a_time_is_said_as_a_utc_minute() {
        assert_eq!(utc(0), "1970-01-01 00:00 UTC");
        // 2026-11-03 17:41:30 UTC.
        assert_eq!(utc(1_793_727_690_000), "2026-11-03 17:41 UTC");
        assert_eq!(utc(951_782_400_000), "2000-02-29 00:00 UTC");
    }

    #[test]
    fn a_report_says_what_broke_where_and_the_workspaces_by_kind_alone() {
        let report: Report = serde_json::from_value(json!({
            "problem": {
                "fingerprint": "7f3a91c0de12", "source": "page", "kind": "TypeError",
                "message": "reading 'undefined'", "version": "0.1.0", "times": 2,
                "first": 0, "last": 0,
                "frames": [{ "file": "browser/BrowserPane.tsx", "function": "title", "line": 83 }],
            },
            "system": "linux x86_64",
            "logs": [{ "name": "engine.log", "lines": ["line 149", "line 150"] }],
        }))
        .unwrap();
        let space = "01a19cce-59ae-71ca-98ff-62c04d57d3df";
        let pane = |kind: &str, args: Value| json!({ "id": "01a19d18-1bf4-7259-aa2f-4dd6e8fadf0d", "space": space, "kind": kind, "args": args });
        let workspaces: Arrangement = serde_json::from_value(json!([
            { "id": "01a19cce-59f6-7e98-9259-00f0078ee133", "columns": [
                { "id": "01a19d18-1bf4-7259-aa2f-4dd7408c298e",
                  "panes": [pane("agents.thread", json!({ "thread": "secret" }))] },
                { "id": "01a19d18-1bf4-7259-aa2f-4dd7408c298f",
                  "panes": [pane("browser.browser", json!({ "url": "https://secret.test" }))] },
            ] },
            { "id": "01a19ccd-ce5f-76e0-9d59-a96c5cb41bc5", "columns": [] },
        ]))
        .unwrap();
        let report = text(&report, &workspaces);
        assert!(report.starts_with("# Problem 7f3a91c0de12\n"));
        assert!(report.contains("linux x86_64"));
        assert!(report.contains("`TypeError`: reading 'undefined'"));
        assert!(report.contains("- `browser/BrowserPane.tsx:83` in `title`"));
        assert!(report.contains("1. agents.thread | browser.browser\n2. empty"));
        assert!(!report.contains("secret"), "no Pane's args: {report}");
        assert!(
            report.contains("## The last lines of engine.log\n\n```text\nline 149\nline 150\n```")
        );
    }
}
