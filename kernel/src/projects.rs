//! The kernel's own `projects.*`: the Projects of this machine added,
//! made, trusted, changed, located and removed, and their signs; and the
//! fact `changed`, which says each of those in this machine's log.

use crate::access::{self, Right};
use crate::cursors;
use crate::foreign::{self, Foreign};
use crate::kernel::{Entry, Kernel, ProjectSummary, no_project, present};
use crate::methods::{Asks, Kind, Nothing, Tool, needs_command_id};
use crate::project::{self, GONE, Manifest, Project, Said, SaidBy};
use crate::sign::{self, Kept, Picked, SignPick};
use crate::{CommandId, Error, Participant, ProjectId, Refusal};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use ts_rs::TS;

crate::methods! {
    Kernel(Own<'_>) as "ProjectsMethods" in "./" {
        /// This computer's Projects.
        call list(Nothing) -> Vec<ProjectSummary>, Read;
        /// This computer's Projects as of its log's position `at`: who
        /// follows them reads this again on a `changed` after it.
        call listed(Nothing) -> ProjectList, Read;
        /// Makes a Project: a new folder under the root, by its name. A
        /// scratch one, for a Thread in No Project, takes no name: its folder
        /// is new under `scratch/`, and it is trusted. A named one is
        /// trusted as `trusted` says, or else unless its folder looks
        /// foreign (`projects.foreign`).
        command create(CreateProject) -> ProjectSummary, Manage;
        /// Adds a folder as a Project. A folder that already is one answers
        /// that Project, back from the archive if it was there. A new one is
        /// trusted as `trusted` says, or else unless its folder looks
        /// foreign (`projects.foreign`).
        command add(AddProject) -> ProjectSummary, Manage;
        /// The folders that match a path as it is typed, for the field
        /// that picks a Project's folder. Only the owner browses.
        // It needs Manage, and only reads the folders.
        call browse(Browse) -> Browsed, Manage, read;
        /// Whether a folder looks foreign, and why, for Add Project to ask
        /// whether to trust it (ADR 0084, decision 13); one not made yet,
        /// as it will be. It names the Project the folder already is.
        // It needs Manage, and only looks at the folder.
        call foreign(OneFolder) -> Foreign, Manage, read;
        /// Trusts a Project, or takes its trust back, from its Harnesses'
        /// next turn. Only the Person trusts; a scratch Project always is.
        command trust(TrustProject) -> ProjectSummary, Manage;
        /// Renames, pins or archives a Project, lets its Agents see the
        /// other Projects' Panes, or makes a Project of a scratch one, named.
        command update(UpdateProject) -> ProjectSummary, Manage;
        /// Names the folder a missing Project's work is in now, and opens
        /// the Project there.
        command locate(LocateProject) -> ProjectSummary, Manage;
        /// Forgets a Project and deletes its Threads; its folder and the
        /// files in it stay as they are.
        command remove(OneProject) -> (), Manage;
        /// The tools an Agent may call, from the methods of the modules.
        call tools(Nothing) -> Vec<Tool>, Read;
        /// The picture a Project's sign shows, as a `data:` URL; none when
        /// it shows none (ADR 0070). A window keeps it by the sign's version
        /// (`sign.text`) and asks again only when that changes.
        call sign(OneProject) -> Option<String>, Read;
        /// Looks in a Project's folder for its sign's picture again.
        command find_sign(OneProject) -> ProjectSummary, Manage;
    }
}

/// Who calls one of the kernel's own methods, and under which command.
pub(crate) struct Own<'a> {
    pub(crate) participant: Participant,
    pub(crate) method: &'a str,
    pub(crate) only: Option<ProjectId>,
    pub(crate) command: Option<CommandId>,
}

impl Asks for Own<'_> {
    fn command_id(&self) -> Result<CommandId, Refusal> {
        self.command.ok_or_else(|| needs_command_id(self.method))
    }
}

#[derive(Deserialize, TS)]
struct CreateProject {
    /// The Project's name, and its folder's. None for a scratch Project.
    #[serde(default)]
    #[ts(optional)]
    name: Option<String>,
    /// A Project for one Thread in No Project (ADR 0046).
    #[serde(default)]
    #[ts(optional)]
    scratch: Option<bool>,
    /// Whether it is trusted (`ProjectSummary`); a new folder is, unless
    /// said or its folder looks foreign. A scratch Project always is.
    #[serde(default)]
    #[ts(optional)]
    trusted: Option<bool>,
}

#[derive(Deserialize, TS)]
struct AddProject {
    /// Absolute, or from the home folder: `~/code/app`.
    folder: String,
    /// The folder's name when none is given.
    #[serde(default)]
    #[ts(optional)]
    name: Option<String>,
    /// Makes the folder, and the folders above it, when it does not exist.
    #[serde(default)]
    #[ts(optional)]
    create: Option<bool>,
    /// Whether it is trusted (`ProjectSummary`). Not said, a folder that
    /// already is a Project keeps its own, and of another, one that looks
    /// foreign is not trusted.
    #[serde(default)]
    #[ts(optional)]
    trusted: Option<bool>,
}

#[derive(Deserialize, TS)]
struct Browse {
    /// The path as typed: absolute, or from the home folder. One that ends
    /// in `/` lists that folder; another lists the folders beside it whose
    /// names start with its last part.
    partial: String,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct Browsed {
    /// The folder the entries are in.
    pub parent: String,
    /// Whether the path as typed is a folder already: "Add" it, or else
    /// "Create & Add".
    pub exists: bool,
    /// Its subfolders that match, by name. Hidden ones only once a dot is
    /// typed.
    pub entries: Vec<BrowsedFolder>,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct BrowsedFolder {
    pub name: String,
    pub path: String,
}

#[derive(Deserialize, TS)]
struct UpdateProject {
    project: ProjectId,
    #[serde(default)]
    #[ts(optional)]
    name: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pinned: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    archived: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    sees_others: Option<bool>,
    /// `false` makes a Project of a scratch one, which needs a name then.
    /// No Project takes no Project back.
    #[serde(default)]
    #[ts(optional)]
    scratch: Option<bool>,
    /// Move a scratch Project's folder here when promoting it. Omit to keep it.
    #[serde(default)]
    #[ts(optional)]
    folder: Option<String>,
    /// The sign the Person picks; `null` goes back to what Banda finds
    /// (ADR 0070).
    #[serde(default, deserialize_with = "present")]
    #[ts(optional = nullable, as = "Option<SignPick>")]
    sign: Option<Option<SignPick>>,
}

#[derive(Deserialize, TS)]
struct LocateProject {
    project: ProjectId,
    /// Where its folder is now: absolute, or from the home folder.
    folder: String,
}

#[derive(Deserialize, TS)]
struct OneProject {
    project: ProjectId,
}

#[derive(Deserialize, TS)]
struct OneFolder {
    /// Absolute, or from the home folder.
    folder: String,
}

#[derive(Deserialize, TS)]
struct TrustProject {
    project: ProjectId,
    trusted: bool,
}

/// This machine's Projects as of its log's position `at`: a client
/// follows that log after it, and reads this again on each fact
/// `changed` of `projects`.
#[derive(Serialize, TS)]
#[ts(export)]
pub struct ProjectList {
    /// 0 from a kernel with no log of the machine's, which says no fact.
    #[ts(type = "number")]
    pub at: i64,
    /// Every Project, as `projects.list` gives them.
    pub projects: Vec<ProjectSummary>,
}

/// What the kernel writes its facts of the Projects as, in this machine's
/// log: the prefix of its own methods, which no module takes.
const PROJECTS: &str = "projects";

/// The kernel's one fact of this machine's Projects (ADR 0127): one for
/// each Project whose line in `projects.list` reads otherwise than the
/// log last said, written as `projects` in this machine's log, its
/// subject the Project's ID and its payload a [`ProjectChanged`].
pub const PROJECT_CHANGED: &str = "changed";

/// The version of [`PROJECT_CHANGED`]'s payload.
const VERSION: u32 = 1;

/// What the fact `changed` says: which Project, and what happened to it.
/// It is no copy of the Project: `projects.list` says how it reads now.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectChanged {
    pub project: ProjectId,
    pub change: ProjectChange,
}

/// What happened to a Project of this machine.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ProjectChange {
    /// It is one of this machine's Projects now: made, or its folder added.
    Added,
    /// Its line in the list reads otherwise: its name, pin, archive,
    /// trust or sign, what its Agents see, or a scratch one made a Project.
    Updated,
    /// Its missing folder was found: it is open again.
    Located,
    /// It was forgotten.
    Removed,
}

/// What the list `now` says otherwise than `was`, a fact for each Project.
fn changes(was: &[ProjectSummary], now: &[ProjectSummary]) -> Vec<ProjectChanged> {
    let said = |project, change| ProjectChanged { project, change };
    let removed = (was.iter())
        .filter(|one| now.iter().all(|other| other.id != one.id))
        .map(|one| said(one.id, ProjectChange::Removed));
    let rest = now.iter().filter_map(|one| {
        let change = match was.iter().find(|other| other.id == one.id) {
            None => ProjectChange::Added,
            Some(before) if before == one => return None,
            Some(before) if before.missing && !one.missing => ProjectChange::Located,
            Some(_) => ProjectChange::Updated,
        };
        Some(said(one.id, change))
    });
    removed.chain(rest).collect()
}

/// The most folders `projects.browse` answers.
const BROWSED: usize = 200;

/// Why the scratch Project of a Thread in No Project is never untrusted.
const SCRATCH_TRUSTED: &str = "A Thread in No Project is trusted: its folder is Banda's own.";

/// Where the scratch Projects' folders go, under the root (ADR 0046).
const SCRATCH: &str = "scratch";

/// What a pick makes of a Project's sign, and the picture it keeps in
/// `data` when it picks one: checked and kept before the manifest names it.
fn picked(data: &Path, pick: SignPick) -> Result<(Picked, Option<Kept>), Refusal> {
    let plain = |text: &str, what: &str, most: usize| -> Result<String, Refusal> {
        let text = text.trim();
        match text.chars().count() {
            0 => Err(Refusal::invalid(format!("A sign's {what} is not empty."))),
            n if n > most => Err(Refusal::invalid(format!(
                "A sign's {what} is at most {most} long."
            ))),
            _ => Ok(text.to_owned()),
        }
    };
    Ok(match pick {
        SignPick::Emoji { emoji } => (
            Picked::Emoji {
                emoji: plain(&emoji, "emoji", 8)?,
            },
            None,
        ),
        SignPick::Icon { icon, color } => {
            let icon = plain(&icon, "icon", 40)?;
            let lucide = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-';
            if !icon.chars().all(lucide) {
                return Err(Refusal::invalid(
                    "A sign's icon is a Lucide name, as pen-line.",
                ));
            }
            (Picked::Icon { icon, color }, None)
        }
        SignPick::Letters { letters, color } => {
            let letters = plain(&letters, "letters", 2)?.to_uppercase();
            (Picked::Letters { letters, color }, None)
        }
        SignPick::Picture { picture, kind } => {
            let bytes = sign::decoded(&picture).map_err(Refusal::invalid)?;
            sign::fits(kind, &bytes).map_err(Refusal::invalid)?;
            let kept = sign::keep(data, kind, &bytes, None).map_err(Error::from)?;
            (Picked::Picture { picture: true }, Some(kept))
        }
    })
}

impl Kernel {
    /// The right a method of `projects.*` needs, without its prefix, or
    /// `None`.
    pub(crate) fn own_right(name: &str) -> Option<Right> {
        Self::method_right(name)
    }

    /// The kind of a method of `projects.*`, without its prefix, or `None`.
    pub(crate) fn own_kind(name: &str) -> Option<Kind> {
        Self::method_kind(name)
    }

    pub(crate) async fn own_call(
        &self,
        ask: Own<'_>,
        name: &str,
        params: Value,
    ) -> Result<Value, Refusal> {
        if Self::own_kind(name) != Some(Kind::Command) {
            return self.dispatch(ask, name, params).await;
        }
        let author = ask.participant;
        self.note().await;
        let answer = self.dispatch(ask, name, params).await;
        // Refused too: what it changed before it was refused is said.
        self.tell(author).await;
        answer
    }

    /// Keeps the Projects' list as it reads now as what this machine's
    /// log last said, the first time it is asked: before the first change
    /// [`Kernel::tell`] says.
    async fn note(&self) {
        let mut told = self.told.lock().await;
        if told.is_none() {
            *told = Some(self.projects().await);
        }
    }

    /// Says in this machine's log what the Projects' list reads otherwise
    /// than the log last said: one fact [`PROJECT_CHANGED`] for each such
    /// Project, by `author`, written together. One caller at a time, so
    /// each change is said once, whichever command made it. With no log
    /// of the machine's, as while no module is its, nothing is said.
    async fn tell(&self, author: Participant) {
        let Some(machine) = &self.machine else {
            return;
        };
        let mut told = self.told.lock().await;
        let now = self.projects().await;
        let changes = changes(told.as_deref().unwrap_or(&now), &now);
        if !changes.is_empty() {
            let write = machine.store().write(PROJECTS, move |tx| {
                for said in &changes {
                    let subject = said.project.to_string();
                    tx.emit(PROJECT_CHANGED, VERSION, Some(&subject), author, said)?;
                }
                Ok(())
            });
            if let Err(error) = write.await {
                // What the log last said stays, so the next one says it.
                tracing::warn!(%error, "a change of the Projects was not said");
                return;
            }
        }
        *told = Some(now);
    }
}

impl Kernel {
    /// `one` as `projects` lists it: its letters told apart from the
    /// others' (ADR 0070, decision 2).
    async fn lettered(&self, one: ProjectSummary) -> ProjectSummary {
        let all = self.projects().await;
        all.into_iter().find(|p| p.id == one.id).unwrap_or(one)
    }

    /// Looks for the sign of each open Project, as the engine starts, one
    /// after another, beside everything else (ADR 0070, decision 2). It
    /// holds neither the kernel nor a Project but while it looks, so a
    /// kernel that closes lets go of them at once.
    pub(crate) fn find_signs(self: &Arc<Self>) {
        // Nothing else holds the list as the kernel opens.
        let Ok(projects) = self.projects.try_read() else {
            return;
        };
        let open: Vec<std::sync::Weak<Project>> = (projects.values())
            .filter_map(|entry| match entry {
                Entry::Open(project) => Some(Arc::downgrade(project)),
                Entry::Missing { .. } => None,
            })
            .collect();
        drop(projects);
        let kernel = Arc::downgrade(self);
        tokio::spawn(async move {
            // A sign found here is said as any change is.
            match kernel.upgrade() {
                Some(kernel) => kernel.note().await,
                None => return,
            }
            for project in open {
                if kernel.strong_count() == 0 {
                    return;
                }
                // The Project is held only to read and to write, not while
                // its folder is read.
                let Some((folder, name)) = project.upgrade().and_then(|p| p.sign_wanted()) else {
                    continue;
                };
                let found = tokio::task::spawn_blocking(move || sign::find(&folder, &name)).await;
                let (Ok(found), Some(project)) = (found, project.upgrade()) else {
                    continue;
                };
                if let Err(error) = project.keep_sign(found) {
                    tracing::warn!(%error, "a Project's sign was not kept");
                }
            }
            if let Some(kernel) = kernel.upgrade() {
                kernel.tell(Participant::Person(kernel.owner)).await;
            }
        });
    }

    /// Looks for `summary`'s Project's sign now, as one is added or named.
    async fn find_sign_now(&self, summary: ProjectSummary) -> Result<ProjectSummary, Refusal> {
        let Ok(project) = self.project(summary.id).await else {
            return Ok(self.lettered(summary).await);
        };
        let found = tokio::task::spawn_blocking(move || project.find_sign()).await;
        let summary = found.map_err(|_| Refusal::internal())??;
        Ok(self.lettered(summary).await)
    }

    async fn list(&self, ask: Own<'_>, _: Nothing) -> Result<Vec<ProjectSummary>, Refusal> {
        let mut projects = self.projects().await;
        // A pass sees only its own Project (ADR 0019, decision 2).
        projects.retain(|summary| access::within(ask.only, Some(summary.id)).is_ok());
        Ok(projects)
    }

    async fn listed(&self, ask: Own<'_>, nothing: Nothing) -> Result<ProjectList, Refusal> {
        // Its place first: a change made meanwhile is heard after it.
        let at = match &self.machine {
            Some(machine) => machine.module(PROJECTS).at().await?,
            None => 0,
        };
        let projects = self.list(ask, nothing).await?;
        Ok(ProjectList { at, projects })
    }

    async fn tools(&self, _: Own<'_>, _: Nothing) -> Result<Vec<Tool>, Refusal> {
        Ok(self.runs().tools.to_vec())
    }

    async fn create(&self, ask: Own<'_>, create: CreateProject) -> Result<ProjectSummary, Refusal> {
        let (author, command) = (ask.participant, ask.command_id()?);
        match (create.name, create.scratch == Some(true)) {
            (None, true) if create.trusted == Some(false) => Err(Refusal::invalid(SCRATCH_TRUSTED)),
            (None, true) => self.create_scratch(author, command).await,
            // A new folder holds no picture to find.
            (Some(name), false) => {
                let made = self
                    .create_project(&name, create.trusted, author, command)
                    .await?;
                Ok(self.lettered(made).await)
            }
            (Some(_), true) => Err(Refusal::invalid(
                "A scratch Project has no name until it becomes a Project.",
            )),
            (None, false) => Err(Refusal::invalid("A Project needs a name.")),
        }
    }

    /// A Project for one Thread in No Project: a new folder
    /// `scratch/<date>-<id8>` under the root, by the command, and no name. The same command
    /// again gets the Project it made.
    async fn create_scratch(
        &self,
        author: Participant,
        command: CommandId,
    ) -> Result<ProjectSummary, Refusal> {
        let _adding = self.adding.lock().await;
        let projects = self.projects.read().await;
        let made = projects.values().find_map(|entry| match entry {
            Entry::Open(project) if project.command() == command => Some(project.summary()),
            _ => None,
        });
        drop(projects);
        if let Some(made) = made {
            return Ok(made);
        }
        // A UUIDv7 ends in its random part.
        let id = command.to_string();
        let date = crate::utc_date(crate::now_ms());
        let folder = (self.root.join(SCRATCH)).join(format!("{date}-{}", &id[id.len() - 8..]));
        std::fs::create_dir_all(&folder).map_err(Error::from)?;
        let placed = async {
            let mut manifest = Manifest::new(&folder_found(&folder)?, "", author, command);
            manifest.scratch = true;
            self.place_project(manifest).await
        }
        .await;
        if placed.is_err() {
            let _ = std::fs::remove_dir(&folder);
        }
        placed
    }

    /// `projects.add` of a new folder `~/Banda/<name>`; one already there
    /// is refused, unless this command made its Project.
    async fn create_project(
        &self,
        name: &str,
        trusted: Option<bool>,
        author: Participant,
        command: CommandId,
    ) -> Result<ProjectSummary, Refusal> {
        let name = Project::plain_name(name)?;
        let folder = self.root.join(name);
        if let Ok(canonical) = dunce::canonicalize(&folder) {
            return match self.at(&canonical).await {
                Some(Entry::Open(made)) if made.command() == command => Ok(made.summary()),
                _ => Err(Refusal::conflict(format!(
                    "A folder named \"{name}\" already exists in this place."
                ))),
            };
        }
        self.add_at(&folder, Some(name), true, trusted, author, command)
            .await
    }

    async fn add(&self, ask: Own<'_>, add: AddProject) -> Result<ProjectSummary, Refusal> {
        let command = ask.command_id()?;
        let folder = from_home(&add.folder)?;
        let create = add.create == Some(true);
        let added = (self.add_at(
            &folder,
            add.name.as_deref(),
            create,
            add.trusted,
            ask.participant,
            command,
        ))
        .await?;
        self.find_sign_now(added).await
    }

    /// Adds `folder` as a Project, made first if `create` says so; the
    /// Project it already is comes back from the archive instead. A folder
    /// this call made is taken back when the Project is not. A Project is
    /// trusted as `trusted` says. Not said, a Project that already was
    /// keeps its own, and a new one is trusted unless its folder looks
    /// foreign: one this call made, by the repository it is in.
    async fn add_at(
        &self,
        folder: &Path,
        name: Option<&str>,
        create: bool,
        trusted: Option<bool>,
        author: Participant,
        command: CommandId,
    ) -> Result<ProjectSummary, Refusal> {
        let _adding = self.adding.lock().await;
        let made = create && !folder.exists();
        if made {
            std::fs::create_dir_all(folder).map_err(Error::from)?;
        }
        let added = async {
            let canonical = folder_found(folder)?;
            let already = match self.at(&canonical).await {
                Some(Entry::Open(project)) => Some(match project.summary().archived {
                    true => project.change(|manifest| manifest.archived = false)?,
                    false => project.summary(),
                }),
                // Its missing folder is back: the Project opens there again.
                Some(Entry::Missing { manifest, .. }) => {
                    Some(self.open_missing(manifest.id, &canonical).await?)
                }
                None => None,
            };
            if let Some(already) = already {
                return match trusted {
                    Some(trusted)
                        if trusted != already.trusted || trusted != already.trust_said =>
                    {
                        self.trusting(already.id, trusted).await
                    }
                    _ => Ok(already),
                };
            }
            let named = canonical.file_name().map(|n| n.to_string_lossy());
            let name = match (name, &named) {
                (Some(name), _) => name,
                (None, Some(named)) => named,
                (None, None) => "/",
            };
            let name = Project::name_of(name)?;
            let said = trusted == Some(true);
            let trusted = match trusted {
                Some(trusted) => trusted,
                None => !foreign::look(&canonical).await.foreign,
            };
            let mut manifest = Manifest::new(&canonical, name, author, command);
            manifest.untrusted = !trusted;
            manifest.trust_said = said;
            manifest.said = said.then(|| Said::now(SaidBy::Person));
            self.place_project(manifest).await
        }
        .await;
        if made && added.is_err() {
            let _ = std::fs::remove_dir(folder);
        }
        added
    }

    /// The Project whose folder is `folder`, absolute and resolved: open, or
    /// missing it.
    async fn at(&self, folder: &Path) -> Option<Entry> {
        let projects = self.projects.read().await;
        (projects.values())
            .find(|s| crate::host::same(&s.folder(), folder))
            .cloned()
    }

    /// Makes the data of a new Project, whose folder exists, opens it and
    /// lists it.
    async fn place_project(&self, manifest: Manifest) -> Result<ProjectSummary, Refusal> {
        let data = project::place(&self.projects_data, &manifest, |_| Ok(()))?;
        let project = match self.open_project(data.clone(), manifest).await {
            Ok(project) => project,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&data);
                return Err(error.into());
            }
        };
        let summary = project.summary();
        self.projects
            .write()
            .await
            .insert(project.id(), Entry::Open(project));
        Ok(summary)
    }

    /// Opens the missing Project `id` at `folder`, written into its
    /// `project.json`; as it was if it does not open.
    async fn open_missing(&self, id: ProjectId, folder: &Path) -> Result<ProjectSummary, Refusal> {
        let entry = self.projects.read().await.get(&id).cloned();
        let Some(Entry::Missing { data, manifest }) = entry else {
            self.project(id).await?;
            return Err(Refusal::conflict("The Project's folder is not missing."));
        };
        let mut found = manifest.clone();
        found.folder = folder.to_owned();
        found.write(&data)?;
        let project = match self.open_project(data.clone(), *found).await {
            Ok(project) => project,
            Err(error) => {
                let _ = manifest.write(&data);
                return Err(error.into());
            }
        };
        let summary = project.summary();
        let mut projects = self.projects.write().await;
        // Removed while it opened: it stays removed.
        if !matches!(projects.get(&id), Some(Entry::Missing { .. })) {
            return Err(no_project());
        }
        projects.insert(id, Entry::Open(project));
        Ok(summary)
    }

    async fn browse(&self, _: Own<'_>, Browse { partial }: Browse) -> Result<Browsed, Refusal> {
        // By the text: a path ends its `.` and `..` as it reads, not as typed.
        let partial = partial.trim();
        let (parent, prefix) = match partial.rsplit_once('/') {
            Some(("", prefix)) => ("/", prefix),
            Some(split) => split,
            None => (partial, ""),
        };
        let (parent, prefix) = (from_home(parent)?, prefix.to_owned());
        let typed = from_home(partial)?;
        let parent_shown = parent.display().to_string();
        let (exists, entries) =
            tokio::task::spawn_blocking(move || (typed.is_dir(), subfolders(&parent, &prefix)))
                .await
                .map_err(|_| Error::Closed)?;
        Ok(Browsed {
            parent: parent_shown,
            exists,
            entries,
        })
    }

    async fn foreign(
        &self,
        _: Own<'_>,
        OneFolder { folder }: OneFolder,
    ) -> Result<Foreign, Refusal> {
        let folder = folder_to_be(&from_home(&folder)?)?;
        let mut foreign = foreign::look(&folder).await;
        foreign.project = self.at(&folder).await.map(|entry| entry.summary().id);
        Ok(foreign)
    }

    /// Changes whether the Person trusts a Project. It waits for a Project
    /// being added or located, as `update` does, so its manifest has one
    /// writer at a time.
    async fn trust(&self, _: Own<'_>, trust: TrustProject) -> Result<ProjectSummary, Refusal> {
        let _adding = self.adding.lock().await;
        let summary = self.trusting(trust.project, trust.trusted).await?;
        Ok(self.lettered(summary).await)
    }

    /// Sets whether the Person trusts `project`, missing or open, and tells
    /// its modules when it changed, so what runs under the old trust goes.
    /// Who calls holds `adding`.
    async fn trusting(&self, project: ProjectId, trusted: bool) -> Result<ProjectSummary, Refusal> {
        let untrusted = !trusted;
        let mut projects = self.projects.write().await;
        let entry = projects.get_mut(&project).ok_or_else(no_project)?;
        if untrusted && entry.scratch() {
            return Err(Refusal::invalid(SCRATCH_TRUSTED));
        }
        // Trusting it is saying so; not trusting it unsays it.
        let said = |manifest: &mut Manifest| {
            manifest.untrusted = untrusted;
            manifest.trust_said = trusted;
            manifest.said = trusted.then(|| Said::now(SaidBy::Person));
        };
        let (summary, changed) = match entry {
            Entry::Open(open) => {
                let changed = open.trust_said() != trusted || open.trusted() != trusted;
                let summary = open.change(said)?;
                (summary, changed.then(|| open.clone()))
            }
            Entry::Missing { data, manifest } => {
                manifest.change_in(data, said)?;
                (manifest.summary(true), None)
            }
        };
        drop(projects);
        if let Some(project) = changed {
            for module in project.modules().iter() {
                module.trust_changed(project.module(module.name())).await;
            }
        }
        Ok(summary)
    }

    async fn update(&self, _: Own<'_>, update: UpdateProject) -> Result<ProjectSummary, Refusal> {
        let _adding = self.adding.lock().await;
        let name = update.name.as_deref().map(Project::name_of).transpose()?;
        let target = update.folder.as_deref().map(from_home).transpose()?;
        let mut projects = self.projects.write().await;
        let Some(entry) = projects.get_mut(&update.project) else {
            return Err(no_project());
        };
        // A scratch Project has no name; a Project has one.
        let was = entry.scratch();
        match (was, update.scratch.unwrap_or(was), name.is_some()) {
            (false, true, _) => {
                return Err(Refusal::invalid(
                    "A Project does not go back to No Project.",
                ));
            }
            (true, true, true) => {
                return Err(Refusal::invalid(
                    "A Thread in No Project has no name until it becomes a Project.",
                ));
            }
            (true, false, false) => {
                return Err(Refusal::invalid(
                    "A Project made of a Thread in No Project needs a name.",
                ));
            }
            _ => {}
        }
        if target.is_some() && update.scratch != Some(false) {
            return Err(Refusal::invalid(
                "A folder move must make a Project from a Thread in No Project.",
            ));
        }
        let opened = match entry {
            Entry::Open(project) => Some(project.clone()),
            _ => None,
        };
        let _moving = match (&opened, &target) {
            (Some(project), Some(_)) => Some(project.moving.try_write().map_err(|_| {
                Refusal::conflict(
                    "Another operation is using this Project. Try moving it again when it finishes.",
                )
            })?),
            _ => None,
        };
        let old = entry.folder();
        let target = if let Some(target) = target {
            let parent = target
                .parent()
                .ok_or_else(|| Refusal::invalid("Choose a folder with a parent."))?;
            let parent = folder_found(parent)?;
            let leaf = target
                .file_name()
                .ok_or_else(|| Refusal::invalid("Choose a folder name."))?;
            Some(parent.join(leaf))
        } else {
            None
        };
        let relocating = (target.as_ref()).filter(|target| !crate::host::same(target, &old));
        if let Some(target) = relocating {
            if !was {
                return Err(Refusal::invalid(
                    "Only a Thread in No Project can move its folder this way.",
                ));
            }
            if std::fs::symlink_metadata(target).is_ok() {
                return Err(Refusal::conflict(
                    "The destination already exists. Choose a new folder.",
                ));
            }
            let project = opened
                .as_ref()
                .ok_or_else(|| Refusal::conflict("Locate the missing folder before moving it."))?;
            for module in project.modules().iter() {
                module.can_move(project.module(module.name())).await?;
            }
            for module in project.modules().iter() {
                module.moving(project.module(module.name())).await;
            }
        }
        // A picked picture is kept before the manifest names it.
        let data = entry.data();
        let back_to_found = matches!(update.sign, Some(None));
        let find_again = name.is_some() || back_to_found;
        let picked = (update.sign.flatten())
            .map(|pick| picked(&data, pick))
            .transpose()?;
        let change = |manifest: &mut Manifest| {
            if let Some((sign, picture)) = picked {
                manifest.sign = Some(sign);
                if picture.is_some() {
                    manifest.picture = picture;
                }
            }
            // A picture picked by hand goes; one Banda found stays.
            if back_to_found {
                manifest.sign = None;
                if (manifest.picture)
                    .take_if(|kept| kept.found.is_none())
                    .is_some()
                {
                    sign::forget(&data);
                }
            }
            if let Some(target) = &target {
                manifest.folder = target.clone();
            }
            if let Some(name) = name {
                manifest.name = name.to_owned();
            }
            if let Some(pinned) = update.pinned {
                manifest.pinned = pinned;
            }
            if let Some(archived) = update.archived {
                manifest.archived = archived;
            }
            if let Some(sees_others) = update.sees_others {
                manifest.sees_others = sees_others;
            }
            if let Some(scratch) = update.scratch {
                manifest.scratch = scratch;
            }
        };
        // A missing Project keeps its name, pin and archive too.
        let result = match entry {
            Entry::Open(project) => match relocating {
                Some(target) => project.move_to(target, change),
                None => project.change(change),
            },
            Entry::Missing { data, manifest } => manifest
                .change_in(data, change)
                .map(|()| manifest.summary(true)),
        };
        drop(projects);
        let summary = result?;
        if find_again {
            self.find_sign_now(summary).await
        } else {
            Ok(self.lettered(summary).await)
        }
    }

    async fn sign(
        &self,
        _: Own<'_>,
        OneProject { project }: OneProject,
    ) -> Result<Option<String>, Refusal> {
        let entry = self.projects.read().await.get(&project).cloned();
        let entry = entry.ok_or_else(no_project)?;
        Ok((entry.picture()).and_then(|kept| sign::data_url(&entry.data(), &kept)))
    }

    async fn find_sign(
        &self,
        _: Own<'_>,
        OneProject { project }: OneProject,
    ) -> Result<ProjectSummary, Refusal> {
        let summary = self.project(project).await?.summary();
        self.find_sign_now(summary).await
    }

    /// Opens a missing Project at the folder its work is in now, written
    /// into its `project.json`. A folder that already is another Project is
    /// refused.
    async fn locate(&self, _: Own<'_>, locate: LocateProject) -> Result<ProjectSummary, Refusal> {
        let _adding = self.adding.lock().await;
        let folder = folder_found(&from_home(&locate.folder)?)?;
        if let Some(other) = self.at(&folder).await
            && other.summary().id != locate.project
        {
            let name = other.summary().name;
            return Err(Refusal::conflict(format!(
                "{} already is the Project \"{name}\".",
                folder.display()
            )));
        }
        let located = self.open_missing(locate.project, &folder).await?;
        self.find_sign_now(located).await
    }

    /// Takes the Project out of the list at once, and its data out of the
    /// engine's sight: `<id>.gone`, deleted once nothing holds the Project,
    /// or else on the next start. Its modules stop what runs there first,
    /// and their places in this machine's log go.
    /// A Project that is already gone is what was asked for.
    async fn remove(&self, _: Own<'_>, OneProject { project }: OneProject) -> Result<(), Refusal> {
        let Some(entry) = self.projects.write().await.remove(&project) else {
            return Ok(());
        };
        if let Some(machine) = &self.machine
            && let Err(error) = cursors::forget(machine, project).await
        {
            tracing::warn!(%error, "a removed Project's places in the machine's log stayed");
        }
        let gone = self.projects_data.join(format!("{project}{GONE}"));
        let project = match entry {
            Entry::Open(project) => project,
            // Nothing of it is open: its data goes now.
            Entry::Missing { data, .. } => {
                let away = put_away(&data, gone);
                tokio::task::spawn_blocking(move || crate::host::remove_all(&away));
                return Ok(());
            }
        };
        // A call that reaches it from another Project lands what it brings
        // first, and finds it removed after.
        let reached = project.reached.write().await;
        project.delete_when_closed(put_away(project.data(), gone));
        drop(reached);
        // What acts for it stops reaching Banda.
        self.passes.revoke_project(project.id());
        for module in project.modules().iter() {
            module.closing(project.module(module.name())).await;
        }
        Ok(())
    }
}

/// Moves a removed Project's `data` out of the engine's sight, to `gone`;
/// answers where it is now, in place if it would not move.
fn put_away(data: &Path, gone: PathBuf) -> PathBuf {
    match crate::host::rename(data, &gone) {
        Ok(()) => gone,
        Err(error) => {
            let shown = data.display();
            tracing::warn!(data = %shown, %error, "a removed Project's data stayed in place");
            data.to_owned()
        }
    }
}

/// The folder at `folder`, resolved: refused when there is none.
fn folder_found(folder: &Path) -> Result<PathBuf, Refusal> {
    let canonical = match dunce::canonicalize(folder) {
        Ok(canonical) => canonical,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let there = format!("There is no folder {}.", folder.display());
            return Err(Refusal::not_found(there));
        }
        Err(error) => return Err(Error::from(error).into()),
    };
    if !canonical.is_dir() {
        let what = format!("{} is not a folder.", folder.display());
        return Err(Refusal::invalid(what));
    }
    Ok(canonical)
}

/// The folder at `folder`, resolved; or, when it is not made yet, where it
/// will be: the nearest folder above it, resolved, with the rest as given.
fn folder_to_be(folder: &Path) -> Result<PathBuf, Refusal> {
    let Some(there) = (folder.ancestors()).find(|dir| dir.exists()) else {
        return folder_found(folder);
    };
    match folder.strip_prefix(there) {
        Ok(rest) if !rest.as_os_str().is_empty() => Ok(folder_found(there)?.join(rest)),
        _ => folder_found(folder),
    }
}

/// `~` or `~/…` from the home folder; any other path must be absolute.
fn from_home(path: &str) -> Result<PathBuf, Refusal> {
    let home = || dirs::home_dir().ok_or_else(|| Refusal::not_found("There is no home folder."));
    let path = match path.trim() {
        "~" => home()?,
        path => match path.strip_prefix("~/") {
            // `~/~/x` is a path typed again over the field's `~/`: no
            // folder named `~` is made of it.
            Some(rest) if rest == "~" || rest.starts_with("~/") => {
                return Err(Refusal::invalid(format!("{path} starts at ~ twice.")));
            }
            Some(rest) => home()?.join(rest),
            None => PathBuf::from(path),
        },
    };
    if !path.is_absolute() {
        return Err(Refusal::invalid(format!(
            "{} is not a whole path: start it at / or ~.",
            path.display()
        )));
    }
    Ok(path)
}

/// The subfolders of `parent` whose names start with `prefix`, any case,
/// by name; hidden ones only when `prefix` starts with a dot. A folder
/// that cannot be read has none.
fn subfolders(parent: &Path, prefix: &str) -> Vec<BrowsedFolder> {
    let Ok(read) = std::fs::read_dir(parent) else {
        return Vec::new();
    };
    let prefix = prefix.to_lowercase();
    let mut entries: Vec<BrowsedFolder> = read
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let shown = name.to_lowercase().starts_with(&prefix)
                && (prefix.starts_with('.') || !name.starts_with('.'));
            if !shown {
                return None;
            }
            // The listing says what each is; only a link is looked through.
            let path = entry.path();
            let kind = entry.file_type().ok()?;
            let folder = kind.is_dir() || (kind.is_symlink() && path.is_dir());
            folder.then(|| BrowsedFolder {
                path: path.display().to_string(),
                name,
            })
        })
        .collect();
    entries.sort_by_key(|entry| entry.name.to_lowercase());
    entries.truncate(BROWSED);
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_from_home_starts_at_it_once() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(from_home("~/code").unwrap(), home.join("code"));
        assert_eq!(from_home("~").unwrap(), home);
        assert!(from_home("~/~/code").is_err());
        assert!(from_home("~/~").is_err());
        assert!(from_home("code").is_err());
    }
}
