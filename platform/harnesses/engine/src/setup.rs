//! A Harness's setup (ADR 0140): the steps that take it from not on this
//! computer to ready, install then sign in, and the engine running them to
//! their end. The steps of a Harness Banda knows come from its row of
//! [`crate::kinds`]; one it does not know has none. A step is done when
//! the engine finds it so, never because its program ended well.

use crate::accounts::{Accounts, LoginAccount, LoginStatus};
use crate::{Harness, Harnesses};
use banda_kernel::{ModuleProject, Participant, Refusal, Stream, WeakModuleProject};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::{Notify, watch};
use ts_rs::TS;

/// A Harness's setup now: its steps in order, and what the one that runs
/// printed.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct Setup {
    pub harness: String,
    /// The Harness's name, as a sheet's title says it.
    pub name: String,
    /// None for a Harness that says no steps: Banda cannot set it up.
    pub steps: Vec<SetupStep>,
    /// Whether the engine runs it now.
    pub running: bool,
    /// The last of what the step that runs, or the one that failed,
    /// printed: an installer's lines, a sign-in's link.
    pub output: String,
    /// The sign-in the step that asks waits for: `login_input` sends it
    /// the code its page shows.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login: Option<String>,
}

/// One step of a setup, in words for a Person.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct SetupStep {
    /// `install` or `sign_in`.
    pub id: String,
    pub name: String,
    /// What it is for, in one line.
    pub says: String,
    pub state: StepState,
    /// Why it failed.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "harnesses/")]
pub enum StepState {
    /// Not done, and not its turn.
    Waiting,
    /// The engine does it now.
    Running,
    /// It waits for the Person: a sign-in in their browser.
    Asks,
    Done,
    Failed,
}

const GIT: usize = 0;
const INSTALL: usize = 1;
const SIGN_IN: usize = 2;

/// What a test names in place of a Harness, for Git's installer and for
/// where Git is looked for.
const GIT_LINE: &str = "git";
const GIT_AT: &str = "git-at";

/// The machine's setups: one per Harness at a time.
#[derive(Default)]
pub(crate) struct Setups {
    all: Mutex<HashMap<String, Run>>,
    /// The installer's line a test runs for a Harness, in place of its
    /// vendor's.
    stand_ins: Mutex<HashMap<String, String>>,
}

/// Git's installer, and where a test looks for Git in place of the host.
#[derive(Clone)]
struct Git {
    line: String,
    at: Option<std::path::PathBuf>,
}

impl Git {
    fn found(&self) -> bool {
        match &self.at {
            Some(at) => at.is_file(),
            None => crate::kinds::git().is_some(),
        }
    }
}

struct Run {
    state: watch::Sender<Setup>,
    stop: Arc<Notify>,
}

impl Setups {
    /// Installs `harness` with `line`: only a test does.
    pub(crate) fn installing_with(&self, harness: &str, line: &str) {
        let mut lines = self.stand_ins.lock().unwrap();
        lines.insert(harness.to_owned(), line.to_owned());
    }

    fn line(&self, harness: &Harness) -> Option<String> {
        let lines = self.stand_ins.lock().unwrap();
        (lines.get(&harness.id).cloned()).or_else(|| Some(harness.row()?.install.here().to_owned()))
    }

    /// How Git is installed and found here: a test's stand-ins, else the
    /// system's.
    fn git(&self) -> Git {
        let lines = self.stand_ins.lock().unwrap();
        Git {
            line: (lines.get(GIT_LINE).cloned()).unwrap_or_else(|| crate::kinds::GIT.to_owned()),
            at: lines.get(GIT_AT).map(std::path::PathBuf::from),
        }
    }

    /// `harness`'s setup and what stops it; with `anew`, a stop of its
    /// own, so one asked of the run before stops none after it.
    fn run(&self, harness: &str, anew: bool) -> (watch::Sender<Setup>, Arc<Notify>) {
        let mut all = self.all.lock().unwrap();
        let run = all.entry(harness.to_owned()).or_insert_with(|| Run {
            state: watch::Sender::new(Setup::default()),
            stop: Arc::default(),
        });
        if anew {
            run.stop = Arc::default();
        }
        (run.state.clone(), run.stop.clone())
    }

    /// `harness`'s setup now: the one that runs, else as the engine finds
    /// each step this moment.
    pub(crate) async fn now(
        &self,
        accounts: &Accounts,
        harnesses: &Harnesses,
        project: &ModuleProject,
        harness: &str,
    ) -> Result<Setup, Refusal> {
        let entry = harnesses.get(harness).map_err(Refusal::invalid)?;
        let (state, _) = self.run(harness, false);
        if state.borrow().running {
            return Ok(state.borrow().clone());
        }
        let mut found = look(accounts, project, &entry, &self.git()).await;
        // One that started meanwhile is the newer.
        state.send_if_modified(|now| {
            if now.running {
                return false;
            }
            // What stopped it stays said until the step is done or run again.
            for (step, old) in found.steps.iter_mut().zip(&now.steps) {
                if old.state == StepState::Failed && step.state != StepState::Done {
                    (step.state, step.note) = (StepState::Failed, old.note.clone());
                    found.output.clone_from(&now.output);
                }
            }
            let changed = *now != found;
            if changed {
                *now = std::mem::take(&mut found);
            }
            changed
        });
        Ok(state.borrow().clone())
    }

    /// Runs what is not done of `harness`'s setup, in order, and answers
    /// at once: [`Setups::watch`] says how it goes.
    pub(crate) async fn start(
        &self,
        accounts: Arc<Accounts>,
        harnesses: &Harnesses,
        project: &ModuleProject,
        by: Participant,
        harness: &str,
    ) -> Result<Setup, Refusal> {
        let entry = harnesses.get(harness).map_err(Refusal::invalid)?;
        let Some(line) = self.line(&entry) else {
            return Err(Refusal::invalid(format!(
                "Banda does not know how {} is set up: install it and sign in to it yourself.",
                entry.name
            )));
        };
        let git = self.git();
        let mut setup = look(&accounts, project, &entry, &git).await;
        setup.running = true;
        let (state, _) = self.run(harness, false);
        let taken = state.send_if_modified(|now| {
            let free = !now.running;
            if free {
                *now = setup;
            }
            free
        });
        let (_, stop) = self.run(harness, taken);
        if !taken {
            return Err(Refusal::conflict(format!(
                "{} is being set up already.",
                entry.name
            )));
        }
        let going = Going {
            accounts,
            project: project.downgrade(),
            by,
            harness: entry,
            line,
            git,
            state: state.clone(),
            stop,
        };
        tokio::spawn(async move {
            let ended = going.run().await;
            going.state.send_modify(|now| {
                now.running = false;
                now.login = None;
                let at = now
                    .steps
                    .iter_mut()
                    .find(|step| matches!(step.state, StepState::Running | StepState::Asks));
                match (at, ended) {
                    (Some(step), Err(Some(why))) => {
                        (step.state, step.note) = (StepState::Failed, Some(why));
                    }
                    (Some(step), _) => step.state = StepState::Waiting,
                    (None, Err(Some(why))) => {
                        let left = now.steps.iter_mut().find(|s| s.state != StepState::Done);
                        if let Some(step) = left {
                            (step.state, step.note) = (StepState::Failed, Some(why));
                        }
                    }
                    (None, _) => {}
                }
            });
        });
        Ok(state.borrow().clone())
    }

    /// `harness`'s setup as it changes, until its watcher goes: as the
    /// engine finds it now first.
    pub(crate) async fn watch(
        &self,
        accounts: &Accounts,
        harnesses: &Harnesses,
        project: &ModuleProject,
        harness: &str,
    ) -> Result<Stream, Refusal> {
        self.now(accounts, harnesses, project, harness).await?;
        Ok(banda_kernel::watching(
            self.run(harness, false).0.subscribe(),
        ))
    }

    /// Stops `harness`'s setup, if one runs.
    pub(crate) fn cancel(&self, harness: &str) {
        let (state, stop) = self.run(harness, false);
        if state.borrow().running {
            stop.notify_one();
        }
    }
}

/// `harness`'s steps as the engine finds them now, none running.
async fn look(accounts: &Accounts, project: &ModuleProject, harness: &Harness, git: &Git) -> Setup {
    let mut setup = Setup {
        harness: harness.id.clone(),
        name: harness.name.clone(),
        ..Setup::default()
    };
    let Some(row) = harness.row() else {
        return setup;
    };
    let step = |id: &str, name: &str, says: String, done: bool| SetupStep {
        id: id.to_owned(),
        name: name.to_owned(),
        says,
        state: if done {
            StepState::Done
        } else {
            StepState::Waiting
        },
        note: None,
    };
    let installed = installed(project, harness).await;
    let signed_in = installed && signed_in(accounts, project, harness).await;
    setup.steps = vec![
        step(
            "git",
            "Git",
            "Keeps the history of what Agents change in your files".to_owned(),
            git.found(),
        ),
        step(
            "install",
            &harness.name,
            format!("The Agent itself, from {}", row.vendor),
            installed,
        ),
        step(
            "sign_in",
            "Sign in",
            format!("With your {} account, in the browser", row.account),
            signed_in,
        ),
    ];
    setup
}

/// Whether `harness`'s CLI is on this computer.
async fn installed(project: &ModuleProject, harness: &Harness) -> bool {
    (crate::cli::find(&*project.environment(), harness).await).is_ok()
}

/// Whether `harness` says someone is signed in to it.
async fn signed_in(accounts: &Accounts, project: &ModuleProject, harness: &Harness) -> bool {
    let account = accounts.account_in(project, harness.id.clone()).await;
    account.is_ok_and(|said| said.account.signed_in_as.is_some_and(|who| who.signed_in))
}

/// A setup the engine runs.
struct Going {
    accounts: Arc<Accounts>,
    /// Held weakly: a strong hold keeps the machine's Project open after
    /// the engine lets it go.
    project: WeakModuleProject,
    by: Participant,
    harness: Harness,
    line: String,
    git: Git,
    state: watch::Sender<Setup>,
    stop: Arc<Notify>,
}

/// Why a setup ended early: in words, or none when the Person stopped it.
type Ended = Result<(), Option<String>>;

impl Going {
    fn project(&self) -> Result<ModuleProject, Option<String>> {
        (self.project.upgrade()).ok_or_else(|| Some("Banda's engine is stopping.".to_owned()))
    }

    fn set(&self, step: usize, to: StepState) {
        self.state.send_modify(|now| {
            if let Some(step) = now.steps.get_mut(step) {
                (step.state, step.note) = (to, None);
            }
        });
    }

    async fn run(&self) -> Ended {
        let name = &self.harness.name;
        let done = |step: usize| {
            let now = self.state.borrow();
            now.steps.get(step).map(|step| step.state) == Some(StepState::Done)
        };
        if !done(GIT) {
            // Git holds back no other step: a Harness runs without it.
            match self.git().await {
                Err(None) => return Err(None),
                Err(Some(why)) => self.state.send_modify(|now| {
                    if let Some(step) = now.steps.get_mut(GIT) {
                        (step.state, step.note) = (StepState::Failed, Some(why));
                    }
                }),
                Ok(()) => self.set(GIT, StepState::Done),
            }
        }
        if !done(INSTALL) {
            self.set(INSTALL, StepState::Running);
            let job = {
                let project = self.project()?;
                (self.accounts).install(&project, self.by, &self.harness.id, &self.line)
            };
            self.follow(job.map_err(|refused| Some(refused.message))?)
                .await?;
            if !installed(&self.project()?, &self.harness).await {
                return Err(Some(format!(
                    "Its installer ended, and {name} is still not on this computer."
                )));
            }
            self.set(INSTALL, StepState::Done);
        }
        let project = self.project()?;
        if done(SIGN_IN) || signed_in(&self.accounts, &project, &self.harness).await {
            self.set(SIGN_IN, StepState::Done);
            return Ok(());
        }
        self.set(SIGN_IN, StepState::Running);
        let asked = (self.accounts)
            .account_in(&project, self.harness.id.clone())
            .await
            .map_err(|refused| Some(refused.message))?;
        // The first way the Harness offers for a Person at this machine.
        let way = (asked.account.ways.into_iter()).find(|way| !way.elsewhere);
        let way = way.ok_or_else(|| Some(format!("{name} offers no way to sign in.")))?;
        let login = LoginAccount {
            harness: self.harness.id.clone(),
            way: Some(way.id),
        };
        let job = self.accounts.login_in(&project, self.by, login).await;
        drop(project);
        let job = job.map_err(|refused| Some(refused.message))?;
        self.state.send_modify(|now| {
            now.login = Some(job.login.clone());
            if let Some(step) = now.steps.get_mut(SIGN_IN) {
                step.state = StepState::Asks;
            }
        });
        self.follow(job).await?;
        if !signed_in(&self.accounts, &self.project()?, &self.harness).await {
            return Err(Some(format!("No one is signed in to {name} yet.")));
        }
        self.state.send_modify(|now| now.login = None);
        self.set(SIGN_IN, StepState::Done);
        Ok(())
    }

    /// Installs Git. Off Windows the system asks the Person in a dialog of
    /// its own, so the step asks.
    async fn git(&self) -> Ended {
        let asks = if cfg!(windows) {
            StepState::Running
        } else {
            StepState::Asks
        };
        self.set(GIT, asks);
        let job = {
            let project = self.project()?;
            (self.accounts).install(&project, self.by, &self.harness.id, &self.git.line)
        };
        self.follow(job.map_err(|refused| Some(refused.message))?)
            .await?;
        if !self.git.found() {
            return Err(Some(
                "Its installer ended, and Git is still not on this computer.".to_owned(),
            ));
        }
        Ok(())
    }

    /// Waits for `job`, an install or a sign-in, to end, saying what it
    /// prints as it does; stopped, it stops the job.
    async fn follow(&self, job: LoginStatus) -> Ended {
        let words = |refused: Refusal| Some(refused.message);
        let mut status = self.accounts.job(&job.login).map_err(words)?;
        loop {
            let (output, done, succeeded) = {
                let now = status.borrow_and_update();
                (now.output.clone(), now.done, now.succeeded)
            };
            self.state.send_if_modified(|now| {
                let changed = now.output != output;
                if changed {
                    now.output = output;
                }
                changed
            });
            if done {
                self.accounts.forget_job(&job.login);
                return match succeeded {
                    Some(true) => Ok(()),
                    _ => Err(Some("It ended before it was done.".to_owned())),
                };
            }
            tokio::select! {
                changed = status.changed() => if changed.is_err() {
                    return Err(Some("It ended before it was done.".to_owned()));
                },
                () = self.stop.notified() => {
                    // Its slot is free once it ended: the next run takes it.
                    self.accounts.cancel_job(&job.login);
                    let _ = status.wait_for(|job| job.done).await;
                    self.accounts.forget_job(&job.login);
                    return Err(None);
                }
            }
        }
    }
}
