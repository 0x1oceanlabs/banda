//! The pulls module through the kernel, with a `gh` of the test's own that
//! answers as GitHub would: links made by the Person, by an Agent's tool
//! and by its own `gh pr create`, read and judged, and let go of.

#[cfg(unix)]
use banda_kernel::AgentId;
use banda_kernel::{
    Call, CommandId, Kernel, Kind, Module, Participant, PersonId, ProjectId, Refusal, Right,
};
use banda_pulls::Pulls;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
#[cfg(unix)]
use std::time::Duration;

/// The agents module as pulls hears it: `say { kind, thread, … }` writes
/// the fact `kind` about `thread`, by whoever calls.
struct Agents;

#[async_trait::async_trait]
impl Module for Agents {
    fn name(&self) -> &'static str {
        "agents"
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, _: &str) -> Option<Right> {
        Some(Right::Write)
    }

    fn kind(&self, _: &str) -> Option<Kind> {
        Some(Kind::Command)
    }

    async fn call(&self, call: Call, _: &str, fact: Value) -> Result<Value, Refusal> {
        let by = call.participant();
        call.command(move |tx| {
            let (kind, thread) = (fact["kind"].as_str().unwrap(), fact["thread"].as_str());
            tx.emit(kind, 1, thread, by, &fact["payload"])?;
            Ok(())
        })
        .await?;
        Ok(Value::Null)
    }
}

struct World {
    kernel: Arc<Kernel>,
    owner: PersonId,
    project: ProjectId,
    _root: tempfile::TempDir,
}

/// GitHub's answer for one pull request, `r0.p0`: its checks failed.
#[cfg(unix)]
fn answer(number: u32) -> Value {
    let check = |name: &str, conclusion: &str| {
        json!({"__typename": "CheckRun", "name": name, "status": "COMPLETED",
               "conclusion": conclusion, "startedAt": "2026-11-06T10:00:00Z",
               "checkSuite": {"workflowRun": {"workflow": {"name": "CI"}}}})
    };
    let contexts = json!({"nodes": [check("e2e", "FAILURE"), check("lint", "SUCCESS")]});
    let commits = json!({"nodes": [{"commit": {"statusCheckRollup": {"contexts": contexts}}}]});
    let asked = json!({"nodes": [{"requestedReviewer": {"login": "roma"}}]});
    let pull = json!({
        "number": number, "url": format!("https://github.com/o/r/pull/{number}"),
        "title": "feat: the bar", "state": "OPEN", "isDraft": false,
        "headRefName": "feat/bar", "baseRefName": "main",
        "additions": 12, "deletions": 3,
        "updatedAt": "2026-11-06T10:00:00Z", "mergedAt": null, "closedAt": null,
        "mergeable": "MERGEABLE", "reviewDecision": null, "autoMergeRequest": null,
        "reviewRequests": asked, "commits": commits,
    });
    json!({"data": {"viewer": {"login": "roma"}, "r0": {"p0": pull}}})
}

/// A `gh` that prints `answer` and counts its runs in `runs` beside it.
#[cfg(unix)]
fn gh(root: &Path, answer: &Value) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = root.join("gh");
    std::fs::write(root.join("answer.json"), answer.to_string()).unwrap();
    let script = format!(
        "#!/bin/sh\necho run >> '{runs}'\ncat '{answer}'\n",
        runs = root.join("runs").display(),
        answer = root.join("answer.json").display()
    );
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

impl World {
    async fn new(gh: impl FnOnce(&Path) -> PathBuf) -> World {
        let root = tempfile::tempdir().unwrap();
        let owner = PersonId::new();
        let gh = gh(root.path());
        let kernel = Kernel::builder(
            root.path().join("projects"),
            root.path().join(".data"),
            owner,
        )
        .module(Pulls::new().gh(gh))
        .module(Agents)
        .open()
        .await
        .unwrap();
        let made = kernel
            .call(
                Participant::Person(owner),
                "projects.create",
                None,
                Some(CommandId::new()),
                json!({ "name": "Work" }),
            )
            .await
            .unwrap();
        let project: ProjectId = serde_json::from_value(made["id"].clone()).unwrap();
        let folder = kernel
            .project(project)
            .await
            .unwrap()
            .folder()
            .to_path_buf();
        let git = |args: &[&str]| {
            let done = Command::new("git")
                .args(args)
                .current_dir(&folder)
                .output()
                .unwrap();
            assert!(done.status.success(), "git {args:?}");
        };
        git(&["init", "--quiet"]);
        git(&["remote", "add", "origin", "git@github.com:o/r.git"]);
        World {
            kernel,
            owner,
            project,
            _root: root,
        }
    }

    fn person(&self) -> Participant {
        Participant::Person(self.owner)
    }

    async fn call(&self, by: Participant, method: &str, params: Value) -> Result<Value, Refusal> {
        let commands = ["pulls.link", "pulls.unlink", "agents.say"];
        let command = commands.contains(&method).then(CommandId::new);
        self.kernel
            .call(by, method, Some(self.project), command, params)
            .await
    }

    async fn list(&self) -> Value {
        self.call(self.person(), "pulls.list", json!({}))
            .await
            .unwrap()
    }

    /// The list once `until` holds of it, within five seconds.
    #[cfg(unix)]
    async fn list_until(&self, until: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..100 {
            let listed = self.list().await;
            if until(&listed) {
                return listed;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("the list never came: {}", self.list().await);
    }
}

#[cfg(unix)]
fn runs(root: &Path) -> usize {
    std::fs::read_to_string(root.join("runs"))
        .map(|text| text.lines().count())
        .unwrap_or(0)
}

#[cfg(unix)]
#[tokio::test]
async fn the_person_links_a_pull_request_and_sees_what_it_needs() {
    let world = World::new(|root| gh(root, &answer(5))).await;
    let linked = world
        .call(
            world.person(),
            "pulls.link",
            json!({ "pull": "#5", "thread": "t1" }),
        )
        .await
        .unwrap();
    assert_eq!(linked["repo"], "o/r");
    assert_eq!(linked["number"], 5);
    // A `gh` run beside another test's fork may find its script busy:
    // the next list reads it again.
    let listed = world
        .list_until(|listed| !listed["pulls"][0]["turn"].is_null())
        .await;
    let linked = &listed["pulls"][0];
    assert_eq!(linked["by"], "person");
    assert_eq!(linked["auto_fix"], false);
    assert_eq!(linked["snapshot"]["checks"], "failing");
    assert_eq!(linked["snapshot"]["counted"]["failed"], 1);
    assert_eq!(linked["snapshot"]["asked_of_you"], true);
    assert_eq!(linked["need"], "failing");
    // Linked by the Person, nothing tells an Agent: the Person's turn.
    assert_eq!(linked["turn"], "person");

    // Read once; the list reads it no more until it is due.
    let read = runs(world._root.path());
    let listed = world.list().await;
    assert_eq!(listed["pulls"].as_array().unwrap().len(), 1);
    assert_eq!(runs(world._root.path()), read);

    // A watch says the list as it is.
    let mut watch = world
        .kernel
        .stream(
            world.person(),
            "pulls.watch",
            Some(world.project),
            json!({}),
        )
        .await
        .unwrap();
    let first = tokio::time::timeout(Duration::from_secs(5), watch.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first["pulls"][0]["number"], 5);

    let thread = world
        .call(
            world.person(),
            "pulls.list_thread",
            json!({ "thread": "t1" }),
        )
        .await
        .unwrap();
    assert_eq!(thread.as_array().unwrap().len(), 1);

    world
        .call(
            world.person(),
            "pulls.unlink",
            json!({ "pull": "https://github.com/o/r/pull/5", "thread": "t1" }),
        )
        .await
        .unwrap();
    assert!(world.list().await["pulls"].as_array().unwrap().is_empty());
    let again = world
        .call(
            world.person(),
            "pulls.unlink",
            json!({ "pull": "#5", "thread": "t1" }),
        )
        .await;
    assert!(
        again.is_err(),
        "a pull request not linked is not let go of twice"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn an_agent_s_gh_pr_create_links_what_it_made_once() {
    let world = World::new(|root| gh(root, &answer(7))).await;
    let agent = Participant::Agent(AgentId::new());
    let say =
        |kind: &str, payload: Value| json!({ "kind": kind, "thread": "t2", "payload": payload });
    let facts = [
        say("turn.started", json!({ "turn": "u1" })),
        say(
            "tool.started",
            json!({ "item": "i1", "turn": "u1", "title": "git push -u origin HEAD && gh pr create --fill",
                    "tool": "execute", "status": "running", "content": [] }),
        ),
        say(
            "tool.output",
            json!({ "item": "i1", "text": "https://github.com/o/r/pull/7\n", "cut": false }),
        ),
        say(
            "tool.changed",
            json!({ "item": "i1", "status": "done", "exit": { "code": 0 } }),
        ),
    ];
    for fact in &facts {
        world.call(agent, "agents.say", fact.clone()).await.unwrap();
    }
    let listed = world
        .list_until(|listed| !listed["pulls"][0]["turn"].is_null())
        .await;
    let pull = &listed["pulls"][0];
    assert_eq!(pull["number"], 7);
    assert_eq!(pull["owner"], "t2");
    assert_eq!(pull["by"], "agent");
    assert_eq!(pull["auto_fix"], true);
    // Its Agent works: its turn.
    assert_eq!(pull["turn"], "agent");

    // The Agent's tool names its own Thread without saying it.
    let mine = world
        .call(agent, "pulls.list_thread", json!({}))
        .await
        .unwrap();
    assert_eq!(mine[0]["number"], 7);

    // Let go of, the same call heard again does not link it again.
    world
        .call(
            world.person(),
            "pulls.unlink",
            json!({ "pull": "#7", "thread": "t2" }),
        )
        .await
        .unwrap();
    world
        .call(agent, "agents.say", facts[1].clone())
        .await
        .unwrap();
    world
        .call(agent, "agents.say", facts[2].clone())
        .await
        .unwrap();
    world
        .call(agent, "agents.say", facts[3].clone())
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(world.list().await["pulls"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn without_gh_the_list_says_why_and_holds_no_state() {
    let world = World::new(|root| root.join("no-gh-here")).await;
    let linked = world
        .call(
            world.person(),
            "pulls.link",
            json!({ "pull": "https://github.com/o/r/pull/9", "thread": "t1" }),
        )
        .await
        .unwrap();
    assert!(linked.get("snapshot").is_none());
    let listed = world.list().await;
    assert!(listed["missing"].as_str().unwrap().contains("gh"));
    assert!(listed["pulls"][0].get("need").is_none());
    let refused = world
        .call(
            world.person(),
            "pulls.link",
            json!({ "pull": "not a pull request", "thread": "t1" }),
        )
        .await;
    assert!(refused.is_err());
}
