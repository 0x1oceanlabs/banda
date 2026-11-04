//! The git module: the Space's folder as git sees it (ADR 0034,
//! decision 3).
//!
//! The engine runs the `git` program in the Space's folder, as T3 Code
//! does, with no library of its own: its branch and what changed
//! (`status`), the diff of a scope (`diff`, `contents`), the branches to
//! compare with (`refs`) and the branch's commits (`commits`). These only
//! read, and never take the repository's locks, so they run beside the
//! Person's own git and an Agent's; `watch` follows the status as it
//! changes. `stage`, `unstage`, `revert`, `act` (the git button's commit,
//! push and pull), `switch`, `branch` and `init` write, one at a time in
//! each repository. A folder git does not know is no repository: `status`
//! says so, `init` makes it one, and the rest refuse.

pub mod model;

mod act;
mod checkpoint;
mod diff;
mod message;
mod parse;
mod refs;
mod repo;
mod run;
mod stage;
mod status;
mod watch;

use banda_kernel::{Call, Error, Module, ModuleSpace, Nothing, Refusal, Right, Stream};
use model::{
    ActAsk, BranchAsk, ChangeAsk, Commit, CommitsAsk, Contents, ContentsAsk, Diff, DiffAsk,
    Message, Progress, PromptAsk, Prompted, Ref, RefsAsk, Status, SwitchAsk, WrittenAsk,
};
use repo::Repo;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct Git {
    writing: Repositories,
}

/// Each repository's [`Writes`], by its top folder as git names it, or by
/// the folder of a Space that is no repository yet, its links followed as
/// git follows them: a hook that runs long in one keeps no other waiting.
/// Every Space in a repository shares its own.
#[derive(Clone, Default)]
pub(crate) struct Repositories(Arc<Mutex<HashMap<PathBuf, Writes>>>);

impl Repositories {
    /// The repository's at `top`, as `rev-parse --show-toplevel` says it.
    pub(crate) fn of(&self, top: &Path) -> Writes {
        let mut known = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match known.get(top) {
            Some(writes) => writes.clone(),
            None => known.entry(top.to_owned()).or_default().clone(),
        }
    }

    /// The one of a folder that is no repository yet.
    pub(crate) fn of_folder(&self, folder: &Path) -> Writes {
        match folder.canonicalize() {
            Ok(top) => self.of(&top),
            Err(_) => self.of(folder),
        }
    }
}

/// Held while one of its commands writes in a repository, so two of them
/// never race for its index's lock; `act` holds it till it ends. As it is
/// let go, each `git.watch` of that repository reads the status again at
/// once.
#[derive(Clone, Default)]
pub(crate) struct Writes {
    lock: Arc<tokio::sync::Mutex<()>>,
    pub(crate) done: Arc<tokio::sync::Notify>,
}

impl Writes {
    async fn hold(&self) -> Writing {
        Writing {
            _lock: self.lock.clone().lock_owned().await,
            done: self.done.clone(),
        }
    }

    /// Whether a command of Banda's writes in the repository now.
    pub(crate) fn busy(&self) -> bool {
        self.lock.try_lock().is_err()
    }
}

struct Writing {
    _lock: tokio::sync::OwnedMutexGuard<()>,
    done: Arc<tokio::sync::Notify>,
}

impl Drop for Writing {
    fn drop(&mut self) {
        self.done.notify_waiters();
    }
}

impl Git {
    pub fn new() -> Self {
        Self::default()
    }
}

banda_kernel::methods! {
    Git(Call) as "GitMethods" in "git/" {
        /// The branch checked out, its upstream and how far ahead and
        /// behind it is, the default branch, and each file changed against
        /// `HEAD` with its lines added and removed.
        call status(Nothing) -> Status, Read;
        /// What a scope changed: each file's lines added and removed, and
        /// the patch, cut past 120 000 bytes.
        call diff(DiffAsk) -> Diff, Read;
        /// The branches here and on remotes, to compare with: the one
        /// checked out first, then the default, then the newest.
        call refs(RefsAsk) -> Vec<Ref>, Read;
        /// The commits on the branch since it left its base, newest first.
        call commits(CommitsAsk) -> Vec<Commit>, Read;
        /// A file's text before and after a scope, to show the lines its
        /// diff leaves out.
        call contents(ContentsAsk) -> Contents, Read;
        /// Stages files, or the lines of one hunk, from the work tree.
        call stage(ChangeAsk) -> (), Write;
        /// Takes files, or the lines of one hunk, out of the index, back
        /// to `HEAD`.
        call unstage(ChangeAsk) -> (), Write;
        /// Puts files, or the lines of one hunk, in the work tree back as
        /// the index has them; an untracked file goes. It cannot be undone.
        call revert(ChangeAsk) -> (), Write;
        /// The status again each time it changes, first as it is now. It
        /// fetches the upstream's remote every 30 seconds meanwhile.
        stream watch(Nothing) -> Status, Read;
        /// Commits every change or the files asked, pushes, or pulls, each
        /// step after the one before succeeded, saying each and each hook
        /// as it goes, then how it ended. It runs the repository's hooks.
        stream act(ActAsk) -> Progress, Write;
        /// Switches to a branch here, or to a remote's through a branch
        /// that follows it; the changes go along, or git refuses.
        call switch(SwitchAsk) -> (), Write;
        /// Makes a branch, and switches to it.
        call branch(BranchAsk) -> (), Write;
        /// Makes the Space's folder a git repository.
        call init(Nothing) -> (), Write;
        /// The prompt a Harness writes a commit's message from: what the
        /// commit would take, its branch and the repository's last
        /// subjects. The index is left as it is.
        call prompt(PromptAsk) -> Prompted, Read;
        /// A Harness's reply to `prompt` read as a message for `act`, and
        /// as the name of a new branch no branch here has.
        call written(WrittenAsk) -> Message, Read;
    }
}

#[async_trait::async_trait]
impl Module for Git {
    fn name(&self) -> &'static str {
        "git"
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    /// From now on, it keeps a checkpoint as each turn begins and ends,
    /// before the turn's Harness is asked anything.
    async fn opened(&self, space: ModuleSpace) -> Result<(), Error> {
        let heard = space.react(space.at().await?, checkpoint::heard());
        tokio::spawn(checkpoint::follow(heard));
        Ok(())
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }

    async fn stream(&self, call: Call, method: &str, params: Value) -> Result<Stream, Refusal> {
        self.dispatch_stream(call, method, params).await
    }
}

impl Git {
    async fn status(&self, call: Call, _: Nothing) -> Result<Status, Refusal> {
        // Read before git is: an event after it may change what git reads,
        // and a Pane following it reads again.
        let at = call.space().at().await?;
        Ok(status::status(&call.space().folder(), at).await?)
    }

    async fn diff(&self, call: Call, ask: DiffAsk) -> Result<Diff, Refusal> {
        // Read before git is: an event after it may change what git reads,
        // and a Pane following it reads again.
        let at = call.space().at().await?;
        let repo = Repo::open(&call.space().folder()).await?;
        diff::diff(&repo, ask, at).await
    }

    async fn refs(&self, call: Call, ask: RefsAsk) -> Result<Vec<Ref>, Refusal> {
        refs::refs(&Repo::open(&call.space().folder()).await?, ask).await
    }

    async fn commits(&self, call: Call, ask: CommitsAsk) -> Result<Vec<Commit>, Refusal> {
        refs::commits(&Repo::open(&call.space().folder()).await?, ask).await
    }

    async fn contents(&self, call: Call, ask: ContentsAsk) -> Result<Contents, Refusal> {
        diff::contents(&Repo::open(&call.space().folder()).await?, ask).await
    }

    async fn stage(&self, call: Call, ask: ChangeAsk) -> Result<(), Refusal> {
        self.change(call, stage::Act::Stage, ask).await
    }

    async fn unstage(&self, call: Call, ask: ChangeAsk) -> Result<(), Refusal> {
        self.change(call, stage::Act::Unstage, ask).await
    }

    async fn revert(&self, call: Call, ask: ChangeAsk) -> Result<(), Refusal> {
        self.change(call, stage::Act::Revert, ask).await
    }

    async fn change(&self, call: Call, act: stage::Act, ask: ChangeAsk) -> Result<(), Refusal> {
        let repo = Repo::open(&call.space().folder()).await?;
        let _writing = self.writing.of(&repo.top).hold().await;
        stage::change(&repo, act, ask).await
    }

    async fn watch(&self, call: Call, _: Nothing) -> Result<Stream, Refusal> {
        Ok(watch::watch(call.space().clone(), self.writing.clone()))
    }

    async fn act(&self, call: Call, ask: ActAsk) -> Result<Stream, Refusal> {
        let repo = Repo::open(&call.space().folder()).await?;
        let writing = self.writing.of(&repo.top);
        let (say, heard) = tokio::sync::mpsc::channel(64);
        // It goes on when the window lets go: a commit is not left half
        // done.
        tokio::spawn(async move {
            let tell = act::Teller(say);
            let _writing = writing.hold().await;
            let ended = act::act(&repo, ask, &tell).await;
            tell.ended(ended).await;
        });
        Ok(heard)
    }

    async fn switch(&self, call: Call, ask: SwitchAsk) -> Result<(), Refusal> {
        let repo = Repo::open(&call.space().folder()).await?;
        let _writing = self.writing.of(&repo.top).hold().await;
        act::switch(&repo, &ask.name).await
    }

    async fn branch(&self, call: Call, ask: BranchAsk) -> Result<(), Refusal> {
        let repo = Repo::open(&call.space().folder()).await?;
        let _writing = self.writing.of(&repo.top).hold().await;
        act::make_branch(&repo, &ask.name, ask.from.as_deref()).await
    }

    async fn prompt(&self, call: Call, ask: PromptAsk) -> Result<Prompted, Refusal> {
        message::prompt(&Repo::open(&call.space().folder()).await?, ask).await
    }

    async fn written(&self, call: Call, ask: WrittenAsk) -> Result<Message, Refusal> {
        message::written(&Repo::open(&call.space().folder()).await?, ask).await
    }

    async fn init(&self, call: Call, _: Nothing) -> Result<(), Refusal> {
        let folder = call.space().folder();
        let _writing = self.writing.of_folder(&folder).hold().await;
        act::init(&folder).await
    }
}
