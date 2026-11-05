//! Checkpoints: the Project's work tree as each turn of an Agent's began and
//! as it ended, kept as commits, so the Diff's Turn shows all the turn
//! changed, the shell's work too (ADR 0034, decision 2). As T3 Code's
//! (`docs/research/2026-11-02-t3-code-git-backend.md`, section 5): made
//! through an index of the engine's own, so the Person's index, `HEAD` and
//! branch are never touched, and kept under refs of Banda's own,
//! `refs/banda/checkpoints/<thread>/<turn>/{before,after}`.

use crate::index::{INDEX, UNTRACKED, own_index, untracked};
use crate::repo::Repo;
use crate::run::Opts;
use banda_kernel::{Event, EventFilter, Heard, ModuleProject, Refusal};

/// Where every checkpoint is kept.
const ROOT: &str = "refs/banda/checkpoints";

/// The agents module's facts a checkpoint is made or let go on.
const STARTED: &str = "turn.started";
const ENDED: &str = "turn.ended";
const REWOUND: &str = "thread.rewound";

/// What git hears from the agents module.
pub fn heard() -> EventFilter {
    EventFilter {
        module: Some("agents".into()),
        subject: None,
        kinds: Some(vec![STARTED.into(), ENDED.into(), REWOUND.into()]),
    }
}

/// Which side of a turn a checkpoint is.
#[derive(Clone, Copy)]
pub enum When {
    Before,
    After,
}

/// The ref a turn's checkpoint is kept under. A Thread's and a turn's IDs
/// are the agents module's UUIDs, letters, digits and dashes: anything
/// else is refused, so no name reaches outside Banda's refs.
pub fn reference(thread: &str, turn: &str, side: When) -> Result<String, Refusal> {
    let id = |id: &str| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !id(thread) || !id(turn) {
        return Err(Refusal::invalid("A Thread or a turn is named by its ID."));
    }
    let side = match side {
        When::Before => "before",
        When::After => "after",
    };
    Ok(format!("{ROOT}/{thread}/{turn}/{side}"))
}

/// The commit a checkpoint is, when it was made.
pub async fn find(repo: &Repo, reference: &str) -> Result<Option<String>, Refusal> {
    let named = format!("{reference}^{{commit}}");
    Ok(repo
        .verified(["rev-parse", "--verify", "--quiet", named.as_str()])
        .await?)
}

/// Keeps the work tree as it is now under `reference`: every file but
/// those git ignores, as a commit whose parent is `HEAD`, so a later look
/// can tell whether `HEAD` moved. With more untracked files than a diff
/// takes in, none is kept: the turn shows what its tool calls changed.
pub async fn capture(repo: &Repo, reference: &str) -> Result<(), Refusal> {
    let (untracked, own, head) = futures::join!(untracked(repo), own_index(repo), repo.head());
    if untracked?.len() > UNTRACKED {
        tracing::info!(%reference, "too many untracked files for a checkpoint");
        return Ok(());
    }
    let ((_folder, index), head) = (own?, head?);
    let opts = || Opts {
        index: Some(&index),
        ..Opts::default()
    };
    let add = [&INDEX[..], &["add", "--all", "--", "."]].concat();
    repo.run(add, opts()).await?;
    let tree = repo.run(["write-tree"], opts()).await?.text();
    let mut commit = vec![
        "-c",
        "user.name=Banda",
        "-c",
        "user.email=banda@users.noreply.banda.so",
        "commit-tree",
        &tree,
        "-m",
        "Banda checkpoint",
    ];
    if let Some(head) = &head {
        commit.extend(["-p", head]);
    }
    let commit = repo.run(commit, Opts::default()).await?.text();
    repo.run(["update-ref", reference, &commit], Opts::default())
        .await?;
    Ok(())
}

/// Lets go of the checkpoints of `turns` of `thread`.
async fn forget(repo: &Repo, thread: &str, turns: &[&str]) -> Result<(), Refusal> {
    // A turn begun again after a restart is heard twice, and a ref
    // deleted twice fails the whole batch.
    let mut turns = turns.to_vec();
    turns.sort_unstable();
    turns.dedup();
    let mut deletes = String::new();
    for turn in turns {
        for side in [When::Before, When::After] {
            deletes.push_str(&format!("delete {}\n", reference(thread, turn, side)?));
        }
    }
    let opts = Opts {
        stdin: Some(deletes.into_bytes()),
        ..Opts::default()
    };
    repo.run(["update-ref", "--stdin"], opts).await?;
    Ok(())
}

/// Makes or lets go of checkpoints as the agents module's facts are
/// heard, one at a time, until the Project is gone.
pub async fn follow(mut heard: Heard) {
    loop {
        let event = match heard.next().await {
            Ok(Some(event)) => event,
            Ok(None) => return,
            Err(error) => {
                tracing::warn!(%error, "git stopped hearing the turns");
                return;
            }
        };
        let Some(project) = heard.project() else {
            return;
        };
        if let Err(refusal) = on(&project, &event).await {
            tracing::warn!(kind = %event.kind, ?refusal, "a checkpoint was not kept");
        }
    }
}

/// What one fact does to the checkpoints of its Thread.
async fn on(project: &ModuleProject, event: &Event) -> Result<(), Refusal> {
    let (Some(thread), Some(turn)) = (&event.subject, event.payload["turn"].as_str()) else {
        return Ok(());
    };
    let Some(repo) = Repo::find(&project.folder()).await? else {
        return Ok(());
    };
    match event.kind.as_str() {
        // A turn run again after a restart keeps how it first began.
        STARTED => {
            let before = reference(thread, turn, When::Before)?;
            if find(&repo, &before).await?.is_none() {
                capture(&repo, &before).await?;
            }
        }
        // A turn that began before checkpoints were kept has none.
        ENDED => {
            let before = reference(thread, turn, When::Before)?;
            if find(&repo, &before).await?.is_some() {
                capture(&repo, &reference(thread, turn, When::After)?).await?;
            }
        }
        // The turn and every turn after it left the Thread, and so do
        // their checkpoints.
        REWOUND => {
            let filter = EventFilter {
                module: event.module.clone().into(),
                subject: Some(thread.clone()),
                kinds: Some(vec![STARTED.into()]),
            };
            let started = project.events_after(0, filter, usize::MAX).await?;
            let turns: Vec<&str> = started
                .iter()
                .filter_map(|each| each.payload["turn"].as_str())
                .skip_while(|each| *each != turn)
                .collect();
            if !turns.is_empty() {
                forget(&repo, thread, &turns).await?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_checkpoint_is_named_only_by_ids() {
        assert_eq!(
            reference("t-1", "u-2", When::After).unwrap(),
            "refs/banda/checkpoints/t-1/u-2/after"
        );
        for bad in ["", "../x", "a/b", "a b", "a^"] {
            assert!(reference(bad, "u", When::Before).is_err());
            assert!(reference("t", bad, When::Before).is_err());
        }
    }
}
