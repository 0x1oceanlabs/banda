//! Reading pull requests from GitHub (ADR 0076, decision 2): one GraphQL
//! query for every pull request a Project links on one host, signed in as
//! the Person is. Through `gh`; where the fence holds, which runs no `gh`
//! an Agent could change (ADR 0083), the engine asks GitHub's API itself,
//! with the token gh keeps ([`banda_kernel::gh`]).

use crate::model::{Checks, Counted, PullRef, Review, Snapshot, State};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::time::Duration;

/// How long one read may take.
const LIMIT: Duration = Duration::from_secs(30);

/// Why GitHub could not be read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Missed {
    /// No `gh`, or no sign-in: the Person mends it, and the bar says
    /// nothing meanwhile.
    Person(String),
    /// GitHub asks Banda to wait.
    RateLimited,
    /// Anything else: the network, GitHub. It reads again later.
    Failed(String),
}

impl Missed {
    pub fn words(&self) -> String {
        match self {
            Missed::Person(words) | Missed::Failed(words) => words.clone(),
            Missed::RateLimited => "GitHub asks Banda to wait before reading again.".into(),
        }
    }
}

/// What one read found: each pull request asked that GitHub knows, and
/// the login of the account `gh` is signed in as.
pub struct Read {
    pub pulls: HashMap<PullRef, Snapshot>,
}

/// Reads `pulls`, all on one host, with the `gh` at `gh`, at `now`; where
/// the fence holds, from GitHub's API ([`asked_api`]).
pub async fn read(gh: &Path, pulls: &[PullRef], now: i64) -> Result<Read, Missed> {
    read_where(gh, pulls, now, banda_kernel::host::guarded(), api).await
}

/// [`read`], with `gh` where not `guarded`, else from the API at the
/// address `at` names for a host.
async fn read_where(
    gh: &Path,
    pulls: &[PullRef],
    now: i64,
    guarded: bool,
    at: impl Fn(&str) -> String,
) -> Result<Read, Missed> {
    let Some(host) = pulls.first().map(|pull| pull.host.clone()) else {
        return Ok(Read {
            pulls: HashMap::new(),
        });
    };
    let (query, names) = query(pulls);
    let answer = match guarded {
        true => asked_api(&at(&host), banda_kernel::gh::token(&host).await, &query).await?,
        false => asked_gh(gh, &host, &query).await?,
    };
    Ok(parse(&answer, &names, now))
}

/// The address of `host`'s GraphQL API: github.com's own, a GitHub
/// Enterprise Cloud's under `api.`, and a server's under `/api`.
fn api(host: &str) -> String {
    if host == banda_kernel::gh::GITHUB {
        return "https://api.github.com/graphql".to_owned();
    }
    match host.ends_with(".ghe.com") {
        true => format!("https://api.{host}/graphql"),
        false => format!("https://{host}/api/graphql"),
    }
}

/// Why GitHub could not be read, which the Person mends.
fn person(words: &str) -> Missed {
    Missed::Person(words.to_owned())
}

/// What the GraphQL API at `url` answers `query` with, asked with `token`.
async fn asked_api(url: &str, token: Option<String>, query: &str) -> Result<Value, Missed> {
    const SIGN_IN: &str = "Sign in to GitHub with `gh auth login` to see pull requests.";
    let token = token.ok_or_else(|| person(SIGN_IN))?;
    let client = banda_kernel::https::client().map_err(Missed::Failed)?;
    let body = serde_json::json!({ "query": query }).to_string();
    let asked = client
        .post(url)
        .bearer_auth(token)
        .header("Content-Type", "application/json")
        .timeout(LIMIT)
        .body(body)
        .send();
    let answer = match asked.await {
        Ok(answer) => answer,
        Err(error) if error.is_timeout() => {
            return Err(Missed::Failed("GitHub took too long to answer.".into()));
        }
        Err(error) => {
            let cause = banda_kernel::https::cause(&error);
            return Err(Missed::Failed(format!("GitHub could not be read: {cause}")));
        }
    };
    let status = answer.status().as_u16();
    let text = answer.text().await.unwrap_or_default();
    let read = serde_json::from_str::<Value>(&text).ok();
    match status {
        200..=299 => read.ok_or_else(|| Missed::Failed("GitHub's answer was not JSON.".into())),
        401 => Err(person(SIGN_IN)),
        _ if text.to_ascii_lowercase().contains("rate limit") => Err(Missed::RateLimited),
        _ => {
            let said = read.as_ref().and_then(|read| read["message"].as_str());
            let said = said.unwrap_or("it answered with an error").to_owned();
            Err(Missed::Failed(format!(
                "GitHub could not be read: {said} ({status})"
            )))
        }
    }
}

/// What the `gh` at `gh` answers `query` with on `host`.
async fn asked_gh(gh: &Path, host: &str, query: &str) -> Result<Value, Missed> {
    let missing = || {
        Missed::Person(
            "Banda reads pull requests with the GitHub CLI, gh, which is not installed.".into(),
        )
    };
    // Found on the host's PATH as it is now, as the engine finds its own.
    let mut command = banda_kernel::host::own(gh).map_err(|_| missing())?;
    command
        .args(["api", "graphql", "--hostname", host, "-f"])
        .arg(format!("query={query}"))
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .stdin(std::process::Stdio::null());
    let output = match tokio::time::timeout(LIMIT, command.output()).await {
        Err(_) => return Err(Missed::Failed("GitHub took too long to answer.".into())),
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => return Err(missing()),
        Ok(Err(error)) => return Err(Missed::Failed(format!("gh did not run: {error}"))),
        Ok(Ok(output)) => output,
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        // GitHub answers a pull request it does not know with an error,
        // and the others still.
        if let Ok(answer) = serde_json::from_str::<Value>(&stdout)
            && answer.get("data").is_some_and(|data| !data.is_null())
        {
            return Ok(answer);
        }
        return Err(missed(&stderr, &stdout));
    }
    serde_json::from_str(&stdout)
        .map_err(|_| Missed::Failed("GitHub's answer was not JSON.".into()))
}

/// What `gh`'s words say went wrong.
fn missed(stderr: &str, stdout: &str) -> Missed {
    let said = format!("{stderr}\n{stdout}").to_ascii_lowercase();
    if said.contains("rate limit") {
        return Missed::RateLimited;
    }
    if said.contains("gh auth login") || said.contains("not logged") || said.contains("401") {
        return Missed::Person(
            "Sign in to GitHub with `gh auth login` to see pull requests.".into(),
        );
    }
    let line = stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("gh failed");
    Missed::Failed(format!("GitHub could not be read: {line}"))
}

/// The fields read of each pull request.
const FIELDS: &str = "number url title state isDraft headRefName baseRefName additions deletions \
updatedAt mergedAt closedAt mergeable reviewDecision autoMergeRequest { enabledAt } \
reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } } \
commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { \
__typename ... on CheckRun { name status conclusion startedAt completedAt \
checkSuite { workflowRun { workflow { name } } } } \
... on StatusContext { context state createdAt } } } } } } }";

/// One query for every pull request in `pulls`, and the alias each is
/// answered under: `r0 { p0 }`. A name GitHub would not take is left out.
fn query(pulls: &[PullRef]) -> (String, BTreeMap<(String, String), PullRef>) {
    let mut repos: BTreeMap<&str, Vec<&PullRef>> = BTreeMap::new();
    for pull in pulls {
        repos.entry(pull.repo.as_str()).or_default().push(pull);
    }
    let mut names = BTreeMap::new();
    let mut query = String::from("query { viewer { login } ");
    for (r, (repo, pulls)) in repos.into_iter().enumerate() {
        let Some((owner, name)) = repo.split_once('/') else {
            continue;
        };
        let plain = |part: &str| {
            part.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        };
        if !plain(owner) || !plain(name) {
            continue;
        }
        query.push_str(&format!(
            "r{r}: repository(owner: \"{owner}\", name: \"{name}\") {{ "
        ));
        for (p, pull) in pulls.into_iter().enumerate() {
            query.push_str(&format!(
                "p{p}: pullRequest(number: {}) {{ {FIELDS} }} ",
                pull.number
            ));
            names.insert((format!("r{r}"), format!("p{p}")), pull.clone());
        }
        query.push_str("} ");
    }
    query.push('}');
    (query, names)
}

/// Each pull request GitHub answered, by the aliases it was asked under.
fn parse(answer: &Value, names: &BTreeMap<(String, String), PullRef>, now: i64) -> Read {
    let data = &answer["data"];
    let viewer = data["viewer"]["login"].as_str().unwrap_or_default();
    let pulls = names
        .iter()
        .filter_map(|((r, p), pull)| {
            let node = &data[r][p];
            snapshot(node, viewer, now).map(|snapshot| (pull.clone(), snapshot))
        })
        .collect();
    Read { pulls }
}

/// One pull request as GitHub's answer has it.
fn snapshot(node: &Value, viewer: &str, now: i64) -> Option<Snapshot> {
    let state = match node["state"].as_str()? {
        "MERGED" => State::Merged,
        "CLOSED" => State::Closed,
        _ => State::Open,
    };
    let text = |field: &str| node[field].as_str().unwrap_or_default().to_owned();
    let count = |field: &str| u32::try_from(node[field].as_u64().unwrap_or(0)).unwrap_or(u32::MAX);
    let contexts = &node["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["contexts"]["nodes"];
    let (checks, counted) = rollup(contexts.as_array().map(Vec::as_slice).unwrap_or_default());
    let review = match node["reviewDecision"].as_str() {
        Some("APPROVED") => Some(Review::Approved),
        Some("CHANGES_REQUESTED") => Some(Review::ChangesRequested),
        Some("REVIEW_REQUIRED") => Some(Review::Required),
        _ => None,
    };
    let asked_of_you = !viewer.is_empty()
        && node["reviewRequests"]["nodes"]
            .as_array()
            .is_some_and(|asked| {
                asked
                    .iter()
                    .any(|a| a["requestedReviewer"]["login"].as_str() == Some(viewer))
            });
    Some(Snapshot {
        state,
        draft: node["isDraft"].as_bool().unwrap_or(false),
        title: text("title"),
        head: text("headRefName"),
        base: text("baseRefName"),
        checks,
        counted,
        review,
        asked_of_you,
        conflicts: node["mergeable"].as_str() == Some("CONFLICTING"),
        auto_merge: !node["autoMergeRequest"].is_null(),
        additions: count("additions"),
        deletions: count("deletions"),
        updated_at: time(&node["updatedAt"]).unwrap_or(now),
        merged_at: time(&node["mergedAt"]),
        closed_at: time(&node["closedAt"]),
        synced_at: now,
    })
}

/// How a check ended, once its re-runs are counted once.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Ended {
    Passed,
    Failed,
    Running,
    /// Skipped or neutral: it counts, and says nothing.
    Quiet,
}

/// The checks summed up (ADR 0076, decision 2): any failure or cancel is
/// failing, else any still running is running, else any success is
/// passing. A check run again counts once, its newest run.
pub fn rollup(contexts: &[Value]) -> (Option<Checks>, Counted) {
    let mut newest: HashMap<String, (String, Ended)> = HashMap::new();
    for context in contexts {
        let (key, when, ended) = if context["__typename"] == "StatusContext" {
            let ended = match context["state"].as_str() {
                Some("SUCCESS") => Ended::Passed,
                Some("FAILURE" | "ERROR") => Ended::Failed,
                _ => Ended::Running,
            };
            let key = context["context"].as_str().unwrap_or_default().to_owned();
            (key, context["createdAt"].as_str(), ended)
        } else {
            let ended = if context["status"].as_str() != Some("COMPLETED") {
                Ended::Running
            } else {
                match context["conclusion"].as_str() {
                    Some("SUCCESS") => Ended::Passed,
                    Some("FAILURE" | "CANCELLED" | "TIMED_OUT" | "STARTUP_FAILURE") => {
                        Ended::Failed
                    }
                    Some("ACTION_REQUIRED") => Ended::Running,
                    _ => Ended::Quiet,
                }
            };
            let workflow = context["checkSuite"]["workflowRun"]["workflow"]["name"]
                .as_str()
                .unwrap_or_default();
            let name = context["name"].as_str().unwrap_or_default();
            (
                format!("{workflow}/{name}"),
                context["startedAt"].as_str(),
                ended,
            )
        };
        let when = when.unwrap_or_default().to_owned();
        match newest.get(&key) {
            Some((was, _)) if *was > when => {}
            _ => {
                newest.insert(key, (when, ended));
            }
        }
    }
    let mut counted = Counted::default();
    for (_, ended) in newest.values() {
        counted.total += 1;
        match ended {
            Ended::Passed => counted.passed += 1,
            Ended::Failed => counted.failed += 1,
            Ended::Running => counted.running += 1,
            Ended::Quiet => {}
        }
    }
    let checks = if counted.failed > 0 {
        Some(Checks::Failing)
    } else if counted.running > 0 {
        Some(Checks::Running)
    } else if counted.passed > 0 {
        Some(Checks::Passing)
    } else {
        None
    };
    (checks, counted)
}

/// GitHub's `2026-11-06T10:00:00Z`, in ms since the epoch.
fn time(value: &Value) -> Option<i64> {
    let text = value.as_str()?;
    let (date, clock) = text.trim_end_matches('Z').split_once('T')?;
    let mut date = date.split('-').map(str::parse::<i64>);
    let (year, month, day) = (date.next()?.ok()?, date.next()?.ok()?, date.next()?.ok()?);
    let clock = clock.split('.').next()?;
    let mut clock = clock.split(':').map(str::parse::<i64>);
    let (hour, minute, second) = (
        clock.next()?.ok()?,
        clock.next()?.ok()?,
        clock.next()?.ok()?,
    );
    // Days from the civil date, as Howard Hinnant's algorithm counts them.
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sums_up_the_checks_a_re_run_counted_once() {
        let run = |name: &str, started: &str, status: &str, conclusion: Value| {
            json!({"__typename": "CheckRun", "name": name, "status": status,
                   "conclusion": conclusion, "startedAt": started,
                   "checkSuite": {"workflowRun": {"workflow": {"name": "CI"}}}})
        };
        // e2e failed, then passed when run again.
        let contexts = [
            run("e2e", "2026-11-06T10:00:00Z", "COMPLETED", json!("FAILURE")),
            run("e2e", "2026-11-06T10:20:00Z", "COMPLETED", json!("SUCCESS")),
            run(
                "lint",
                "2026-11-06T10:00:00Z",
                "COMPLETED",
                json!("SUCCESS"),
            ),
            run(
                "docs",
                "2026-11-06T10:00:00Z",
                "COMPLETED",
                json!("SKIPPED"),
            ),
        ];
        let (checks, counted) = rollup(&contexts);
        assert_eq!(checks, Some(Checks::Passing));
        assert_eq!((counted.passed, counted.failed, counted.total), (2, 0, 3));

        let mut contexts = contexts.to_vec();
        contexts.push(run(
            "macos",
            "2026-11-06T10:30:00Z",
            "IN_PROGRESS",
            Value::Null,
        ));
        assert_eq!(rollup(&contexts).0, Some(Checks::Running));
        contexts.push(
            json!({"__typename": "StatusContext", "context": "ci/legacy",
                             "state": "ERROR", "createdAt": "2026-11-06T10:00:00Z"}),
        );
        assert_eq!(rollup(&contexts).0, Some(Checks::Failing));
        assert_eq!(rollup(&[]).0, None);
    }

    #[test]
    fn reads_github_s_time() {
        assert_eq!(time(&json!("1970-01-01T00:00:00Z")), Some(0));
        assert_eq!(
            time(&json!("2026-11-06T10:00:00Z")),
            Some(1_793_959_200_000)
        );
        assert_eq!(time(&json!(null)), None);
    }

    #[test]
    fn asks_for_every_pull_request_in_one_query() {
        let pull = |repo: &str, number| PullRef {
            host: "github.com".into(),
            repo: repo.into(),
            number,
        };
        let pulls = [
            pull("o/a", 1),
            pull("o/a", 2),
            pull("o/b", 3),
            pull("o/b\"x", 4),
        ];
        let (query, names) = query(&pulls);
        assert!(query.contains("r0: repository(owner: \"o\", name: \"a\")"));
        assert!(query.contains("p1: pullRequest(number: 2)"));
        assert!(
            !query.contains("b\"x"),
            "a name GitHub would not take is left out"
        );
        assert_eq!(names.len(), 3);
    }

    #[test]
    fn tells_what_went_wrong() {
        assert_eq!(
            missed("API rate limit exceeded for user", ""),
            Missed::RateLimited
        );
        assert!(matches!(
            missed(
                "To get started with GitHub CLI, please run:  gh auth login",
                ""
            ),
            Missed::Person(_)
        ));
        assert!(matches!(
            missed("dial tcp: no route", ""),
            Missed::Failed(_)
        ));
    }

    #[test]
    fn each_host_s_api_is_where_github_serves_it() {
        assert_eq!(api("github.com"), "https://api.github.com/graphql");
        assert_eq!(api("acme.ghe.com"), "https://api.acme.ghe.com/graphql");
        assert_eq!(
            api("git.corp.example"),
            "https://git.corp.example/api/graphql"
        );
    }

    /// An API on a port of this machine that answers one request with
    /// `status` and `body`, and hands back what it was asked.
    async fn api_answering(
        status: u16,
        body: &'static str,
    ) -> (String, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/graphql", listener.local_addr().unwrap());
        let heard = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut asked = Vec::new();
            let mut chunk = [0u8; 4096];
            // The head, then as much of the body as it says it has.
            loop {
                let read = stream.read(&mut chunk).await.unwrap();
                asked.extend_from_slice(&chunk[..read]);
                let text = String::from_utf8_lossy(&asked).into_owned();
                if let Some((head, rest)) = text.split_once("\r\n\r\n") {
                    let length = (head.lines())
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .map(str::to_owned)
                        })
                        .and_then(|length| length.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if rest.len() >= length || read == 0 {
                        break;
                    }
                }
            }
            let answer = format!(
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(answer.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&asked).into_owned()
        });
        (url, heard)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn where_the_fence_holds_github_is_asked_with_gh_s_token_and_no_gh_runs() {
        use std::os::unix::fs::PermissionsExt;
        let folder = tempfile::tempdir().unwrap();
        // A `gh` an Agent could have written: it leaves a mark if it runs.
        let gh = folder.path().join("gh");
        let ran = folder.path().join("ran");
        let script = format!(
            "#!/bin/sh\ntouch '{}'\necho '{{\"data\":{{}}}}'\n",
            ran.display()
        );
        std::fs::write(&gh, script).unwrap();
        std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755)).unwrap();
        let answer =
            r#"{"data":{"viewer":{"login":"octo"},"r0":{"p0":{"state":"OPEN","title":"Fix"}}}}"#;
        let (url, heard) = api_answering(200, answer).await;
        banda_kernel::gh::keep("api.test", Some("t0ken".to_owned()));
        let pull = PullRef {
            host: "api.test".into(),
            repo: "o/r".into(),
            number: 7,
        };
        let read = read_where(&gh, std::slice::from_ref(&pull), 0, true, |_| url.clone()).await;
        let read = read.unwrap();
        assert_eq!(read.pulls[&pull].title, "Fix");
        let asked = heard.await.unwrap();
        assert!(
            asked.contains("authorization: Bearer t0ken")
                || asked.contains("Authorization: Bearer t0ken")
        );
        assert!(asked.contains("pullRequest(number: 7)"));
        assert!(!ran.exists(), "no gh ran where the fence holds");
        // Signed out: no request, and the Person's words.
        banda_kernel::gh::keep("api.test", None);
        let read = read_where(&gh, std::slice::from_ref(&pull), 0, true, |_| url.clone()).await;
        assert!(matches!(read, Err(Missed::Person(_))));
        // Where it does not hold, the Person's gh reads them, as before.
        let read = read_where(&gh, &[pull], 0, false, |_| unreachable!()).await;
        assert!(read.is_ok());
        assert!(ran.exists());
    }

    #[tokio::test]
    async fn the_api_s_refusals_are_told_apart() {
        let (url, _) = api_answering(401, r#"{"message":"Bad credentials"}"#).await;
        let asked = asked_api(&url, Some("t".to_owned()), "query { viewer { login } }").await;
        assert!(matches!(asked, Err(Missed::Person(_))));
        let (url, _) = api_answering(403, r#"{"message":"API rate limit exceeded"}"#).await;
        let asked = asked_api(&url, Some("t".to_owned()), "query { viewer { login } }").await;
        assert_eq!(asked, Err(Missed::RateLimited));
        let (url, _) = api_answering(502, "{}").await;
        let asked = asked_api(&url, Some("t".to_owned()), "query { viewer { login } }").await;
        assert!(matches!(asked, Err(Missed::Failed(_))));
    }
}
