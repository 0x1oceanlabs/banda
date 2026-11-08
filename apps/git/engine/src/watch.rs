//! `git.watch`: the status as it changes, while a Pane follows it
//! (ADR 0034, decision 3). It reads the status again every few seconds
//! and says it only when it changed; and it fetches the upstream's remote
//! now and then, as T3 Code does, so ahead and behind count what the
//! remote has, backing off while that fails. A fetch runs beside the
//! reads, which go on meanwhile; none begins while a command of Banda's
//! writes in the repository, and none keeps one waiting: git locks each
//! remote branch it updates itself. Where the fence holds, a fetch of the
//! upstream branch from github.com over https signs in with the Person's
//! token, which Banda reads itself, in a Project they said they trust
//! (ADR 0083): into a repository of Banda's own, whose config is Banda's
//! alone, and from there into the Project's, with no token. One that
//! cannot sign in is said in the log once, as why.

use crate::model::Status;
use crate::repo::Repo;
use crate::run::{Failure, Opts, Pool, Reason, git};
use crate::{Repositories, Writes, status};
use banda_git_cli::SignIn;
use banda_kernel::{ModuleProject, Stream};
use std::collections::BTreeSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::Instant;

/// How often the status is read again.
const AGAIN: Duration = Duration::from_secs(3);
/// How often the upstream's remote is fetched, and how far apart at most
/// while that fails.
const FETCH: Duration = Duration::from_secs(30);
const FETCH_AT_MOST: Duration = Duration::from_secs(15 * 60);

/// The repository of Banda's own a fetch that signs in fetches into, in
/// the Project's data, which the fence hides
/// ([`banda_git_cli::signed_fetch`]).
const FETCHED: &str = "git-fetched";

/// Follows the status of `project`'s folder until the window lets go,
/// reading it again at once when a git command of Banda's has written in
/// its repository.
pub fn watch(project: ModuleProject, repositories: Repositories) -> Stream {
    let (say, heard) = mpsc::channel(1);
    tokio::spawn(async move {
        let mut told: Option<Status> = None;
        let mut fetch = Fetch::new();
        loop {
            let folder = project.folder();
            // Read before git is: an event after it may change what git
            // reads.
            let at = project.at().await.ok();
            let found = Repo::find(&project).await;
            let repo = match &found {
                Ok(Some(repo)) => Some(repo.clone()),
                _ => None,
            };
            let writes = match &repo {
                Some(repo) => repositories.of(&repo.top),
                None => repositories.of_folder(&folder),
            };
            // Heard from now: a write that ends during the read counts.
            let wrote = writes.done.notified();
            tokio::pin!(wrote);
            wrote.as_mut().enable();
            let read = async { status::read(found, at?, &repositories).await.ok() };
            if let Some(mut status) = read.await {
                // The same but for its position is no change.
                let at = status.at;
                status.at = told.as_ref().map_or(at, |t| t.at);
                if told.as_ref() != Some(&status) {
                    status.at = at;
                    let Ok(piece) = serde_json::to_value(&status) else {
                        return;
                    };
                    if say.send(piece).await.is_err() {
                        return;
                    }
                    told = Some(status);
                }
            }
            if let Some(Status {
                branch: Some(branch),
                upstream: Some(_),
                ..
            }) = &told
                && let Some(repo) = repo
            {
                let signs = project.trust_said().then(|| project.data().join(FETCHED));
                fetch.start(repo, branch.clone(), signs, &writes);
            }
            tokio::select! {
                () = tokio::time::sleep(AGAIN) => {}
                // What it fetched counts now, not in a while.
                () = fetch.ended() => {}
                () = &mut wrote => {}
                () = say.closed() => return,
            }
        }
    });
    heard
}

/// The fetch of the upstream's remote: when the next is due, and the one
/// running.
struct Fetch {
    next: Instant,
    apart: Duration,
    running: Option<JoinHandle<bool>>,
}

impl Fetch {
    fn new() -> Fetch {
        Fetch {
            next: Instant::now(),
            apart: FETCH,
            running: None,
        }
    }

    /// Starts one when it is due, none runs and no command of Banda's
    /// writes in the repository; one that may sign in, into Banda's own
    /// repository at `signs`, when the Person said they trust the Project.
    fn start(&mut self, repo: Repo, branch: String, signs: Option<PathBuf>, writes: &Writes) {
        if self.running.is_some() || Instant::now() < self.next {
            return;
        }
        if !writes.busy() {
            self.running = Some(tokio::spawn(fetch(repo, branch, signs)));
        }
    }

    /// Once the one running ends, when it fetched; never when none runs
    /// or it failed.
    async fn ended(&mut self) {
        let Some(running) = &mut self.running else {
            return std::future::pending().await;
        };
        let fetched = running.await.unwrap_or(false);
        self.running = None;
        self.apart = match fetched {
            true => FETCH,
            false => (self.apart * 2).min(FETCH_AT_MOST),
        };
        self.next = Instant::now() + self.apart;
        if !fetched {
            std::future::pending().await
        }
    }
}

/// Fetches the remote `branch` follows, and says whether it did. It is
/// Banda's own git (`banda_git_cli`): as T3 Code's, it asks for no
/// password and runs no gc, whose packs a failed one would leave each
/// time until the disk is full. Where the fence holds and the Person said
/// they trust the Project, it signs in to github.com with their token, by
/// way of Banda's own repository at `signs` ([`signed`]); never through a
/// helper of the home's. A token GitHub refuses is let go of, and the
/// fetch tried once more without one, as a public repository takes it.
async fn fetch(repo: Repo, branch: String, signs: Option<PathBuf>) -> bool {
    let Ok(Some(remote)) = repo.config(&format!("branch.{branch}.remote")).await else {
        return false;
    };
    if remote.starts_with('-') {
        return false;
    }
    let shadow = signs.filter(|_| banda_kernel::host::books_fenced());
    let signing = match &shadow {
        Some(shadow) => sign_in(&repo, &branch, &remote, shadow).await,
        None => None,
    };
    let mut signed_failed = false;
    if let Some(signing) = &signing {
        match signed(&repo, signing).await {
            Ok(()) => return true,
            Err(Failure(Reason::Unauthorized)) => {
                unauthorized(&repo.top, Unsigned::Refused);
                banda_kernel::gh::keep(banda_kernel::gh::GITHUB, None);
                signed_failed = true;
            }
            Err(_) => return false,
        }
    }
    // No FETCH_HEAD, which only a merge after the fetch reads.
    let args = [
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        "--",
        &remote,
    ];
    let opts = Opts {
        pool: Pool::Long,
        ..Opts::default()
    };
    match repo.run(args, opts).await {
        Err(Failure(Reason::Unauthorized)) => {
            if !signed_failed {
                let url = remote_url(&repo.top, &remote).await;
                let guarded = banda_kernel::host::guarded();
                let why = why_unsigned(url.as_deref(), shadow.is_some(), guarded);
                unauthorized(&repo.top, why);
            }
            false
        }
        ran => ran.is_ok(),
    }
}

/// A fetch that signs in: its remote, the token, and where it brings the
/// upstream branch.
struct Signing {
    sign_in: SignIn,
    /// The upstream branch on the remote, and the remote-tracking ref of
    /// it here: `refs/heads/main`, `refs/remotes/origin/main`.
    merge: String,
    tracking: String,
    /// Banda's own repository it fetches into, and the Project's objects
    /// that one borrows.
    shadow: PathBuf,
    objects: PathBuf,
}

/// What a fetch of `remote`, the upstream of `branch` in `repo`, signs in
/// with, through Banda's own repository at `shadow`: the Person's GitHub
/// token, as Banda reads it (`banda_kernel::gh`), when git reaches the
/// remote at github.com over https and the repository's objects are named
/// by SHA-1, as GitHub's are; none elsewhere.
async fn sign_in(repo: &Repo, branch: &str, remote: &str, shadow: &Path) -> Option<Signing> {
    if !repo.sha1() {
        return None;
    }
    let url = remote_url(&repo.top, remote).await?;
    if !banda_git_cli::on_github(&url) {
        return None;
    }
    let merge = repo
        .config(&format!("branch.{branch}.merge"))
        .await
        .ok()??;
    let tracking = format!("refs/heads/{branch}");
    let args = ["for-each-ref", "--format=%(upstream)", &tracking];
    let ran = git(&repo.top, args, Opts::default()).await.ok()?;
    let tracking = ran.text();
    let plain = |name: &str, under: &str| {
        name.strip_prefix(under).is_some_and(|rest| {
            !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_graphic() && b != b':')
        })
    };
    if !plain(&merge, "refs/heads/") || !plain(&tracking, "refs/remotes/") {
        return None;
    }
    let args = ["rev-parse", "--path-format=absolute", "--git-common-dir"];
    let ran = git(&repo.top, args, Opts::default()).await.ok()?;
    let objects = PathBuf::from(ran.success.then(|| ran.text())?).join("objects");
    let github = banda_kernel::gh::GITHUB;
    let token = banda_kernel::gh::token(github).await?;
    let user = tokio::task::spawn_blocking(move || banda_kernel::gh::login(github));
    let user = user.await.ok().flatten();
    Some(Signing {
        sign_in: SignIn { url, user, token },
        merge,
        tracking,
        shadow: shadow.to_owned(),
        objects,
    })
}

/// Fetches the upstream branch as `signing` says: from the remote into
/// Banda's own repository, signed in, on the host; then from there into
/// `repo`'s remote-tracking ref, with no token, as a bookkeeping fetch
/// does, behind the fence.
async fn signed(repo: &Repo, signing: &Signing) -> Result<(), Failure> {
    let Signing {
        sign_in,
        merge,
        tracking,
        shadow,
        objects,
    } = signing;
    let refspec = format!("+{merge}:{tracking}");
    let from_github = [
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        "--",
        &sign_in.url,
        &refspec,
    ];
    let opts = Opts {
        pool: Pool::Long,
        signed: Some((objects, sign_in)),
        ..Opts::default()
    };
    git(shadow, from_github, opts).await?.checked()?;
    taken(repo, shadow, tracking).await
}

/// Takes `tracking`, a remote-tracking ref, into `repo` from Banda's own
/// repository at `shadow`, which fetched it: a bookkeeping fetch, behind
/// the fence where it holds, with `shadow` opened to it to read.
async fn taken(repo: &Repo, shadow: &Path, tracking: &str) -> Result<(), Failure> {
    let refspec = format!("+{tracking}:{tracking}");
    let from_banda = [
        OsStr::new("fetch"),
        OsStr::new("--quiet"),
        OsStr::new("--no-tags"),
        OsStr::new("--no-write-fetch-head"),
        OsStr::new("--"),
        shadow.as_os_str(),
        OsStr::new(&refspec),
    ];
    let shadow = [shadow.to_owned()];
    let opts = Opts {
        pool: Pool::Long,
        reads: &shadow,
        ..Opts::default()
    };
    repo.run(from_banda, opts).await?.checked().map(drop)
}

/// The address git reaches `remote` of the repository at `top` at, as the
/// config says, its `insteadOf` taken.
async fn remote_url(top: &Path, remote: &str) -> Option<String> {
    let ran = git(top, ["remote", "get-url", remote], Opts::default()).await;
    Some(ran.ok().filter(|ran| ran.success)?.text())
}

/// Why Banda's own fetch did not sign in to a remote that wanted it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Unsigned {
    /// GitHub refused the Person's token.
    Refused,
    /// Banda read no token of the Person's for github.com.
    NoToken,
    /// It goes over ssh, which reads none of the Person's ssh config
    /// where the fence holds.
    Ssh,
    /// It signs in only to github.com over https, in a Project the Person
    /// said they trust, where the fence holds.
    Elsewhere,
    /// Where the fence does not hold, it signs in as the Person's git does,
    /// and that did not.
    Failed,
}

/// Why a fetch from the remote at `url` that could not sign in did not
/// sign in; `could` says that it may sign in here, where the fence holds
/// and the Person said they trust the Project, and `guarded` that the
/// fence holds ([`banda_kernel::host::guard`]).
fn why_unsigned(url: Option<&str>, could: bool, guarded: bool) -> Unsigned {
    if !guarded {
        return Unsigned::Failed;
    }
    let Some(url) = url else {
        return Unsigned::Elsewhere;
    };
    let lower = url.to_ascii_lowercase();
    let over_http = lower.starts_with("https://") || lower.starts_with("http://");
    let local = url.starts_with('/') || lower.starts_with("file:");
    match (over_http, local) {
        (false, false) => Unsigned::Ssh,
        (true, _) if could && banda_git_cli::on_github(url) => Unsigned::NoToken,
        _ => Unsigned::Elsewhere,
    }
}

/// Says in the log, once for the repository at `top`, that its fetch
/// could not sign in to its remote, and why.
fn unauthorized(top: &Path, why: Unsigned) {
    static SAID: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());
    if !SAID.lock().unwrap().insert(top.to_owned()) {
        return;
    }
    let folder = top.display();
    match why {
        Unsigned::Refused => tracing::warn!(
            %folder,
            "Banda's fetch could not sign in to the remote with the Person's GitHub token"
        ),
        Unsigned::Ssh => tracing::warn!(
            %folder,
            "Banda's fetch could not sign in to the remote over ssh: where the fence holds, its \
             ssh reads none of the Person's ssh config (ssh -F none), so a host's other name or \
             an IdentityAgent set there is not used"
        ),
        Unsigned::NoToken => tracing::warn!(
            %folder,
            "Banda's fetch could not sign in to github.com: it found no GitHub token of the \
             Person's, in gh's hosts.yml, the keyring or GH_TOKEN"
        ),
        Unsigned::Elsewhere => tracing::warn!(
            %folder,
            "Banda's fetch could not sign in to the remote: where the fence holds, it signs in \
             only to github.com over https, with the Person's GitHub token, in a Project they \
             said they trust"
        ),
        Unsigned::Failed => {
            tracing::warn!(%folder, "Banda's fetch could not sign in to the remote")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs git in `folder`, as a Person's own does.
    fn run(folder: &Path, args: &[&str]) -> String {
        let ran = std::process::Command::new("git")
            .args(args)
            .current_dir(folder)
            .output()
            .unwrap();
        assert!(ran.status.success(), "{args:?}: {ran:?}");
        String::from_utf8(ran.stdout).unwrap().trim().to_owned()
    }

    /// A repository at `top` with a commit on `main`.
    fn committed(top: &Path) {
        std::fs::create_dir_all(top).unwrap();
        run(top, &["init", "--quiet", "--initial-branch=main"]);
        std::fs::write(top.join("a"), "a").unwrap();
        run(top, &["add", "a"]);
        let who = ["-c", "user.name=T", "-c", "user.email=t@t"];
        run(top, &[&who[..], &["commit", "--quiet", "-m", "a"]].concat());
    }

    #[tokio::test]
    async fn a_fetch_signs_in_with_the_persons_token_only_where_git_reaches_github() {
        let dir = tempfile::tempdir().unwrap();
        let top = dunce::canonicalize(dir.path()).unwrap().join("p");
        committed(&top);
        run(
            &top,
            &["remote", "add", "origin", "https://github.com/o/r.git"],
        );
        run(
            &top,
            &["remote", "add", "elsewhere", "https://example.com/o/r.git"],
        );
        run(&top, &["config", "branch.main.remote", "origin"]);
        run(&top, &["config", "branch.main.merge", "refs/heads/main"]);
        banda_kernel::gh::keep(banda_kernel::gh::GITHUB, Some("gho_t".to_owned()));
        let repo = Repo::at(top.clone());
        let shadow = dir.path().join("data/git-fetched");
        let signing = sign_in(&repo, "main", "origin", &shadow).await.unwrap();
        assert_eq!(
            (&*signing.sign_in.url, &*signing.sign_in.token),
            ("https://github.com/o/r.git", "gho_t")
        );
        assert_eq!(
            (&*signing.merge, &*signing.tracking),
            ("refs/heads/main", "refs/remotes/origin/main")
        );
        assert_eq!(signing.objects, top.join(".git/objects"));
        assert!(sign_in(&repo, "main", "elsewhere", &shadow).await.is_none());
        assert!(sign_in(&repo, "main", "missing", &shadow).await.is_none());
        assert!(sign_in(&repo, "none", "origin", &shadow).await.is_none());
        // Where git reaches the remote elsewhere, as the config says.
        run(
            &top,
            &[
                "config",
                "url.https://example.com/.insteadOf",
                "https://github.com/",
            ],
        );
        assert!(sign_in(&repo, "main", "origin", &shadow).await.is_none());
    }

    #[tokio::test]
    async fn what_banda_s_own_repository_fetched_is_taken_into_the_project_s() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let (remote, top, shadow) = (root.join("remote"), root.join("p"), root.join("shadow"));
        committed(&remote);
        run(&root, &["clone", "--quiet", remote.to_str().unwrap(), "p"]);
        std::fs::write(remote.join("b"), "b").unwrap();
        run(&remote, &["add", "b"]);
        run(
            &remote,
            &[
                "-c",
                "user.name=T",
                "-c",
                "user.email=t@t",
                "commit",
                "--quiet",
                "-m",
                "b",
            ],
        );
        let tip = run(&remote, &["rev-parse", "HEAD"]);
        // Banda's own repository, as a fetch that signs in leaves it.
        run(&root, &["init", "--quiet", "--bare", "shadow"]);
        let objects = top.join(".git/objects");
        std::fs::write(
            shadow.join("objects/info/alternates"),
            format!("{}\n", objects.display()),
        )
        .unwrap();
        let refspec = "+refs/heads/main:refs/remotes/origin/main";
        run(
            &shadow,
            &["fetch", "--quiet", remote.to_str().unwrap(), refspec],
        );
        let tracking = "refs/remotes/origin/main";
        assert_ne!(run(&top, &["rev-parse", tracking]), tip);
        taken(&Repo::at(top.clone()), &shadow, tracking)
            .await
            .unwrap();
        assert_eq!(run(&top, &["rev-parse", tracking]), tip);
        run(&top, &["cat-file", "-e", &tip]);
        assert_eq!(
            run(&top, &["rev-list", "--count", "HEAD..@{upstream}"]),
            "1"
        );
    }

    #[test]
    fn a_fetch_that_could_not_sign_in_says_why() {
        let github = Some("https://github.com/o/r.git");
        assert_eq!(why_unsigned(github, true, false), Unsigned::Failed);
        assert_eq!(why_unsigned(github, true, true), Unsigned::NoToken);
        assert_eq!(why_unsigned(github, false, true), Unsigned::Elsewhere);
        let alias = Some("git@github-work:o/r.git");
        assert_eq!(why_unsigned(alias, true, true), Unsigned::Ssh);
        let ssh = Some("ssh://git@github.com/o/r.git");
        assert_eq!(why_unsigned(ssh, false, true), Unsigned::Ssh);
        let other = Some("https://example.com/o/r.git");
        assert_eq!(why_unsigned(other, true, true), Unsigned::Elsewhere);
        assert_eq!(
            why_unsigned(Some("/srv/r.git"), true, true),
            Unsigned::Elsewhere
        );
        assert_eq!(why_unsigned(None, true, true), Unsigned::Elsewhere);
    }
}
