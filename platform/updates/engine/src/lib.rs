//! The updates module (ADR 0115): each machine updates its own Banda, and
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
//! It takes nothing from a checkout's build (Banda Local), where a package
//! manager owns Banda (`package-type` beside the running program), with
//! `BANDA_UPDATES=off`, or where `machine.toml` says `updates = "off"`.
//!
//! Once a copy is in place, the engine moves onto it as soon as nothing
//! runs ([`restart`]): no Turn, no terminal open, no key in the last ten
//! minutes; with `updates = "ask"`, once the Person says
//! (`updates.restart`). The window's child waits for Banda to restart.
//! `updates.take` puts a given version in place, an older one too, and
//! the looks then take nothing above it until the Person takes the newest
//! again: the choice is kept in `engine/chosen`.

pub mod feed;
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
        let chosen = chosen(&banda.engine);
        let copies = take::copies(&banda.engine);
        let ready = match &chosen {
            Some(chosen) => {
                (*chosen != banda.version && copies.contains(chosen)).then(|| chosen.clone())
            }
            None => (copies.into_iter()).find(|copy| feed::is_above(copy, &banda.version)),
        };
        let state = UpdateState {
            running: banda.version.clone(),
            ready,
            chosen,
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
            Ok((newest, take)) => {
                self.0.state.send_modify(|state| {
                    state.off = None;
                    state.looked = Some(looked);
                    state.newest = Some(newest);
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
        let Some(newest) = (take::copies(&self.0.banda.engine).into_iter())
            .find(|copy| feed::is_above(copy, running))
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
    async fn find(&self) -> Result<(String, Option<(String, Feed)>), String> {
        let banda = &self.0.banda;
        let which = match banda.channel {
            "stable" => Which::Stable,
            _ => Which::Dev,
        };
        let releases = self.releases(which).await?;
        let have = (self.0.state.borrow().ready.clone()).unwrap_or_else(|| banda.version.clone());
        let above = feed::above(&releases, &banda.version, which);
        let newest = (above.first()).map_or_else(|| banda.version.clone(), |(_, v)| v.clone());
        for (release, version) in above {
            if !feed::is_above(&version, &have) {
                break;
            }
            if let Ok(found) = self.bundle(which, release, &version).await? {
                return Ok((newest, Some(found)));
            }
        }
        Ok((newest, None))
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
        let text = (take::get(&asset.browser_download_url).await?)
            .text()
            .await
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
        self.move_now(restarting)
            .ok_or_else(|| Refusal::conflict("The copy ready is gone from its folder."))
    }

    /// Puts `version` in place and keeps it as chosen; `newest` drops the
    /// choice and looks again.
    pub async fn choose(&self, version: &str) -> Result<UpdateState, Refusal> {
        let version = version.to_owned();
        let engine = &self.0.banda.engine;
        if version == NEWEST {
            let _ = std::fs::remove_file(engine.join(CHOSEN));
            // The newest copy in place waits again, not the one chosen.
            let ready = (take::copies(engine).into_iter())
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

    /// Asks the engine to move onto the copy ready: what it moves from
    /// and onto, unless the copy is gone.
    fn move_now(&self, restarting: &Restarting) -> Option<Moving> {
        let to = self.0.state.borrow().ready.clone()?;
        let program = self.0.banda.engine.join(&to).join(PROGRAM);
        if !program.is_file() {
            tracing::warn!(version = %to, "the copy ready has no program: not moved onto");
            self.0.state.send_modify(|state| state.ready = None);
            return None;
        }
        let from = self.0.banda.version.clone();
        tracing::info!(%from, %to, "the engine moves onto the copy ready");
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
                Next::Move if self.move_now(restarting).is_some() => return,
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
const PROGRAM: &str = if cfg!(windows) { "banda.exe" } else { "banda" };

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
        tokio::spawn(self.clone().drive());
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
