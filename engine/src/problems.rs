//! `banda problems`: what broke in Banda, and one Problem's report for an
//! Agent or an issue (ADR 0039, decision 1). The problems module gives the
//! report; this adds the channel and the workspaces by their Panes' kinds,
//! which are not the module's.

use crate::Failure;
use crate::client::Client;
use crate::places::{FOLDER, Places};
use banda_kernel::CommandId;
use banda_problems::Listed;
use banda_problems::model::Report;
use banda_workspaces::model::Arrangement;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

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

/// The module's report, and after it the workspaces by their Panes'
/// kinds, which are not the module's. A Pane's args are left out: they
/// hold the Person's work.
fn text(report: &Report, workspaces: &Arrangement) -> String {
    let mut out = report.text.clone();
    out.push_str(&format!(
        "\n## The workspaces of {FOLDER}, by their Panes' kinds\n\n"
    ));
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
        out.push_str(&format!("{}. {shown}\n", n + 1));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_report_ends_with_the_workspaces_by_kind_alone() {
        let report: Report = serde_json::from_value(json!({
            "problem": {
                "fingerprint": "7f3a91c0de12", "source": "page", "kind": "TypeError",
                "message": "reading 'undefined'", "version": "0.1.0", "times": 2,
                "first": 0, "last": 0, "frames": [],
            },
            "system": "linux x86_64",
            "logs": [],
            "text": "# Problem 7f3a91c0de12\n",
        }))
        .unwrap();
        let project = "01a19cce-59ae-71ca-98ff-62c04d57d3df";
        let pane = |kind: &str, args: Value| json!({ "id": "01a19d18-1bf4-7259-aa2f-4dd6e8fadf0d", "project": project, "kind": kind, "args": args });
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
        assert!(report.contains("1. agents.thread | browser.browser\n2. empty"));
        assert!(!report.contains("secret"), "no Pane's args: {report}");
    }
}
