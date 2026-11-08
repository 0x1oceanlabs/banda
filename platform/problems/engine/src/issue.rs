//! The one thing Banda's Problems send anywhere: an issue the Person sends
//! to Banda on GitHub, as an Agent drafted it (ADR 0039, decisions 1 and
//! 3). With `gh` signed in, it is filed, or its comment on the issue that
//! has the fingerprint; without, the window opens GitHub's page that
//! sends it from the browser, filled in.

use crate::model::Fingerprint;
use banda_kernel::Refusal;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use ts_rs::TS;

/// Banda's repository on GitHub.
const REPO: &str = "0x1oceanlabs/banda";

/// An issue about a Problem, as the Person sends it.
#[derive(Deserialize, TS)]
#[ts(export_to = "problems/")]
pub struct Issue {
    #[serde(flatten)]
    #[ts(flatten)]
    pub problem: Fingerprint,
    pub title: String,
    pub body: String,
    /// The issue that has the fingerprint already, to comment on instead.
    #[serde(default)]
    #[ts(optional)]
    pub comment_on: Option<u32>,
}

/// Where it went: filed by `gh`, or a page for the window to open.
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "problems/")]
pub struct Sent {
    pub url: String,
    /// `gh` filed it; else `url` sends it from the browser.
    pub filed: bool,
}

/// GitHub's own limits: a title's, and a body's.
const TITLE_MOST: usize = 256;
const BODY_MOST: usize = 65_536;

/// Whether an issue may be sent as it is.
pub fn may_send(issue: &Issue) -> Result<(), Refusal> {
    let Issue { title, body, .. } = issue;
    if title.trim().is_empty() || title.len() > TITLE_MOST * 4 || title.chars().count() > TITLE_MOST
    {
        return Err(Refusal::invalid(format!(
            "An issue's title is 1 to {TITLE_MOST} characters."
        )));
    }
    if body.len() > BODY_MOST || body.trim().is_empty() {
        return Err(Refusal::invalid(format!(
            "An issue's body is 1 to {BODY_MOST} bytes."
        )));
    }
    Ok(())
}

/// Files `issue` with the `gh` at `gh`; without one signed in, the page
/// that sends it from the browser.
pub async fn send(gh: &Path, issue: &Issue) -> Sent {
    match filed(gh, issue).await {
        Some(url) => Sent { url, filed: true },
        None => Sent {
            url: page(issue),
            filed: false,
        },
    }
}

/// How long `gh` may take to file it.
const GH_WAIT: Duration = Duration::from_secs(30);

/// What `gh` prints as it files it: the issue's address, or the
/// comment's; none when it could not.
async fn filed(gh: &Path, issue: &Issue) -> Option<String> {
    // Found on the host's PATH as it is now, as the engine finds its own.
    let mut command = banda_kernel::host::own(gh).ok()?;
    match issue.comment_on {
        Some(number) => command.args(["issue", "comment", &number.to_string()]),
        None => command.args(["issue", "create", "--title", &issue.title]),
    };
    command
        .args(["--repo", REPO, "--body-file", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().ok()?;
    let mut stdin = child.stdin.take()?;
    let body = issue.body.clone();
    // The body is written while `gh` runs, within its wait: a `gh` that
    // reads nothing does not hold it.
    let written = async move {
        let wrote = stdin.write_all(body.as_bytes()).await;
        drop(stdin);
        wrote
    };
    let (wrote, out) = tokio::time::timeout(GH_WAIT, async {
        tokio::join!(written, child.wait_with_output())
    })
    .await
    .ok()?;
    let out = out.ok()?;
    wrote.ok()?;
    let printed = String::from_utf8_lossy(&out.stdout);
    let url = printed
        .lines()
        .rev()
        .find(|line| line.starts_with("https://"))?;
    out.status.success().then(|| url.trim().to_owned())
}

/// The most of an address a browser takes well.
const ADDRESS_MOST: usize = 7000;

/// What an address's query keeps as it is: letters, digits and `-._~`.
const QUERY: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

fn encoded(text: &str) -> String {
    utf8_percent_encode(text, QUERY).to_string()
}

/// GitHub's page that sends it from the browser: the bug form filled in,
/// or the issue to comment on.
fn page(issue: &Issue) -> String {
    let issues = format!("https://github.com/{REPO}/issues");
    if let Some(number) = issue.comment_on {
        return format!("{issues}/{number}");
    }
    let fingerprint = &issue.problem.fingerprint;
    let head = format!(
        "{issues}/new?template=bug.yml&title={}&fingerprint={}&what=",
        encoded(&issue.title),
        encoded(fingerprint)
    );
    let body = &issue.body;
    let whole = encoded(body);
    if head.len() + whole.len() <= ADDRESS_MOST {
        return head + &whole;
    }
    // Too long for an address: as much of its start as fits, and where
    // the rest is.
    let rest = encoded(&format!(
        "\n\n…the rest: `banda problems report {fingerprint}`."
    ));
    let room = ADDRESS_MOST.saturating_sub(head.len() + rest.len());
    let mut used = 0;
    let cut = body
        .char_indices()
        .find(|&(_, c)| {
            used += match c {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '.' | '_' | '~' => 1,
                _ => 3 * c.len_utf8(),
            };
            used > room
        })
        .map_or(body.len(), |(at, _)| at);
    head + &encoded(&body[..cut]) + &rest
}

#[cfg(test)]
mod tests {
    use super::*;

    fn issue(title: &str, body: &str, comment_on: Option<u32>) -> Issue {
        Issue {
            problem: Fingerprint {
                fingerprint: "3124".to_owned(),
            },
            title: title.to_owned(),
            body: body.to_owned(),
            comment_on,
        }
    }

    #[test]
    fn the_browser_gets_the_bug_form_filled_in_or_the_issue_to_comment_on() {
        assert_eq!(
            page(&issue("Tabs break", "a & b\nc", None)),
            "https://github.com/0x1oceanlabs/banda/issues/new?template=bug.yml\
             &title=Tabs%20break&fingerprint=3124&what=a%20%26%20b%0Ac"
        );
        assert_eq!(
            page(&issue("t", "b", Some(398))),
            "https://github.com/0x1oceanlabs/banda/issues/398"
        );
        let long = page(&issue("t", &"й".repeat(5000), None));
        assert!(long.len() <= ADDRESS_MOST, "{}", long.len());
        assert!(long.ends_with(&encoded("…the rest: `banda problems report 3124`.")));
    }

    #[test]
    fn an_issue_needs_a_title_and_a_body() {
        assert!(may_send(&issue("Tabs break", "body", None)).is_ok());
        assert!(may_send(&issue(" ", "body", None)).is_err());
        assert!(may_send(&issue(&"t".repeat(257), "body", None)).is_err());
        assert!(may_send(&issue("t", "", None)).is_err());
    }
}
