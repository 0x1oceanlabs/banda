//! The machine's tabs (ADR 0132, decision 1): the tabs an Agent's
//! `browser_open` opens with no window open, in the Chromium of its
//! Project's machine, through the driver. The engine keeps which tabs
//! they are and each one's Project, and checks for them what the window
//! checks for its own (`apps/browser/desktop/src/drive.ts`): the switches
//! of `browser.toml`, and the Person's say on each site.
//!
//! A tab stays where it opened: a call that names a machine's tab asks
//! the driver, and any other asks the window, as before.

use crate::chromium::Chromium;
use crate::driver::{Driver, PROGRAM};
use crate::settings::{self, BrowserSettings, SiteRule};
use crate::{LISTING, SeenTab, site};
use banda_kernel::host::Node;
use banda_kernel::{Call, Participant, ProjectId, Refusal};
use banda_look::OneFile as _;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

/// The id of the first machine's tab: far above any the window gives its
/// own, which are its pages' and count up from 1, so no id names both.
const FIRST_TAB: u32 = 100_001;

/// Where a tab a call names is.
pub(crate) enum Place {
    /// In the window, or nowhere: the window says which.
    Window,
    /// In the machine's Chromium, which this driver drives.
    Machine(Arc<Driver>),
}

/// What a call does in a machine's tab, which says what is checked first
/// and what a driver that ended may have done of it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Work {
    /// Reads the page: on a site the Agent may use.
    Reads,
    /// Pictures the page: as a read, where the Person lets Agents take
    /// pictures.
    Pictures,
    /// Acts in the page: on a site the Agent may use.
    Acts,
    /// Takes the tab elsewhere, whatever its page: it reads nothing of it.
    Moves,
}

#[derive(Default)]
struct State {
    /// The driver, from its first start; one that ended stays until the
    /// next call sees it did.
    driver: Option<Arc<Driver>>,
    /// Each machine's tab, and the Project whose Agents opened it.
    tabs: HashMap<u32, ProjectId>,
    /// How far the ids went since the engine started, from `FIRST_TAB`:
    /// the next driver counts on from there, so no id is given twice.
    given: u32,
}

/// The machine's tabs, and what runs them.
#[derive(Default)]
pub(crate) struct Machine {
    pub chromium: Option<Arc<Chromium>>,
    /// The Node the driver runs on, and the folders it may be in.
    pub node: Option<Node>,
    pub folders: Vec<PathBuf>,
    /// The folder of the machine's `browser.toml`.
    pub config: Option<PathBuf>,
    state: Mutex<State>,
    /// Held while the driver starts: one starts at a time.
    starting: tokio::sync::Mutex<()>,
}

/// A tab no call may name: one there is not, or one of another Project,
/// in the window's words for it (`noTab`).
pub(crate) fn no_tab(tab: u32) -> Refusal {
    Refusal::not_found(format!("There is no tab {tab}: browser_tabs lists them."))
}

fn not_carried() -> Refusal {
    Refusal::app_unavailable("This Banda does not carry its browser for Agents yet.")
}

/// Who asks, as the driver hears it.
fn name_of(by: Participant) -> String {
    match by {
        Participant::Person(id) => id.to_string(),
        Participant::Agent(id) => id.to_string(),
    }
}

/// Where the machine's tabs of `call`'s Project keep their profile: one
/// per Project, under its data on this machine (ADR 0132, decision 4).
fn profile_of(call: &Call) -> PathBuf {
    call.project().data().join("browser").join("profile")
}

/// Where a machine's tab saves what it downloads: the Person's Downloads,
/// as the system names it, else the folder of that name in their home.
/// A machine with no home keeps them with the Project's profile.
fn downloads_of(call: &Call) -> PathBuf {
    dirs::download_dir()
        .or_else(|| Some(dirs::home_dir()?.join("Downloads")))
        .unwrap_or_else(|| call.project().data().join("browser").join("downloads"))
}

/// The tabs an answer names: the one it is about, and those it opened.
#[derive(Deserialize)]
struct Named {
    tab: Option<u32>,
    #[serde(default)]
    opened: Vec<Listed>,
}

/// A tab as the driver lists it.
#[derive(Deserialize)]
struct Listed {
    id: u32,
    #[serde(default)]
    url: String,
    #[serde(default)]
    title: String,
}

/// Where a tab is, as the driver says it.
#[derive(Deserialize)]
struct Where {
    url: String,
}

impl Machine {
    /// The state, with a driver that ended let go of: its tabs went with
    /// it, and the next call that needs one starts another.
    fn state(&self) -> MutexGuard<'_, State> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.driver.as_ref().is_some_and(|driver| driver.ended()) {
            state.driver = None;
            state.tabs.clear();
        }
        state
    }

    /// Keeps `tabs` as machine's tabs of `project`.
    fn keep(&self, project: ProjectId, tabs: impl IntoIterator<Item = u32>) {
        let mut state = self.state();
        // Only of a driver that runs: one that ended took them with it.
        if state.driver.is_none() {
            return;
        }
        for tab in tabs {
            state.tabs.insert(tab, project);
            state.given = state.given.max(tab.saturating_sub(FIRST_TAB) + 1);
        }
    }

    /// The machine's `browser.toml` as it is now, over Banda's defaults.
    fn settings(&self) -> settings::Browser {
        match &self.config {
            Some(config) => banda_look::file::resolved_at::<BrowserSettings>(
                &config.join(BrowserSettings::NAME),
            ),
            None => BrowserSettings::defaults().resolved(),
        }
    }

    /// Refuses `by` the browser's tools where the Person turned them off
    /// for Agents, and a picture where they did not turn pictures on, in
    /// the window's words for both.
    fn access(&self, by: Participant, picture: bool) -> Result<(), Refusal> {
        let settings = self.settings();
        if by.agent().is_some() && !settings.tools {
            return Err(Refusal::forbidden(
                "Banda's browser tools are disabled in Settings → Browser.",
            ));
        }
        if picture && !settings.screenshots {
            return Err(Refusal::forbidden(
                "Page screenshots are disabled. The Person can enable agents.screenshots in \
                 Settings → Browser.",
            ));
        }
        Ok(())
    }

    /// Refuses a read or an action of the Agent `by` in the machine's tab
    /// `tab` on a site it may not use (ADR 0029, decision 7, B): one the
    /// Person denied every Agent, or one they have not let Agents use
    /// yet. The page is at `at`, or where the driver says the tab is now.
    /// Its own computer's pages never ask, and the Person is never asked.
    async fn gated(
        &self,
        driver: &Driver,
        tab: u32,
        by: Participant,
        at: Option<&str>,
    ) -> Result<(), Refusal> {
        if by.agent().is_none() {
            return Ok(());
        }
        let url = match at {
            Some(url) => url.to_owned(),
            None => {
                let at: Where = self
                    .asked(driver, tab, "where", json!({ "tab": tab }), LISTING, false)
                    .await?;
                at.url
            }
        };
        let Some(at) = site::at(&url) else {
            return Ok(());
        };
        let site = &at.site;
        match site::rule(&self.settings().sites, &at) {
            Some(SiteRule::Allow) => Ok(()),
            Some(SiteRule::Deny) => Err(Refusal::forbidden(format!(
                "The Person lets no Agent use {site}. Do not use it: carry on without it, or \
                 tell them why you need it."
            ))),
            // No Pane shows a machine's tab yet, so nothing asks the
            // Person here. The card in the Thread that does (ADR 0132,
            // decision 5) takes this refusal's place: the call then waits
            // for their answer.
            None => Err(Refusal::forbidden(format!(
                "Tab {tab} is on {site}, which you may not use yet. Your Person allows it in \
                 Settings → Browser, or with `banda settings set browser.toml \
                 'agents.sites.\"{site}\"' allow`: tell them why you need it."
            ))),
        }
    }

    /// Asks `driver` `method` of the machine's tab `tab`, and decodes its
    /// answer. A tab the driver has not is no machine's tab any more.
    async fn asked<T: DeserializeOwned>(
        &self,
        driver: &Driver,
        tab: u32,
        method: &str,
        params: Value,
        within: Duration,
        writes: bool,
    ) -> Result<T, Refusal> {
        let answer = driver.ask(method, params, within, writes).await;
        if matches!(&answer, Err(refused) if refused.code == banda_kernel::Code::NotFound) {
            self.state().tabs.remove(&tab);
        }
        decoded(answer?)
    }

    /// The driver, started unless it runs: refused where this Banda
    /// carries none, or has no Node to run it on, and while the Chromium
    /// is not ready (`Chromium::ready`).
    async fn started(&self) -> Result<Arc<Driver>, Refusal> {
        let _one = self.starting.lock().await;
        if let Some(driver) = self.state().driver.clone() {
            return Ok(driver);
        }
        let node = self.node.as_ref().ok_or_else(not_carried)?;
        let program = (self.folders.iter())
            .map(|folder| folder.join(PROGRAM))
            .find(|program| program.is_file())
            .ok_or_else(not_carried)?;
        let chromium = self.chromium.as_ref().ok_or_else(not_carried)?.ready()?;
        let first = FIRST_TAB + self.state().given;
        let driver = Driver::start(node, &program, &chromium, first).map_err(|error| {
            Refusal::app_unavailable(format!(
                "Banda's browser for Agents did not start: {error}."
            ))
        })?;
        let driver = Arc::new(driver);
        self.state().driver = Some(driver.clone());
        Ok(driver)
    }

    /// Where the tab `tab` is for `call`. A machine's tab of another
    /// Project is refused as one there is not (ADR 0083, decision 4), and
    /// so is a tab that is no machine's while no window is open, which
    /// has none.
    pub(crate) fn place(&self, call: &Call, tab: u32) -> Result<Place, Refusal> {
        let state = self.state();
        match (state.tabs.get(&tab), &state.driver) {
            (Some(project), Some(driver)) if *project == call.project().id() => {
                Ok(Place::Machine(driver.clone()))
            }
            (Some(_), _) => Err(no_tab(tab)),
            (None, _) if call.project().window_open() => Ok(Place::Window),
            (None, _) => Err(no_tab(tab)),
        }
    }

    /// A new machine's tab for `call`, as `open` says: in its Project's
    /// profile, whose downloads go to the machine's Downloads.
    pub(crate) async fn open<T: DeserializeOwned>(
        &self,
        call: &Call,
        open: &crate::Open,
        within: Duration,
    ) -> Result<T, Refusal> {
        let by = call.participant();
        self.access(by, false)?;
        let driver = self.started().await?;
        let mut params = json!({
            "profile": profile_of(call).to_string_lossy(),
            "downloads": downloads_of(call).to_string_lossy(),
            "by": name_of(by),
        });
        if let Some(url) = &open.url {
            params["url"] = json!(url);
        }
        let answer = driver.ask("open", params, within, true).await?;
        self.keep_named(call, &answer);
        decoded(answer)
    }

    /// Keeps the tabs `answer` names as machine's tabs of `call`'s
    /// Project: a page opens its tabs in its own profile.
    fn keep_named(&self, call: &Call, answer: &Value) {
        if let Ok(named) = Named::deserialize(answer) {
            let opened = named.opened.iter().map(|tab| tab.id);
            self.keep(call.project().id(), named.tab.into_iter().chain(opened));
        }
    }

    /// Asks `driver` `what` of the machine's tab `tab` for `call`, once
    /// what the window checks for a tab of its own is checked here.
    #[expect(clippy::too_many_arguments)]
    pub(crate) async fn in_tab<T: DeserializeOwned>(
        &self,
        driver: &Driver,
        call: &Call,
        tab: u32,
        what: &str,
        params: Value,
        within: Duration,
        work: Work,
    ) -> Result<T, Refusal> {
        let by = call.participant();
        let picture = work == Work::Pictures;
        self.access(by, picture)?;
        if work != Work::Moves {
            self.gated(driver, tab, by, None).await?;
        }
        let mut params = params;
        params["by"] = json!(name_of(by));
        let writes = matches!(work, Work::Acts | Work::Moves);
        let answer: Value = self
            .asked(driver, tab, what, params, within, writes)
            .await?;
        if picture {
            // No picture leaves once the Person took their yes back, or
            // of a site the page went to meanwhile.
            self.access(by, true)?;
            let at = answer.get("url").and_then(Value::as_str);
            self.gated(driver, tab, by, Some(at.unwrap_or_default()))
                .await?;
        }
        self.keep_named(call, &answer);
        decoded(answer)
    }

    /// The machine's tabs of `call`'s Project, as the driver lists its
    /// profile's. None while no driver runs: it starts for no list.
    pub(crate) async fn tabs(&self, call: &Call) -> Result<Vec<SeenTab>, Refusal> {
        self.access(call.participant(), false)?;
        let Some(driver) = self.state().driver.clone() else {
            return Ok(Vec::new());
        };
        let params = json!({ "profile": profile_of(call).to_string_lossy() });
        let listed: Vec<Listed> = decoded(driver.ask("tabs", params, LISTING, false).await?)?;
        self.keep(call.project().id(), listed.iter().map(|tab| tab.id));
        let seen = |tab: Listed| SeenTab {
            id: tab.id,
            url: tab.url,
            title: tab.title,
            driven: false,
            lent: false,
        };
        Ok(listed.into_iter().map(seen).collect())
    }
}

/// The driver's answer as a `T`; one that is none is refused, as the
/// window's is.
fn decoded<T: DeserializeOwned>(answer: Value) -> Result<T, Refusal> {
    serde_json::from_value(answer)
        .map_err(|e| Refusal::invalid(format!("Banda's browser answered amiss: {e}.")))
}
