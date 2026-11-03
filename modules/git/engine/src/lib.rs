//! The git module: the Space's folder as git sees it (ADR 0034,
//! decision 3).
//!
//! The engine runs the `git` program in the Space's folder, as T3 Code
//! does, with no library of its own: its branch and what changed
//! (`status`), the diff of a scope (`diff`, `contents`), the branches to
//! compare with (`refs`) and the branch's commits (`commits`). These only
//! read, and never take the repository's locks, so they run beside the
//! Person's own git and an Agent's. A folder git does not know is no
//! repository: `status` says so, and the rest refuse.

pub mod model;

mod checkpoint;
mod diff;
mod parse;
mod refs;
mod repo;
mod run;
mod status;

use banda_kernel::{Call, Error, Module, ModuleSpace, Nothing, Refusal, Right};
use model::{Commit, CommitsAsk, Contents, ContentsAsk, Diff, DiffAsk, Ref, RefsAsk, Status};
use repo::Repo;
use serde_json::Value;

#[derive(Default)]
pub struct Git;

impl Git {
    pub fn new() -> Self {
        Self
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
}

impl Git {
    async fn status(&self, call: Call, _: Nothing) -> Result<Status, Refusal> {
        // Read before git is: an event after it may change what git reads,
        // and a Pane following it reads again.
        let at = call.space().at().await?;
        Ok(status::status(call.space().folder(), at).await?)
    }

    async fn diff(&self, call: Call, ask: DiffAsk) -> Result<Diff, Refusal> {
        // Read before git is: an event after it may change what git reads,
        // and a Pane following it reads again.
        let at = call.space().at().await?;
        let repo = Repo::open(call.space().folder()).await?;
        diff::diff(&repo, ask, at).await
    }

    async fn refs(&self, call: Call, ask: RefsAsk) -> Result<Vec<Ref>, Refusal> {
        refs::refs(&Repo::open(call.space().folder()).await?, ask).await
    }

    async fn commits(&self, call: Call, ask: CommitsAsk) -> Result<Vec<Commit>, Refusal> {
        refs::commits(&Repo::open(call.space().folder()).await?, ask).await
    }

    async fn contents(&self, call: Call, ask: ContentsAsk) -> Result<Contents, Refusal> {
        diff::contents(&Repo::open(call.space().folder()).await?, ask).await
    }
}
