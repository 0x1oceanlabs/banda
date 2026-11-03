//! The workspaces module: how this machine's Panes are arranged, in the
//! engine, so the window, the CLI and Agents change them alike (ADR 0005,
//! decision 3; ADR 0025, decision 1).
//!
//! It is the machine's, not a Space's: one workspace holds Panes of every
//! Space. Its commands carry what was decided, a place or a width; what
//! depends on the look or the view stays the window's. A change says the
//! whole arrangement after it in one event, so a window that follows
//! draws what the event holds; new args for a Pane, the change made most,
//! say only those. A command that changes nothing says nothing.
//!
//! An Agent arranges through its tools alone (ADR 0032): it sees its
//! Space's Panes, and the other Spaces' outlines when its Person lets it;
//! it opens Panes of its Space that run nothing as the Person, and moves
//! and closes only those it opened.

pub mod model;

use banda_kernel::{
    AgentId, Call, Error, Module, ModuleSpace, Nothing, Refusal, Right, Scope, Tool, Tx, Wall,
};
use banda_look::columns::Display;
use model::{Arrangement, ColumnId, PaneId, Place, Shown, Side, Sight, WorkspaceId};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use ts_rs::TS;

/// The version of every event this module writes.
pub const VERSION: u32 = 1;

#[derive(Default)]
pub struct Workspaces;

impl Workspaces {
    pub fn new() -> Self {
        Self
    }
}

banda_kernel::methods! {
    Workspaces(Call) as "WorkspacesMethods" in "workspaces/" {
        /// The workspaces from the top down, at the log's position: a
        /// window draws them, then follows the module's events.
        call list(Nothing) -> Arranged, Read;
        /// Shows a Pane of a Space at a place, or instead of another, and
        /// names it. One shown already stays where it is, and is named.
        command open(Open) -> Opened, Write;
        /// Closes a Pane; its column goes when it was the last there.
        command close(OnePane) -> Done, Write;
        /// Keeps new args for a Pane, which stays where it is.
        command update(Update) -> Done, Write;
        /// Moves a Pane to a place, counted as if it had left its own.
        command move_pane(MovePane) -> Done, Write;
        /// Moves a column, its Panes and all, to a workspace.
        command move_column(MoveColumn) -> Done, Write;
        /// Gives a column its width; it no longer takes the whole screen.
        command size(Size) -> Done, Write;
        /// Gives a Pane its share of its column's height; left out, an
        /// even one.
        command height(Height) -> Done, Write;
        /// Makes every Pane of a column as high as the others.
        command even(OneColumn) -> Done, Write;
        /// Whether a column takes the whole screen.
        command maximize(Maximize) -> Done, Write;
        /// Shows a column's Panes one above another or as tabs.
        command display(ShowAs) -> Done, Write;
        /// Lets every empty workspace go but the one the Person looks at
        /// and the last.
        command tidy(Tidy) -> Done, Write;
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
        /// The Panes on the workspaces, from the top down and from the
        /// left: your Space's with their args, and, when your Person lets
        /// you see the other Spaces, theirs without. `yours` marks the
        /// ones you opened, which alone you move and close.
        call panes(Nothing) -> Vec<SeenWorkspace>, Read, tool "panes";
        /// Opens a Pane of your Space for your Person to see: a Thread
        /// (`agents.thread`, args `{"thread": "<id>"}`), the Diff
        /// (`git.diff`, args `{"scope": {"kind": "changes"}}`, or `uncommitted`,
        /// `staged`, or `{"kind": "commit", "sha": "<sha>"}`), or a
        /// browser at a web address (`browser.browser`, args
        /// `{"url": "https://…"}`). Beside a Pane `panes` lists, or,
        /// left out, beside your Space's Panes. It takes no focus; the
        /// Person sees a mark on it until they look.
        command open_pane(OpenPane) -> Opened, Write, tool "open_pane";
        /// Moves a Pane you opened beside another that `panes` lists.
        command move_own(MoveOwn) -> Done, Write, tool "move_pane";
        /// Closes a Pane you opened.
        command close_own(OnePane) -> Done, Write, tool "close_pane";
    }
}

/// The kinds of Pane an Agent may open: ones that show, and run nothing as
/// the Person. A terminal's runs the Person's shell, and the command its
/// `done` sends goes as the Person (ADR 0032).
const AGENT_KINDS: &[&str] = &["agents.thread", "git.diff", "browser.browser"];

/// Refuses a browser an Agent opens anywhere but at a web address, as
/// `browser_open` does: never at the Person's files (ADR 0029, decision 3).
fn web_address(args: &Value) -> Result<(), Refusal> {
    let url = args
        .as_object()
        .filter(|args| args.len() == 1)
        .and_then(|args| args.get("url"));
    let scheme = url
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
    pub space: banda_kernel::SpaceId,
    pub kind: String,
    /// Its args, for a Pane of your Space; none for another Space's.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub args: Option<Value>,
    /// You opened it.
    pub yours: bool,
}

#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "workspaces/")]
pub struct OpenPane {
    /// The kind: `agents.thread`, `git.diff` or `browser.browser`.
    pub kind: String,
    /// The kind's own, an object, as `panes` shows them.
    #[schemars(with = "serde_json::Map<String, Value>")]
    pub args: Value,
    /// A Pane `panes` lists, to open it beside.
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

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Open {
    #[serde(flatten)]
    #[ts(flatten)]
    pub shows: Shown,
    /// Left out, a column on the right of the top workspace that shows a
    /// Pane of its Space, or of the empty one at the bottom.
    #[serde(default)]
    #[ts(optional)]
    pub place: Option<Place>,
    /// The Pane it shows in place of, which leaves.
    #[serde(default)]
    #[ts(optional)]
    pub instead: Option<PaneId>,
    /// A new column's width; left out, the look's.
    #[serde(default)]
    #[ts(optional)]
    pub width: Option<String>,
    /// A new Pane even when one shows the same: a New Thread, a New Pane,
    /// as a browser's new window.
    #[serde(default)]
    #[ts(optional)]
    pub again: Option<bool>,
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Opened {
    pub pane: PaneId,
    /// False when the workspaces showed it already.
    pub new: bool,
    /// Where its event stands in the log, as `Done`'s.
    #[ts(type = "number | null")]
    pub at: Option<i64>,
}

/// What a change answers: where its event stands in the log, so a window
/// draws it before it works out the next; none when nothing changed.
#[derive(Serialize, Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Done {
    #[ts(type = "number | null")]
    pub at: Option<i64>,
}

#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "workspaces/")]
pub struct OnePane {
    /// The Pane's ID, as `panes` lists it.
    pub pane: PaneId,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Update {
    pub pane: PaneId,
    pub args: Value,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct MovePane {
    pub pane: PaneId,
    pub place: Place,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct MoveColumn {
    pub column: ColumnId,
    pub workspace: WorkspaceId,
    /// From the left, counted as if it had left its place; past the last,
    /// the last.
    pub index: usize,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Size {
    pub column: ColumnId,
    /// A share of the screen, such as `"1/2"`; left out, the look's.
    #[serde(default)]
    #[ts(optional)]
    pub width: Option<String>,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Height {
    pub pane: PaneId,
    /// A share of its column's height, such as `"1/3"`; left out, even.
    #[serde(default)]
    #[ts(optional)]
    pub height: Option<String>,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct OneColumn {
    pub column: ColumnId,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Maximize {
    pub column: ColumnId,
    pub full: bool,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct ShowAs {
    pub column: ColumnId,
    /// Left out, as the look says.
    #[serde(default)]
    #[ts(optional)]
    pub display: Option<Display>,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Tidy {
    /// The workspace the Person looks at, which stays even empty.
    #[serde(default)]
    #[ts(optional)]
    pub keep: Option<WorkspaceId>,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Take {
    pub workspaces: Arrangement,
}

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
        ]
    }

    /// The first arrangement, one empty workspace, made once, so its ID
    /// holds from the first read.
    async fn opened(&self, space: ModuleSpace) -> Result<(), Error> {
        space
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
            .space()
            .view(|sql| Ok((load(sql)?, Aside::of(&load_aside(sql)?))))
            .await?;
        Ok(Arranged {
            at,
            workspaces,
            aside,
        })
    }

    async fn set_aside(&self, call: Call, _: Nothing) -> Result<Done, Refusal> {
        change(&call, "set_aside", None, Say::Aside, |list, tx| {
            if model::panes(list).next().is_none() {
                return Ok(());
            }
            let mut aside = load_aside(tx.sql())?;
            aside.extend(std::mem::replace(list, model::start()));
            aside.retain(|w| !w.columns.is_empty());
            keep_aside(tx, &aside)
        })
        .await
        .map(|((), at)| Done { at })
    }

    async fn bring_back(&self, call: Call, _: Nothing) -> Result<Done, Refusal> {
        change(&call, "brought_back", None, Say::Aside, |list, tx| {
            let aside = load_aside(tx.sql())?;
            if aside.is_empty() {
                return Ok(());
            }
            // The ones there are now first; a Pane shown in both, once.
            let now = std::mem::replace(list, aside);
            model::take(list, now)?;
            keep_aside(tx, &[])
        })
        .await
        .map(|((), at)| Done { at })
    }

    async fn open(&self, call: Call, open: Open) -> Result<Opened, Refusal> {
        let ((pane, new), at) = change(&call, "opened", None, Say::Whole, move |list, _| {
            let again = open.again == Some(true) || open.instead.is_some();
            let new = again || model::showing(list, &open.shows).is_none();
            let Open {
                shows,
                place,
                instead,
                width,
                ..
            } = open;
            let pane = model::open(list, shows, place, instead, width, again, None)?;
            Ok((pane, new))
        })
        .await?;
        Ok(Opened { pane, new, at })
    }

    async fn close(&self, call: Call, one: OnePane) -> Result<Done, Refusal> {
        let pane = one.pane;
        done(&call, "closed", pane, Say::Whole, move |list, _| {
            Ok(model::close(list, pane)?)
        })
        .await
    }

    async fn update(&self, call: Call, update: Update) -> Result<Done, Refusal> {
        let Update { pane, args } = update;
        done(&call, "updated", pane, Say::Args(pane), move |list, _| {
            Ok(model::update(list, pane, args)?)
        })
        .await
    }

    async fn move_pane(&self, call: Call, moving: MovePane) -> Result<Done, Refusal> {
        let MovePane { pane, place } = moving;
        done(&call, "moved", pane, Say::Whole, move |list, _| {
            Ok(model::move_pane(list, pane, &place)?)
        })
        .await
    }

    async fn move_column(&self, call: Call, moving: MoveColumn) -> Result<Done, Refusal> {
        let MoveColumn {
            column,
            workspace,
            index,
        } = moving;
        done(&call, "moved", column, Say::Whole, move |list, _| {
            Ok(model::move_column(list, column, workspace, index)?)
        })
        .await
    }

    async fn size(&self, call: Call, size: Size) -> Result<Done, Refusal> {
        let Size { column, width } = size;
        done(&call, "sized", column, Say::Whole, move |list, _| {
            Ok(model::size(list, column, width)?)
        })
        .await
    }

    async fn height(&self, call: Call, height: Height) -> Result<Done, Refusal> {
        let Height { pane, height } = height;
        done(&call, "heightened", pane, Say::Whole, move |list, _| {
            Ok(model::height(list, pane, height)?)
        })
        .await
    }

    async fn even(&self, call: Call, one: OneColumn) -> Result<Done, Refusal> {
        let column = one.column;
        done(&call, "evened", column, Say::Whole, move |list, _| {
            Ok(model::even(list, column)?)
        })
        .await
    }

    async fn maximize(&self, call: Call, maximize: Maximize) -> Result<Done, Refusal> {
        let Maximize { column, full } = maximize;
        done(&call, "maximized", column, Say::Whole, move |list, _| {
            Ok(model::maximize(list, column, full)?)
        })
        .await
    }

    async fn display(&self, call: Call, show: ShowAs) -> Result<Done, Refusal> {
        let ShowAs { column, display } = show;
        done(&call, "displayed", column, Say::Whole, move |list, _| {
            Ok(model::display(list, column, display)?)
        })
        .await
    }

    async fn tidy(&self, call: Call, tidy: Tidy) -> Result<Done, Refusal> {
        change(&call, "tidied", None, Say::Whole, move |list, _| {
            model::tidy(list, tidy.keep);
            Ok(())
        })
        .await
        .map(|((), at)| Done { at })
    }

    async fn take(&self, call: Call, take: Take) -> Result<Done, Refusal> {
        change(&call, "taken", None, Say::Whole, move |list, tx| {
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
            Ok(model::take(list, take.workspaces)?)
        })
        .await
        .map(|((), at)| Done { at })
    }
}

impl Workspaces {
    async fn panes(&self, call: Call, _: Nothing) -> Result<Vec<SeenWorkspace>, Refusal> {
        let wall = call.wall();
        let me = call.participant().agent();
        let (_, list) = call.space().view(load).await?;
        let seen = |pane: &model::Pane| {
            let sight = model::sight(wall, pane);
            (sight != Sight::Hidden).then(|| SeenPane {
                id: pane.id,
                space: pane.shows.space,
                kind: pane.shows.kind.clone(),
                args: (sight == Sight::Whole).then(|| pane.shows.args.clone()),
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
        if !AGENT_KINDS.contains(&open.kind.as_str()) {
            return Err(Refusal::invalid(format!(
                "An Agent opens only {}: they run nothing as your Person.",
                AGENT_KINDS.join(", ")
            )));
        }
        if open.kind == "browser.browser" {
            web_address(&open.args)?;
        }
        let shows = Shown {
            space: wall.space,
            kind: open.kind,
            args: open.args,
        };
        let beside = open.beside;
        let ((pane, new), at) = change(&call, "opened", None, Say::Whole, move |list, _| {
            let place = beside.map(|b| b.place(list, wall)).transpose()?;
            let new = model::showing(list, &shows).is_none();
            let pane = model::open(list, shows, place, None, None, false, Some(me))?;
            Ok((pane, new))
        })
        .await?;
        Ok(Opened { pane, new, at })
    }

    async fn move_own(&self, call: Call, moving: MoveOwn) -> Result<Done, Refusal> {
        let (wall, me) = walled(&call)?;
        let MoveOwn { pane, beside } = moving;
        done(&call, "moved", pane, Say::Whole, move |list, _| {
            own(list, wall, me, pane)?;
            let place = beside.place(list, wall)?;
            Ok(model::move_pane(list, pane, &place)?)
        })
        .await
    }

    async fn close_own(&self, call: Call, one: OnePane) -> Result<Done, Refusal> {
        let (wall, me) = walled(&call)?;
        let pane = one.pane;
        done(&call, "closed", pane, Say::Whole, move |list, _| {
            own(list, wall, me, pane)?;
            Ok(model::close(list, pane)?)
        })
        .await
    }
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

/// A change about one thing, which answers only where it stands.
async fn done(
    call: &Call,
    kind: &'static str,
    subject: impl ToString,
    say: Say,
    how: impl FnOnce(&mut Arrangement, &mut Tx<'_>) -> Result<(), Error> + Send + 'static,
) -> Result<Done, Refusal> {
    let subject = Some(subject.to_string());
    let ((), at) = change(call, kind, subject, say, how).await?;
    Ok(Done { at })
}

/// Runs a command on the arrangement, and keeps and says it when it
/// changed, with where its event stands in the log; one no change touched
/// says nothing.
async fn change<T>(
    call: &Call,
    kind: &'static str,
    subject: Option<String>,
    say: Say,
    how: impl FnOnce(&mut Arrangement, &mut Tx<'_>) -> Result<T, Error> + Send + 'static,
) -> Result<(T, Option<i64>), Refusal>
where
    T: Serialize + DeserializeOwned + Send + 'static,
{
    let author = call.participant();
    call.command(move |tx| {
        let before = load(tx.sql())?;
        let mut list = before.clone();
        let answer = how(&mut list, tx)?;
        if list == before {
            return Ok((answer, None));
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
        let event = tx.emit(kind, VERSION, subject.as_deref(), author, &said)?;
        Ok((answer, Some(event.seq)))
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
/// reads them now.
fn parsed(text: &str) -> Result<Arrangement, Error> {
    let mut list: Arrangement = serde_json::from_str(text)?;
    for pane in list
        .iter_mut()
        .flat_map(|w| &mut w.columns)
        .flat_map(|c| &mut c.panes)
    {
        pane.shows.upgrade();
    }
    Ok(list)
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
