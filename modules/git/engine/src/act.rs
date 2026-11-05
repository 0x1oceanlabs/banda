//! What the git button does: commit, push and pull at once, each step
//! after the one before it succeeded, as T3 Code's stacked action runs
//! them (`docs/research/2026-11-02-t3-code-git-backend.md`, sections 3
//! and 4); and switching and making branches, and a repository.
//!
//! These write, and run the Person's hooks: a commit up to ten minutes, a
//! push or a pull as long too. What a hook or a remote says comes as it
//! comes, its credentials taken out, and a failure says its last line.

use crate::model::{ActAsk, Acted, Action, Change, Changed, Commit, Done, Progress, Step};
use crate::repo::{Repo, branch_refs, chosen, in_way, scratch};
use crate::run::{Failure, Opts, Ran, Reason, git};
use banda_kernel::{ModuleProject, Participant, Refusal};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::time::Duration;
use tokio::sync::mpsc;

/// How often the trace is read for the hook that began.
const TRACED: Duration = Duration::from_millis(100);

/// The Thread whose card asked for a git action: as each step is done,
/// git says what changed in its fact `git.acted`, which the agents module
/// puts before the Agent's next message.
pub struct Card {
    pub project: ModuleProject,
    pub by: Participant,
    pub thread: String,
}

impl Card {
    /// The card of `thread`, when one asked.
    pub fn of(project: &ModuleProject, by: Participant, thread: Option<String>) -> Option<Card> {
        Some(Card {
            project: project.clone(),
            by,
            thread: thread?,
        })
    }

    /// Says `notice`, what a step changed; what was done stays done when
    /// it cannot.
    pub async fn acted(&self, notice: String) {
        let acted = Acted {
            thread: self.thread.clone(),
            notice,
        };
        let by = self.by;
        let told = self.project.write(move |tx| {
            tx.emit("git.acted", 1, Some(&acted.thread), by, &acted)?;
            Ok(())
        });
        if let Err(error) = told.await {
            tracing::warn!(%error, "the Thread's Agent was not told what git did");
        }
    }
}

/// Says how `git.act` goes, to a window that may have gone, and what each
/// step changed to the Thread whose card asked: what it does is done all
/// the same.
pub struct Teller {
    pub say: mpsc::Sender<Value>,
    pub card: Option<Card>,
}

impl Teller {
    async fn say(&self, progress: Progress) {
        if let Ok(piece) = serde_json::to_value(progress) {
            let _ = self.say.send(piece).await;
        }
    }

    /// Says what a step changed to the card's Thread, if a card asked.
    async fn acted(&self, notice: String) {
        if let Some(card) = &self.card {
            card.acted(notice).await
        }
    }

    async fn step(&self, step: Step) {
        self.say(Progress::Step { step }).await
    }

    /// A line, unless the window is behind: the next one says more.
    fn line(&self, line: String) {
        if let Ok(piece) = serde_json::to_value(Progress::Line { line }) {
            let _ = self.say.try_send(piece);
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
                let pushed = push(repo, &branch, tell).await?;
                tell.acted(pushed.notice(&branch)).await;
                let title = format!("Pushed {} to {}", pushed.head.short, pushed.to);
                Ok(done(title, &pushed.head))
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
        return Err(nothing_to_commit(false));
    }
    // `add --all` would take a conflict as resolved, its markers and all.
    let fought: Vec<&str> = (said.files.iter())
        .filter(|f| f.status == Change::Conflicted)
        .map(|f| f.path.as_str())
        .collect();
    if !fought.is_empty() {
        return Err(Refusal::conflict(format!(
            "Resolve the conflicts first: {}.",
            some_of(&fought)
        )));
    }
    // A rename chosen takes where it was too, so its old path goes.
    let files = files.map(|files| with_old_paths(files, &said.files));
    let mut branch = said.branch;
    let made = ask.branch.is_some();
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
    // Told now: a push that fails leaves the commit made.
    tell.acted(committed.notice(branch.as_deref(), made)).await;
    let title = format!("Committed {}", committed.head.short);
    let Some(branch) = branch.filter(|_| ask.action == Action::CommitPush) else {
        return Ok(done(title, &committed.head));
    };
    tell.step(Step::Pushing).await;
    // The commit stays made: what failed is the push alone.
    let pushed = push(repo, &branch, tell).await.map_err(|mut refusal| {
        refusal.message = format!("{title}, but the push failed. {}", refusal.message);
        refusal
    })?;
    tell.acted(pushed.notice(&branch)).await;
    let title = format!(
        "Committed and pushed {} to {}",
        pushed.head.short, pushed.to
    );
    Ok(done(title, &pushed.head))
}

/// How a run that ended at `head` says it, its subject under `title`.
fn done(title: String, head: &Commit) -> Done {
    Done {
        title,
        detail: Some(head.subject.clone()),
    }
}

/// A commit made: it, and how many files it took.
struct Committed {
    head: Commit,
    files: usize,
}

impl Committed {
    /// What a Thread's Agent reads of it: `Committed 2 files on main:
    /// “Add multiply” (a1b2c3d).`
    fn notice(&self, branch: Option<&str>, made: bool) -> String {
        let Committed { head, files } = self;
        let files = match files {
            1 => "1 file".to_owned(),
            n => format!("{n} files"),
        };
        let what = format!("“{}” ({})", head.subject, head.short);
        match (branch, made) {
            (Some(branch), true) => {
                format!("Made the branch {branch}, and committed {files} on it: {what}.")
            }
            (Some(branch), false) => format!("Committed {files} on {branch}: {what}."),
            (None, _) => format!("Committed {files} on a detached HEAD: {what}."),
        }
    }
}

/// A push made: where to, as `origin/main`, and the commit it took there.
struct Pushed {
    to: String,
    head: Commit,
}

impl Pushed {
    /// What a Thread's Agent reads of a push of `branch`.
    fn notice(&self, branch: &str) -> String {
        let Pushed { to, head } = self;
        format!(
            "Pushed {branch} to {to}, up to {} “{}”.",
            head.short, head.subject
        )
    }
}

/// A few of `paths`, as `a.txt, b.txt and 3 more`.
fn some_of(paths: &[&str]) -> String {
    const FEW: usize = 3;
    let named = paths[..paths.len().min(FEW)].join(", ");
    match paths.len().saturating_sub(FEW) {
        0 => named,
        more => format!("{named} and {more} more"),
    }
}

/// `files`, and where each renamed one of them was: the rename's other
/// side, which a commit of it takes too, so the old path is removed.
fn with_old_paths<'a>(files: Vec<&'a str>, changed: &'a [Changed]) -> Vec<&'a str> {
    let mut all = files.clone();
    for file in changed {
        let Some(old) = file.old_path.as_deref() else {
            continue;
        };
        let new = file.path.as_str();
        if files.contains(&new) || files.contains(&old) {
            all.extend([new, old]);
        }
    }
    all.sort_unstable();
    all.dedup();
    all
}

/// Why there is nothing to commit, as the button's commit and the prompt
/// for its message both say it: the work tree is clean, or the files
/// `chosen` have no changes.
pub(crate) fn nothing_to_commit(chosen: bool) -> Refusal {
    Refusal::conflict(match chosen {
        true => "Nothing to commit: those files have no changes.",
        false => "Nothing to commit: the work tree is clean.",
    })
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
) -> Result<Committed, Refusal> {
    match files {
        // Every change, as T3 Code's button commits: what `.gitignore`
        // leaves out stays out.
        None => {
            repo.run(["add", "--all"], Opts::writes()).await?;
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
            repo.run(["reset", "--quiet"], Opts::writes()).await?;
            repo.run_on_paths(&["add", "--all"], files, Opts::writes())
                .await?;
        }
    }
    let staged = repo
        .run(
            ["diff", "--cached", "--name-only", "-z", "-M", "--"],
            Opts::default(),
        )
        .await?;
    let taken = staged.stdout.split(|b| *b == 0).filter(|p| !p.is_empty());
    let files = taken.count();
    if files == 0 {
        return Err(nothing_to_commit(true));
    }
    let stdin = Some(message.as_bytes().to_vec());
    let args = ["commit", "--quiet", "--file=-"];
    traced(repo, &args, stdin, "Git could not commit", tell).await?;
    let head = repo.said_head().await?;
    Ok(Committed { head, files })
}

/// Pushes `branch` to the remote it follows, or else the primary one,
/// under its own name, and makes that its upstream when it has none or
/// another: a branch made from `origin/main` is not pushed to `main`.
async fn push(repo: &Repo, branch: &str, tell: &Teller) -> Result<Pushed, Refusal> {
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
            repo.run(["config", &key, value], Opts::writes()).await?;
        }
    }
    let head = repo.said_head().await?;
    Ok(Pushed {
        to: format!("{remote}/{branch}"),
        head,
    })
}

/// Brings the upstream's commits in, fast-forward only.
async fn pull(repo: &Repo, branch: &str, tell: &Teller) -> Result<Done, Refusal> {
    // An upstream git counts nothing against is gone from the remote, as
    // after its pull request merged.
    let said = repo.porcelain().await?;
    let upstream = match (said.upstream, said.ahead) {
        (Some(upstream), Some(_)) => upstream,
        (Some(upstream), None) => {
            return Err(Refusal::conflict(format!(
                "Its upstream {upstream} is gone from the remote."
            )));
        }
        (None, _) => {
            return Err(Refusal::conflict(
                "This branch follows no upstream: push it first.",
            ));
        }
    };
    let before = repo.head().await?;
    let args = ["pull", "--quiet", "--ff-only", "--no-rebase"];
    traced(repo, &args, None, "Git could not pull", tell).await?;
    let head = repo.said_head().await?;
    if before.as_deref() == Some(head.sha.as_str()) {
        return Ok(Done {
            title: "Already up to date".to_owned(),
            detail: Some(format!("{branch} has all of {upstream}.")),
        });
    }
    tell.acted(format!(
        "Pulled {upstream} into {branch}, which is now at {} “{}”.",
        head.short, head.subject
    ))
    .await;
    Ok(Done {
        title: "Pulled".to_owned(),
        detail: Some(format!("Updated {branch} from {upstream}.")),
    })
}

/// Switches to `name`: a branch here, or a remote's, which the branch
/// here that follows it checks out, or a new one made to. The changes go
/// along, or git refuses. Says what changed, for a Thread's Agent.
pub async fn switch(repo: &Repo, name: &str) -> Result<String, Refusal> {
    ref_name(name)?;
    let Some(found) = repo.first_there(branch_refs(name)).await? else {
        return Err(Failure(Reason::BadRef).into());
    };
    let to = if found.full.starts_with("refs/heads/") {
        vec![name.to_owned()]
    } else {
        let ran = repo
            .run(
                [
                    "for-each-ref",
                    "--format=%(refname:strip=2)\t%(upstream:short)",
                    "refs/heads",
                ],
                Opts::default(),
            )
            .await?;
        let text = ran.text();
        // The text's end is trimmed: the last branch may follow nothing and
        // have no tab.
        let here: Vec<(&str, &str)> = (text.lines())
            .map(|l| l.split_once('\t').unwrap_or((l, "")))
            .collect();
        // The branch here that follows it; or else the one `--track`
        // would make, when one of its name is here already but follows
        // another; or else that one, made.
        let local = match here.iter().find(|(_, up)| *up == name) {
            Some((local, _)) => Some(local.to_string()),
            None => tracked_name(repo, name)
                .await?
                .filter(|own| here.iter().any(|(local, _)| local == own)),
        };
        match local {
            Some(local) => vec![local],
            None => vec!["--track".to_owned(), name.to_owned()],
        }
    };
    let along = changes_along(repo).await?;
    // `--` after it, so a ref gone stale is no path, whose checkout would
    // throw the Person's changes away (T3 Code).
    let mut args = vec!["checkout", "--quiet"];
    args.extend(to.iter().map(String::as_str));
    args.push("--");
    repo.run(args, Opts::writes()).await?;
    let now = repo.branch().await?.unwrap_or_else(|| name.to_owned());
    Ok(match to.first().map(String::as_str) {
        Some("--track") => {
            format!("Made the branch {now}, which follows {name}, and switched to it{along}.")
        }
        _ if now != name => format!("Switched to the branch {now}, which follows {name}{along}."),
        _ => format!("Switched to the branch {now}{along}."),
    })
}

/// How a sentence of a switch ends when the changes not committed went
/// along: they are in the branch switched to now.
async fn changes_along(repo: &Repo) -> Result<&'static str, Failure> {
    Ok(match repo.porcelain().await?.files.is_empty() {
        true => "",
        false => "; the changes not committed went along",
    })
}

/// The name a remote's branch has here, as `checkout --track` names it:
/// `origin/fix/a` is `fix/a`. None when no remote's name begins it.
async fn tracked_name(repo: &Repo, name: &str) -> Result<Option<String>, Failure> {
    Ok(repo
        .remotes()
        .await?
        .iter()
        .filter_map(|remote| name.strip_prefix(remote.as_str())?.strip_prefix('/'))
        .find(|own| !own.is_empty())
        .map(str::to_owned))
}

/// Makes the branch `name` at `from`, or at `HEAD` with the changes
/// taken along, and switches to it.
/// Makes the branch `name` from `from`, or `HEAD`, and switches to it;
/// says what changed, for a Thread's Agent.
pub async fn make_branch(repo: &Repo, name: &str, from: Option<&str>) -> Result<String, Refusal> {
    ref_name(name)?;
    if !repo.yes(["check-ref-format", "--branch", name]).await? {
        return Err(Refusal::invalid("Git takes no branch of that name."));
    }
    match in_way(&repo.branches().await?, name) {
        Some(there) if there == name => {
            return Err(Refusal::conflict("A branch of that name is there already."));
        }
        // Git keeps `fix` as a file, so `fix/login` can be no folder.
        Some(there) => {
            return Err(Refusal::conflict(format!(
                "The branch {there} is there, so git can make no branch {name}: name it otherwise."
            )));
        }
        None => {}
    }
    let along = changes_along(repo).await?;
    let mut args = vec!["checkout", "--quiet", "-b", name];
    if let Some(from) = from {
        ref_name(from)?;
        args.push(from);
    }
    args.push("--");
    repo.run(args, Opts::writes()).await?;
    let from = from.map(|from| format!(" from {from}")).unwrap_or_default();
    Ok(format!(
        "Made the branch {name}{from} and switched to it{along}."
    ))
}

/// Makes `folder` a repository.
pub async fn init(folder: &Path) -> Result<(), Refusal> {
    if Repo::find(folder).await?.is_some() {
        return Err(Refusal::conflict(
            "This folder is in a git repository already.",
        ));
    }
    git(folder, ["init", "--quiet"], Opts::writes())
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
        env: &env,
        lines: Some(lines),
        ..Opts::writes()
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
    // What a remote said as it refused a push says more than git's own
    // "failed to push some refs".
    match ran.refused().or_else(|| ran.last_line()) {
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
