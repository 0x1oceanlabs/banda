//! `git.watch`: the status as it changes, while a Pane follows it
//! (ADR 0034, decision 3). It reads the status again every few seconds
//! and says it only when it changed; and it fetches the upstream's remote
//! now and then, as T3 Code does, so ahead and behind count what the
//! remote has, backing off while that fails. A fetch runs beside the
//! reads, which go on meanwhile; none begins while a command of Banda's
//! writes in the repository, and none keeps one waiting: git locks each
//! remote branch it updates itself.

use crate::model::Status;
use crate::repo::Repo;
use crate::run::{Opts, Pool};
use crate::{Repositories, Writes, status};
use banda_kernel::{ModuleProject, Stream};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::Instant;

/// How often the status is read again.
const AGAIN: Duration = Duration::from_secs(3);
/// How often the upstream's remote is fetched, and how far apart at most
/// while that fails.
const FETCH: Duration = Duration::from_secs(30);
const FETCH_AT_MOST: Duration = Duration::from_secs(15 * 60);

/// Follows the status of `project`'s folder until the window lets go,
/// reading it again at once when a git command of Banda's has written in
/// its repository.
pub fn watch(project: ModuleProject, repositories: Repositories) -> Stream {
    let (say, heard) = mpsc::channel(1);
    tokio::spawn(async move {
        let mut told: Option<Status> = None;
        let mut fetch = Fetch::new();
        loop {
            let folder = project.folder();
            // Read before git is: an event after it may change what git
            // reads.
            let at = project.at().await.ok();
            let found = Repo::find(&folder).await;
            let repo = match &found {
                Ok(Some(repo)) => Some(repo.clone()),
                _ => None,
            };
            let writes = match &repo {
                Some(repo) => repositories.of(&repo.top),
                None => repositories.of_folder(&folder),
            };
            // Heard from now: a write that ends during the read counts.
            let wrote = writes.done.notified();
            tokio::pin!(wrote);
            wrote.as_mut().enable();
            let read = async { status::read(found, at?, &repositories).await.ok() };
            if let Some(mut status) = read.await {
                // The same but for its position is no change.
                let at = status.at;
                status.at = told.as_ref().map_or(at, |t| t.at);
                if told.as_ref() != Some(&status) {
                    status.at = at;
                    let Ok(piece) = serde_json::to_value(&status) else {
                        return;
                    };
                    if say.send(piece).await.is_err() {
                        return;
                    }
                    told = Some(status);
                }
            }
            if let Some(Status {
                branch: Some(branch),
                upstream: Some(_),
                ..
            }) = &told
                && let Some(repo) = repo
            {
                fetch.start(repo, branch.clone(), &writes);
            }
            tokio::select! {
                () = tokio::time::sleep(AGAIN) => {}
                // What it fetched counts now, not in a while.
                () = fetch.ended() => {}
                () = &mut wrote => {}
                () = say.closed() => return,
            }
        }
    });
    heard
}

/// The fetch of the upstream's remote: when the next is due, and the one
/// running.
struct Fetch {
    next: Instant,
    apart: Duration,
    running: Option<JoinHandle<bool>>,
}

impl Fetch {
    fn new() -> Fetch {
        Fetch {
            next: Instant::now(),
            apart: FETCH,
            running: None,
        }
    }

    /// Starts one when it is due, none runs and no command of Banda's
    /// writes in the repository.
    fn start(&mut self, repo: Repo, branch: String, writes: &Writes) {
        if self.running.is_some() || Instant::now() < self.next {
            return;
        }
        if !writes.busy() {
            self.running = Some(tokio::spawn(fetch(repo, branch)));
        }
    }

    /// Once the one running ends, when it fetched; never when none runs
    /// or it failed.
    async fn ended(&mut self) {
        let Some(running) = &mut self.running else {
            return std::future::pending().await;
        };
        let fetched = running.await.unwrap_or(false);
        self.running = None;
        self.apart = match fetched {
            true => FETCH,
            false => (self.apart * 2).min(FETCH_AT_MOST),
        };
        self.next = Instant::now() + self.apart;
        if !fetched {
            std::future::pending().await
        }
    }
}

/// Fetches the remote `branch` follows, and says whether it did. It is
/// Banda's own git (`banda_git_cli`): as T3 Code's, it asks for no
/// password and runs no gc, whose packs a failed one would leave each
/// time until the disk is full.
async fn fetch(repo: Repo, branch: String) -> bool {
    let fetched = async {
        let key = format!("branch.{branch}.remote");
        let remote = repo.config(&key).await.ok()??;
        // No FETCH_HEAD, which only a merge after the fetch reads.
        let args = [
            "fetch",
            "--quiet",
            "--no-tags",
            "--no-write-fetch-head",
            "--",
            &remote,
        ];
        let opts = Opts {
            pool: Pool::Long,
            ..Opts::default()
        };
        repo.run(args, opts).await.ok()
    };
    fetched.await.is_some()
}
