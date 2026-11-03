//! What the git button does: commit, push and pull at once, each step
//! after the one before it succeeded, as T3 Code's stacked action runs
//! them (`docs/research/2026-11-02-t3-code-git-backend.md`, sections 3
//! and 4); and switching and making branches, and a repository.
//!
//! These write, and run the Person's hooks: a commit up to ten minutes, a
//! push or a pull as long too. What a hook or a remote says comes as it
//! comes, its credentials taken out, and a failure says its last line.

use crate::model::{ActAsk, Action, Done, Progress, Step};
use crate::repo::{Repo, chosen, scratch};
use crate::run::{Failure, Opts, Ran, Reason, git};
use banda_kernel::Refusal;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::time::Duration;
use tokio::sync::mpsc;

/// How long a commit, its hooks, a push or a pull may run.
const LONG: Duration = Duration::from_secs(10 * 60);
/// How often the trace is read for the hook that began.
const TRACED: Duration = Duration::from_millis(100);

/// Says how `git.act` goes, to a window that may have gone: what it
/// does is done all the same.
pub struct Teller(pub mpsc::Sender<Value>);

impl Teller {
    async fn say(&self, progress: Progress) {
        if let Ok(piece) = serde_json::to_value(progress) {
            let _ = self.0.send(piece).await;
        }
    }

    async fn step(&self, step: Step) {
        self.say(Progress::Step { step }).await
    }

    /// A line, unless the window is behind: the next one says more.
    fn line(&self, line: String) {
        if let Ok(piece) = serde_json::to_value(Progress::Line { line }) {
            let _ = self.0.try_send(piece);
        }
    }

    /// How it ended, the last piece.
    pub async fn ended(&self, ended: Result<Done, Refusal>) {
        self.say(match ended {
            Ok(done) => Progress::Done { done },
            Err(refusal) => Progress::Failed {
                message: refusal.message,
            },
        })
        .await
    }
}

/// Does what `ask` asks, saying each step to `tell`.
pub async fn act(repo: &Repo, ask: ActAsk, tell: &Teller) -> Result<Done, Refusal> {
    let commits = matches!(ask.action, Action::Commit | Action::CommitPush);
    if !commits {
        if ask.message.is_some() || ask.files.is_some() || ask.branch.is_some() {
            return Err(Refusal::invalid(
                "Only a commit takes a message, files or a new branch.",
            ));
        }
        // No commit, so no need to look over the work tree.
        let branch = repo.branch().await?.ok_or_else(detached)?;
        return match ask.action {
            Action::Push => {
                tell.step(Step::Pushing).await;
                push(repo, &branch, tell).await
            }
            _ => {
                tell.step(Step::Pulling).await;
                pull(repo, &branch, tell).await
            }
        };
    }
    let message = ask
        .message
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .ok_or_else(|| Refusal::invalid("A commit needs a message."))?;
    let files = chosen(&ask.files)?;
    let said = repo.porcelain().await?;
    if said.files.is_empty() {
        return Err(Refusal::conflict(
            "Nothing to commit: the work tree is clean.",
        ));
    }
    let mut branch = said.branch;
    if let Some(name) = ask.branch {
        tell.step(Step::Branching).await;
        make_branch(repo, &name, None).await?;
        branch = Some(name);
    }
    if ask.action == Action::CommitPush && branch.is_none() {
        return Err(detached());
    }
    tell.step(Step::Committing).await;
    let committed = commit(repo, message, files.as_deref(), tell).await?;
    match branch {
        Some(branch) if ask.action == Action::CommitPush => {
            tell.step(Step::Pushing).await;
            push(repo, &branch, tell).await
        }
        _ => Ok(committed),
    }
}

fn detached() -> Refusal {
    Refusal::conflict("HEAD is detached: check out a branch first.")
}

/// Stages what the commit takes, commits it with `message`, and says the
/// commit.
async fn commit(
    repo: &Repo,
    message: &str,
    files: Option<&[&str]>,
    tell: &Teller,
) -> Result<Done, Refusal> {
    match files {
        // Every change, as T3 Code's button commits: what `.gitignore`
        // leaves out stays out.
        None => {
            repo.run(["add", "--all"], Opts::default()).await?;
        }
        // Only these: what else was staged is unstaged first, as T3 Code
        // does, so the commit holds what the Person chose.
        Some(files) => {
            if repo
                .yes(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"])
                .await?
            {
                return Err(Refusal::conflict(
                    "A merge is going on: commit all of it, or end it first.",
                ));
            }
            repo.run(["reset", "--quiet"], Opts::default()).await?;
            repo.run_on_paths(&["add", "--all"], files, None).await?;
        }
    }
    if repo.yes(["diff", "--cached", "--quiet", "--"]).await? {
        return Err(Refusal::conflict(
            "Nothing to commit: those files have no changes.",
        ));
    }
    let stdin = Some(message.as_bytes().to_vec());
    let args = ["commit", "--quiet", "--file=-"];
    traced(repo, &args, stdin, "Git could not commit", tell).await?;
    let head = repo.said_head().await?;
    Ok(Done {
        title: format!("Committed {}", head.short),
        detail: Some(head.subject),
    })
}

/// Pushes `branch` to the remote it follows, or else the primary one,
/// under its own name, and makes that its upstream when it has none or
/// another: a branch made from `origin/main` is not pushed to `main`.
async fn push(repo: &Repo, branch: &str, tell: &Teller) -> Result<Done, Refusal> {
    let own = format!("refs/heads/{branch}");
    let merge = repo.config(&format!("branch.{branch}.merge")).await?;
    let follows = merge.as_deref() == Some(own.as_str());
    let mut keys = vec![
        format!("branch.{branch}.pushRemote"),
        "remote.pushDefault".to_owned(),
    ];
    if follows {
        keys.push(format!("branch.{branch}.remote"));
    }
    let mut remote = None;
    for key in keys {
        remote = repo.config(&key).await?;
        if remote.is_some() {
            break;
        }
    }
    let remote = match remote {
        Some(remote) => remote,
        None => repo
            .primary_remote()
            .await?
            .ok_or_else(|| Refusal::conflict("This repository has no remote to push to."))?,
    };
    let to = format!("HEAD:{own}");
    let args = ["push", "--quiet", "--", &remote, &to];
    traced(repo, &args, None, "Git could not push", tell).await?;
    if !follows {
        // Itself, not `push -u`, which exits with 0 without it when
        // another git holds the config's lock (T3 Code).
        for (key, value) in [("remote", remote.as_str()), ("merge", own.as_str())] {
            let key = format!("branch.{branch}.{key}");
            repo.run(["config", &key, value], Opts::default()).await?;
        }
    }
    let head = repo.said_head().await?;
    Ok(Done {
        title: format!("Pushed {} to {remote}/{branch}", head.short),
        detail: Some(head.subject),
    })
}

/// Brings the upstream's commits in, fast-forward only.
async fn pull(repo: &Repo, branch: &str, tell: &Teller) -> Result<Done, Refusal> {
    let upstream = repo
        .verified([
            "rev-parse",
            "--verify",
            "--quiet",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ])
        .await?
        .ok_or_else(|| Refusal::conflict("This branch follows no upstream: push it first."))?;
    let before = repo.head().await?;
    let args = ["pull", "--quiet", "--ff-only", "--no-rebase"];
    traced(repo, &args, None, "Git could not pull", tell).await?;
    Ok(match repo.head().await? == before {
        true => Done {
            title: "Already up to date".to_owned(),
            detail: Some(format!("{branch} has all of {upstream}.")),
        },
        false => Done {
            title: "Pulled".to_owned(),
            detail: Some(format!("Updated {branch} from {upstream}.")),
        },
    })
}

/// Switches to `name`: a branch here, or a remote's, which the branch
/// here that follows it checks out, or a new one made to. The changes go
/// along, or git refuses.
pub async fn switch(repo: &Repo, name: &str) -> Result<(), Refusal> {
    ref_name(name)?;
    let to = if repo.has_ref(&format!("refs/heads/{name}")).await? {
        vec![name.to_owned()]
    } else if repo.has_ref(&format!("refs/remotes/{name}")).await? {
        let ran = repo
            .run(
                [
                    "for-each-ref",
                    "--format=%(refname:short)\t%(upstream:short)",
                    "refs/heads",
                ],
                Opts::default(),
            )
            .await?;
        let text = ran.text();
        let follows = text
            .lines()
            .find_map(|l| l.split_once('\t').filter(|(_, up)| *up == name))
            .map(|(local, _)| local.to_owned());
        match follows {
            Some(local) => vec![local],
            None => vec!["--track".to_owned(), name.to_owned()],
        }
    } else {
        return Err(Failure(Reason::BadRef).into());
    };
    // `--` after it, so a ref gone stale is no path, whose checkout would
    // throw the Person's changes away (T3 Code).
    let mut args = vec!["checkout", "--quiet"];
    args.extend(to.iter().map(String::as_str));
    args.push("--");
    repo.run(args, Opts::default()).await?;
    Ok(())
}

/// Makes the branch `name` at `from`, or at `HEAD` with the changes
/// taken along, and switches to it.
pub async fn make_branch(repo: &Repo, name: &str, from: Option<&str>) -> Result<(), Refusal> {
    ref_name(name)?;
    if !repo.yes(["check-ref-format", "--branch", name]).await? {
        return Err(Refusal::invalid("Git takes no branch of that name."));
    }
    if repo.has_ref(&format!("refs/heads/{name}")).await? {
        return Err(Refusal::conflict("A branch of that name is there already."));
    }
    let mut args = vec!["checkout", "--quiet", "-b", name];
    if let Some(from) = from {
        ref_name(from)?;
        args.push(from);
    }
    args.push("--");
    repo.run(args, Opts::default()).await?;
    Ok(())
}

/// Makes `folder` a repository.
pub async fn init(folder: &Path) -> Result<(), Refusal> {
    if Repo::find(folder).await?.is_some() {
        return Err(Refusal::conflict(
            "This folder is in a git repository already.",
        ));
    }
    git(folder, ["init", "--quiet"], Opts::default())
        .await?
        .checked()?;
    Ok(())
}

/// A name git cannot take for an option.
fn ref_name(name: &str) -> Result<(), Refusal> {
    match name.is_empty() || name.starts_with('-') || name.contains('\0') {
        true => Err(Refusal::invalid(
            "A branch is named, and not with a dash first.",
        )),
        false => Ok(()),
    }
}

/// Runs a git that may run hooks, for as long as it takes, saying each
/// hook as it begins and each line as it comes. When it fails, a hook
/// that exited so says it stopped it, with its last line; else git's
/// reason, or `what` with git's last line.
async fn traced(
    repo: &Repo,
    args: &[&str],
    stdin: Option<Vec<u8>>,
    what: &str,
    tell: &Teller,
) -> Result<(), Refusal> {
    let folder = scratch("banda-git-trace-")?;
    let trace = folder.path().join("trace");
    let (lines, mut heard) = mpsc::unbounded_channel();
    let env = [("GIT_TRACE2_EVENT", trace.as_os_str())];
    let opts = Opts {
        stdin,
        time: Some(LONG),
        env: &env,
        lines: Some(lines),
        ..Opts::default()
    };
    let ran = git(&repo.top, args, opts);
    tokio::pin!(ran);
    let mut hooks = Hooks::new(&trace);
    let mut tick = tokio::time::interval(TRACED);
    let ran = loop {
        tokio::select! {
            ran = &mut ran => {
                hooks.read(tell).await;
                while let Ok(line) = heard.try_recv() {
                    tell.line(line);
                }
                break ran?;
            }
            Some(line) = heard.recv() => tell.line(line),
            _ = tick.tick() => hooks.read(tell).await,
        }
    };
    if ran.success {
        return Ok(());
    }
    Err(failed(&ran, hooks.stopped.as_deref(), what))
}

fn failed(ran: &Ran, hook: Option<&str>, what: &str) -> Refusal {
    let reason = ran.failure().0;
    let said = match hook {
        Some(hook) => format!("The {hook} hook stopped it"),
        None if reason == Reason::Other => what.to_owned(),
        None => return Failure(reason).into(),
    };
    match ran.last_line() {
        Some(line) => Refusal::conflict(format!("{said}: {line}")),
        None if hook.is_some() => Refusal::conflict(format!("{said}.")),
        None => Failure(reason).into(),
    }
}

/// The hooks git ran, read from its trace2 events as git writes them:
/// each one as it begins, and the one that exited with another code than
/// 0.
struct Hooks<'a> {
    trace: &'a Path,
    file: Option<File>,
    /// What was read past the last whole line.
    rest: String,
    /// The hooks begun, by git's id for each child; an exit names only
    /// that.
    begun: HashMap<u64, String>,
    stopped: Option<String>,
}

impl<'a> Hooks<'a> {
    fn new(trace: &'a Path) -> Hooks<'a> {
        Hooks {
            trace,
            file: None,
            rest: String::new(),
            begun: HashMap::new(),
            stopped: None,
        }
    }

    /// Says each hook begun since it last read.
    async fn read(&mut self, tell: &Teller) {
        if self.file.is_none() {
            self.file = File::open(self.trace).ok();
        }
        let Some(file) = &mut self.file else {
            return;
        };
        // A few lines of a local file, as git appends them.
        if file.read_to_string(&mut self.rest).is_err() {
            return;
        }
        let Some(end) = self.rest.rfind('\n') else {
            return;
        };
        let whole: String = self.rest.drain(..=end).collect();
        for line in whole.lines() {
            let Ok(event) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let Some(child) = event["child_id"].as_u64() else {
                continue;
            };
            match event["event"].as_str() {
                Some("child_start") if event["child_class"] == "hook" => {
                    let Some(name) = event["hook_name"].as_str() else {
                        continue;
                    };
                    self.begun.insert(child, name.to_owned());
                    let name = name.to_owned();
                    tell.say(Progress::Hook { name }).await;
                }
                Some("child_exit") if event["code"] != 0 => {
                    if let Some(name) = self.begun.get(&child) {
                        self.stopped = Some(name.clone());
                    }
                }
                _ => {}
            }
        }
    }
}
