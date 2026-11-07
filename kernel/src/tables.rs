//! Each module reaches only its own tables (ADR 0062, decision 5; ADR 0085,
//! decision 10): a SQLite authorizer on every connection of a store,
//! switched by who runs SQL on it now.
//!
//! - A module's tables and indexes go by its name and `_`: `notes` owns
//!   `notes_items`. A module whose id changed keeps its tables' names, for
//!   data at rest is never renamed: the prefixes it kept are its legacy
//!   ones, which its `module.toml` declares (`legacy-prefixes`,
//!   [`Module::legacy_prefixes`]).
//! - The kernel's own tables, `kernel_*`, a module reaches only through
//!   the kernel's API: [`Tx::emit`](crate::Tx::emit),
//!   [`Tx::enqueue`](crate::Tx::enqueue), the log's reads. All the
//!   kernel's SQL in a [`Tx`](crate::Tx) goes through `Tx::kernel`.
//! - A module's SQL reads and writes its own tables, and reads SQLite's
//!   `json_each` and `json_tree`. Its migration steps also make its tables
//!   and their indexes and change their columns (`CREATE TABLE`,
//!   `CREATE INDEX`, `ALTER TABLE`), and each foreign key they leave
//!   points at its own tables: SQLite asks nothing of a key's parent as
//!   the key is made, so the kernel looks after each step.
//! - The rest no module needs yet, and it is refused until one does, with
//!   a test: a transaction or a savepoint (the kernel begins and ends
//!   each), another database, a pragma, a view, a trigger (it would run as
//!   whoever fires it), a temporary or virtual table, dropping a table (its
//!   data is kept, ADR 0085, and SQLite's `sqlite_sequence` beside it holds
//!   the kernel's counters), and renaming one: SQLite does not tell the new
//!   name. A module rebuilds a table under a new name it owns, and copies
//!   its rows.
//!
//! SQLite asks as a statement is prepared, so a statement cached before
//! was decided for whoever ran SQL then: entering a module empties its
//! connection's statement cache, and so does the end of the kernel's SQL
//! in a module's transaction. The authorizer holds a module's SQL, not its
//! Rust, which runs in the engine: it catches SQL that strays, until the
//! transaction is data (A9 of the architecture vision) and a worker's SQL
//! comes as text.

use crate::module::Module;
use crate::store::KERNEL;
use crate::{Error, Refusal};
use rusqlite::Connection;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use std::ops::Deref;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// Names no module takes, nor a legacy prefix: the kernel's tables,
/// SQLite's own, and those SQLite reads as tables (`pragma_table_info`,
/// `json_each`), which a real table of that name would stand in for.
const RESERVED: [&str; 4] = [KERNEL, "sqlite", "pragma", "json"];

/// What SQL on a connection reaches while the kernel runs it: everything.
const KERNEL_RUNS: usize = usize::MAX;

/// While SQL runs for a name the store does not know: nothing.
const NOBODY: usize = usize::MAX - 1;

/// SQLite's schema, which a module's steps read and write as they change
/// its tables; SQLite itself refuses a direct write.
const SCHEMA: [&str; 4] = [
    "sqlite_master",
    "sqlite_schema",
    "sqlite_temp_master",
    "sqlite_temp_schema",
];

/// How SQLite names the index it makes for a table's UNIQUE or
/// non-integer PRIMARY KEY, `sqlite_autoindex_<table>_<n>`: no statement
/// may name one so.
const AUTOINDEX: &str = "sqlite_autoindex_";

/// SQLite's functions that read as tables, of their arguments alone.
const TABLE_FUNCTIONS: [&str; 2] = ["json_each", "json_tree"];

/// One module's tables in a store: the prefixes they go by, and its ledger
/// of migrations.
#[derive(Clone, Copy)]
pub(crate) struct Tables {
    pub module: &'static str,
    pub legacy: &'static [&'static str],
    pub migrations: &'static [&'static str],
}

impl Tables {
    pub(crate) fn of(module: &dyn Module) -> Tables {
        Tables {
            module: module.name(),
            legacy: module.legacy_prefixes(),
            migrations: module.migrations(),
        }
    }

    /// Whether `name`, a table's or an index's, is this module's: its name
    /// or a legacy prefix, then `_`.
    fn owns(&self, name: &str) -> bool {
        let of = |prefix: &str| {
            name.strip_prefix(prefix)
                .is_some_and(|rest| rest.starts_with('_'))
        };
        of(self.module) || self.legacy.iter().any(|prefix| of(prefix))
    }

    /// Whether this module's SQL may do `action`, in one of its migration
    /// steps or not.
    fn allows(&self, action: &AuthAction<'_>, migrating: bool) -> bool {
        use AuthAction as A;
        let schema = |table: &str| migrating && SCHEMA.contains(&table);
        match *action {
            A::Select | A::Recursive => true,
            // Renaming a table: SQLite does not tell to what.
            A::Function { function_name } => function_name != "sqlite_rename_table",
            A::Read { table_name, .. } => {
                self.owns(table_name) || schema(table_name) || TABLE_FUNCTIONS.contains(&table_name)
            }
            A::Insert { table_name } | A::Update { table_name, .. } => {
                self.owns(table_name) || schema(table_name)
            }
            A::Delete { table_name } => self.owns(table_name),
            A::CreateTable { table_name } | A::AlterTable { table_name, .. } => {
                migrating && self.owns(table_name)
            }
            A::CreateIndex {
                index_name,
                table_name,
            } => {
                migrating
                    && self.owns(table_name)
                    && (self.owns(index_name) || index_name.starts_with(AUTOINDEX))
            }
            // An index it makes SQLite fills as it would a REINDEX.
            A::Reindex { index_name } => migrating && self.owns(index_name),
            _ => false,
        }
    }

    /// Refuses a foreign key of this module's tables that points outside
    /// them, which the kernel reads after each of its steps.
    pub(crate) fn parents_are_its_own(&self, sql: &Connection) -> Result<(), Error> {
        let mut keys = sql.prepare(
            "SELECT m.name, k.\"table\" FROM sqlite_master m, pragma_foreign_key_list(m.name) k
             WHERE m.type = 'table'",
        )?;
        let rows = keys.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        for row in rows {
            let (table, parent): (String, String) = row?;
            if self.owns(&table) && !self.owns(&parent) {
                return Err(Refusal::invalid(format!(
                    "{table}'s foreign key points at {parent}, which is not {}'s.",
                    self.module
                ))
                .into());
            }
        }
        Ok(())
    }
}

/// Who runs SQL on one connection now, and what each may reach there.
pub(crate) struct Authorizer {
    /// [`KERNEL_RUNS`], [`NOBODY`], or the module at `modules[now]`.
    now: AtomicUsize,
    /// Whether that module runs one of its migration steps.
    migrating: AtomicBool,
    modules: Arc<[Tables]>,
}

impl Authorizer {
    /// Puts an authorizer on `sql`, which the kernel holds as it starts:
    /// the connection is used by one thread at a time, so it is switched
    /// with plain atomics.
    pub(crate) fn install(
        sql: &mut Connection,
        modules: Arc<[Tables]>,
    ) -> Result<Arc<Authorizer>, Error> {
        let authorizer = Arc::new(Authorizer {
            now: AtomicUsize::new(KERNEL_RUNS),
            migrating: AtomicBool::new(false),
            modules,
        });
        let deciding = authorizer.clone();
        sql.authorizer(Some(move |asked: AuthContext<'_>| deciding.decide(&asked)))?;
        Ok(authorizer)
    }

    /// Runs what comes next on `sql` for `module`, the kernel's name
    /// included, until the guard is dropped.
    pub(crate) fn enter<'a>(&'a self, sql: &Connection, module: &str) -> Entered<'a> {
        self.switch(sql, module, false)
    }

    /// [`Authorizer::enter`], for one of `module`'s migration steps.
    pub(crate) fn migrate<'a>(&'a self, sql: &Connection, module: &str) -> Entered<'a> {
        self.switch(sql, module, true)
    }

    /// `sql` for the kernel's own SQL, inside a module's transaction too,
    /// until the guard is dropped.
    pub(crate) fn as_kernel<'t>(&'t self, sql: &'t Connection) -> AsKernel<'t> {
        AsKernel {
            sql,
            entered: self.enter(sql, KERNEL),
        }
    }

    fn switch<'a>(&'a self, sql: &Connection, module: &str, migrating: bool) -> Entered<'a> {
        let who = if module == KERNEL {
            KERNEL_RUNS
        } else {
            (self.modules.iter())
                .position(|tables| tables.module == module)
                .unwrap_or(NOBODY)
        };
        if who != KERNEL_RUNS {
            sql.flush_prepared_statement_cache();
        }
        Entered {
            authorizer: self,
            was: self.now.swap(who, Ordering::Relaxed),
            was_migrating: self.migrating.swap(migrating, Ordering::Relaxed),
        }
    }

    fn decide(&self, asked: &AuthContext<'_>) -> Authorization {
        let now = self.now.load(Ordering::Relaxed);
        if now == KERNEL_RUNS {
            return Authorization::Allow;
        }
        let tables = self.modules.get(now);
        let migrating = self.migrating.load(Ordering::Relaxed);
        if tables.is_some_and(|tables| tables.allows(&asked.action, migrating)) {
            return Authorization::Allow;
        }
        let module = tables.map_or("no module", |tables| tables.module);
        tracing::error!(
            module,
            action = ?asked.action,
            "refused: a module reaches only its own tables"
        );
        Authorization::Deny
    }
}

/// Who ran SQL on a connection before: put back as it is dropped.
pub(crate) struct Entered<'a> {
    authorizer: &'a Authorizer,
    was: usize,
    was_migrating: bool,
}

impl Drop for Entered<'_> {
    fn drop(&mut self) {
        let authorizer = self.authorizer;
        authorizer.now.store(self.was, Ordering::Relaxed);
        authorizer
            .migrating
            .store(self.was_migrating, Ordering::Relaxed);
    }
}

/// A connection the kernel runs its own SQL on, until it is dropped:
/// `Tx::kernel` gives it.
pub(crate) struct AsKernel<'t> {
    sql: &'t Connection,
    entered: Entered<'t>,
}

impl Deref for AsKernel<'_> {
    type Target = Connection;

    fn deref(&self) -> &Connection {
        self.sql
    }
}

impl Drop for AsKernel<'_> {
    /// Back to a module, which is not given what the kernel cached.
    fn drop(&mut self) {
        if self.entered.was != KERNEL_RUNS {
            self.sql.flush_prepared_statement_cache();
        }
    }
}

/// Refuses modules whose tables would meet: one named as a reserved name,
/// or a legacy prefix not of lowercase letters, reserved, another
/// module's name, or two modules'.
pub(crate) fn check(modules: &[Arc<dyn Module>]) -> Result<(), Refusal> {
    let mut taken: Vec<&str> = modules.iter().map(|module| module.name()).collect();
    if let Some(name) = taken.iter().find(|name| RESERVED.contains(name)) {
        return Err(Refusal::invalid(format!(
            "\"{name}\" cannot be a module's name."
        )));
    }
    for module in modules {
        for &prefix in module.legacy_prefixes() {
            let plain = !prefix.is_empty() && prefix.bytes().all(|b| b.is_ascii_lowercase());
            if !plain || RESERVED.contains(&prefix) || taken.contains(&prefix) {
                return Err(Refusal::invalid(format!(
                    "\"{prefix}\" cannot be a legacy prefix of {}'s tables.",
                    module.name()
                )));
            }
            taken.push(prefix);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::hooks::TransactionOperation;

    const NOTES: Tables = Tables {
        module: "notes",
        legacy: &["jots"],
        migrations: &[],
    };

    /// Whether the notes module may do `action` as it runs.
    fn allowed(action: AuthAction<'_>) -> bool {
        NOTES.allows(&action, false)
    }

    /// Whether the notes module may do `action` in one of its steps.
    fn migrating(action: AuthAction<'_>) -> bool {
        NOTES.allows(&action, true)
    }

    #[test]
    fn a_module_owns_its_name_and_its_legacy_prefixes_then_an_underscore() {
        for owned in ["notes_items", "notes_items_by_text", "jots_old"] {
            assert!(NOTES.owns(owned), "{owned}");
        }
        for other in [
            "notes",
            "notesitems",
            "kernel_events",
            "jotsold",
            "other_notes_items",
        ] {
            assert!(!NOTES.owns(other), "{other}");
        }
    }

    #[test]
    fn a_module_reads_and_writes_its_own_tables_only() {
        for table in ["notes_items", "jots_old"] {
            let column = "text";
            assert!(allowed(AuthAction::Read {
                table_name: table,
                column_name: column
            }));
            assert!(allowed(AuthAction::Insert { table_name: table }));
            assert!(allowed(AuthAction::Update {
                table_name: table,
                column_name: column
            }));
            assert!(allowed(AuthAction::Delete { table_name: table }));
        }
        for table in [
            "kernel_receipts",
            "kernel_events",
            "other_items",
            "passes",
            "sqlite_sequence",
            "pragma_secrets",
        ] {
            for steps in [false, true] {
                let may = |action: AuthAction<'_>| NOTES.allows(&action, steps);
                // A count reads no column: its table is told with none.
                assert!(!may(AuthAction::Read {
                    table_name: table,
                    column_name: ""
                }));
                assert!(!may(AuthAction::Insert { table_name: table }));
                assert!(!may(AuthAction::Update {
                    table_name: table,
                    column_name: "seq"
                }));
                assert!(!may(AuthAction::Delete { table_name: table }));
            }
        }
        assert!(allowed(AuthAction::Read {
            table_name: "json_each",
            column_name: "value"
        }));
    }

    #[test]
    fn a_module_changes_the_shape_of_its_own_tables_only_in_its_steps() {
        let (own, other) = ("notes_items", "other_items");
        let table = AuthAction::CreateTable { table_name: own };
        assert!(migrating(table) && !allowed(table));
        assert!(!migrating(AuthAction::CreateTable { table_name: other }));
        let alter = |table_name| AuthAction::AlterTable {
            database_name: "main",
            table_name,
        };
        assert!(migrating(alter(own)) && !allowed(alter(own)));
        assert!(!migrating(alter(other)));
        let index = AuthAction::CreateIndex {
            index_name: "notes_items_by_text",
            table_name: own,
        };
        assert!(migrating(index) && !allowed(index));
        let filled = AuthAction::Reindex {
            index_name: "notes_items_by_text",
        };
        assert!(migrating(filled) && !allowed(filled));
        // Its index on another's table, or another's name on its table.
        assert!(!migrating(AuthAction::CreateIndex {
            index_name: "notes_x",
            table_name: other
        }));
        assert!(!migrating(AuthAction::CreateIndex {
            index_name: "other_x",
            table_name: own
        }));
        // The index SQLite makes for a key: its table's alone.
        assert!(migrating(AuthAction::CreateIndex {
            index_name: "sqlite_autoindex_notes_items_1",
            table_name: own
        }));
        assert!(!migrating(AuthAction::CreateIndex {
            index_name: "sqlite_autoindex_other_items_1",
            table_name: other
        }));
        // Its schema it reads and writes only as its steps change it.
        let schema = AuthAction::Update {
            table_name: "sqlite_master",
            column_name: "sql",
        };
        assert!(migrating(schema) && !allowed(schema));
        let schema = AuthAction::Read {
            table_name: "sqlite_master",
            column_name: "sql",
        };
        assert!(migrating(schema) && !allowed(schema));
        assert!(!migrating(AuthAction::Function {
            function_name: "sqlite_rename_table"
        }));
        assert!(migrating(AuthAction::Function {
            function_name: "sqlite_rename_column"
        }));
    }

    #[test]
    fn what_no_module_needs_yet_is_refused_in_its_steps_too() {
        let own = "notes_items";
        for action in [
            AuthAction::DropTable { table_name: own },
            AuthAction::DropIndex {
                index_name: "notes_items_by_text",
                table_name: own,
            },
            AuthAction::Delete {
                table_name: "sqlite_master",
            },
            AuthAction::CreateTempTable { table_name: own },
            AuthAction::CreateTrigger {
                trigger_name: "notes_t",
                table_name: own,
            },
            AuthAction::CreateView {
                view_name: "notes_recent",
            },
            AuthAction::CreateVtable {
                table_name: "notes_v",
                module_name: "fts5",
            },
            AuthAction::Analyze { table_name: own },
            AuthAction::Reindex {
                index_name: "other_items_by_text",
            },
            AuthAction::Pragma {
                pragma_name: "table_info",
                pragma_value: Some(own),
            },
            AuthAction::Pragma {
                pragma_name: "writable_schema",
                pragma_value: Some("ON"),
            },
            AuthAction::Attach {
                filename: "/elsewhere.sqlite3",
            },
            AuthAction::Detach {
                database_name: "main",
            },
        ] {
            assert!(!migrating(action) && !allowed(action), "{action:?}");
        }
    }

    #[test]
    fn the_transaction_is_the_kernel_s() {
        for operation in [
            TransactionOperation::Begin,
            TransactionOperation::Release,
            TransactionOperation::Rollback,
        ] {
            let transaction = AuthAction::Transaction { operation };
            let savepoint = AuthAction::Savepoint {
                operation,
                savepoint_name: "inner",
            };
            for action in [transaction, savepoint] {
                assert!(!allowed(action) && !migrating(action), "{action:?}");
            }
        }
    }

    #[test]
    fn the_authorizer_lets_the_kernel_through_and_nobody_it_does_not_know() {
        let mut sql = Connection::open_in_memory().unwrap();
        sql.execute_batch(
            "CREATE TABLE kernel_receipts (command TEXT); CREATE TABLE notes_items (text TEXT)",
        )
        .unwrap();
        let authorizer = Authorizer::install(&mut sql, Arc::new([NOTES])).unwrap();
        let read = |table: &str| {
            sql.prepare(&format!("SELECT count(*) FROM {table}"))
                .map(drop)
        };
        assert!(read("kernel_receipts").is_ok());
        {
            let _notes = authorizer.enter(&sql, "notes");
            assert!(read("notes_items").is_ok());
            let refused = read("kernel_receipts").unwrap_err();
            assert_eq!(
                refused.sqlite_error_code(),
                Some(rusqlite::ErrorCode::AuthorizationForStatementDenied)
            );
            {
                let _kernel = authorizer.enter(&sql, KERNEL);
                assert!(read("kernel_receipts").is_ok());
            }
            assert!(read("kernel_receipts").is_err(), "back to notes");
        }
        assert!(read("kernel_receipts").is_ok(), "back to the kernel");
        let _stranger = authorizer.enter(&sql, "stranger");
        assert!(read("notes_items").is_err());
    }

    #[test]
    fn a_module_is_not_given_a_statement_the_kernel_cached() {
        let mut sql = Connection::open_in_memory().unwrap();
        sql.execute_batch("CREATE TABLE kernel_receipts (command TEXT)")
            .unwrap();
        let authorizer = Authorizer::install(&mut sql, Arc::new([NOTES])).unwrap();
        // No value is bound, so SQLite would hand it back as it was.
        let cached = |sql: &Connection| {
            sql.prepare_cached("SELECT count(*) FROM kernel_receipts")
                .map(drop)
        };
        cached(&sql).unwrap();
        let notes = authorizer.enter(&sql, "notes");
        assert!(cached(&sql).is_err(), "cached before the module ran");
        {
            let kernel = authorizer.as_kernel(&sql);
            cached(&kernel).unwrap();
        }
        assert!(cached(&sql).is_err(), "cached by the kernel as it ran");
        drop(notes);
        cached(&sql).unwrap();
    }

    /// What the authorizer adds as a module's statement is prepared, the
    /// way `execute` and `query_row` prepare each, and to enter a module:
    /// `cargo test -p banda-kernel --release --lib tables::tests::cost --
    /// --ignored --nocapture`.
    #[test]
    #[ignore = "a measure to read, not a check"]
    fn cost() {
        use std::time::{Duration, Instant};
        const TIMES: u32 = 2_000;
        let columns: Vec<String> = (0..12).map(|n| format!("c{n}")).collect();
        let make = format!(
            "CREATE TABLE notes_items ({} TEXT)",
            columns.join(" TEXT, ")
        );
        let select = format!(
            "SELECT {} FROM notes_items WHERE c0 = ?1",
            columns.join(", ")
        );
        let insert = format!(
            "INSERT INTO notes_items ({}) VALUES ({})",
            columns.join(", "),
            ["?"; 12].join(", ")
        );
        let round = |run: &mut dyn FnMut()| -> Duration {
            let start = Instant::now();
            for _ in 0..TIMES {
                run();
            }
            start.elapsed() / TIMES
        };
        let bare = Connection::open_in_memory().unwrap();
        bare.execute_batch(&make).unwrap();
        let mut gated = Connection::open_in_memory().unwrap();
        gated.execute_batch(&make).unwrap();
        let authorizer = Authorizer::install(&mut gated, Arc::new([NOTES])).unwrap();
        let _notes = authorizer.enter(&gated, "notes");
        for (what, text) in [("a 12-column SELECT", &select), ("an INSERT", &insert)] {
            // Rounds side by side, the least of each: the rest is the
            // machine's noise.
            let (mut without, mut with) = (Duration::MAX, Duration::MAX);
            for _ in 0..15 {
                without = without.min(round(&mut || drop(bare.prepare(text).unwrap())));
                with = with.min(round(&mut || drop(gated.prepare(text).unwrap())));
            }
            println!("prepare {what}: {without:?} without, {with:?} with the authorizer");
        }
        let entering = round(&mut || drop(authorizer.enter(&gated, "notes")));
        println!("enter a module and leave: {entering:?}");
    }
}
