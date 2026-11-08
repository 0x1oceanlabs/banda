//! Local journal usage (ADR 0043, step 5). Only counters and metadata are
//! kept. Provider calls and model requests are never made by this reader.
mod files;
mod journal;
mod model;
mod prices;
mod store;

use crate::limits::Kind;
use crate::{Harness, Harnesses};
use banda_kernel::{Error, ModuleProject};
pub use model::{UsageNow, UsageRead, UsageRow, UsageTokens, UsageTotal};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
pub(crate) use store::{REREAD_CODEX, TABLES};

/// The name of its listener of the accounts, which it hears only to end
/// as the machine's Project closes: the kernel keeps its place by it.
const LISTENER: &str = "usage";

const DAY: i64 = 86_400_000;
const KEEP: i64 = 92 * DAY;

#[derive(Clone)]
struct Source {
    id: String,
    harness: String,
    name: String,
    root: PathBuf,
    kind: Kind,
}

/// Entries pointing to one journal directory share its history. The first
/// enabled entry names it; adding an alias must never double the totals.
fn sources(harnesses: &[Harness]) -> Vec<Source> {
    let mut seen = HashSet::new();
    harnesses
        .iter()
        .filter(|h| h.enabled)
        .filter_map(|h| {
            let kind = Kind::of(h)?;
            let (variable, default, folder, prefix) = match kind {
                Kind::Claude => ("CLAUDE_CONFIG_DIR", ".claude", "projects", "claude"),
                Kind::Codex => ("CODEX_HOME", ".codex", "sessions", "codex"),
            };
            let home = h.env.get("HOME").map(PathBuf::from).or_else(dirs::home_dir);
            let config = h
                .env
                .get(variable)
                .map(PathBuf::from)
                .or_else(|| std::env::var_os(variable).map(PathBuf::from))
                .or_else(|| home.map(|home| home.join(default)))?;
            let root = config.join(folder);
            let root = dunce::canonicalize(&root).unwrap_or(root);
            let id = format!("{prefix}:{}", root.display());
            if !seen.insert(id.clone()) {
                return None;
            }
            Some(Source {
                id,
                harness: h.id.clone(),
                name: h.name.clone(),
                root,
                kind,
            })
        })
        .collect()
}

#[derive(Clone)]
pub(crate) struct Reader {
    harnesses: Harnesses,
    scanning: Arc<tokio::sync::Mutex<()>>,
}
impl Reader {
    pub fn new(harnesses: Harnesses) -> Self {
        Self {
            harnesses,
            scanning: Arc::default(),
        }
    }

    pub async fn start(&self, project: ModuleProject) -> Result<(), Error> {
        // The listener keeps only a weak Project, so closing the machine
        // releases its database even while the timer is idle.
        let mut lifetime = project.listen(LISTENER, crate::account_changed()).await?;
        let reader = self.clone();
        tokio::spawn(async move {
            let mut timer = tokio::time::interval(Duration::from_secs(60));
            loop {
                tokio::select! {
                    event=lifetime.next()=>{
                        let Ok(Some(event)) = event else { break };
                        if let Err(error) = lifetime.ack_through(event.seq).await {
                            tracing::warn!(%error, "usage's place in the log was not kept");
                        }
                    }
                    _=timer.tick()=>{
                        let Some(project)=lifetime.project() else {break;};
                        if project.window_open() && let Err(error)=reader.scan(&project).await {
                            tracing::warn!(%error,"usage journals could not be counted");
                        }
                    }
                }
            }
        });
        Ok(())
    }

    pub async fn scan(&self, project: &ModuleProject) -> Result<(), Error> {
        let _guard = self.scanning.lock().await;
        let (harnesses, settings) = self.harnesses.usage();
        if !settings.read {
            return Ok(());
        }
        let cutoff = banda_kernel::now_ms() - KEEP;
        store::prune(project, cutoff).await?;
        for source in sources(&harnesses) {
            let root = source.root.clone();
            let found = tokio::task::spawn_blocking(move || files::discover(&root))
                .await
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            let paths = match found {
                Ok(paths) => paths,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    store::read_done(
                        project,
                        source.id,
                        vec!["No session journals found.".into()],
                    )
                    .await?;
                    continue;
                }
                Err(error) => {
                    store::read_done(
                        project,
                        source.id,
                        vec![format!("Cannot list session journals: {}", error.kind())],
                    )
                    .await?;
                    continue;
                }
            };
            let mut problems = Vec::new();
            for path in paths {
                if !self.harnesses.usage().1.read {
                    return Ok(());
                }
                let name = path.to_string_lossy().into_owned();
                let cursor = store::cursor(project, source.id.clone(), name.clone()).await?;
                let previous = cursor.clone();
                let kind = source.kind;
                let read = tokio::task::spawn_blocking(move || files::read(&path, kind, cursor))
                    .await
                    .map_err(|e| std::io::Error::other(e.to_string()))?;
                match read {
                    Ok(batch) => {
                        if batch.skipped > 0 {
                            problems.push(format!(
                                "{} malformed journal lines skipped.",
                                batch.skipped
                            ));
                        }
                        if batch.pending {
                            problems.push("Some journal data remains for the next read.".into());
                        }
                        if batch.cursor != previous {
                            store::keep(project, source.id.clone(), name, batch, cutoff).await?;
                        }
                    }
                    Err(error) => problems.push(format!(
                        "A session journal could not be read: {}",
                        error.kind()
                    )),
                }
            }
            problems.sort();
            problems.dedup();
            problems.truncate(20);
            store::read_done(project, source.id, problems).await?;
        }
        Ok(())
    }

    pub async fn now(
        &self,
        project: &ModuleProject,
        since: i64,
        until: i64,
    ) -> Result<UsageNow, Error> {
        let (harnesses, settings) = self.harnesses.usage();
        let sources = sources(&harnesses);
        let (at, (total, rows, reads)) = project
            .view(move |sql| store::view(sql, &sources, since, until))
            .await?;
        Ok(UsageNow {
            at,
            reading: settings.read,
            since,
            until,
            price_revision: prices::revision(),
            total,
            rows,
            reads,
        })
    }
}
