//! The pulls module: the GitHub pull requests linked to a Project's
//! Threads (ADR 0076).
//!
//! A Thread holds its pull requests; Banda never guesses them from a
//! branch. A link is made by Create PR, by an Agent's own `gh pr create`
//! (read from the end of its shell call), by its tool, or by the Person
//! (`link`). One reader a Project reads them all through `gh api graphql`,
//! batched, while something follows the Project (`watch`): open ones
//! every minute, or every five once none changed for half an hour; a
//! merged or closed one once more, then never; at once after a push from
//! a Thread's card. It works out what each needs and whose turn it is
//! (`judge`). Without `gh`, a sign-in or a pull request on GitHub, the
//! list says why in plain words, and holds none it could not read.

mod github;
mod heard;
pub mod judge;
pub mod model;
mod reader;
pub mod shell;
mod store;

use banda_kernel::{
    Call, Error, Kind, Module, ModuleProject, Nothing, Participant, ProjectId, Refusal, Right,
    Stream,
};
use model::{By, LinkAsk, Listed, Pull, PullRef, ThreadAsk};
use reader::Live;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub struct Pulls {
    /// The `gh` it reads GitHub with.
    gh: PathBuf,
    /// Each open Project's reader.
    lives: Mutex<HashMap<ProjectId, Arc<Live>>>,
}

impl Default for Pulls {
    fn default() -> Self {
        Self::new()
    }
}

impl Pulls {
    pub fn new() -> Self {
        Self {
            gh: PathBuf::from("gh"),
            lives: Mutex::new(HashMap::new()),
        }
    }

    /// Reads GitHub with the `gh` at `gh`, not the one on PATH.
    pub fn gh(self, gh: PathBuf) -> Self {
        Self { gh, ..self }
    }

    fn live(&self, project: &ModuleProject) -> Arc<Live> {
        let mut lives = self.lives.lock().unwrap();
        lives
            .entry(project.id())
            .or_insert_with(|| Live::new(project.clone(), self.gh.clone()))
            .clone()
    }
}

banda_kernel::methods! {
    Pulls(Call) as "PullsMethods" in "pulls/" {
        /// The Project's pull requests, the most urgent first: what GitHub
        /// last said of each, what it needs and whose turn it is, and the
        /// Threads that link it. One not read yet is read first.
        call list(Nothing) -> Listed, Read;
        /// The list now, and again each time it changes. GitHub is read
        /// while one of these is held.
        stream watch(Nothing) -> Listed, Read;
        /// Reads every open pull request of the Project again now.
        call refresh(Nothing) -> (), Read;
        /// Links a pull request to a Thread, by its URL or `#42` in the
        /// Project's own repository on GitHub: Banda shows what it needs
        /// on the bar. An Agent links one to its own Thread.
        command link(LinkAsk) -> Pull, Write, tool "link_pull_request";
        /// Lets go of a pull request in a Thread; what made it does not
        /// link it again.
        command unlink(LinkAsk) -> (), Write, tool "unlink_pull_request";
        /// The pull requests a Thread links, with what each needs: an
        /// Agent's own Thread's when it asks. Not to check on CI: Banda
        /// watches them.
        call list_thread(ThreadAsk) -> Vec<Pull>, Read, tool "list_thread_pull_requests";
    }
}

#[async_trait::async_trait]
impl Module for Pulls {
    fn name(&self) -> &'static str {
        "pulls"
    }

    fn migrations(&self) -> &'static [&'static str] {
        store::MIGRATIONS
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    fn tools(&self) -> Vec<banda_kernel::Tool> {
        Self::method_tools(self.name())
    }

    /// From now on, it hears the Threads' shell calls and turns, and the
    /// pushes from their cards.
    async fn opened(&self, project: ModuleProject) -> Result<(), Error> {
        let live = self.live(&project);
        let at = project.at().await?;
        tokio::spawn(heard::follow_agents(
            project.react(at, heard::agents()),
            live.clone(),
        ));
        tokio::spawn(heard::follow_git(project.react(at, heard::git()), live));
        Ok(())
    }

    async fn closing(&self, project: ModuleProject) {
        self.lives.lock().unwrap().remove(&project.id());
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }

    async fn stream(&self, call: Call, method: &str, params: Value) -> Result<Stream, Refusal> {
        self.dispatch_stream(call, method, params).await
    }
}

impl Pulls {
    async fn list(&self, call: Call, _: Nothing) -> Result<Listed, Refusal> {
        Ok(self.live(call.project()).list().await?)
    }

    async fn watch(&self, call: Call, _: Nothing) -> Result<Stream, Refusal> {
        Ok(self.live(call.project()).stream())
    }

    async fn refresh(&self, call: Call, _: Nothing) -> Result<(), Refusal> {
        self.live(call.project()).poke(true);
        Ok(())
    }

    async fn link(&self, call: Call, ask: LinkAsk) -> Result<Pull, Refusal> {
        let thread = thread(&call, ask.thread.clone()).await?;
        let pull = pull_of(call.project(), &ask.pull).await?;
        let author = call.participant();
        let by = match author {
            Participant::Agent(_) => By::Agent,
            Participant::Person(_) => By::Person,
        };
        let (t, p) = (thread.clone(), pull.clone());
        call.command(move |tx| store::link(tx, author, &t, &p, by, None))
            .await?;
        let live = self.live(call.project());
        live.poke(false);
        let listed = live.list().await?;
        listed
            .pulls
            .into_iter()
            .find(|listed| listed.pull == pull)
            .ok_or_else(|| Refusal::not_found("The pull request was not linked."))
    }

    async fn unlink(&self, call: Call, ask: LinkAsk) -> Result<(), Refusal> {
        let thread = thread(&call, ask.thread.clone()).await?;
        let pull = pull_of(call.project(), &ask.pull).await?;
        let author = call.participant();
        let unlinked = call
            .command(move |tx| store::unlink(tx, author, &thread, &pull))
            .await?;
        if !unlinked {
            return Err(Refusal::not_found(
                "The Thread does not link that pull request.",
            ));
        }
        self.live(call.project()).poke(false);
        Ok(())
    }

    async fn list_thread(&self, call: Call, ask: ThreadAsk) -> Result<Vec<Pull>, Refusal> {
        let thread = thread(&call, ask.thread).await?;
        let listed = self.live(call.project()).list().await?;
        Ok(listed
            .pulls
            .into_iter()
            .filter(|pull| pull.threads.contains(&thread))
            .collect())
    }
}

/// The Thread a call names, or its Agent's own.
async fn thread(call: &Call, named: Option<String>) -> Result<String, Refusal> {
    if let Some(thread) = named.filter(|thread| !thread.trim().is_empty()) {
        return Ok(thread);
    }
    let Participant::Agent(agent) = call.participant() else {
        return Err(Refusal::invalid(
            "Name the Thread to link the pull request to.",
        ));
    };
    let agent = agent.to_string();
    call.project()
        .read(move |sql| store::thread_of(sql, &agent))
        .await?
        .ok_or_else(|| Refusal::invalid("Banda does not know this Agent's Thread yet: name it."))
}

/// A pull request by its URL, or by `#42` in the Project's repository on
/// GitHub, as its remote says.
async fn pull_of(project: &ModuleProject, text: &str) -> Result<PullRef, Refusal> {
    if let Some(pull) = shell::parse_url(text) {
        return Ok(pull);
    }
    let Some(number) = shell::parse_number(text) else {
        return Err(Refusal::invalid(
            "A pull request is its URL, or #42 in the Project's own repository.",
        ));
    };
    let (host, repo) = remote(project).await?;
    Ok(PullRef { host, repo, number })
}

/// The Project's repository on GitHub, from its `origin` remote, or the
/// first.
async fn remote(project: &ModuleProject) -> Result<(String, String), Refusal> {
    let folder = project.folder();
    let mut url = String::new();
    if let Ok(out) = git(&folder, &["remote", "get-url", "origin"]).await
        && out.status.success()
    {
        url = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    }
    if url.is_empty()
        && let Ok(out) = git(&folder, &["remote", "-v"]).await
    {
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        url = (text.split_whitespace().nth(1).unwrap_or_default()).to_owned();
    }
    github_repo(&url).ok_or_else(|| {
        Refusal::invalid(
            "The Project's repository is not on GitHub: link the pull request by its URL.",
        )
    })
}

/// Runs `git args` in `folder` as Banda's own (`banda_git_cli`), and says
/// what it printed.
async fn git(folder: &Path, args: &[&str]) -> std::io::Result<std::process::Output> {
    (banda_git_cli::bookkeeping(folder, args).await?)
        .output()
        .await
}

/// `github.com` and `owner/name`, from a remote's URL: HTTPS or SSH.
fn github_repo(url: &str) -> Option<(String, String)> {
    let url = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let (host, path) = if let Some(rest) = url.strip_prefix("git@") {
        rest.split_once(':')?
    } else {
        let rest = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("ssh://git@"))?;
        rest.split_once('/')?
    };
    if host != "github.com" {
        return None;
    }
    let (owner, name) = path.split_once('/')?;
    let plain = |part: &str| {
        !part.is_empty()
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    (plain(owner) && plain(name)).then(|| (host.to_owned(), format!("{owner}/{name}")))
}

#[cfg(test)]
mod tests {
    use super::github_repo;

    #[test]
    fn knows_a_repository_on_github_by_its_remote() {
        let repo = |url| github_repo(url).map(|(_, repo)| repo);
        assert_eq!(repo("https://github.com/o/r.git").as_deref(), Some("o/r"));
        assert_eq!(repo("git@github.com:o/r.git").as_deref(), Some("o/r"));
        assert_eq!(repo("ssh://git@github.com/o/r").as_deref(), Some("o/r"));
        assert_eq!(repo("https://gitlab.com/o/r.git"), None);
        assert_eq!(repo(""), None);
    }
}
