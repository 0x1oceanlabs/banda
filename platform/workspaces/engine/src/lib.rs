//! The workspaces module: how this machine's Panes are arranged, in the
//! engine, so the window, the CLI and Agents change them alike (ADR 0005,
//! decision 3; ADR 0025, decision 1).
//!
//! It is the machine's, not a Project's: one workspace holds Panes of every
//! Project. Its commands carry what was decided, a place the Person named
//! or a width; where a Pane with no place opens, and which move the row
//! refuses, `placing` decides here, for every caller (ADR 0110), by the
//! Flow and the rules of the Tiling's file, `tiling.toml` ([`tiling`];
//! ADR 0127, decision 4). What
//! depends on the look or the view stays the window's. A change says the
//! whole arrangement after it in one event, so a window that follows
//! draws what the event holds; new args for a Pane, the change made most,
//! say only those. A command that changes nothing says nothing.
//!
//! An Agent arranges through its tools alone (ADR 0032): it sees its
//! Project's Panes, and the other Projects' outlines when its Person lets it;
//! it opens Panes of its Project that run nothing as the Person, given only
//! the args that choose what each shows (ADR 0083, decision 3), and moves
//! and closes only those it opened.
//!
//! What a command makes, a Pane, a column, a Group or a workspace, takes
//! an ID derived from the command's ID (`model::Seed`, ADR 0088, decision
//! 11). So the client that sends it knows the IDs before the answer and
//! can draw them at once, two clients never make the same, and a command
//! sent again makes nothing twice: its receipt answers it, and past the
//! receipt the workspaces refuse it while they hold what it made.

pub mod commands;
pub mod model;
pub mod placing;
pub mod tiling;

use banda_kernel::{
    AgentId, Call, Error, Kind, Module, ModuleProject, Nothing, Refusal, Right, Scope, Tool, Tx,
    Wall,
};
pub use commands::{
    Arrange, Fill, Height, Maximize, MoveColumn, MovePane, MoveWorkspace, OneColumn, OnePane, Open,
    Regroup, ShowAs, Size, Take, Tidy, Update,
};
use model::{Arrangement, ColumnId, Opening, PaneId, Place, Seed, Shown, Side, Sight, WorkspaceId};
use placing::{Asked, By, Facts};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::collections::BTreeSet;
use tiling::Tiling;
use ts_rs::TS;

/// The version of every event this module writes.
pub const VERSION: u32 = 1;

/// The module's settings file in `~/.config/banda` (ADR 0016): the
/// Tiling's, `tiling.toml`. How the Tiling behaves the Person means
/// everywhere, as their keys: it follows them to every machine (ADR 0101,
/// decision 3; ADR 0127, decision 4).
pub const SETTINGS: [banda_look::SettingsFile; 1] =
    [banda_look::SettingsFile::of::<tiling::TilingSettings>()
        .class(banda_look::Class::Shared, &[])];

#[derive(Default)]
pub struct Workspaces {
    /// The Pane kinds that open as a Group of their own, as their window
    /// parts say (ADR 0065, decision 7).
    grouped: BTreeSet<String>,
    /// The Pane kinds that stand on their Project's workspace, as their
    /// window parts say (ADR 0065, decision 9).
    home: BTreeSet<String>,
    /// Reads this machine's copy of the Tiling's file; none, the Flow
    /// `free` and no rule.
    tiling: Option<Box<dyn Fn() -> Tiling + Send + Sync>>,
}

impl Workspaces {
    /// Workspaces that know no kind of Pane to open as a Group of its own.
    pub fn new() -> Self {
        Self::default()
    }

    /// The kinds of Pane that stand on their Project's workspace.
    pub fn home_kinds(mut self, kinds: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.home = kinds.into_iter().map(Into::into).collect();
        self
    }

    /// Whether `project` is of no Project, as this machine knows it: a
    /// draft stands in the machine's own ID. None for a Project it does not
    /// know, another machine's.
    async fn scratch(&self, call: &Call, project: banda_kernel::ProjectId) -> Option<bool> {
        if project == call.project().id() {
            return Some(true);
        }
        call.scratch(project).await
    }

    /// What this machine places a Pane by, and refuses a move by, read
    /// before the change, as it cannot wait (ADR 0110, decision 5).
    fn facts(&self) -> Facts {
        let unsaid = || Tiling {
            flow: tiling::Flow::Free,
            ..Tiling::default()
        };
        // A column that names no width is drawn by each client at the
        // widths the file gives: the engine places by none of them yet.
        let Tiling { flow, rules, .. } = self.tiling.as_ref().map_or_else(unsaid, |read| read());
        Facts {
            flow: flow.into(),
            home: self.home.clone(),
            leads: self.grouped.clone(),
            rules,
        }
    }

    /// Where this machine's copy of the Tiling's file is read from: its
    /// Flow and its rules by kind of Pane (ADR 0110, decision 5; ADR 0127,
    /// decision 4).
    pub fn tiling(mut self, read: impl Fn() -> Tiling + Send + Sync + 'static) -> Self {
        self.tiling = Some(Box::new(read));
        self
    }

    /// The kinds of Pane that open as a Group of their own, as a Thread
    /// does, whoever opens them: the engine reads them from the window
    /// parts (`PaneKind.grouped`), so the workspaces name no App for it.
    pub fn grouped_kinds(mut self, kinds: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.grouped = kinds.into_iter().map(Into::into).collect();
        self
    }
}

banda_kernel::methods! {
    Workspaces(Call) as "WorkspacesMethods" in "workspaces/" {
        /// The workspaces from the top down, at the log's position: a
        /// window draws them, then follows the module's events.
        call list(Nothing) -> Arranged, Read;
        /// Shows a Pane of a Project at a place, or instead of another, and
        /// names it. One shown already stays where it is, and is named.
        /// With no place it goes where the Flow says, by the Pane it is
        /// opened from, for the window, a program and `banda` alike (ADR
        /// 0110, decision 4). A rule of its kind in `tiling.toml` says
        /// how wide its new column is, and may say where it opens.
        command open(Open) -> Opened, Write;
        /// Closes a Pane; its column goes when it was the last there.
        command close(OnePane) -> Done, Write;
        /// Keeps new args for a Pane, which stays where it is.
        command update(Update) -> Done, Write;
        /// Moves a Pane to a place, counted as if it had left its own. In
        /// the row, never onto another Project's workspace: the window,
        /// an Agent and `banda` are refused alike (ADR 0110, decision 8).
        command move_pane(MovePane) -> Done, Write;
        /// Moves a column, its Panes and all, to a workspace, where the
        /// row lets it go, as `move_pane`.
        command move_column(MoveColumn) -> Done, Write;
        /// Moves a workspace, its columns and all, up or down; never under
        /// the empty one at the bottom.
        command move_workspace(MoveWorkspace) -> Done, Write;
        /// Gives a column its width; it no longer takes the whole screen.
        command size(Size) -> Done, Write;
        /// Gives a Pane its share of its column's height; left out, an
        /// even one.
        command height(Height) -> Done, Write;
        /// Makes every Pane of a column as high as the others.
        command even(OneColumn) -> Done, Write;
        /// Whether a column takes the whole screen.
        command maximize(Maximize) -> Done, Write;
        /// Shows a column's Panes one above another or as a Deck.
        command display(ShowAs) -> Done, Write;
        /// Starts a Group of a column alone, for others to join (ADR 0065).
        command group(OneColumn) -> Done, Write;
        /// A column in a Group leaves it that way; one in none joins the
        /// Group beside it that way.
        command regroup(Regroup) -> Done, Write;
        /// Moves the Group a column is in, its columns all, to a workspace,
        /// where the row lets it go, as `move_pane`: it moves as its
        /// Agent's Thread's Project, else as its first Pane's.
        command move_group(MoveColumn) -> Done, Write;
        /// Whether a column's Group takes the whole screen.
        command fill(Fill) -> Done, Write;
        /// Lets every empty workspace go but the one the Person looks at
        /// and the last.
        command tidy(Tidy) -> Done, Write;
        /// Puts every Pane where the row would have opened it: on its
        /// Project's workspace, the Person's own into its own Group and an
        /// Agent's last, or of no Project on a free one (ADR 0102,
        /// decisions 4, 7 and 9).
        command arrange(Arrange) -> Done, Write;
        /// Puts a window's arrangement over the engine's, once (ADR 0025,
        /// decision 2).
        command take(Take) -> Done, Write;
        /// Sets the workspaces aside, for a window that broke on them, and
        /// leaves one empty workspace (ADR 0039, decision 2). Those set
        /// aside before stay, with these after them.
        command set_aside(Nothing) -> Done, Write;
        /// Brings the workspaces set aside back, after the ones there are
        /// now.
        command bring_back(Nothing) -> Done, Write;
        /// Puts the workspaces back as they stood before the last Arrange
        /// by Project, while they still stand as it left them (ADR 0102,
        /// decision 9). Each Pane keeps the args it has now.
        command unarrange(Nothing) -> Done, Write;
        /// The Panes on the workspaces, from the top down and from the
        /// left: your Project's with their args, a browser's with the tabs
        /// your Project's Agents opened alone, and, when your Person lets
        /// you see the other Projects, theirs without. `yours` marks the
        /// ones you opened, which alone you move and close.
        call panes(Nothing) -> Vec<SeenWorkspace>, Read, tool "panes";
        /// Opens a Pane of your Project for your Person to see: one of its
        /// Threads (`agents.thread`, args `{"thread": "<id>"}` alone, an ID
        /// `threads` lists; `send` starts a Thread), the Diff (`git.diff`,
        /// args `{"scope": {"kind": "changes"}}`, or `uncommitted`,
        /// `staged`, or `{"kind": "commit", "sha": "<sha>"}`, with
        /// `"file": "<path>"` to show one), a file (`files.file`, args
        /// `{"path": "<path>", "line": <n>}`), or a browser at a web
        /// address (`browser.browser`, args `{"url": "https://…"}` alone).
        /// Only the args that choose what a Pane shows are yours to give;
        /// the rest are your Person's. Beside a Pane `panes` lists; left
        /// out, right of your Thread, in its Group, when your Thread is
        /// shown, else last on your Project's workspace, or beside your
        /// Project's Panes when it has none. A Thread opens as a Group of
        /// its own; left out, last on your Project's workspace or beside
        /// your Project's Panes, never in your Thread's. One shown already,
        /// a Thread's by its ID, stays where it is, and is named. It takes
        /// no focus; the Person sees a mark on it until they look.
        command open_pane(OpenPane) -> Opened, Write, tool "open_pane";
        /// Moves a Pane you opened beside another that `panes` lists. When
        /// each Project has its own workspace, never onto another
        /// Project's.
        command move_own(MoveOwn) -> Done, Write, tool "move_pane";
        /// Closes a Pane you opened.
        command close_own(OnePane) -> Done, Write, tool "close_pane";
    }
}

/// Refuses the args an Agent may not open a kind of Pane with.
type ArgsRule = fn(&Value) -> Result<(), Refusal>;

/// The kinds of Pane an Agent may open, each with the rule its args keep.
/// A kind is here when it shows, and runs nothing as the Person: a
/// terminal's runs the Person's shell, and the command its `done` sends
/// goes as the Person (ADR 0032). Only the Person's gesture acts as the
/// Person (ADR 0083, decision 3), so a kind's rule refuses an Agent every
/// arg that would send or start something. The Diff's args and a file's
/// choose only what they show: staging, reverting and saving wait for the
/// Person's click and typing. A browser loads its page in the Person's own
/// profile until an Agent's tabs have their Project's (ADR 0083,
/// decision 4).
const AGENT_KINDS: &[(&str, ArgsRule)] = &[
    ("agents.thread", a_thread),
    ("git.diff", |_| Ok(())),
    ("files.file", |_| Ok(())),
    ("browser.browser", web_address),
];

/// What an Agent does instead of giving a Thread's Pane words to send.
const SEND: &str = "To start a Thread or write to one, call `send`, as yourself.";

/// Refuses a Thread's Pane an Agent opens on anything but one Thread, by
/// its ID as `threads` lists it, so one Thread is one Pane. The rest of its
/// args are the Person's: `ask`, the words a Thread not yet started sends
/// first, the Project and Harness it starts in, and the title its header
/// keeps. An Agent starts a Thread, or writes to one, with `send`, as
/// itself, and the message says so (ADR 0019, decision 4). The Pane opens
/// in the Agent's Project, which answers for its own Threads alone.
fn a_thread(args: &Value) -> Result<(), Refusal> {
    shows_only(args, &["thread"]).map_err(|refused| Refusal {
        message: format!("{} {SEND}", refused.message),
        ..refused
    })?;
    let id = args.get("thread").and_then(Value::as_str);
    if id.is_some_and(|id| uuid::Uuid::parse_str(id).is_ok_and(|read| read.to_string() == id)) {
        return Ok(());
    }
    Err(Refusal::invalid(format!(
        "A Thread's Pane shows one of your Project's Threads: args \
         {{\"thread\": \"<id>\"}}, an ID as `threads` lists it. {SEND}"
    )))
}

/// Refuses any arg but `shows`, the ones an Agent gives a kind of Pane.
fn shows_only(args: &Value, shows: &[&str]) -> Result<(), Refusal> {
    let mut given = args.as_object().into_iter().flat_map(|args| args.keys());
    match given.find(|arg| !shows.contains(&arg.as_str())) {
        None => Ok(()),
        Some(other) => {
            let shows: Vec<_> = shows.iter().map(|arg| format!("`{arg}`")).collect();
            Err(Refusal::forbidden(format!(
                "`{other}` is your Person's to give: an Agent gives this Pane only {}.",
                shows.join(", ")
            )))
        }
    }
}

/// Drops the words a Thread's Pane an Agent opened would send first,
/// whenever it was kept: they are the Person's alone to give (ADR 0083,
/// decision 3).
fn unasked(pane: &mut model::Pane) {
    if pane.by.is_some()
        && pane.shows.kind == "agents.thread"
        && let Some(args) = pane.shows.args.as_object_mut()
    {
        args.remove("ask");
    }
}

/// Refuses a browser an Agent opens anywhere but at a web address, as
/// `browser_open` does: never at the Person's files (ADR 0029, decision 3).
fn web_address(args: &Value) -> Result<(), Refusal> {
    shows_only(args, &["url"])?;
    let scheme = (args.get("url"))
        .and_then(Value::as_str)
        .and_then(|url| url.split_once("://"));
    match scheme {
        Some((scheme, _))
            if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") =>
        {
            Ok(())
        }
        _ => Err(Refusal::invalid(
            "A browser opens at a web address: args {\"url\": \"https://…\"}.",
        )),
    }
}

/// A workspace as an Agent sees it: only the columns with a Pane it sees.
#[derive(Serialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct SeenWorkspace {
    pub id: WorkspaceId,
    pub columns: Vec<SeenColumn>,
}

#[derive(Serialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct SeenColumn {
    pub id: ColumnId,
    pub panes: Vec<SeenPane>,
}

#[derive(Serialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct SeenPane {
    pub id: PaneId,
    pub project: banda_kernel::ProjectId,
    pub kind: String,
    /// Its args, for a Pane of your Project, a browser's with the tabs your
    /// Project's Agents opened alone; none for another Project's.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub args: Option<Value>,
    /// You opened it.
    pub yours: bool,
}

#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "workspaces/")]
pub struct OpenPane {
    /// The kind: `agents.thread`, `git.diff`, `files.file` or `browser.browser`.
    pub kind: String,
    /// The kind's own, an object, only those that choose what it shows:
    /// a Thread's ID alone for a Thread's Pane, a web address alone for a
    /// browser.
    #[schemars(with = "serde_json::Map<String, Value>")]
    pub args: Value,
    /// A Pane `panes` lists, to open it beside. Left out, right of your
    /// Thread, in its Group, when your Thread is shown, else last on your
    /// Project's workspace, or beside your Project's Panes when it has
    /// none; a Thread, last on that workspace or beside those Panes.
    #[serde(default)]
    #[ts(optional)]
    pub beside: Option<Beside>,
}

#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "workspaces/")]
pub struct Beside {
    /// The Pane's ID, as `panes` lists it.
    pub pane: PaneId,
    /// `left` or `right`: a column of its own; `above` or `below`: in
    /// that Pane's column.
    pub side: Side,
}

impl Beside {
    /// Its place, by a Pane the caller behind `wall` sees.
    fn place(self, list: &Arrangement, wall: Wall) -> Result<Place, Refusal> {
        model::seen(list, wall, self.pane)?;
        Ok(Place::Beside {
            pane: self.pane,
            side: self.side,
        })
    }
}

#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "workspaces/")]
pub struct MoveOwn {
    /// A Pane you opened.
    pub pane: PaneId,
    /// Where it goes.
    pub beside: Beside,
}

/// The arrangement, and the log's position it is current at.
#[derive(Serialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Arranged {
    #[ts(type = "number")]
    pub at: i64,
    pub workspaces: Arrangement,
    /// What is set aside, if anything is.
    pub aside: Option<Aside>,
}

/// The workspaces set aside, as the Person is told of them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Aside {
    pub workspaces: u32,
    pub panes: u32,
}

impl Aside {
    fn of(list: &Arrangement) -> Option<Aside> {
        let panes = model::panes(list).count() as u32;
        let workspaces = list.iter().filter(|w| !w.columns.is_empty()).count() as u32;
        (panes > 0).then_some(Aside { workspaces, panes })
    }
}

/// What the module's events hold: the arrangement after it, or, for
/// `updated`, a Pane's new args.
#[derive(Serialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "workspaces/")]
pub enum Changed {
    /// The arrangement after the workspaces were set aside or came back,
    /// and what is aside now.
    Aside {
        workspaces: Arrangement,
        aside: Option<Aside>,
    },
    Whole {
        workspaces: Arrangement,
    },
    Args {
        pane: PaneId,
        args: Value,
    },
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Opened {
    /// The Pane: a new one's ID is derived from the command's ID
    /// (`model::Seed`), so the client that sent it knows it before this
    /// answer.
    pub pane: PaneId,
    /// False when the workspaces showed it already.
    pub new: bool,
}

/// What a change answers: nothing of its own, as the kernel's answer
/// carries where its event stands in the log (ADR 0082, decision 4).
/// Braced, so it is `{}`, not null: a window takes any answer as the
/// change done.
#[derive(Serialize, Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Done {}

#[async_trait::async_trait]
impl Module for Workspaces {
    fn name(&self) -> &'static str {
        "workspaces"
    }

    fn scope(&self) -> Scope {
        Scope::Machine
    }

    fn migrations(&self) -> &'static [&'static str] {
        // One row keeps the whole arrangement, and whether a window's was
        // taken.
        &[
            "CREATE TABLE workspaces_arrangement (
               one INTEGER PRIMARY KEY CHECK (one = 1),
               workspaces TEXT NOT NULL,
               taken INTEGER NOT NULL DEFAULT 0
           )",
            // The workspaces set aside, when a window broke on them.
            "ALTER TABLE workspaces_arrangement ADD COLUMN aside TEXT",
            // The last Arrange by Project, before it and after it, while
            // Undo may put it back.
            "ALTER TABLE workspaces_arrangement ADD COLUMN arranged TEXT",
        ]
    }

    /// The first arrangement, one empty workspace, made once, so its ID
    /// holds from the first read.
    async fn opened(&self, project: ModuleProject) -> Result<(), Error> {
        project
            .write(|tx| {
                tx.sql().execute(
                    "INSERT OR IGNORE INTO workspaces_arrangement (one, workspaces) VALUES (1, ?1)",
                    [serde_json::to_string(&model::start())?],
                )?;
                Ok(())
            })
            .await
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    fn tools(&self) -> Vec<Tool> {
        Self::method_tools(self.name())
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }
}

impl Workspaces {
    async fn list(&self, call: Call, _: Nothing) -> Result<Arranged, Refusal> {
        let (at, (workspaces, aside)) = call
            .project()
            .view(|sql| Ok((load(sql)?, Aside::of(&load_aside(sql)?))))
            .await?;
        Ok(Arranged {
            at,
            workspaces,
            aside,
        })
    }

    async fn set_aside(&self, call: Call, _: Nothing) -> Result<Done, Refusal> {
        change(&call, "set_aside", None, Say::Aside, |list, tx, seed| {
            if model::panes(list).next().is_none() {
                return Ok(());
            }
            let mut aside = load_aside(tx.sql())?;
            aside.extend(std::mem::replace(list, model::start_from(seed)));
            aside.retain(|w| !w.columns.is_empty());
            keep_aside(tx, &aside)
        })
        .await
        .map(|()| Done {})
    }

    async fn bring_back(&self, call: Call, _: Nothing) -> Result<Done, Refusal> {
        change(&call, "brought_back", None, Say::Aside, |list, tx, seed| {
            let aside = load_aside(tx.sql())?;
            if aside.is_empty() {
                return Ok(());
            }
            // The ones there are now first; a Pane shown in both, once.
            let now = std::mem::replace(list, aside);
            model::take(list, now, seed)?;
            keep_aside(tx, &[])
        })
        .await
        .map(|()| Done {})
    }

    async fn open(&self, call: Call, mut open: Open) -> Result<Opened, Refusal> {
        if self.grouped.contains(&open.shows.kind) {
            open.grouped.get_or_insert(true);
        }
        // Whether its Project is of no Project the engine says itself
        // where it knows the Project, as it says `grouped`: of its own it
        // takes no one's word (ADR 0110, decision 6).
        if let Some(known) = self.scratch(&call, open.shows.project).await {
            open.scratch = Some(known);
        }
        let facts = self.facts();
        let (pane, new) = change(&call, "opened", None, Say::Whole, move |list, _, seed| {
            Ok(commands::open(list, open, &facts, seed)?)
        })
        .await?;
        Ok(Opened { pane, new })
    }

    async fn close(&self, call: Call, one: OnePane) -> Result<Done, Refusal> {
        let pane = one.pane;
        done(&call, "closed", pane, Say::Whole, move |list, _, seed| {
            Ok(model::close(list, pane, seed)?)
        })
        .await
    }

    async fn update(&self, call: Call, update: Update) -> Result<Done, Refusal> {
        let Update { pane, args } = update;
        done(
            &call,
            "updated",
            pane,
            Say::Args(pane),
            move |list, _, _| Ok(model::update(list, pane, args)?),
        )
        .await
    }

    async fn move_pane(&self, call: Call, moving: MovePane) -> Result<Done, Refusal> {
        let facts = self.facts();
        let pane = moving.pane;
        done(&call, "moved", pane, Say::Whole, move |list, _, seed| {
            Ok(commands::move_pane(list, moving, &facts, seed)?)
        })
        .await
    }

    async fn move_column(&self, call: Call, moving: MoveColumn) -> Result<Done, Refusal> {
        self.moving(call, moving, false).await
    }

    /// Moves a column, or with `whole` the Group it is in, where the row
    /// lets it go.
    async fn moving(&self, call: Call, moving: MoveColumn, whole: bool) -> Result<Done, Refusal> {
        let facts = self.facts();
        let column = moving.column;
        done(&call, "moved", column, Say::Whole, move |list, _, seed| {
            Ok(commands::move_column(list, moving, whole, &facts, seed)?)
        })
        .await
    }

    async fn move_workspace(&self, call: Call, moving: MoveWorkspace) -> Result<Done, Refusal> {
        let MoveWorkspace { workspace, index } = moving;
        done(&call, "moved", workspace, Say::Whole, move |list, _, _| {
            Ok(model::move_workspace(list, workspace, index)?)
        })
        .await
    }

    async fn size(&self, call: Call, size: Size) -> Result<Done, Refusal> {
        let Size { column, width } = size;
        done(&call, "sized", column, Say::Whole, move |list, _, _| {
            Ok(model::size(list, column, width)?)
        })
        .await
    }

    async fn height(&self, call: Call, height: Height) -> Result<Done, Refusal> {
        let Height { pane, height } = height;
        done(&call, "heightened", pane, Say::Whole, move |list, _, _| {
            Ok(model::height(list, pane, height)?)
        })
        .await
    }

    async fn even(&self, call: Call, one: OneColumn) -> Result<Done, Refusal> {
        let column = one.column;
        done(&call, "evened", column, Say::Whole, move |list, _, _| {
            Ok(model::even(list, column)?)
        })
        .await
    }

    async fn maximize(&self, call: Call, maximize: Maximize) -> Result<Done, Refusal> {
        let Maximize { column, full } = maximize;
        done(&call, "maximized", column, Say::Whole, move |list, _, _| {
            Ok(model::maximize(list, column, full)?)
        })
        .await
    }

    async fn display(&self, call: Call, show: ShowAs) -> Result<Done, Refusal> {
        let ShowAs { column, display } = show;
        done(&call, "displayed", column, Say::Whole, move |list, _, _| {
            Ok(model::display(list, column, display)?)
        })
        .await
    }

    async fn group(&self, call: Call, one: OneColumn) -> Result<Done, Refusal> {
        let column = one.column;
        done(
            &call,
            "grouped",
            column,
            Say::Whole,
            move |list, _, seed| Ok(model::group(list, column, seed)?),
        )
        .await
    }

    async fn regroup(&self, call: Call, regroup: Regroup) -> Result<Done, Refusal> {
        let Regroup { column, toward } = regroup;
        done(&call, "regrouped", column, Say::Whole, move |list, _, _| {
            Ok(model::regroup(list, column, toward)?)
        })
        .await
    }

    async fn move_group(&self, call: Call, moving: MoveColumn) -> Result<Done, Refusal> {
        self.moving(call, moving, true).await
    }

    async fn fill(&self, call: Call, fill: Fill) -> Result<Done, Refusal> {
        let Fill { column, fill } = fill;
        done(&call, "filled", column, Say::Whole, move |list, _, _| {
            Ok(model::fill(list, column, fill)?)
        })
        .await
    }

    async fn tidy(&self, call: Call, tidy: Tidy) -> Result<Done, Refusal> {
        change(&call, "tidied", None, Say::Whole, move |list, _, _| {
            model::tidy(list, tidy.keep, &tidy.projects);
            Ok(())
        })
        .await
        .map(|()| Done {})
    }

    async fn arrange(&self, call: Call, arrange: Arrange) -> Result<Done, Refusal> {
        let leads = (arrange.leads).unwrap_or_else(|| self.grouped.iter().cloned().collect());
        change(
            &call,
            "arranged",
            None,
            Say::Whole,
            move |list, tx, seed| {
                let before = list.clone();
                model::arrange(list, &arrange.projects, arrange.only, &leads, seed);
                // Undo puts back the Person's Arrange of every Project, and
                // none past one that moved nothing. One with `only`, as a
                // Thread made a Project's, is another change.
                if arrange.only.is_some() {
                    return Ok(());
                }
                let after = list.clone();
                let last = (after != before).then_some(LastArrange { before, after });
                keep_arranged(tx, last.as_ref())
            },
        )
        .await
        .map(|()| Done {})
    }

    async fn unarrange(&self, call: Call, _: Nothing) -> Result<Done, Refusal> {
        change(&call, "unarranged", None, Say::Whole, |list, tx, _| {
            let Some(last) = load_arranged(tx.sql())? else {
                return Err(Refusal::conflict("There is no Arrange to undo.").into());
            };
            model::unarrange(list, last.before, &last.after)?;
            keep_arranged(tx, None)
        })
        .await
        .map(|()| Done {})
    }

    async fn take(&self, call: Call, take: Take) -> Result<Done, Refusal> {
        change(&call, "taken", None, Say::Whole, move |list, tx, seed| {
            let taken: bool = tx.sql().query_row(
                "SELECT taken FROM workspaces_arrangement WHERE one = 1",
                [],
                |row| row.get(0),
            )?;
            if taken {
                return Err(Refusal::conflict(
                    "The engine took a window's workspaces already: it takes them once.",
                )
                .into());
            }
            tx.sql().execute(
                "UPDATE workspaces_arrangement SET taken = 1 WHERE one = 1",
                [],
            )?;
            Ok(model::take(list, take.workspaces, seed)?)
        })
        .await
        .map(|()| Done {})
    }
}

impl Workspaces {
    async fn panes(&self, call: Call, _: Nothing) -> Result<Vec<SeenWorkspace>, Refusal> {
        let wall = call.wall();
        let me = call.participant().agent();
        let (_, list) = call.project().view(load).await?;
        let seen = |pane: &model::Pane| {
            let sight = model::sight(wall, pane);
            (sight != Sight::Hidden).then(|| SeenPane {
                id: pane.id,
                project: pane.shows.project,
                kind: pane.shows.kind.clone(),
                args: (sight == Sight::Whole).then(|| args_seen(wall, &pane.shows)),
                yours: me.is_some() && pane.by == me,
            })
        };
        Ok(list
            .iter()
            .map(|workspace| SeenWorkspace {
                id: workspace.id,
                columns: (workspace.columns.iter())
                    .filter_map(|column| {
                        let panes: Vec<_> = column.panes.iter().filter_map(seen).collect();
                        (!panes.is_empty()).then_some(SeenColumn {
                            id: column.id,
                            panes,
                        })
                    })
                    .collect(),
            })
            .filter(|workspace| !workspace.columns.is_empty())
            .collect())
    }

    async fn open_pane(&self, call: Call, open: OpenPane) -> Result<Opened, Refusal> {
        let (wall, me) = walled(&call)?;
        let Some((_, refuses)) = AGENT_KINDS.iter().find(|(kind, _)| *kind == open.kind) else {
            let kinds: Vec<_> = AGENT_KINDS.iter().map(|(kind, _)| *kind).collect();
            return Err(Refusal::forbidden(format!(
                "An Agent opens only {}: they run nothing as your Person.",
                kinds.join(", ")
            )));
        };
        refuses(&open.args)?;
        let shows = Shown {
            project: wall.project,
            kind: open.kind,
            args: open.args,
        };
        let beside = open.beside;
        // A kind that opens as a Group of its own does so here too, unless
        // it goes into another Pane's column, which stays as it is.
        let grouped = self.grouped.contains(&shows.kind);
        let stacks = (beside.as_ref()).is_some_and(|b| matches!(b.side, Side::Above | Side::Below));
        // What its Agent opens with no place goes where the Flow says: into
        // the Group of the Thread its pass was made for (ADR 0065, decisions
        // 6 and 7), else on its Project's workspace (ADR 0102, decision 4).
        // Its new column is as wide as its kind's rule says.
        let facts = self.facts();
        let width = facts.width(&shows.kind);
        let asked = if beside.is_none() {
            Some(Asked {
                flow: facts.flow,
                project: shows.project,
                grouped,
                home: facts.at_home(&shows.kind),
                opens: facts.opens(&shows.kind),
                scratch: self.scratch(&call, shows.project).await == Some(true),
                from: None,
                on: None,
                by: By::Agent {
                    thread: call.thread(),
                },
            })
        } else {
            None
        };
        let (pane, new) = change(&call, "opened", None, Say::Whole, move |list, _, seed| {
            let place = beside.map(|b| b.place(list, wall)).transpose()?;
            if let Some(shown) = model::showing_asked(list, &shows) {
                return Ok((shown.id, false));
            }
            let place = place.or_else(|| placing::place(list, asked?));
            let opening = Opening {
                place,
                width,
                by: Some(me),
                ..Opening::of(shows)
            };
            let pane = model::open(list, opening, seed)?;
            if grouped && !stacks {
                model::group_pane(list, pane, seed)?;
            }
            Ok((pane, true))
        })
        .await?;
        Ok(Opened { pane, new })
    }

    async fn move_own(&self, call: Call, moving: MoveOwn) -> Result<Done, Refusal> {
        let (wall, me) = walled(&call)?;
        let MoveOwn { pane, beside } = moving;
        let facts = self.facts();
        done(&call, "moved", pane, Say::Whole, move |list, _, seed| {
            own(list, wall, me, pane)?;
            let moving = MovePane {
                pane,
                place: beside.place(list, wall)?,
                grouped: None,
            };
            Ok(commands::move_pane(list, moving, &facts, seed)?)
        })
        .await
    }

    async fn close_own(&self, call: Call, one: OnePane) -> Result<Done, Refusal> {
        let (wall, me) = walled(&call)?;
        let pane = one.pane;
        done(&call, "closed", pane, Say::Whole, move |list, _, seed| {
            own(list, wall, me, pane)?;
            Ok(model::close(list, pane, seed)?)
        })
        .await
    }
}

/// The args of a Pane a caller behind `wall` sees whole. A browser's tabs
/// are only those its Project's Agents opened, each naming that Project as
/// `agents`, and an address alone is one an Agent opened (`open_pane`):
/// the Person's own tabs are no Agent's to see (ADR 0083, decision 4).
fn args_seen(wall: Option<Wall>, shows: &Shown) -> Value {
    let Some(wall) = wall.filter(|_| shows.kind == "browser.browser") else {
        return shows.args.clone();
    };
    let Some(tabs) = shows.args.get("tabs").and_then(Value::as_array) else {
        return shows.args.clone();
    };
    let project = wall.project.to_string();
    let shown = shows.args.get("shown").and_then(Value::as_u64);
    let (mut kept, mut now) = (Vec::new(), 0);
    for (at, tab) in tabs.iter().enumerate() {
        if tab.get("agents").and_then(Value::as_str) != Some(project.as_str()) {
            continue;
        }
        if shown == Some(at as u64) {
            now = kept.len();
        }
        kept.push(tab.clone());
    }
    serde_json::json!({ "tabs": kept, "shown": now })
}

/// The wall and the Agent of a call to an Agent's tool.
fn walled(call: &Call) -> Result<(Wall, AgentId), Refusal> {
    match (call.wall(), call.participant().agent()) {
        (Some(wall), Some(agent)) => Ok((wall, agent)),
        _ => Err(Refusal::invalid(
            "This is an Agent's tool: a Person arranges with open, move_pane and close.",
        )),
    }
}

/// Refuses a Pane `agent` did not open.
fn own(list: &Arrangement, wall: Wall, agent: AgentId, pane: PaneId) -> Result<(), Refusal> {
    if model::seen(list, wall, pane)?.by == Some(agent) {
        Ok(())
    } else {
        Err(Refusal::forbidden(
            "An Agent moves and closes only the Panes it opened; ask your Person for the rest.",
        ))
    }
}

/// How a change's event says it.
enum Say {
    /// The whole arrangement after it.
    Whole,
    /// Only this Pane's new args.
    Args(PaneId),
    /// The whole arrangement after it, and what is set aside now.
    Aside,
}

/// A change about one thing, which answers nothing of its own.
async fn done(
    call: &Call,
    kind: &'static str,
    subject: impl ToString,
    say: Say,
    how: impl FnOnce(&mut Arrangement, &mut Tx<'_>, &Seed) -> Result<(), Error> + Send + 'static,
) -> Result<Done, Refusal> {
    let subject = Some(subject.to_string());
    change(call, kind, subject, say, how).await?;
    Ok(Done {})
}

/// Runs a command on the arrangement, and keeps and says it when it
/// changed; one no change touched says nothing, so the kernel answers it
/// with no place in the log. What it makes takes IDs derived from its
/// command's ID, and one whose IDs the workspaces hold already ran.
async fn change<T>(
    call: &Call,
    kind: &'static str,
    subject: Option<String>,
    say: Say,
    how: impl FnOnce(&mut Arrangement, &mut Tx<'_>, &Seed) -> Result<T, Error> + Send + 'static,
) -> Result<T, Refusal>
where
    T: Serialize + DeserializeOwned + Send + 'static,
{
    let author = call.participant();
    let seed = Seed::of(&call.command_id()?.to_string());
    call.command(move |tx| {
        let before = load(tx.sql())?;
        seed.unused(&before)?;
        let mut list = before.clone();
        let answer = how(&mut list, tx, &seed)?;
        if list == before {
            return Ok(answer);
        }
        keep(tx, &list)?;
        let said = match say {
            Say::Args(pane) => Changed::Args {
                pane,
                args: model::args_of(&list, pane).cloned().unwrap_or_default(),
            },
            Say::Whole => Changed::Whole { workspaces: list },
            Say::Aside => Changed::Aside {
                aside: Aside::of(&load_aside(tx.sql())?),
                workspaces: list,
            },
        };
        tx.emit(kind, VERSION, subject.as_deref(), author, &said)?;
        Ok(answer)
    })
    .await
}

fn load(sql: &rusqlite::Connection) -> Result<Arrangement, Error> {
    let text: String = sql.query_row(
        "SELECT workspaces FROM workspaces_arrangement WHERE one = 1",
        [],
        |row| row.get(0),
    )?;
    parsed(&text)
}

/// An arrangement as this module keeps it, each Pane's args as its kind
/// reads them now, and none an Agent may not give.
fn parsed(text: &str) -> Result<Arrangement, Error> {
    let mut list: Arrangement = serde_json::from_str(text)?;
    upgraded(&mut list);
    Ok(list)
}

/// Reads each Pane's args of `list` as its kind reads them now, and drops
/// any an Agent may not give.
fn upgraded(list: &mut Arrangement) {
    for pane in model::panes_mut(list) {
        pane.shows.upgrade();
        unasked(pane);
    }
}

/// The last Arrange by Project, while Undo may put it back: the
/// arrangement before it, and after it (ADR 0102, decision 9).
#[derive(Serialize, Deserialize)]
struct LastArrange {
    before: Arrangement,
    after: Arrangement,
}

/// The last Arrange by Project, if there is one to undo.
fn load_arranged(sql: &rusqlite::Connection) -> Result<Option<LastArrange>, Error> {
    let text: Option<String> = sql.query_row(
        "SELECT arranged FROM workspaces_arrangement WHERE one = 1",
        [],
        |row| row.get(0),
    )?;
    let Some(text) = text else {
        return Ok(None);
    };
    let mut last: LastArrange = serde_json::from_str(&text)?;
    upgraded(&mut last.before);
    upgraded(&mut last.after);
    Ok(Some(last))
}

/// Keeps `last` as the last Arrange by Project; none, when there is none
/// to undo.
fn keep_arranged(tx: &Tx<'_>, last: Option<&LastArrange>) -> Result<(), Error> {
    let kept = last.map(serde_json::to_string).transpose()?;
    tx.sql().execute(
        "UPDATE workspaces_arrangement SET arranged = ?1 WHERE one = 1",
        [kept],
    )?;
    Ok(())
}

/// The workspaces set aside; none when there are none.
fn load_aside(sql: &rusqlite::Connection) -> Result<Arrangement, Error> {
    let text: Option<String> = sql.query_row(
        "SELECT aside FROM workspaces_arrangement WHERE one = 1",
        [],
        |row| row.get(0),
    )?;
    Ok(text.as_deref().map(parsed).transpose()?.unwrap_or_default())
}

/// Keeps `aside` as the workspaces set aside; none, when it is empty.
fn keep_aside(tx: &Tx<'_>, aside: &[model::Workspace]) -> Result<(), Error> {
    let kept = (!aside.is_empty())
        .then(|| serde_json::to_string(aside))
        .transpose()?;
    tx.sql().execute(
        "UPDATE workspaces_arrangement SET aside = ?1 WHERE one = 1",
        [kept],
    )?;
    Ok(())
}

fn keep(tx: &Tx<'_>, list: &Arrangement) -> Result<(), Error> {
    tx.sql().execute(
        "UPDATE workspaces_arrangement SET workspaces = ?1 WHERE one = 1",
        [serde_json::to_string(list)?],
    )?;
    Ok(())
}
