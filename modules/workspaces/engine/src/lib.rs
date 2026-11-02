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

pub mod model;

use banda_kernel::{Call, Error, Module, ModuleSpace, Nothing, Refusal, Right, Scope, Tx};
use banda_look::columns::Display;
use model::{Arrangement, ColumnId, PaneId, Place, Shown, WorkspaceId};
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
        command close(OnePane) -> (), Write;
        /// Keeps new args for a Pane, which stays where it is.
        command update(Update) -> (), Write;
        /// Moves a Pane to a place, counted as if it had left its own.
        command move_pane(MovePane) -> (), Write;
        /// Moves a column, its Panes and all, to a workspace.
        command move_column(MoveColumn) -> (), Write;
        /// Gives a column its width; it no longer takes the whole screen.
        command size(Size) -> (), Write;
        /// Whether a column takes the whole screen.
        command maximize(Maximize) -> (), Write;
        /// Shows a column's Panes one above another or as tabs.
        command display(ShowAs) -> (), Write;
        /// Lets every empty workspace go but the one the Person looks at
        /// and the last.
        command tidy(Tidy) -> (), Write;
        /// Puts a window's arrangement over the engine's, once (ADR 0025,
        /// decision 2).
        command take(Take) -> (), Write;
    }
}

/// The arrangement, and the log's position it is current at.
#[derive(Serialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Arranged {
    #[ts(type = "number")]
    pub at: i64,
    pub workspaces: Arrangement,
}

/// What the module's events hold: the arrangement after it, or, for
/// `updated`, a Pane's new args.
#[derive(Serialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "workspaces/")]
pub enum Changed {
    Whole { workspaces: Arrangement },
    Args { pane: PaneId, args: Value },
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
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Opened {
    pub pane: PaneId,
    /// False when the workspaces showed it already.
    pub new: bool,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct OnePane {
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
        &["CREATE TABLE workspaces_arrangement (
               one INTEGER PRIMARY KEY CHECK (one = 1),
               workspaces TEXT NOT NULL,
               taken INTEGER NOT NULL DEFAULT 0
           )"]
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

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }
}

impl Workspaces {
    async fn list(&self, call: Call, _: Nothing) -> Result<Arranged, Refusal> {
        let (at, workspaces) = call.space().view(load).await?;
        Ok(Arranged { at, workspaces })
    }

    async fn open(&self, call: Call, open: Open) -> Result<Opened, Refusal> {
        change(
            &call,
            "opened",
            None::<String>,
            Say::Whole,
            move |list, _| {
                let new = model::showing(list, &open.shows).is_none();
                let pane = model::open(list, open.shows, open.place, open.instead, open.width)?;
                Ok(Opened { pane, new })
            },
        )
        .await
    }

    async fn close(&self, call: Call, one: OnePane) -> Result<(), Refusal> {
        change(
            &call,
            "closed",
            Some(one.pane),
            Say::Whole,
            move |list, _| Ok(model::close(list, one.pane)?),
        )
        .await
    }

    async fn update(&self, call: Call, update: Update) -> Result<(), Refusal> {
        let (pane, args) = (update.pane, update.args);
        change(
            &call,
            "updated",
            Some(pane),
            Say::Args(pane),
            move |list, _| Ok(model::update(list, pane, args)?),
        )
        .await
    }

    async fn move_pane(&self, call: Call, moving: MovePane) -> Result<(), Refusal> {
        change(
            &call,
            "moved",
            Some(moving.pane),
            Say::Whole,
            move |list, _| Ok(model::move_pane(list, moving.pane, &moving.place)?),
        )
        .await
    }

    async fn move_column(&self, call: Call, moving: MoveColumn) -> Result<(), Refusal> {
        let MoveColumn {
            column,
            workspace,
            index,
        } = moving;
        change(&call, "moved", Some(column), Say::Whole, move |list, _| {
            Ok(model::move_column(list, column, workspace, index)?)
        })
        .await
    }

    async fn size(&self, call: Call, size: Size) -> Result<(), Refusal> {
        change(
            &call,
            "sized",
            Some(size.column),
            Say::Whole,
            move |list, _| Ok(model::size(list, size.column, size.width)?),
        )
        .await
    }

    async fn maximize(&self, call: Call, maximize: Maximize) -> Result<(), Refusal> {
        let Maximize { column, full } = maximize;
        change(
            &call,
            "maximized",
            Some(column),
            Say::Whole,
            move |list, _| Ok(model::maximize(list, column, full)?),
        )
        .await
    }

    async fn display(&self, call: Call, show: ShowAs) -> Result<(), Refusal> {
        let ShowAs { column, display } = show;
        change(
            &call,
            "displayed",
            Some(column),
            Say::Whole,
            move |list, _| Ok(model::display(list, column, display)?),
        )
        .await
    }

    async fn tidy(&self, call: Call, tidy: Tidy) -> Result<(), Refusal> {
        change(
            &call,
            "tidied",
            None::<String>,
            Say::Whole,
            move |list, _| {
                model::tidy(list, tidy.keep);
                Ok(())
            },
        )
        .await
    }

    async fn take(&self, call: Call, take: Take) -> Result<(), Refusal> {
        change(
            &call,
            "taken",
            None::<String>,
            Say::Whole,
            move |list, tx| {
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
            },
        )
        .await
    }
}

/// How a change's event says it.
enum Say {
    /// The whole arrangement after it.
    Whole,
    /// Only this Pane's new args.
    Args(PaneId),
}

/// Runs a command on the arrangement, and keeps and says it when it
/// changed: one no change touched says nothing.
async fn change<T>(
    call: &Call,
    kind: &'static str,
    subject: Option<impl ToString>,
    say: Say,
    how: impl FnOnce(&mut Arrangement, &mut Tx<'_>) -> Result<T, Error> + Send + 'static,
) -> Result<T, Refusal>
where
    T: Serialize + DeserializeOwned + Send + 'static,
{
    let author = call.participant();
    let subject = subject.map(|s| s.to_string());
    call.command(move |tx| {
        let before = load(tx.sql())?;
        let mut list = before.clone();
        let answer = how(&mut list, tx)?;
        if list != before {
            keep(tx, &list)?;
            let said = match say {
                Say::Args(pane) => Changed::Args {
                    pane,
                    args: model::args_of(&list, pane).cloned().unwrap_or_default(),
                },
                Say::Whole => Changed::Whole { workspaces: list },
            };
            tx.emit(kind, VERSION, subject.as_deref(), author, &said)?;
        }
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
    Ok(serde_json::from_str(&text)?)
}

fn keep(tx: &Tx<'_>, list: &Arrangement) -> Result<(), Error> {
    tx.sql().execute(
        "UPDATE workspaces_arrangement SET workspaces = ?1 WHERE one = 1",
        [serde_json::to_string(list)?],
    )?;
    Ok(())
}
