//! The updates module (ADR 0115): each machine updates its own Banda, and
//! its engine decides. It looks at its channel's releases a minute after
//! the engine starts, then every hour, and when asked (`updates.check`);
//! takes the newest engine alone, as the release's engine feed names it
//! ([`feed`]); and puts it in place beside the running one, in the data
//! folder's `engine/`, as the window's copy is laid out ([`take`]). The
//! stream `updates.state` says what it found and took.
//!
//! It takes nothing from a checkout's build (Banda Local), where a package
//! manager owns Banda (`package-type` beside the running program), with
//! `BANDA_UPDATES=off`, or where `machine.toml` says `updates = "off"`.
//! Restarting on the copy it took is ADR 0115's step 4; until then it
//! waits beside the running one.

pub mod feed;
pub mod take;

use banda_kernel::{Call, Kind, Module, ModuleProject, Nothing, Refusal, Right, Scope, Stream};
use banda_machines::TakeUpdates;
use feed::{Feed, Release, Which};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use ts_rs::TS;

/// Banda's releases, as GitHub's REST API serves them.
const RELEASES: &str = "https://api.github.com/repos/0x1oceanlabs/banda";
/// The first look, after the engine starts, and each after it: as the
/// window's updater looks (`client/desktop/src/update.ts`).
const FIRST: Duration = Duration::from_secs(60);
const EVERY: Duration = Duration::from_secs(60 * 60);
/// The Devs read at each look: more than are ever above a running one.
const DEVS: u32 = 30;

/// What this machine's updates are now, as `updates.state` says each
/// change of it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "updates/")]
pub struct UpdateState {
    /// The version this engine runs.
    pub running: String,
    /// The newest version its channel has, as the last look found it;
    /// none before the first look.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub newest: Option<String>,
    /// When it last looked, in ms since the epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub looked: Option<i64>,
    /// The engine it downloads now.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub taking: Option<Taking>,
    /// A newer engine in place beside this one, which it does not run yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ready: Option<String>,
    /// Why the last look or take failed, in words; the next look tries
    /// again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub failed: Option<String>,
    /// Why this machine takes no update by itself, in words: a package
    /// manager owns Banda here, it is a checkout's build, or the Person
    /// turned it off. It then looks at nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub off: Option<String>,
}

/// An engine on its way.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "updates/")]
pub struct Taking {
    pub version: String,
    /// How much of it came, 0 to 1.
    pub share: f64,
    /// Its size, in bytes.
    #[ts(type = "number")]
    pub size: u64,
}

/// What a Banda is, for its updates.
#[derive(Clone, Debug)]
pub struct Banda {
    /// `stable`, `dev` or `local`, as the engine's channel names it.
    pub channel: &'static str,
    /// Its folder's name: `banda`, `banda-dev`, `banda-local`.
    pub folder: &'static str,
    /// The version it runs.
    pub version: String,
    /// The program it runs from.
    pub program: Option<PathBuf>,
    /// Where its copies of the engine are: the data folder's `engine/`.
    pub engine: PathBuf,
}

/// The updates module.
#[derive(Clone)]
pub struct Updates(Arc<Held>);

struct Held {
    banda: Banda,
    /// What machine.toml says of updates, kept current.
    take: watch::Receiver<TakeUpdates>,
    /// Where it reads releases: GitHub's API, or a test's.
    releases: String,
    /// When it looks first and then again.
    first: Duration,
    every: Duration,
    state: watch::Sender<UpdateState>,
    /// One look at a time.
    looking: tokio::sync::Mutex<()>,
    /// The looks run from the first `opened`, once.
    started: AtomicBool,
}

impl Updates {
    pub fn new(banda: Banda, take: watch::Receiver<TakeUpdates>) -> Updates {
        let ready = take::copies(&banda.engine)
            .into_iter()
            .find(|copy| feed::is_above(copy, &banda.version));
        let state = UpdateState {
            running: banda.version.clone(),
            ready,
            ..UpdateState::default()
        };
        Updates(Arc::new(Held {
            banda,
            take,
            releases: RELEASES.to_owned(),
            first: FIRST,
            every: EVERY,
            state: watch::Sender::new(state),
            looking: tokio::sync::Mutex::new(()),
            started: AtomicBool::new(false),
        }))
    }

    /// Reads releases at `releases` instead of GitHub's, and looks first
    /// after `first`, then each `every`: for the tests.
    pub fn reading(self, releases: &str, first: Duration, every: Duration) -> Updates {
        let held = Arc::into_inner(self.0).expect("set before it is shared");
        Updates(Arc::new(Held {
            releases: releases.trim_end_matches('/').to_owned(),
            first,
            every,
            ..held
        }))
    }

    /// What its updates are now, and each change of them.
    pub fn watch(&self) -> watch::Receiver<UpdateState> {
        self.0.state.subscribe()
    }

    /// Why it takes nothing by itself, if it does not.
    fn off(&self) -> Option<String> {
        let banda = &self.0.banda;
        if banda.channel == "local" {
            return Some("A checkout's build never updates itself".to_owned());
        }
        if std::env::var_os("BANDA_UPDATES").is_some_and(|off| off == "off") {
            return Some("BANDA_UPDATES=off: Banda takes no update".to_owned());
        }
        if let Some(manager) = managed(banda.program.as_deref()) {
            return Some(format!("{manager} updates Banda here"));
        }
        if feed::system().is_none() {
            return Some("Banda packs no engine alone for this system yet".to_owned());
        }
        if *self.0.take.borrow() == TakeUpdates::Off {
            return Some("machine.toml says updates = \"off\"".to_owned());
        }
        None
    }

    /// Looks at its channel's releases now, and takes the newest engine
    /// when it is above the one running and the one ready: what
    /// `updates.check` and each hour's look do.
    pub async fn look(&self) -> UpdateState {
        let _one = self.0.looking.lock().await;
        if let Some(off) = self.off() {
            self.0.state.send_modify(|state| {
                state.off = Some(off);
                state.taking = None;
            });
            return self.0.state.borrow().clone();
        }
        let found = self.find().await;
        let looked = banda_kernel::now_ms();
        match found {
            Err(why) => self.0.state.send_modify(|state| {
                state.off = None;
                state.looked = Some(looked);
                state.failed = Some(why);
            }),
            Ok((newest, take)) => {
                self.0.state.send_modify(|state| {
                    state.off = None;
                    state.looked = Some(looked);
                    state.newest = Some(newest);
                    state.failed = None;
                });
                if let Some((url, feed)) = take {
                    self.take(&url, &feed).await;
                }
            }
        }
        self.0.state.borrow().clone()
    }

    /// The newest version its channel has, and the engine to take, when
    /// one is above the one running and the one ready: where its bundle
    /// is and what its feed says.
    async fn find(&self) -> Result<(String, Option<(String, Feed)>), String> {
        let banda = &self.0.banda;
        let which = match banda.channel {
            "stable" => Which::Stable,
            _ => Which::Dev,
        };
        let (os, arch) = feed::system().ok_or("no engine for this system")?;
        let releases = self.releases(which).await?;
        let have = (self.0.state.borrow().ready.clone()).unwrap_or_else(|| banda.version.clone());
        let above = feed::above(&releases, &banda.version, which);
        let newest = (above.first()).map_or_else(|| banda.version.clone(), |(_, v)| v.clone());
        let feed_name = feed::feed_name(which, os);
        for (release, version) in above {
            if !feed::is_above(&version, &have) {
                break;
            }
            let Some(asset) = release.file(&feed_name) else {
                tracing::info!(%version, "no {feed_name} in its release yet");
                continue;
            };
            let text = (take::get(&asset.browser_download_url).await?)
                .text()
                .await
                .map_err(|e| format!("{feed_name}: {}", banda_kernel::https::cause(&e)))?;
            let Some(feed) = Feed::read(&text) else {
                tracing::warn!(%version, "{feed_name} names no file: not taken");
                continue;
            };
            let bundle = feed::bundle_name(banda.folder, &version, os, arch);
            if feed.version != version || feed.file != bundle {
                tracing::warn!(%version, file = %feed.file, "{feed_name} is not this Banda's: not taken");
                continue;
            }
            let Some(asset) = release.file(&bundle) else {
                tracing::info!(%version, "{bundle} is not all there yet");
                continue;
            };
            return Ok((newest, Some((asset.browser_download_url.clone(), feed))));
        }
        Ok((newest, None))
    }

    /// The releases `which` reads: the newest Devs, or the Stable marked
    /// Latest; none before the first.
    async fn releases(&self, which: Which) -> Result<Vec<Release>, String> {
        let path = match which {
            Which::Dev => format!("/releases?per_page={DEVS}"),
            Which::Stable => "/releases/latest".to_owned(),
        };
        let url = format!("{}{path}", self.0.releases);
        let client = banda_kernel::https::client()?;
        let response = (client.get(&url))
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("GitHub: {}", banda_kernel::https::cause(&e)))?;
        let status = response.status().as_u16();
        let header = |name: &str| {
            (response.headers().get(name)).and_then(|value| value.to_str().ok().map(str::to_owned))
        };
        let now = u64::try_from(banda_kernel::now_ms() / 1000).unwrap_or_default();
        let (remaining, reset) = (header("x-ratelimit-remaining"), header("x-ratelimit-reset"));
        if let Some(limited) = feed::limited(status, remaining.as_deref(), reset.as_deref(), now) {
            return Err(limited);
        }
        if which == Which::Stable && status == 404 {
            return Ok(Vec::new());
        }
        if !response.status().is_success() {
            return Err(format!("GitHub answered {status} for Banda's releases"));
        }
        let text = (response.text().await)
            .map_err(|e| format!("GitHub: {}", banda_kernel::https::cause(&e)))?;
        match which {
            Which::Dev => serde_json::from_str(&text),
            Which::Stable => serde_json::from_str(&text).map(|one| vec![one]),
        }
        .map_err(|e| format!("GitHub's releases did not read: {e}"))
    }

    /// Downloads, checks and puts in place the engine at `url`.
    async fn take(&self, url: &str, feed: &Feed) {
        let engine = &self.0.banda.engine;
        let version = feed.version.clone();
        tracing::info!(%version, "taking a new engine");
        let start = Taking {
            version: version.clone(),
            share: 0.0,
            size: feed.size,
        };
        self.0.state.send_modify(|state| state.taking = Some(start));
        let bundle = engine.join(format!(".{version}.tar.gz"));
        let taken = async {
            std::fs::create_dir_all(engine).map_err(|e| format!("{}: {e}", engine.display()))?;
            let mut told = 0.0;
            take::download(url, feed, &bundle, |share| {
                // A change a window sees: a percent or more.
                if share - told >= 0.01 || share >= 1.0 {
                    told = share;
                    self.0.state.send_modify(|state| {
                        if let Some(taking) = &mut state.taking {
                            taking.share = share;
                        }
                    });
                }
            })
            .await?;
            take::place(&bundle, engine, &version).await
        }
        .await;
        let _ = std::fs::remove_file(&bundle);
        match taken {
            Ok(kept) => {
                tracing::info!(%version, folder = %kept.display(), "a new engine is in place");
                take::prune(engine, &self.0.banda.version);
                self.0.state.send_modify(|state| {
                    state.taking = None;
                    state.ready = Some(version);
                    state.failed = None;
                });
            }
            Err(why) => {
                tracing::warn!(%version, %why, "the new engine was not taken");
                self.0.state.send_modify(|state| {
                    state.taking = None;
                    state.failed = Some(format!("Could not take {version}: {why}"));
                });
            }
        }
    }
}

/// Who owns Banda where `program` runs: what `package-type` beside it
/// says, as electron-builder's packages and the AUR's write it (ADR 0086,
/// decision 2).
fn managed(program: Option<&std::path::Path>) -> Option<String> {
    let said = std::fs::read_to_string(program?.parent()?.join("package-type")).ok()?;
    let said = said.trim();
    Some(
        if said.is_empty() {
            "A package manager"
        } else {
            said
        }
        .to_owned(),
    )
}

banda_kernel::methods! {
    Updates(Call) as "UpdatesMethods" in "updates/" {
        /// Looks at this machine's channel now, and takes the newest
        /// engine when it is newer; answers what it found.
        call check(Nothing) -> UpdateState, Write;
        /// What this machine's updates are, then that again on each
        /// change: what it runs, the newest found, what it takes, what is
        /// ready, and why not.
        stream state(Nothing) -> UpdateState, Read;
    }
}

impl Updates {
    async fn check(&self, _: Call, _: Nothing) -> Result<UpdateState, Refusal> {
        Ok(self.look().await)
    }

    async fn state(&self, _: Call, _: Nothing) -> Result<Stream, Refusal> {
        Ok(follow(self.watch()))
    }
}

/// Each value of `changes`, the current one first, as a stream's pieces.
fn follow(mut changes: watch::Receiver<UpdateState>) -> Stream {
    let (say, heard) = mpsc::channel(1);
    tokio::spawn(async move {
        loop {
            let now = changes.borrow_and_update().clone();
            let Ok(said) = serde_json::to_value(&now) else {
                return;
            };
            if say.send(said).await.is_err() || changes.changed().await.is_err() {
                return;
            }
        }
    });
    heard
}

#[async_trait::async_trait]
impl Module for Updates {
    fn name(&self) -> &'static str {
        "updates"
    }

    fn scope(&self) -> Scope {
        Scope::Machine
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    /// Looks a minute after the engine starts, then each hour.
    async fn opened(&self, _: ModuleProject) -> Result<(), banda_kernel::Error> {
        if self.0.started.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        let updates = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(updates.0.first).await;
            loop {
                updates.look().await;
                tokio::time::sleep(updates.0.every).await;
            }
        });
        Ok(())
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }

    async fn stream(&self, call: Call, method: &str, params: Value) -> Result<Stream, Refusal> {
        self.dispatch_stream(call, method, params).await
    }
}
