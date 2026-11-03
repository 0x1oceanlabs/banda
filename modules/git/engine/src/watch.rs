//! `git.watch`: the status as it changes, while a Pane follows it
//! (ADR 0034, decision 3). It reads the status again every few seconds
//! and says it only when it changed; and it fetches the upstream's remote
//! now and then, as T3 Code does, so ahead and behind count what the
//! remote has, backing off while that fails. A fetch runs beside the
//! reads, which go on meanwhile.

use crate::model::Status;
use crate::repo::Repo;
use crate::run::Opts;
use crate::status;
use banda_kernel::{ModuleSpace, Stream};
use std::path::PathBuf;
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

/// Follows the status of `space`'s folder until the window lets go.
pub fn watch(space: ModuleSpace) -> Stream {
    let (say, heard) = mpsc::channel(1);
    tokio::spawn(async move {
        let mut told: Option<Status> = None;
        let mut fetch = Fetch::new();
        loop {
            let read = async {
                let at = space.at().await.ok()?;
                status::status(space.folder(), at).await.ok()
            };
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
            {
                fetch.start(space.folder().to_path_buf(), branch.clone());
            }
            tokio::select! {
                () = tokio::time::sleep(AGAIN) => {}
                // What it fetched counts now, not in a while.
                () = fetch.ended() => {}
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

    /// Starts one when it is due and none runs.
    fn start(&mut self, folder: PathBuf, branch: String) {
        if self.running.is_none() && Instant::now() >= self.next {
            self.running = Some(tokio::spawn(fetch(folder, branch)));
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

/// Fetches the remote `branch` follows, saying whether it did.
async fn fetch(folder: PathBuf, branch: String) -> bool {
    let fetched = async {
        let repo = Repo::find(&folder).await.ok()??;
        let key = format!("branch.{branch}.remote");
        let remote = repo.config(&key).await.ok()??;
        // No gc: one that fails would leave its packs behind each time,
        // until the disk is full (T3 Code).
        let args = [
            "fetch",
            "--quiet",
            "--no-tags",
            "--no-auto-gc",
            "--",
            &remote,
        ];
        repo.run(args, Opts::default()).await.ok()
    };
    fetched.await.is_some()
}
