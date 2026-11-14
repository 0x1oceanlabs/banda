//! The updates module (ADR 0119): each machine updates its own Banda, and
//! its engine decides. It looks at its channel's releases a minute after
//! the engine starts, then every hour, and when asked (`updates.check`);
//! takes the newest engine alone, as the release's engine feed names it
//! ([`feed`]); and puts it in place beside the running one, in the data
//! folder's `engine/`, as the window's copy is laid out ([`take`]). The
//! stream `updates.state` says what it found and took. A newer copy
//! already in place, as the one a window put there as its app updated,
//! is ready at the next look, as one it took: the newest copy wins,
//! whoever put it there.
//!
//! The looks and the takes run in `banda-update`, a program of its own
//! beside the engine's (ADR 0131, decision 2), never in the engine's
//! process: the engine asks it, or follows what its service keeps.
//!
//! It takes nothing from a checkout's build (Banda Local), where a package
//! manager owns Banda (`package-type` beside the running program), with
//! `BANDA_UPDATES=off`, where `machine.toml` says `updates = "off"`, or
//! where the engine's copy carries no `banda-update`.
//!
//! Once a copy is in place, the engine moves onto it as soon as nothing
//! runs ([`restart`]): no Turn, no terminal open, no key in the last ten
//! minutes; with `updates = "ask"`, once the Person says
//! (`updates.restart`). The window's child waits for Banda to restart.
//! `updates.take` puts a given version in place, an older one too, and
//! the looks then take nothing above it until the Person takes the newest
//! again: the choice is kept in `engine/chosen`.

pub mod daemon;
pub mod feed;
pub mod guard;
pub mod restart;
pub mod take;

use banda_kernel::{
    Call, InHand, Kind, Module, ModuleProject, Nothing, Refusal, Right, Scope, Stream,
};
use banda_machines::TakeUpdates;
use feed::{Feed, Release, Which};
use restart::{Facts, Next, Refused, Restart, Waits};
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
/// The first look, after the engine starts, and each after it; the
/// window's app reads what each found (`platform/updates/desktop`).
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
    /// A copy in place beside this one, which it moves onto: a newer
    /// one, or the one chosen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ready: Option<String>,
    /// What the copy ready waits for before the engine moves onto it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub waits: Option<Waits>,
    /// The version the Person chose (`banda update --version`): the looks
    /// take nothing above it until they take the newest again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub chosen: Option<String>,
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
    /// When the newest version's release was published, in ms since the
    /// epoch, as the last look found it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub published: Option<i64>,
    /// How this engine came to run its version, when it moved onto it
    /// from another (ADR 0119, decision 3); none for one started so.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub updated: Option<Updated>,
    /// What `machine.toml`'s `updates` says: `when-idle`, `ask` or `off`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub takes: Option<TakeUpdates>,
}

/// An engine that moved onto the version it runs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "updates/")]
pub struct Updated {
    /// The version it ran before.
    pub from: String,
    /// When it moved, in ms since the epoch.
    #[ts(type = "number")]
    pub at: i64,
    /// It moved by itself, once nothing ran; not as the Person said.
    pub idle: bool,
}

/// The file in `engine/` that keeps how the engine last moved, for the
/// copy it moved onto: `{ "to": …, "from": …, "at": …, "idle": … }`,
/// and `"arrived": true` once that copy ran two minutes (`guard`).
pub(crate) const MOVED: &str = "moved";

/// How the engine that runs `version` came to it, as `engine/moved`
/// says, when it moved onto it.
fn moved(engine: &std::path::Path, version: &str) -> Option<Updated> {
    #[derive(Deserialize)]
    struct Moved {
        to: String,
        #[serde(flatten)]
        updated: Updated,
    }
    let said: Moved =
        serde_json::from_str(&std::fs::read_to_string(engine.join(MOVED)).ok()?).ok()?;
    (said.to == version).then_some(said.updated)
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
    /// How it moves onto a copy, and what it waits for; none in a test
    /// that only looks.
    restarting: Option<Restarting>,
    /// `banda-update`, which looks and takes for the engine (ADR 0131,
    /// decision 2); none where this process is `banda-update` itself, or
    /// a test that looks in its own.
    program: Option<PathBuf>,
    /// The engine found no `banda-update` beside it: it takes nothing,
    /// and says so. It never looks or takes in its own process.
    lacks: bool,
    /// The service it runs as beside the engine's, which looks every hour
    /// and guards a move; none where the engine looks itself.
    service: Option<daemon::Service>,
}

/// What the restart reads, and how it asks for one.
struct Restarting {
    restart: Restart,
    /// The Turns that run on this machine.
    turns: watch::Receiver<usize>,
    /// The terminals open, and the Person's last key.
    hands: watch::Receiver<InHand>,
}

/// The file in `engine/` that keeps the version the Person chose.
const CHOSEN: &str = "chosen";

impl Updates {
    pub fn new(banda: Banda, take: watch::Receiver<TakeUpdates>) -> Updates {
        let state = UpdateState {
            running: banda.version.clone(),
            ready: in_place(&banda),
            chosen: chosen(&banda.engine),
            updated: moved(&banda.engine, &banda.version),
            takes: Some(*take.borrow()),
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
            restarting: None,
            program: None,
            lacks: false,
            service: None,
        }))
    }

    /// The engine's, with no `banda-update` beside it: it takes no
    /// update, and says why.
    pub fn lacking(self) -> Updates {
        let held = Arc::into_inner(self.0).expect("set before it is shared");
        Updates(Arc::new(Held {
            lacks: true,
            ..held
        }))
    }

    /// Runs `banda-update` as its own service, `service`, once the engine
    /// opens: it then looks every hour in place of the engine.
    pub fn serving(self, service: daemon::Service) -> Updates {
        let held = Arc::into_inner(self.0).expect("set before it is shared");
        Updates(Arc::new(Held {
            service: Some(service),
            ..held
        }))
    }

    /// Looks and takes through the `banda-update` at `program`, in a
    /// process of its own, not in this one.
    pub fn through(self, program: PathBuf) -> Updates {
        let held = Arc::into_inner(self.0).expect("set before it is shared");
        Updates(Arc::new(Held {
            program: Some(program),
            ..held
        }))
    }

    /// Moves onto a copy in place through `restart`, once no Turn counted
    /// in `turns` runs and `hands` holds nothing.
    pub fn restarts(
        self,
        restart: Restart,
        turns: watch::Receiver<usize>,
        hands: watch::Receiver<InHand>,
    ) -> Updates {
        let held = Arc::into_inner(self.0).expect("set before it is shared");
        Updates(Arc::new(Held {
            restarting: Some(Restarting {
                restart,
                turns,
                hands,
            }),
            ..held
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
        if self.0.lacks {
            return Some(
                "This copy of Banda carries no banda-update: update Banda's app".to_owned(),
            );
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
        if self.0.program.is_some() {
            return self.ask(&["check"]).await.unwrap_or_else(|why| {
                self.0.state.send_modify(|state| state.failed = Some(why));
                self.0.state.borrow().clone()
            });
        }
        let _one = self.0.looking.lock().await;
        if let Some(off) = self.off() {
            self.0.state.send_modify(|state| {
                state.off = Some(off);
                state.taking = None;
            });
            return self.0.state.borrow().clone();
        }
        let chosen = chosen(&self.0.banda.engine);
        self.found_in_place(chosen.as_deref());
        let found = self.find().await;
        let looked = banda_kernel::now_ms();
        match found {
            Err(why) => self.0.state.send_modify(|state| {
                state.off = None;
                state.looked = Some(looked);
                state.failed = Some(why);
            }),
            Ok((newest, published, take)) => {
                self.0.state.send_modify(|state| {
                    state.off = None;
                    state.looked = Some(looked);
                    state.newest = Some(newest);
                    state.published = published;
                    state.failed = None;
                    state.chosen.clone_from(&chosen);
                });
                // Nothing above the version the Person chose.
                if let Some((url, feed)) = take.filter(|_| chosen.is_none()) {
                    self.take_bundle(&url, &feed).await;
                }
            }
        }
        self.0.state.borrow().clone()
    }

    /// Takes a copy above the running one that is already in place as
    /// ready, as the one a window put there when its app updated
    /// (`client/desktop/src/program.ts`): the engine moves onto it as onto
    /// one it took, and downloads it no more. Nothing while the Person
    /// chose a version.
    fn found_in_place(&self, chosen: Option<&str>) {
        if chosen.is_some() {
            return;
        }
        let running = &self.0.banda.version;
        let Some(newest) =
            (takeable(&self.0.banda.engine).into_iter()).find(|copy| feed::is_above(copy, running))
        else {
            return;
        };
        self.0.state.send_if_modified(|state| {
            let above = (state.ready.as_deref()).is_none_or(|ready| feed::is_above(&newest, ready));
            if above {
                tracing::info!(version = %newest, "a newer engine is in place");
                state.ready = Some(newest);
            }
            above
        });
    }

    /// The newest version its channel has, and the engine to take, when
    /// one is above the one running and the one ready: where its bundle
    /// is and what its feed says.
    async fn find(&self) -> Result<(String, Option<i64>, Option<(String, Feed)>), String> {
        let banda = &self.0.banda;
        let which = match banda.channel {
            "stable" => Which::Stable,
            _ => Which::Dev,
        };
        let releases = self.releases(which).await?;
        let have = (self.0.state.borrow().ready.clone()).unwrap_or_else(|| banda.version.clone());
        let above = feed::above(&releases, &banda.version, which);
        let newest = (above.first()).map_or_else(|| banda.version.clone(), |(_, v)| v.clone());
        let published = (releases.iter())
            .find(|release| release.tag_name.strip_prefix('v') == Some(newest.as_str()))
            .and_then(feed::Release::published);
        let bad = guard::bad(&banda.engine);
        for (release, version) in above {
            if !feed::is_above(&version, &have) {
                break;
            }
            // One that did not start is never taken again.
            if bad.contains(&version) {
                continue;
            }
            if let Ok(found) = self.bundle(which, release, &version).await? {
                return Ok((newest, published, Some(found)));
            }
        }
        Ok((newest, published, None))
    }

    /// Where `release`'s engine for this system is, and what its feed
    /// says; `Ok(Err(why))` when it has none to take, as one not all
    /// there yet.
    async fn bundle(
        &self,
        which: Which,
        release: &Release,
        version: &str,
    ) -> Result<Result<(String, Feed), String>, String> {
        let (os, arch) = feed::system().ok_or("no engine for this system")?;
        let feed_name = feed::feed_name(which, os);
        let Some(asset) = release.file(&feed_name) else {
            tracing::info!(%version, "no {feed_name} in its release yet");
            return Ok(Err(format!("{version}'s release has no {feed_name}")));
        };
        let text = take::within(
            &feed_name,
            (take::get(&asset.browser_download_url).await?).text(),
        )
        .await?
        .map_err(|e| format!("{feed_name}: {}", banda_kernel::https::cause(&e)))?;
        let Some(feed) = Feed::read(&text) else {
            tracing::warn!(%version, "{feed_name} names no file: not taken");
            return Ok(Err(format!("{version}'s {feed_name} names no file")));
        };
        let bundle = feed::bundle_name(self.0.banda.folder, version, os, arch);
        if feed.version != version || feed.file != bundle {
            tracing::warn!(%version, file = %feed.file, "{feed_name} is not this Banda's: not taken");
            return Ok(Err(format!("{version}'s {feed_name} is not this Banda's")));
        }
        let Some(asset) = release.file(&bundle) else {
            tracing::info!(%version, "{bundle} is not all there yet");
            return Ok(Err(format!("{bundle} is not all there yet")));
        };
        Ok(Ok((asset.browser_download_url.clone(), feed)))
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
            .timeout(take::ANSWERS)
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
    async fn take_bundle(&self, url: &str, feed: &Feed) {
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
                let chosen = chosen(engine);
                let mut keep = vec![self.0.banda.version.as_str(), version.as_str()];
                keep.extend(chosen.as_deref());
                take::prune(engine, &keep);
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

impl Updates {
    /// Runs `banda-update` with `command` for this Banda, and takes what
    /// it says at each change into the state: what the look and the take
    /// own, never what the engine does (what the copy waits for, how the
    /// engine came to its version, machine.toml's word). Answers its
    /// last word; fails when it could not run, or said nothing.
    async fn ask(&self, command: &[&str]) -> Result<UpdateState, String> {
        use tokio::io::AsyncBufReadExt;
        let program = self.0.program.as_ref().ok_or("no banda-update")?;
        let _one = self.0.looking.lock().await;
        let banda = &self.0.banda;
        let takes = serde_json::to_value(*self.0.take.borrow())
            .ok()
            .and_then(|said| said.as_str().map(str::to_owned))
            .unwrap_or_else(|| "when-idle".to_owned());
        let mut run = tokio::process::Command::new(program);
        run.args(command)
            .args(["--running", &banda.version])
            .args(["--channel", banda.channel])
            .args(["--folder", banda.folder])
            .arg("--engine")
            .arg(&banda.engine)
            .args(["--takes", &takes])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(own) = &banda.program {
            run.arg("--program").arg(own);
        }
        if self.0.releases != RELEASES {
            run.args(["--releases", &self.0.releases]);
        }
        let mut child = run
            .spawn()
            .map_err(|e| format!("banda-update did not start ({}): {e}", program.display()))?;
        let out = child.stdout.take().ok_or("banda-update has no stdout")?;
        let mut lines = tokio::io::BufReader::new(out).lines();
        let mut last = None;
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(said) = serde_json::from_str::<UpdateState>(&line) else {
                continue;
            };
            self.heard(&said);
            last = Some(());
        }
        let status = child
            .wait()
            .await
            .map_err(|e| format!("banda-update: {e}"))?;
        if last.is_none() {
            return Err(format!("banda-update said nothing and ended: {status}"));
        }
        Ok(self.0.state.borrow().clone())
    }
}

impl Updates {
    /// Takes what `banda-update` said into the state: what the look and
    /// the take own, never what the engine does (what the copy waits for,
    /// how the engine came to its version, machine.toml's word).
    fn heard(&self, said: &UpdateState) {
        if said.running != self.0.banda.version {
            return;
        }
        self.0.state.send_modify(|state| {
            state.newest.clone_from(&said.newest);
            state.looked = said.looked;
            state.taking.clone_from(&said.taking);
            state.ready.clone_from(&said.ready);
            state.chosen.clone_from(&said.chosen);
            state.failed.clone_from(&said.failed);
            state.off.clone_from(&said.off);
            state.published = said.published;
        });
    }

    /// Marks the copy this engine moved onto and came back from as one
    /// that did not start, before anything moves: it crashed, and the
    /// engine's unit, or job, started this copy again, which else moves
    /// onto it again, and again (`guard::came_back`).
    fn back_from_a_copy(&self) {
        let banda = &self.0.banda;
        let Some(to) = guard::came_back(&banda.engine, &banda.version) else {
            return;
        };
        tracing::warn!(%to, running = %banda.version, "the new engine did not start: Banda went back");
        if let Err(error) = guard::mark_bad(&banda.engine, &to) {
            tracing::warn!(%error, "the copy that did not start is not marked");
            // Unmarked, it is still not moved onto while this engine runs.
        }
        let ready = in_place(banda).filter(|ready| *ready != to);
        self.0.state.send_modify(|state| {
            state.ready = ready;
            state.failed = Some(format!(
                "{to} did not start: Banda went back to {}",
                banda.version
            ));
        });
    }

    /// Starts `banda-update run` as its own service, where the engine is
    /// its machine's service too and takes updates: says whether it runs.
    async fn service_started(&self) -> bool {
        let (Some(program), Some(service), Some(restarting)) =
            (&self.0.program, &self.0.service, &self.0.restarting)
        else {
            return false;
        };
        if *restarting.restart.moves() != restart::Moves::Itself || self.off().is_some() {
            return false;
        }
        daemon::start(program, &self.0.banda, service).await
    }

    /// Follows what the service keeps of each look (`engine/state.json`).
    async fn follow_service(self) {
        let mut seen = None;
        loop {
            if let Some((said, when)) = guard::kept_state(&self.0.banda.engine)
                && seen != Some(when)
            {
                seen = Some(when);
                self.heard(&said);
            }
            tokio::time::sleep(Duration::from_secs(10)).await;
        }
    }
}

/// The copy in place `banda` moves onto: the one chosen, when it is not
/// the one running, else the newest above it.
fn in_place(banda: &Banda) -> Option<String> {
    let copies = takeable(&banda.engine);
    match chosen(&banda.engine) {
        Some(chosen) => (chosen != banda.version && copies.contains(&chosen)).then_some(chosen),
        None => (copies.into_iter()).find(|copy| feed::is_above(copy, &banda.version)),
    }
}

/// The copies in place that may be moved onto: all but those that did
/// not start (`guard::bad`).
fn takeable(engine: &std::path::Path) -> Vec<String> {
    let bad = guard::bad(engine);
    (take::copies(engine).into_iter())
        .filter(|copy| !bad.contains(copy))
        .collect()
}

/// The version the Person chose, as `engine/chosen` keeps it.
fn chosen(engine: &std::path::Path) -> Option<String> {
    let said = std::fs::read_to_string(engine.join(CHOSEN)).ok()?;
    Some(said.trim().to_owned()).filter(|said| !said.is_empty())
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
        /// ready, what that waits for, and why not.
        stream state(Nothing) -> UpdateState, Read;
        /// Restart now: the engine moves onto the copy ready at once,
        /// which ends its Turns and terminals. It refuses while Turns run,
        /// unless `force`: the Person said so after Quit's warning.
        call restart(RestartNow) -> Moving, Manage;
        /// Puts `version` in place, an older one too, and keeps it as
        /// chosen: the engine moves onto it as it moves onto any copy
        /// ready, and the looks take nothing above it. `newest` drops the
        /// choice and looks again.
        call take(TakeVersion) -> UpdateState, Manage;
    }
}

/// What Restart now asks.
#[derive(Deserialize, TS)]
#[ts(export_to = "updates/")]
struct RestartNow {
    /// Moves while Turns run, which it ends.
    #[serde(default)]
    #[ts(optional)]
    force: Option<bool>,
}

/// What `take` asks.
#[derive(Deserialize, TS)]
#[ts(export_to = "updates/")]
struct TakeVersion {
    /// A version of this machine's channel, or `newest`.
    version: String,
}

/// The engine is moving: from the version it ran onto the one ready.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "updates/")]
pub struct Moving {
    pub from: String,
    pub to: String,
}

/// What `take` takes `newest` as: the choice dropped.
const NEWEST: &str = "newest";

impl Updates {
    async fn check(&self, _: Call, _: Nothing) -> Result<UpdateState, Refusal> {
        Ok(self.look().await)
    }

    async fn state(&self, _: Call, _: Nothing) -> Result<Stream, Refusal> {
        Ok(follow(self.watch()))
    }

    async fn restart(&self, _: Call, RestartNow { force }: RestartNow) -> Result<Moving, Refusal> {
        self.restart_now(force.unwrap_or(false))
    }

    async fn take(
        &self,
        _: Call,
        TakeVersion { version }: TakeVersion,
    ) -> Result<UpdateState, Refusal> {
        self.choose(&version).await
    }

    /// Restart now: moves onto the copy ready, unless Turns run and not
    /// `force`.
    pub fn restart_now(&self, force: bool) -> Result<Moving, Refusal> {
        let Some(restarting) = &self.0.restarting else {
            return Err(Refusal::invalid("This engine does not restart itself."));
        };
        let facts = self.facts(restarting);
        let running = &self.0.banda.version;
        match restart::now(&facts, force) {
            Ok(()) => {}
            Err(Refused::Nothing) => {
                return Err(Refusal::conflict(format!(
                    "No other copy is ready: {running} is the newest in place. banda update \
                     --check looks for one."
                )));
            }
            Err(Refused::Never(why)) => return Err(Refusal::conflict(why)),
            Err(Refused::Working(turns)) => {
                let agents = match turns {
                    1 => "An Agent works".to_owned(),
                    _ => format!("{turns} Agents work"),
                };
                return Err(Refusal::conflict(format!(
                    "{agents} on this machine: restarting stops them too. Nothing was \
                     restarted: force restarts anyway."
                )));
            }
        }
        self.move_now(restarting, false)
            .ok_or_else(|| Refusal::conflict("The copy ready is gone from its folder."))
    }

    /// Puts `version` in place and keeps it as chosen; `newest` drops the
    /// choice and looks again.
    pub async fn choose(&self, version: &str) -> Result<UpdateState, Refusal> {
        if self.0.program.is_some() {
            let state = self
                .ask(&["take", version])
                .await
                .map_err(Refusal::conflict)?;
            return match state.failed {
                Some(failed) if state.chosen.as_deref() != Some(version) => {
                    Err(Refusal::conflict(failed))
                }
                _ => Ok(state),
            };
        }
        let version = version.to_owned();
        let engine = &self.0.banda.engine;
        if version == NEWEST {
            let _ = std::fs::remove_file(engine.join(CHOSEN));
            // The newest copy in place waits again, not the one chosen.
            let ready = (takeable(engine).into_iter())
                .find(|copy| feed::is_above(copy, &self.0.banda.version));
            self.0.state.send_modify(|state| {
                state.chosen = None;
                state.ready = ready;
            });
            return Ok(self.look().await);
        }
        if feed::Version::of(&version).is_none() {
            return Err(Refusal::invalid(format!(
                "\"{version}\" is not a version of Banda's, as 0.1.0-dev.660, or newest."
            )));
        }
        let _one = self.0.looking.lock().await;
        if let Some(off) = self
            .off()
            .filter(|_| *self.0.take.borrow() != TakeUpdates::Off)
        {
            return Err(Refusal::conflict(off));
        }
        let running = self.0.banda.version.clone();
        if version != running && !take::copies(engine).contains(&version) {
            let (url, feed) = self.release(&version).await.map_err(Refusal::conflict)?;
            self.take_bundle(&url, &feed).await;
            if let Some(failed) = self.0.state.borrow().failed.clone() {
                return Err(Refusal::conflict(failed));
            }
        }
        std::fs::create_dir_all(engine)
            .and_then(|()| std::fs::write(engine.join(CHOSEN), format!("{version}\n")))
            .map_err(|e| Refusal::conflict(format!("{}: {e}", engine.display())))?;
        tracing::info!(%version, "the Person chose this engine");
        self.0.state.send_modify(|state| {
            state.chosen = Some(version.clone());
            state.ready = (version != running).then(|| version.clone());
            state.failed = None;
        });
        Ok(self.0.state.borrow().clone())
    }

    /// Where release `version`'s engine is, and what its feed says.
    async fn release(&self, version: &str) -> Result<(String, Feed), String> {
        let which = match self.0.banda.channel {
            "stable" => Which::Stable,
            _ => Which::Dev,
        };
        let url = format!("{}/releases/tags/v{version}", self.0.releases);
        let client = banda_kernel::https::client()?;
        let response = (client.get(&url))
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .timeout(take::ANSWERS)
            .send()
            .await
            .map_err(|e| format!("GitHub: {}", banda_kernel::https::cause(&e)))?;
        if response.status().as_u16() == 404 {
            return Err(format!("Banda has no release {version}"));
        }
        if !response.status().is_success() {
            return Err(format!(
                "GitHub answered {} for {version}",
                response.status().as_u16()
            ));
        }
        let text = (response.text().await)
            .map_err(|e| format!("GitHub: {}", banda_kernel::https::cause(&e)))?;
        let release: Release = serde_json::from_str(&text)
            .map_err(|e| format!("GitHub's release {version} did not read: {e}"))?;
        if !which.takes(&release) {
            return Err(format!(
                "{version} is not a release of this Banda's channel"
            ));
        }
        self.bundle(which, &release, version).await?
    }

    /// What holds now, for the restart's policy.
    fn facts<'a>(&self, restarting: &'a Restarting) -> Facts<'a> {
        Facts {
            ready: self.0.state.borrow().ready.is_some(),
            take: *self.0.take.borrow(),
            moves: restarting.restart.moves(),
            turns: *restarting.turns.borrow(),
            in_hand: *restarting.hands.borrow(),
            now: banda_kernel::now_ms(),
        }
    }

    /// Asks the engine to move onto the copy ready, by itself once `idle`,
    /// or as the Person said: what it moves from and onto, unless the copy
    /// is gone. The copy hears how in `engine/moved`.
    fn move_now(&self, restarting: &Restarting, idle: bool) -> Option<Moving> {
        let to = self.0.state.borrow().ready.clone()?;
        let program = self.0.banda.engine.join(&to).join(PROGRAM);
        if !program.is_file() {
            tracing::warn!(version = %to, "the copy ready has no program: not moved onto");
            self.0.state.send_modify(|state| state.ready = None);
            return None;
        }
        let from = self.0.banda.version.clone();
        tracing::info!(%from, %to, "the engine moves onto the copy ready");
        let said = serde_json::json!({
            "to": to,
            "from": from,
            "at": banda_kernel::now_ms(),
            "idle": idle,
        });
        if let Err(e) = std::fs::write(self.0.banda.engine.join(MOVED), said.to_string()) {
            tracing::warn!(%e, "how the engine moved is not kept");
        }
        restarting.restart.ask(program);
        Some(Moving { from, to })
    }

    /// Moves onto a copy ready once [`restart::next`] says, and says what
    /// it waits for meanwhile; until the engine moves.
    async fn drive(self) {
        let Some(restarting) = &self.0.restarting else {
            return;
        };
        let mut state = self.watch();
        let mut turns = restarting.turns.clone();
        let mut hands = restarting.hands.clone();
        let mut take = self.0.take.clone();
        loop {
            state.borrow_and_update();
            turns.borrow_and_update();
            hands.borrow_and_update();
            take.borrow_and_update();
            let waits = match restart::next(&self.facts(restarting)) {
                Next::Move if self.move_now(restarting, true).is_some() => return,
                Next::Move | Next::Nothing => None,
                Next::Wait(waits) => Some(waits),
            };
            let quiet = (waits.as_ref())
                .and_then(|waits| waits.typed_until)
                .map(|until| until - banda_kernel::now_ms());
            self.0.state.send_if_modified(|state| {
                let changed = state.waits != waits;
                state.waits = waits;
                changed
            });
            let quiet = async move {
                match quiet {
                    Some(left) => {
                        let left = u64::try_from(left.max(0)).unwrap_or_default();
                        tokio::time::sleep(Duration::from_millis(left)).await;
                    }
                    None => std::future::pending().await,
                }
            };
            let gone = tokio::select! {
                changed = state.changed() => changed.is_err(),
                changed = turns.changed() => changed.is_err(),
                changed = hands.changed() => changed.is_err(),
                changed = take.changed() => changed.is_err(),
                () = quiet => false,
            };
            if gone {
                return;
            }
        }
    }
}

/// The engine's program in its copy's folder.
pub(crate) const PROGRAM: &str = if cfg!(windows) { "banda.exe" } else { "banda" };

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

    /// Looks a minute after the engine starts, then each hour, and
    /// moves onto a copy ready once nothing runs.
    async fn opened(&self, _: ModuleProject) -> Result<(), banda_kernel::Error> {
        if self.0.started.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        self.back_from_a_copy();
        // A copy that ran this long arrived: a later start of the copy
        // before is not read as its crash.
        let (engine, version) = (self.0.banda.engine.clone(), self.0.banda.version.clone());
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(guard::GRACE_MS.unsigned_abs())).await;
            guard::keep_arrived(&engine, &version);
        });
        tokio::spawn(self.clone().drive());
        // machine.toml's `updates`, as the state says it.
        let said = self.0.state.clone();
        let mut take = self.0.take.clone();
        tokio::spawn(async move {
            while take.changed().await.is_ok() {
                let now = *take.borrow_and_update();
                said.send_if_modified(|state| {
                    let changed = state.takes != Some(now);
                    state.takes = Some(now);
                    changed
                });
            }
        });
        let updates = self.clone();
        tokio::spawn(async move {
            // The service looks every hour where it runs, and the engine
            // follows what it keeps; where it does not, the engine looks.
            if updates.service_started().await {
                updates.follow_service().await;
                return;
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use restart::Moves;

    /// A machine running dev.10 with dev.11 in place, which moves as
    /// `moves` says.
    struct Machine {
        updates: Updates,
        restart: Restart,
        turns: watch::Sender<usize>,
        hands: watch::Sender<InHand>,
        take: watch::Sender<TakeUpdates>,
        engine: PathBuf,
        _folder: tempfile::TempDir,
    }

    fn machine(moves: Moves) -> Machine {
        let folder = tempfile::tempdir().unwrap();
        let engine = folder.path().join("engine");
        let copy = engine.join("0.1.0-dev.11");
        std::fs::create_dir_all(&copy).unwrap();
        // As take::copies finds one, and the program the engine runs.
        std::fs::write(copy.join("banda"), "").unwrap();
        std::fs::write(copy.join(PROGRAM), "").unwrap();
        std::fs::write(copy.join("version"), "banda 0.1.0-dev.11 (build b)\n").unwrap();
        let banda = Banda {
            channel: "dev",
            folder: "banda-dev",
            version: "0.1.0-dev.10".to_owned(),
            program: None,
            engine: engine.clone(),
        };
        let (take, taken) = watch::channel(TakeUpdates::WhenIdle);
        let (turns, counted) = watch::channel(0);
        let (hands, held) = watch::channel(InHand::default());
        let restart = Restart::new(moves);
        let updates = Updates::new(banda, taken).restarts(restart.clone(), counted, held);
        Machine {
            updates,
            restart,
            turns,
            hands,
            take,
            engine,
            _folder: folder,
        }
    }

    /// The next `waits` the state says, past those `until` refuses.
    async fn waits_until(
        state: &mut watch::Receiver<UpdateState>,
        until: impl Fn(&Option<Waits>) -> bool,
    ) -> Option<Waits> {
        let waits = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let waits = state.borrow_and_update().waits.clone();
                if until(&waits) {
                    return waits;
                }
                state.changed().await.unwrap();
            }
        });
        waits.await.expect("the state said it")
    }

    #[tokio::test]
    async fn the_engine_moves_once_nothing_runs_and_says_what_it_waits_for() {
        let machine = machine(Moves::Itself);
        let mut state = machine.updates.watch();
        assert_eq!(state.borrow().ready.as_deref(), Some("0.1.0-dev.11"));
        machine.turns.send_replace(2);
        machine.hands.send_replace(InHand {
            terminals: 1,
            typed: None,
        });
        tokio::spawn(machine.updates.clone().drive());

        let waits = waits_until(&mut state, Option::is_some).await.unwrap();
        assert_eq!((waits.turns, waits.terminals), (2, 1));
        machine.turns.send_replace(0);
        let waits = waits_until(&mut state, |w| w.as_ref().is_some_and(|w| w.turns == 0)).await;
        assert_eq!(waits.unwrap().terminals, 1, "the terminal holds it still");

        machine.hands.send_replace(InHand::default());
        let program = tokio::time::timeout(Duration::from_secs(5), machine.restart.asked())
            .await
            .expect("it moved");
        assert_eq!(program, machine.engine.join("0.1.0-dev.11").join(PROGRAM));
        // The copy it moved onto says it updated, by itself; another
        // version's engine says nothing of it.
        let updated = moved(&machine.engine, "0.1.0-dev.11").expect("kept");
        assert_eq!(
            (updated.from.as_str(), updated.idle),
            ("0.1.0-dev.10", true)
        );
        assert_eq!(moved(&machine.engine, "0.1.0-dev.10"), None);
    }

    #[tokio::test]
    async fn ask_waits_for_the_person_and_restart_now_warns_while_turns_run() {
        let machine = machine(Moves::Itself);
        machine.take.send_replace(TakeUpdates::Ask);
        let mut state = machine.updates.watch();
        tokio::spawn(machine.updates.clone().drive());
        let waits = waits_until(&mut state, Option::is_some).await.unwrap();
        assert!(waits.person, "{waits:?}");

        machine.turns.send_replace(1);
        let refused = machine.updates.restart_now(false).unwrap_err();
        assert!(refused.message.contains("An Agent works"), "{refused:?}");
        let moving = machine.updates.restart_now(true).unwrap();
        assert_eq!(
            (moving.from.as_str(), moving.to.as_str()),
            ("0.1.0-dev.10", "0.1.0-dev.11")
        );
        assert_eq!(
            machine.restart.asked().await,
            machine.engine.join("0.1.0-dev.11").join(PROGRAM)
        );
        let updated = moved(&machine.engine, "0.1.0-dev.11").unwrap();
        assert!(!updated.idle, "the Person said");
    }

    /// The engine moved from dev.10 onto dev.11, as `engine/moved` says.
    fn moved_onto_the_copy(machine: &Machine) {
        std::fs::write(
            machine.engine.join(MOVED),
            r#"{"to":"0.1.0-dev.11","from":"0.1.0-dev.10","at":1000,"idle":true}"#,
        )
        .unwrap();
    }

    #[tokio::test]
    async fn an_engine_back_from_a_copy_that_crashed_does_not_move_onto_it_again() {
        let machine = machine(Moves::Itself);
        // dev.11 crashed as it started, and the unit started dev.10 again.
        moved_onto_the_copy(&machine);
        machine.updates.back_from_a_copy();
        let state = machine.updates.watch().borrow().clone();
        assert_eq!(state.ready, None);
        let failed = state.failed.expect("it says why");
        assert!(failed.contains("0.1.0-dev.11 did not start"), "{failed}");
        assert_eq!(guard::bad(&machine.engine), ["0.1.0-dev.11"]);

        tokio::spawn(machine.updates.clone().drive());
        let asked = tokio::time::timeout(Duration::from_millis(300), machine.restart.asked());
        assert!(asked.await.is_err(), "nothing runs, and it stays");
        // Nor the next start of it.
        let again = Updates::new(machine.updates.0.banda.clone(), machine.take.subscribe());
        assert_eq!(again.watch().borrow().ready, None);
    }

    #[tokio::test]
    async fn a_copy_that_arrived_is_moved_onto_again_from_the_copy_before() {
        let machine = machine(Moves::Itself);
        // dev.11 ran, said so, and stopped; dev.10 was started after it.
        moved_onto_the_copy(&machine);
        guard::keep_arrived(&machine.engine, "0.1.0-dev.11");
        machine.updates.back_from_a_copy();
        let state = machine.updates.watch().borrow().clone();
        assert_eq!(state.ready.as_deref(), Some("0.1.0-dev.11"));
        assert_eq!(state.failed, None);
        assert!(guard::bad(&machine.engine).is_empty());
    }

    #[tokio::test]
    async fn an_engine_with_no_banda_update_takes_nothing_and_says_why() {
        let machine = machine(Moves::Itself);
        let banda = machine.updates.0.banda.clone();
        let updates = Updates::new(banda, machine.take.subscribe())
            // Nowhere: a look in its own process would fail on it.
            .reading("http://127.0.0.1:9", Duration::MAX, Duration::MAX)
            .lacking();
        // Where Banda packs no engine alone, as on Windows yet, that is
        // said first.
        let why = match feed::system() {
            Some(_) => "no banda-update",
            None => "packs no engine alone",
        };
        let state = updates.look().await;
        let off = state.off.expect("it says why");
        assert!(off.contains(why), "{off}");
        assert_eq!((state.looked, state.failed), (None, None));
        let refused = updates.choose("0.1.0-dev.9").await.unwrap_err();
        assert!(refused.message.contains(why), "{refused:?}");
    }

    #[tokio::test]
    async fn the_windows_child_waits_for_banda_to_restart() {
        let machine = machine(Moves::Never("it restarts with Banda".to_owned()));
        let mut state = machine.updates.watch();
        tokio::spawn(machine.updates.clone().drive());
        let waits = waits_until(&mut state, Option::is_some).await.unwrap();
        assert_eq!(waits.restart.as_deref(), Some("it restarts with Banda"));
        let refused = machine.updates.restart_now(true).unwrap_err();
        assert_eq!(refused.message, "it restarts with Banda");
    }

    #[tokio::test]
    async fn a_key_holds_it_ten_minutes() {
        let machine = machine(Moves::Itself);
        let now = banda_kernel::now_ms();
        machine.hands.send_replace(InHand {
            terminals: 0,
            typed: Some(now),
        });
        let mut state = machine.updates.watch();
        tokio::spawn(machine.updates.clone().drive());
        let waits = waits_until(&mut state, Option::is_some).await.unwrap();
        assert_eq!(waits.typed_until, Some(now + restart::QUIET_MS));

        // Ten minutes after the key, it moves.
        machine.hands.send_replace(InHand {
            terminals: 0,
            typed: Some(now - restart::QUIET_MS),
        });
        tokio::time::timeout(Duration::from_secs(5), machine.restart.asked())
            .await
            .expect("it moved");
    }
}
