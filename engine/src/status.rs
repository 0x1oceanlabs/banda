//! `banda status`: whether this machine's engine runs, since when, its
//! build, and who works and who waits on this machine, as one JSON line.
//! It starts nothing. `--follow` prints a line again on each change, the
//! current one first, for the bar outside the window: the menu bar on
//! macOS and Omarchy's shell plugin read it, so both show the same (ADR
//! 0086, decision 4).
//!
//! Who works and who waits are this machine's Threads alone, counted by
//! the agents module's rule (`banda_agents::counts`) over every Project
//! the window shows: what the engine lists of them, read again on each
//! fact that may change a count.
//!
//! With no engine, `--follow` says so and waits for one, looking each
//! second, and an engine that goes is said the same way: a widget then
//! shows no icon, and picks Banda up as it starts, with one process for
//! its whole life. It ends as its reader goes, or with `--with-parent` as
//! its stdin closes, as the window's children do.

use crate::client::{Client, Pass};
use crate::control::{ANSWERS_WITHIN, NOWHERE, answering};
use crate::places::{Places, Running};
use crate::{Failure, parent};
use banda_agents::counts::{self, AgentCounts, ProjectThreads};
use banda_agents::model::{ListedThread, ThreadList};
use banda_kernel::api::EngineFrame;
use banda_kernel::{
    Code, CommandId, EventFilter, Fence, Named, PROTOCOL, ProjectId, ProjectSummary, Refusal,
};
use banda_machines::Machine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::time::Duration;
use ts_rs::TS;

/// What `banda status` prints, one JSON object a line. Each field but
/// `running` is there only where it is known.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, rename = "EngineStatus")]
pub struct Status {
    /// Whether this machine's engine runs. With none, the line says only
    /// what this machine is.
    pub running: bool,
    /// The protocol it speaks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub protocol: Option<u32>,
    /// Its version, as `banda --version` says it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub version: Option<String>,
    /// Its build id (ADR 0086, decision 2).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub build: Option<String>,
    /// Which Banda it is: `stable`, `dev` or `local`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub channel: Option<String>,
    /// When it began to serve, in milliseconds since the epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub since: Option<i64>,
    /// Its process.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pid: Option<u32>,
    /// The systemd user unit, or launchd job, it runs as.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub unit: Option<String>,
    /// Why it runs as the window's child, in plain words.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub child: Option<String>,
    /// Whether the fence around its Harnesses holds, as it said in its
    /// welcome (ADR 0083).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fence: Option<Fence>,
    /// The system this machine runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub system: Option<String>,
    /// This machine's own name and icon (ADR 0095).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub named: Option<Named>,
    /// Who works and who waits on this machine: none under an Agent's
    /// pass, nor while this program cannot read what the engine lists, as
    /// one of another build may say it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agents: Option<AgentCounts>,
}

/// One line, its fields in their order: `running` first.
impl std::fmt::Display for Status {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let line = serde_json::to_string(self).map_err(|_| std::fmt::Error)?;
        f.write_str(&line)
    }
}

/// `banda status`, or with `follow` `banda status --follow`, which with
/// `with_parent` ends as its stdin closes. Under an Agent's pass it says,
/// once, what the engine that gave the pass says: behind the fence the
/// file that names where an engine runs, and since when, is hidden, and
/// so may `machine.toml` be.
pub async fn status(places: &Places, follow: bool, with_parent: bool) -> Result<(), Failure> {
    let pass = Pass::from_env()?.is_some();
    if follow && pass {
        return Err(Failure::Refused(Refusal::forbidden(
            "banda status --follow is for the Person's bar: under an Agent's pass, banda status \
             says it once.",
        )));
    }
    if follow {
        return follow_status(places, with_parent).await;
    }
    println!("{}", status_line(places, pass).await?);
    Ok(())
}

/// What `banda status` says once, under an Agent's pass (`pass`) or not:
/// it says what this machine is too, for another machine's Test (ADR 0095,
/// decision 9), the system it runs and its own name and icon, as the
/// engine said them in its welcome, else as `machine.toml` says them over
/// what Banda finds here.
async fn status_line(places: &Places, pass: bool) -> Result<Status, Failure> {
    let (line, named) = if pass {
        match tokio::time::timeout(ANSWERS_WITHIN, Client::connect(places)).await {
            Ok(Ok(client)) => {
                let line = Status {
                    running: true,
                    protocol: Some(PROTOCOL),
                    ..Status::default()
                };
                (fenced(line, &client), client.named().cloned())
            }
            Ok(Err(refused @ Failure::Refused(_))) => return Err(refused),
            _ => (Status::default(), None),
        }
    } else {
        match answering(places).await {
            Ok((running, mut client)) => {
                let named = client.named().cloned();
                let mut line = fenced(said(&running), &client);
                // An engine that broke off as it was read still runs, as
                // far as it said.
                let mut lists = Lists::default();
                if lists.read(&mut client).await.is_ok() {
                    line.agents = lists.counts(banda_kernel::now_ms());
                }
                (line, named)
            }
            Err(Failure::Refused(refusal)) if refusal.code == Code::Protocol => {
                (said(&places.running()?), None)
            }
            Err(refused @ Failure::Refused(_)) => return Err(refused),
            Err(_) => (Status::default(), None),
        }
    };
    let named = match named {
        None if !pass => Some(named_here(places).await),
        named => named,
    };
    Ok(this_machine(line, system(), named))
}

/// What `banda status` says of a running engine, as `engine.json` says it.
pub fn said(running: &Running) -> Status {
    Status {
        running: true,
        protocol: Some(running.protocol),
        version: running.version.clone(),
        build: running.build.clone(),
        channel: running.channel.clone(),
        since: running.since,
        pid: running.pid,
        unit: running.unit.clone(),
        child: running.child.clone(),
        ..Status::default()
    }
}

/// This machine's name and icon as `machine.toml` says them over what
/// Banda finds here, as its engine would, starting none.
async fn named_here(places: &Places) -> Named {
    let machine = Machine::new(&places.config, banda_machines::found().await);
    machine.named().borrow().clone()
}

/// The system this machine runs.
fn system() -> Option<String> {
    banda_machines::about().system
}

/// `line`, with what this machine is: the `system` it runs, and its own
/// name and icon, `named`, each where there is one.
fn this_machine(line: Status, system: Option<String>, named: Option<Named>) -> Status {
    Status {
        system,
        named,
        ..line
    }
}

/// `line`, with the fence as the engine said it in its welcome, never as
/// a file says.
fn fenced(line: Status, client: &Client) -> Status {
    Status {
        fence: client.fence().cloned(),
        ..line
    }
}

/// Whether the bar counts `project`'s Threads: the window shows it, as it
/// is not archived, and its folder is there.
fn counts_its_threads(project: &ProjectSummary) -> bool {
    !project.archived && !project.missing
}

/// `project`'s name, as the sidebar shows it.
fn shown(project: &ProjectSummary) -> String {
    match project.scratch {
        true => "No Project".to_owned(),
        false => project.name.clone(),
    }
}

/// A Project the bar counts the Threads of: the name its rows show, and
/// its Threads as the engine listed them last; none while this program
/// cannot read them.
struct Counted {
    name: String,
    list: Option<ThreadList>,
}

/// The Projects the bar counts, by their IDs.
#[derive(Default)]
struct Lists {
    projects: BTreeMap<ProjectId, Counted>,
    /// The engine listed its Projects in words this program does not read.
    unread: bool,
}

impl Lists {
    /// Reads the Projects the bar counts, and the Threads of each it has
    /// not read yet; those gone or archived go. A Project whose Threads
    /// the engine does not list is left out.
    async fn read(&mut self, client: &mut Client) -> Result<(), Failure> {
        let said = match client
            .ask("projects.list", None, CommandId::new(), json!({}))
            .await
        {
            Ok(said) => said,
            Err(Failure::Refused(_)) => return Ok(()),
            Err(broken) => return Err(broken),
        };
        let listed: Vec<ProjectSummary> = match serde_json::from_value(said) {
            Ok(listed) => listed,
            Err(error) => {
                if !self.unread {
                    tracing::warn!(%error, "the engine's Projects are not read: no counts");
                }
                self.unread = true;
                return Ok(());
            }
        };
        self.unread = false;
        let counted: Vec<_> = listed.into_iter().filter(counts_its_threads).collect();
        (self.projects).retain(|id, _| counted.iter().any(|project| project.id == *id));
        for project in counted {
            match self.projects.get_mut(&project.id) {
                Some(known) if known.list.is_some() => known.name = shown(&project),
                _ => {
                    let listing = threads(client, project.id).await?;
                    self.take(project.id, Some(shown(&project)), listing);
                }
            }
        }
        Ok(())
    }

    /// Reads `project`'s Threads again; one the engine no longer lists
    /// goes.
    async fn read_again(&mut self, client: &mut Client, project: ProjectId) -> Result<(), Failure> {
        let listing = threads(client, project).await?;
        self.take(project, None, listing);
        Ok(())
    }

    /// Keeps what the engine listed of `project`'s Threads, under `name`
    /// where it is new to the bar. One it refused goes; one this program
    /// cannot read stays, its counts not known.
    fn take(&mut self, project: ProjectId, name: Option<String>, listing: Listing) {
        let list = match listing {
            Listing::Read(list) => Some(list),
            Listing::Unread(error) => {
                let known = self.projects.get(&project);
                if known.is_none_or(|known| known.list.is_some()) {
                    tracing::warn!(%project, %error, "a Project's Threads are not read: no counts");
                }
                None
            }
            Listing::Refused => {
                self.projects.remove(&project);
                return;
            }
        };
        match (self.projects.get_mut(&project), name) {
            (Some(known), name) => {
                known.list = list;
                if let Some(name) = name {
                    known.name = name;
                }
            }
            (None, Some(name)) => {
                self.projects.insert(project, Counted { name, list });
            }
            (None, None) => {}
        }
    }

    /// Where each Project's list stands in its log.
    fn at(&self) -> impl Iterator<Item = (ProjectId, i64)> {
        (self.projects.iter())
            .filter_map(|(project, counted)| Some((*project, counted.list.as_ref()?.at)))
    }

    /// Leaves `project` out until the Projects are read again.
    fn forget(&mut self, project: ProjectId) {
        self.projects.remove(&project);
    }

    fn threads(&self) -> impl Iterator<Item = &ListedThread> {
        (self.projects.values())
            .filter_map(|counted| counted.list.as_ref())
            .flat_map(|list| &list.threads)
    }

    /// Who works and who waits at `now`; nothing while a list is not read.
    fn counts(&self, now: i64) -> Option<AgentCounts> {
        if self.unread {
            return None;
        }
        let projects = self.projects.iter().map(|(project, counted)| {
            let list = counted.list.as_ref()?;
            Some(ProjectThreads {
                project: *project,
                name: &counted.name,
                threads: &list.threads,
            })
        });
        Some(AgentCounts::of(projects.collect::<Option<Vec<_>>>()?, now))
    }
}

/// A Project's Threads as the engine lists them.
enum Listing {
    Read(ThreadList),
    /// In words this program does not read, as an engine of another build
    /// may say them.
    Unread(serde_json::Error),
    /// It refused, as for a Project that went.
    Refused,
}

/// `project`'s Threads as the engine lists them.
async fn threads(client: &mut Client, project: ProjectId) -> Result<Listing, Failure> {
    let asked = client.ask("agents.threads", Some(project), CommandId::new(), json!({}));
    match asked.await {
        Ok(list) => Ok(serde_json::from_value(list).map_or_else(Listing::Unread, Listing::Read)),
        Err(Failure::Refused(_)) => Ok(Listing::Refused),
        Err(broken) => Err(broken),
    }
}

/// How often `--follow` looks for an engine while none runs.
const LOOKS_EVERY: Duration = Duration::from_secs(1);

/// How often it looks again at an engine of another build, which it
/// cannot follow.
const OTHER_BUILD_EVERY: Duration = Duration::from_secs(5);

/// How often it reads the Projects again, as a Thread in No Project comes
/// with a Project of its own.
const PROJECTS_EVERY: Duration = Duration::from_secs(2);

/// How long it lets facts gather before it reads their Projects again:
/// a turn that ends comes with a few.
const GATHER: Duration = Duration::from_millis(50);

/// The reader of `--follow` went: nothing more to print.
struct ReaderGone;

/// Prints a line to `out`, stdout, when it differs from the one printed
/// before.
struct Lines {
    out: Box<dyn Write>,
    last: Option<String>,
}

impl Lines {
    fn new(out: impl Write + 'static) -> Lines {
        Lines {
            out: Box::new(out),
            last: None,
        }
    }

    fn print(&mut self, line: &Status) -> Result<(), ReaderGone> {
        let line = line.to_string();
        if self.last.as_ref() == Some(&line) {
            return Ok(());
        }
        writeln!(self.out, "{line}")
            .and_then(|()| self.out.flush())
            .map_err(|_| ReaderGone)?;
        self.last = Some(line);
        Ok(())
    }
}

/// `banda status --follow`: a line now, and one each time it changes,
/// until the reader goes, or with `with_parent` until stdin closes.
async fn follow_status(places: &Places, with_parent: bool) -> Result<(), Failure> {
    let parent_gone = async {
        if !with_parent {
            return std::future::pending().await;
        }
        let (gone, stdin_gone) = tokio::sync::oneshot::channel::<()>();
        parent::on_gone(move || {
            let _ = gone.send(());
        });
        let _ = stdin_gone.await;
    };
    let mut lines = Lines::new(std::io::stdout());
    tokio::select! {
        () = parent_gone => {}
        _ = watch(places, &mut lines, system()) => {}
    }
    Ok(())
}

/// Follows the engine while one runs, and looks for one while none does.
async fn watch(places: &Places, lines: &mut Lines, system: Option<String>) -> ReaderGone {
    // What this machine is with no engine: read once each time none runs.
    let mut idle = None;
    loop {
        match answering(places).await {
            Ok((running, client)) => {
                idle = None;
                if let Err(gone) = follow_engine(&running, client, lines, &system).await {
                    return gone;
                }
                // It went, or broke off: looked for again in a moment.
                tokio::time::sleep(LOOKS_EVERY).await;
            }
            Err(Failure::Refused(refusal)) if refusal.code == Code::Protocol => {
                if let Ok(running) = places.running() {
                    let line = this_machine(said(&running), system.clone(), None);
                    if let Err(gone) = lines.print(&line) {
                        return gone;
                    }
                }
                tokio::time::sleep(OTHER_BUILD_EVERY).await;
            }
            Err(_) => {
                let line = match idle.take() {
                    Some(line) => line,
                    None => {
                        let named = named_here(places).await;
                        this_machine(Status::default(), system.clone(), Some(named))
                    }
                };
                let printed = lines.print(&line);
                idle = Some(line);
                if let Err(gone) = printed {
                    return gone;
                }
                tokio::time::sleep(LOOKS_EVERY).await;
            }
        }
    }
}

/// What a second connection follows: each Project's facts by their
/// subscription, and this machine's name and icon by their stream.
#[derive(Default)]
struct Heard {
    projects: HashMap<u64, ProjectId>,
    named: Option<u64>,
}

/// Prints the running engine's line, then again on each change, until it
/// goes. A second connection hears the facts, so none is lost while the
/// first reads a list.
async fn follow_engine(
    running: &Running,
    mut reader: Client,
    lines: &mut Lines,
    system: &Option<String>,
) -> Result<(), ReaderGone> {
    let Ok(mut events) = Client::hello(&running.url(), running.secret.clone(), NOWHERE).await
    else {
        return Ok(());
    };
    let line = fenced(said(running), &reader);
    let mut named = reader.named().cloned();
    let mut heard = Heard {
        // The kernel's stream of this machine's name and icon (ADR 0095).
        named: events.stream("machine.named").await.ok(),
        ..Heard::default()
    };
    let mut lists = Lists::default();
    let mut dirty = Vec::new();
    let mut projects_at = tokio::time::Instant::now();
    loop {
        let now = tokio::time::Instant::now();
        let read = async {
            if now >= projects_at {
                projects_at = now + PROJECTS_EVERY;
                lists.read(&mut reader).await?;
            }
            for project in std::mem::take(&mut dirty) {
                lists.read_again(&mut reader, project).await?;
            }
            followed(&mut events, &mut heard, &lists).await
        };
        // The engine went, or broke off.
        if read.await.is_err() {
            return Ok(());
        }
        let ms = banda_kernel::now_ms();
        let status = Status {
            agents: lists.counts(ms),
            ..this_machine(line.clone(), system.clone(), named.clone())
        };
        lines.print(&status)?;
        // A Later's time comes with no fact to say so.
        let wakes = counts::wakes_next(lists.threads(), ms)
            .map(|at| now + Duration::from_millis((at - ms).unsigned_abs()) + GATHER);
        let next = wakes.map_or(projects_at, |wakes| wakes.min(projects_at));
        tokio::select! {
            frame = events.heard() => {
                let Ok(frame) = frame else { return Ok(()) };
                if !heard_one(frame, &mut heard, &mut lists, &mut dirty, &mut named) {
                    continue;
                }
                // Let the facts that come with it come too.
                let gathered = tokio::time::Instant::now() + GATHER;
                loop {
                    tokio::select! {
                        frame = events.heard() => {
                            let Ok(frame) = frame else { return Ok(()) };
                            heard_one(frame, &mut heard, &mut lists, &mut dirty, &mut named);
                        }
                        () = tokio::time::sleep_until(gathered) => break,
                    }
                }
            }
            () = tokio::time::sleep_until(next) => {}
        }
    }
}

/// Follows the facts of each Project the bar counts, after where its list
/// stands, and stops following those it no longer counts.
async fn followed(events: &mut Client, heard: &mut Heard, lists: &Lists) -> Result<(), Failure> {
    let counted: HashMap<ProjectId, i64> = lists.at().collect();
    let gone: Vec<u64> = (heard.projects.iter())
        .filter(|(_, project)| !counted.contains_key(project))
        .map(|(subscription, _)| *subscription)
        .collect();
    for subscription in gone {
        heard.projects.remove(&subscription);
        events.unsubscribe(subscription).await?;
    }
    for (project, at) in counted {
        if heard.projects.values().any(|followed| *followed == project) {
            continue;
        }
        let filter = EventFilter {
            module: Some("agents".to_owned()),
            subject: None,
            kinds: Some(counts::KINDS.map(str::to_owned).to_vec()),
        };
        let subscription = events.subscribe(project, at, filter).await?;
        heard.projects.insert(subscription, project);
    }
    Ok(())
}

/// Takes in one `frame`: a fact marks its Project's list to read again,
/// as does a subscription the engine could not go on with; one it refused
/// leaves its Project out until the Projects are read again; a new name
/// for this machine is kept. Says whether it was a fact.
fn heard_one(
    frame: EngineFrame,
    heard: &mut Heard,
    lists: &mut Lists,
    dirty: &mut Vec<ProjectId>,
    named: &mut Option<Named>,
) -> bool {
    let mut mark = |project: ProjectId| {
        if !dirty.contains(&project) {
            dirty.push(project);
        }
    };
    match frame {
        EngineFrame::Event { subscription, .. } => {
            let Some(project) = heard.projects.get(&subscription) else {
                return false;
            };
            mark(*project);
            true
        }
        // It catches up from a fresh read; its subscription has ended.
        EngineFrame::Resync { subscription } => {
            if let Some(project) = heard.projects.remove(&subscription) {
                mark(project);
            }
            false
        }
        EngineFrame::Result {
            id, error: Some(_), ..
        } => {
            if let Some(project) = heard.projects.remove(&id) {
                lists.forget(project);
            }
            false
        }
        EngineFrame::Piece { stream, data } if Some(stream) == heard.named => {
            if let Ok(now) = serde_json::from_value::<Named>(data) {
                *named = Some(now);
            }
            false
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn status_says_what_the_engine_says_of_itself() {
        let running = Running {
            protocol: 1,
            port: 4100,
            secret: "never said".into(),
            build: Some("16da2821".into()),
            version: Some("0.3.0".into()),
            channel: Some("dev".into()),
            since: Some(1_794_000_000_000),
            pid: Some(42),
            unit: Some("banda-engine".into()),
            ..Running::default()
        };
        let line = json!(said(&running));
        assert_eq!(
            line,
            json!({
                "running": true, "protocol": 1, "version": "0.3.0", "build": "16da2821",
                "channel": "dev", "since": 1_794_000_000_000_i64, "pid": 42,
                "unit": "banda-engine",
            })
        );
        assert!(!line.to_string().contains("never said"), "no secret");
        let bare = json!(said(&Running::default()));
        assert_eq!(bare, json!({ "running": true, "protocol": 0 }));
        // A window's child where launchd or systemd did not start it says
        // why.
        let child = Running {
            child: Some("launchd did not start Banda's engine".into()),
            ..Running::default()
        };
        assert_eq!(
            json!(said(&child))["child"],
            "launchd did not start Banda's engine"
        );
    }

    #[tokio::test]
    async fn status_says_what_this_machine_is_and_its_own_name_with_no_engine() {
        let base = tempfile::tempdir().unwrap();
        let places = Places::under(base.path());
        std::fs::create_dir_all(&places.config).unwrap();
        std::fs::write(
            places.config.join("machine.toml"),
            "name = \"studio\"\nicon = \"tower\"\n",
        )
        .unwrap();
        let Ok(line) = status_line(&places, false).await else {
            panic!("status should say");
        };
        let line = json!(line);
        assert_eq!(line["running"], false);
        assert_eq!(line["named"], json!({ "name": "studio", "icon": "tower" }));
        assert_eq!(line["system"], json!(banda_machines::about().system));
        assert!(line["system"].is_string(), "{line}");
        assert!(line.get("agents").is_none(), "nobody works with no engine");
        // It started nothing: no engine's state was written.
        assert!(!base.path().join("state").exists());
    }

    #[test]
    fn what_this_machine_is_goes_in_only_where_it_is_known() {
        let named = Named {
            name: "arc".into(),
            icon: banda_kernel::MachineIcon::Server,
        };
        let running = Status {
            running: true,
            ..Status::default()
        };
        let line = this_machine(running, Some("Arch Linux".into()), Some(named));
        assert_eq!(
            json!(line),
            json!({
                "running": true, "system": "Arch Linux",
                "named": { "name": "arc", "icon": "server" },
            })
        );
        let bare = this_machine(Status::default(), None, None);
        assert_eq!(
            json!(bare),
            json!({ "running": false }),
            "older readers parse it as before"
        );
    }

    #[test]
    fn a_line_says_who_works_and_who_waits_in_plain_words() {
        let line = Status {
            agents: Some(AgentCounts::default()),
            ..said(&Running::default())
        };
        let said: Value = json!(line);
        assert_eq!(
            said["agents"],
            json!({
                "working": 0, "waiting": 0, "asking": 0, "failed": 0, "done": 0, "threads": [],
            })
        );
        // What a reader of the contract's type decodes is the same.
        let back: Status = serde_json::from_value(said).unwrap();
        assert_eq!(back, line);
    }

    #[test]
    fn the_bar_counts_the_projects_the_window_shows_and_names_no_project() {
        let listed = |archived, missing, scratch| -> ProjectSummary {
            serde_json::from_value(json!({
                "id": ProjectId::new(),
                "name": if scratch { "" } else { "banda" },
                "folder": "/home/r/code/banda",
                "pinned": false,
                "archived": archived,
                "sees_others": false,
                "scratch": scratch,
                "missing": missing,
                "sign": { "kind": "letters", "text": "B", "picked": false },
                "trusted": true,
            }))
            .unwrap()
        };
        assert!(counts_its_threads(&listed(false, false, false)));
        assert!(
            counts_its_threads(&listed(false, false, true)),
            "one Thread's own"
        );
        assert!(!counts_its_threads(&listed(true, false, false)), "archived");
        assert!(
            !counts_its_threads(&listed(false, true, false)),
            "its folder is gone"
        );
        assert_eq!(shown(&listed(false, false, true)), "No Project");
        assert_eq!(shown(&listed(false, false, false)), "banda");
    }

    #[test]
    fn a_list_this_program_cannot_read_leaves_the_counts_out_and_never_says_none() {
        let list = |threads: Value| -> ThreadList {
            serde_json::from_value(json!({ "threads": threads, "at": 7 })).unwrap()
        };
        let (project, other) = (ProjectId::new(), ProjectId::new());
        let mut lists = Lists::default();
        lists.take(
            project,
            Some("banda".into()),
            Listing::Read(list(json!([]))),
        );
        assert_eq!(lists.counts(0), Some(AgentCounts::default()));
        // Another build lists it in words this one does not read: say
        // nothing rather than that nobody works.
        let unread = serde_json::from_value::<ThreadList>(json!({ "threads": [{ "kind": 1 }] }));
        lists.take(
            other,
            Some("notes".into()),
            Listing::Unread(unread.unwrap_err()),
        );
        assert_eq!(lists.counts(0), None);
        assert_eq!(lists.at().collect::<Vec<_>>(), [(project, 7)], "followed");
        // Read once more, it counts again.
        lists.take(other, None, Listing::Read(list(json!([]))));
        assert_eq!(lists.counts(0), Some(AgentCounts::default()));
        // A Project the engine no longer lists goes.
        lists.take(other, None, Listing::Refused);
        assert_eq!(lists.at().count(), 1);
        // Nor are the Projects read.
        lists.unread = true;
        assert_eq!(lists.counts(0), None);
    }

    #[test]
    fn a_follower_prints_a_line_only_when_it_changed() {
        /// What the follower printed, shared with the test.
        #[derive(Clone, Default)]
        struct Out(std::rc::Rc<std::cell::RefCell<Vec<u8>>>);
        impl Write for Out {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0.borrow_mut().write(bytes)
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let out = Out::default();
        let mut lines = Lines::new(out.clone());
        let running = said(&Running::default());
        for line in [&Status::default(), &Status::default(), &running] {
            assert!(lines.print(line).is_ok());
        }
        let printed = String::from_utf8(out.0.borrow().clone()).unwrap();
        assert_eq!(
            printed, "{\"running\":false}\n{\"running\":true,\"protocol\":0}\n",
            "the same line again is not printed"
        );
        let mut heard = Heard::default();
        let project = ProjectId::new();
        heard.projects.insert(7, project);
        let (mut lists, mut dirty, mut named) = (Lists::default(), Vec::new(), None);
        let resync = EngineFrame::Resync { subscription: 7 };
        assert!(!heard_one(
            resync, &mut heard, &mut lists, &mut dirty, &mut named
        ));
        assert_eq!(dirty, [project], "read again after a resync");
        assert!(heard.projects.is_empty(), "its subscription ended");
    }
}
