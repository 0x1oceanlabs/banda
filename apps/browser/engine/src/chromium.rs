//! The Chromium a machine's tabs run in (ADR 0132, decision 2): Chrome for
//! Testing's headless shell, pinned by this Banda and fetched on first use.
//!
//! - **The pin** is `chromium.json`: the version, and each system's zip by
//!   its size and SHA-256. It is the version the driver's `playwright-core`
//!   is made for (its `browsers.json`), so the two move together.
//! - **The fetch** puts the zip's folder in `<data>/browser/<version>/`,
//!   whole or not at all: downloaded and unpacked beside it, then renamed
//!   into place. Other versions there are dropped. While it runs, a call is
//!   refused in words that say how much has come, so none waits past a
//!   Harness's limit.
//! - **The sandbox** is Chromium's own, always. Ubuntu's AppArmor keeps
//!   user namespaces from a program it has no profile for; there a call is
//!   refused with `banda browser setup`, which the Person runs once.

use banda_kernel::Refusal;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, SystemTime};

/// How long the storage has to answer, and to send each next piece.
const ANSWERS: Duration = Duration::from_secs(30);

/// How old a fetch's leftovers are before another fetch drops them: one
/// that still runs, as `banda browser setup` beside the engine, is younger.
const STALE: Duration = Duration::from_secs(60 * 60);

/// Where Ubuntu says whether it keeps user namespaces from programs with
/// no profile, and where its profiles are.
const RESTRICTS: &str = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
const PROFILES: &str = "/etc/apparmor.d";

/// The Chromium this Banda's Agents browse with.
#[derive(Clone, Debug, Deserialize)]
pub struct Pin {
    pub version: String,
    /// Where its zips are: `<from>/<version>/<system>/<name>-<system>.zip`.
    pub from: String,
    /// Each system's zip, by Chrome for Testing's name for the system.
    pub files: BTreeMap<String, File>,
}

/// One system's zip.
#[derive(Clone, Debug, Deserialize)]
pub struct File {
    pub size: u64,
    pub sha256: String,
}

impl Pin {
    /// The pin this Banda was built with.
    pub fn ours() -> Pin {
        serde_json::from_str(include_str!("../chromium.json")).expect("chromium.json is a pin")
    }
}

/// Chrome for Testing's name for the system this engine runs on, where it
/// has a headless shell for it.
pub fn system() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("linux64"),
        ("linux", "aarch64") => Some("linux-arm64"),
        ("macos", "aarch64") => Some("mac-arm64"),
        ("macos", "x86_64") => Some("mac-x64"),
        ("windows", "x86_64") => Some("win64"),
        _ => None,
    }
}

/// The zip's one folder, and the program in it.
const NAME: &str = "chrome-headless-shell";

/// How a fetch goes.
#[derive(Debug, Default)]
enum Fetch {
    #[default]
    Idle,
    /// It runs, and so many bytes of the zip came.
    Running(u64),
    /// The last one failed, and why.
    Failed(String),
}

/// This machine's Chromium for its tabs: where it is, and the fetch of it.
pub struct Chromium {
    /// `<data>/browser`.
    folder: PathBuf,
    pin: Pin,
    system: Option<&'static str>,
    /// The system's file that says it restricts user namespaces, and its
    /// folder of profiles.
    restricts: PathBuf,
    profiles: PathBuf,
    fetch: Mutex<Fetch>,
}

impl Chromium {
    /// The Chromium in Banda's data folder `data`.
    pub fn of(data: &Path) -> Arc<Chromium> {
        Arc::new(Self::pinned(data, Pin::ours(), system()))
    }

    /// As [`Chromium::of`], with a pin and a system of a test's own.
    pub fn pinned(data: &Path, pin: Pin, system: Option<&'static str>) -> Chromium {
        Chromium {
            folder: data.join("browser"),
            pin,
            system,
            restricts: RESTRICTS.into(),
            profiles: PROFILES.into(),
            fetch: Mutex::default(),
        }
    }

    /// The system's zip in the pin, or that Banda has none for it.
    fn file(&self) -> Result<(&'static str, &File), String> {
        let none = "Banda has no browser for Agents on this system yet.";
        let system = self.system.ok_or(none)?;
        Ok((system, self.pin.files.get(system).ok_or(none)?))
    }

    /// Where the program is once it is fetched.
    fn program(&self, system: &str) -> PathBuf {
        let exe = if system.starts_with("win") {
            ".exe"
        } else {
            ""
        };
        (self.folder.join(&self.pin.version))
            .join(format!("{NAME}-{system}"))
            .join(format!("{NAME}{exe}"))
    }

    /// The program, for a call that needs it now. While it is not here the
    /// call is refused, and a fetch runs: the words say how far it is. A
    /// system that keeps Chromium's sandbox from it refuses with the
    /// command that allows it.
    pub fn ready(self: &Arc<Self>) -> Result<PathBuf, Refusal> {
        let (system, file) = self.file().map_err(Refusal::app_unavailable)?;
        let program = self.program(system);
        if program.is_file() {
            return match self.blocked() {
                Some(why) => Err(Refusal::app_unavailable(why)),
                None => Ok(program),
            };
        }
        let mut fetch = self.fetch.lock().unwrap_or_else(PoisonError::into_inner);
        let failed = match &*fetch {
            Fetch::Running(came) => return Err(Refusal::conflict(fetching(*came, file.size))),
            Fetch::Failed(why) => format!(" The last try failed: {why}."),
            Fetch::Idle => String::new(),
        };
        *fetch = Fetch::Running(0);
        let this = self.clone();
        tokio::spawn(async move {
            let went = this.fetch(|came| this.say(Fetch::Running(came))).await;
            if let Err(why) = &went {
                tracing::warn!("the browser for Agents was not fetched: {why}");
            }
            this.say(went.map_or_else(Fetch::Failed, |_| Fetch::Idle));
        });
        Err(Refusal::conflict(format!(
            "{}{failed}",
            fetching(0, file.size)
        )))
    }

    fn say(&self, fetch: Fetch) {
        *self.fetch.lock().unwrap_or_else(PoisonError::into_inner) = fetch;
    }

    /// Fetches the program unless it is here, telling `came` the bytes of
    /// the zip so far, and answers where it is.
    pub async fn fetch(&self, mut came: impl FnMut(u64)) -> Result<PathBuf, String> {
        let (system, file) = self.file()?;
        let program = self.program(system);
        if program.is_file() {
            return Ok(program);
        }
        let folder = &self.folder;
        std::fs::create_dir_all(folder).map_err(|e| format!("{}: {e}", folder.display()))?;
        self.drop_others();
        let version = &self.pin.version;
        let mine = format!(".{version}.{}", std::process::id());
        let (zip, fresh) = (folder.join(format!("{mine}.zip")), folder.join(&mine));
        let url = format!("{}/{version}/{system}/{NAME}-{system}.zip", self.pin.from);
        let placed = async {
            download(&url, file, &zip, &mut came).await?;
            let (from, into) = (zip.clone(), fresh.clone());
            tokio::task::spawn_blocking(move || unpack(&from, &into))
                .await
                .map_err(|e| e.to_string())??;
            let kept = folder.join(version);
            // Another fetch, `banda browser setup`'s or the engine's, may
            // have put it there meanwhile: theirs is the same one.
            match std::fs::rename(&fresh, &kept) {
                Err(e) if !program.is_file() => Err(format!("{}: {e}", kept.display())),
                _ => Ok(()),
            }
        }
        .await;
        let _ = std::fs::remove_file(&zip);
        let _ = std::fs::remove_dir_all(&fresh);
        placed?;
        Ok(program)
    }

    /// Drops what an older Banda fetched, and what a fetch that ended
    /// badly left.
    fn drop_others(&self) {
        let Ok(entries) = std::fs::read_dir(&self.folder) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if *name == self.pin.version {
                continue;
            }
            let young = name.starts_with('.')
                && (entry.metadata().and_then(|m| m.modified()).ok())
                    .and_then(|at| SystemTime::now().duration_since(at).ok())
                    .is_none_or(|age| age < STALE);
            if young {
                continue;
            }
            let path = entry.path();
            let _ = if path.is_dir() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
        }
    }

    /// Why this system keeps Chromium's sandbox from the program, where it
    /// does: the words an Agent gets.
    fn blocked(&self) -> Option<String> {
        self.profile().map(|_| {
            "This system keeps Chromium's sandbox from Banda's browser for Agents. Your Person \
             allows it once: `banda browser setup` in a terminal, which asks for sudo."
                .to_owned()
        })
    }

    /// The AppArmor profile this system needs for the program and lacks:
    /// its file and its text. None where the system restricts nothing, or
    /// the profile is there.
    fn profile(&self) -> Option<(PathBuf, String)> {
        if !cfg!(target_os = "linux") {
            return None;
        }
        let restricted =
            std::fs::read_to_string(&self.restricts).is_ok_and(|said| said.trim() == "1");
        if !restricted {
            return None;
        }
        let name = self.profile_name();
        let at = format!("{}/*/{NAME}-*/{NAME}", self.folder.display());
        let file = self.profiles.join(&name);
        if std::fs::read_to_string(&file).is_ok_and(|text| text.contains(&at)) {
            return None;
        }
        Some((
            file,
            format!(
                "# Lets Banda's browser for Agents use user namespaces, which Chromium's\n\
                 # sandbox needs and this system keeps from programs it has no profile\n\
                 # for. Written by `banda browser setup`. Nothing else is changed.\n\n\
                 abi <abi/4.0>,\n\
                 include <tunables/global>\n\n\
                 profile {name} \"{at}\" flags=(unconfined) {{\n  userns,\n\n  \
                 include if exists <local/{name}>\n}}\n"
            ),
        ))
    }

    /// The profile's name: this Banda's folder's, as `banda-dev-browser`;
    /// a data folder of another name, a trial's or a test's, has its own
    /// by its path.
    fn profile_name(&self) -> String {
        let data = self.folder.parent().unwrap_or(&self.folder);
        match data.file_name().and_then(|name| name.to_str()) {
            Some(name) if name.starts_with("banda") && !name.contains(['*', ' ']) => {
                format!("{name}-browser")
            }
            _ => {
                let hash = Sha256::digest(data.as_os_str().as_encoded_bytes());
                format!("banda-browser-{}", &format!("{hash:x}")[..8])
            }
        }
    }

    /// `banda browser setup`: allows Chromium's sandbox where the system
    /// keeps it from the program, with `sudo` on the Person's terminal, and
    /// fetches the program, so no Agent's first call waits for it. `say`
    /// gets each line for the Person.
    pub async fn setup(&self, mut say: impl FnMut(&str)) -> Result<PathBuf, String> {
        if let Some((file, text)) = self.profile() {
            say(&format!(
                "This system keeps Chromium's sandbox from programs it has no profile for. \
                 Banda writes one for its browser, {}, with sudo.",
                file.display()
            ));
            allow(&file, &text)?;
        }
        let size = self.file()?.1.size;
        let mut told = 0;
        self.fetch(|came| {
            // A line each tenth, not each piece.
            let tenth = came * 10 / size.max(1);
            if tenth > told {
                told = tenth;
                say(&fetching(came, size));
            }
        })
        .await
    }
}

/// The words of a fetch that runs.
fn fetching(came: u64, size: u64) -> String {
    const MB: u64 = 1_000_000;
    format!(
        "Banda is fetching its browser for Agents: {} of {} MB. Ask again in a moment.",
        came / MB,
        size.div_ceil(MB)
    )
}

/// Downloads `url` into `into`, telling `came` the bytes so far, and checks
/// its size and SHA-256 against `file`.
async fn download(
    url: &str,
    file: &File,
    into: &Path,
    came: &mut impl FnMut(u64),
) -> Result<(), String> {
    let slow = |_| format!("{url} did not answer in {} s", ANSWERS.as_secs());
    let cause = |e| format!("{url}: {}", banda_kernel::https::cause(&e));
    let asked = banda_kernel::https::client()?.get(url).send();
    let mut response = (tokio::time::timeout(ANSWERS, asked).await)
        .map_err(slow)?
        .map_err(cause)?;
    if !response.status().is_success() {
        return Err(format!("{url} answered {}", response.status()));
    }
    let on_disk = |e: std::io::Error| format!("{}: {e}", into.display());
    let mut out = std::fs::File::create(into).map_err(on_disk)?;
    let mut hash = Sha256::new();
    let mut got: u64 = 0;
    while let Some(piece) = (tokio::time::timeout(ANSWERS, response.chunk()).await)
        .map_err(slow)?
        .map_err(cause)?
    {
        got += piece.len() as u64;
        if got > file.size {
            return Err(format!("{url} is longer than Banda's pin says"));
        }
        hash.update(&piece);
        out.write_all(&piece).map_err(on_disk)?;
        came(got);
    }
    out.sync_all().map_err(on_disk)?;
    if got != file.size {
        return Err(format!("{url} came short: {got} of {} bytes", file.size));
    }
    if format!("{:x}", hash.finalize()) != file.sha256 {
        return Err(format!(
            "{url} is not the file Banda's pin names: its SHA-256 differs"
        ));
    }
    Ok(())
}

/// Unpacks the zip `from` into the folder `into`. The zip crate keeps
/// every entry inside it, and its modes, so the program runs.
fn unpack(from: &Path, into: &Path) -> Result<(), String> {
    let file = std::fs::File::open(from).map_err(|e| format!("{}: {e}", from.display()))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("{}: {e}", from.display()))?;
    let _ = std::fs::remove_dir_all(into);
    archive
        .extract(into)
        .map_err(|e| format!("{}: {e}", into.display()))
}

/// Puts the profile `text` at `file` and loads it, with `sudo`, which asks
/// for the password on the terminal.
fn allow(file: &Path, text: &str) -> Result<(), String> {
    let by_hand = || {
        format!(
            "Banda could not write it. As root, put this in {} and run `apparmor_parser -r {}`:\n\n{text}",
            file.display(),
            file.display()
        )
    };
    let draft = std::env::temp_dir().join(format!("banda-browser-{}", std::process::id()));
    std::fs::write(&draft, text).map_err(|e| format!("{}: {e}", draft.display()))?;
    let sudo = |program: &str, args: &[&std::ffi::OsStr]| {
        (std::process::Command::new("sudo").arg(program).args(args))
            .status()
            .is_ok_and(|status| status.success())
    };
    let done = sudo(
        "install",
        &[
            "-m".as_ref(),
            "0644".as_ref(),
            draft.as_ref(),
            file.as_ref(),
        ],
    ) && sudo("apparmor_parser", &["-r".as_ref(), file.as_ref()]);
    let _ = std::fs::remove_file(&draft);
    done.then_some(()).ok_or_else(by_hand)
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::Code;
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

    /// A zip as Chrome for Testing's: one folder, with the program in it.
    fn zipped(system: &str) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let runs = zip::write::SimpleFileOptions::default().unix_permissions(0o755);
        zip.start_file(format!("{NAME}-{system}/{NAME}"), runs)
            .unwrap();
        zip.write_all(b"#!/bin/sh\necho headless\n").unwrap();
        zip.finish().unwrap().into_inner()
    }

    /// Serves `body` to every request, as the storage does, and answers
    /// where.
    async fn storage(body: Vec<u8>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let at = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let body = body.clone();
                tokio::spawn(async move {
                    let mut asked = [0; 2048];
                    let _ = socket.read(&mut asked).await;
                    let head = format!(
                        "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = socket.write_all(head.as_bytes()).await;
                    let _ = socket.write_all(&body).await;
                });
            }
        });
        at
    }

    /// On a system that restricts nothing, whatever this one does.
    fn free(chromium: Chromium) -> Chromium {
        Chromium {
            restricts: "/nowhere".into(),
            ..chromium
        }
    }

    fn pin(from: String, body: &[u8]) -> Pin {
        let file = File {
            size: body.len() as u64,
            sha256: format!("{:x}", Sha256::digest(body)),
        };
        Pin {
            version: "1.2.3".to_owned(),
            from,
            files: BTreeMap::from([("linux64".to_owned(), file)]),
        }
    }

    #[test]
    fn the_pin_names_a_zip_for_every_system_banda_runs_on() {
        let pin = Pin::ours();
        for system in ["linux64", "linux-arm64", "mac-arm64", "mac-x64", "win64"] {
            let file = &pin.files[system];
            assert!(file.size > 50_000_000, "{system}");
            assert_eq!(file.sha256.len(), 64, "{system}");
        }
        assert!(pin.from.starts_with("https://"));
    }

    #[tokio::test]
    async fn the_first_call_starts_the_fetch_and_is_refused_until_the_program_is_whole() {
        let data = tempfile::tempdir().unwrap();
        let body = zipped("linux64");
        let pin = pin(storage(body.clone()).await, &body);
        let chromium = Arc::new(free(Chromium::pinned(data.path(), pin, Some("linux64"))));
        // What an older Banda fetched goes.
        std::fs::create_dir_all(data.path().join("browser/1.0.0")).unwrap();

        let refused = chromium.ready().unwrap_err();
        assert_eq!(refused.code, Code::Conflict);
        assert_eq!(
            refused.message,
            "Banda is fetching its browser for Agents: 0 of 1 MB. Ask again in a moment."
        );
        let program = loop {
            match chromium.ready() {
                Ok(program) => break program,
                Err(refused) => assert_eq!(refused.code, Code::Conflict, "{refused:?}"),
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        };
        assert_eq!(
            program,
            data.path()
                .join("browser/1.2.3/chrome-headless-shell-linux64/chrome-headless-shell")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(&program).unwrap().permissions().mode();
            assert_eq!(mode & 0o111, 0o111, "the program runs");
        }
        let left: Vec<_> = std::fs::read_dir(data.path().join("browser"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(left, ["1.2.3"], "only the pinned one stays");
    }

    #[tokio::test]
    async fn a_zip_that_is_not_the_pinned_one_is_not_kept_and_the_next_call_says_why() {
        let data = tempfile::tempdir().unwrap();
        let body = zipped("linux64");
        let mut pin = pin(storage(body.clone()).await, &body);
        pin.files.get_mut("linux64").unwrap().sha256 = "0".repeat(64);
        let chromium = Arc::new(free(Chromium::pinned(data.path(), pin, Some("linux64"))));

        let failed = chromium.fetch(|_| {}).await.unwrap_err();
        assert!(failed.ends_with("its SHA-256 differs"), "{failed}");
        let left = std::fs::read_dir(data.path().join("browser"))
            .unwrap()
            .count();
        assert_eq!(left, 0, "nothing of it stays");

        chromium.say(Fetch::Failed(failed));
        let refused = chromium.ready().unwrap_err();
        assert!(
            refused.message.contains("The last try failed: http://"),
            "{refused:?}"
        );
    }

    #[test]
    fn a_system_banda_has_no_chromium_for_refuses_in_words() {
        let data = tempfile::tempdir().unwrap();
        let chromium = Arc::new(Chromium::pinned(data.path(), Pin::ours(), None));
        let refused = chromium.ready().unwrap_err();
        assert_eq!(refused.code, Code::AppUnavailable);
        assert_eq!(
            refused.message,
            "Banda has no browser for Agents on this system yet."
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn where_the_system_keeps_user_namespaces_the_profile_is_asked_for_once() {
        let (data, system) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let (restricts, profiles) = (system.path().join("restricts"), system.path().join("d"));
        std::fs::create_dir_all(&profiles).unwrap();
        let on = |data: &Path| Chromium {
            restricts: restricts.clone(),
            profiles: profiles.clone(),
            ..Chromium::pinned(data, Pin::ours(), Some("linux64"))
        };
        let home = data.path().join("banda-dev");
        let chromium = on(&home);

        // A system that restricts nothing needs none.
        assert!(chromium.profile().is_none());
        std::fs::write(&restricts, "0\n").unwrap();
        assert!(chromium.profile().is_none());

        std::fs::write(&restricts, "1\n").unwrap();
        let (file, text) = chromium.profile().unwrap();
        assert_eq!(file, profiles.join("banda-dev-browser"));
        let at = format!(
            "profile banda-dev-browser \"{}/browser/*/chrome-headless-shell-*/chrome-headless-shell\" flags=(unconfined) {{",
            home.display()
        );
        assert!(text.contains(&at), "{text}");
        assert!(text.contains("  userns,\n"), "{text}");

        // Once it is there, for every version to come.
        std::fs::write(&file, &text).unwrap();
        assert!(chromium.profile().is_none());

        // A data folder of another name has a profile of its own.
        let (file, _) = on(&data.path().join("data")).profile().unwrap();
        let name = file.file_name().unwrap().to_str().unwrap();
        assert!(
            name.starts_with("banda-browser-") && name.len() == 22,
            "{name}"
        );
    }
}

#[cfg(test)]
mod live {
    /// The real fetch, by hand: `BANDA_LIVE=<folder> cargo test -p
    /// banda-browser live -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "fetches 126 MB from Chrome for Testing"]
    async fn the_pinned_chromium_comes_whole_and_says_its_version() {
        let data = std::path::PathBuf::from(std::env::var("BANDA_LIVE").unwrap());
        let chromium = super::Chromium::of(&data);
        let program = chromium.fetch(|_| {}).await.unwrap();
        let said = std::process::Command::new(&program)
            .arg("--version")
            .output()
            .unwrap();
        let said = String::from_utf8_lossy(&said.stdout);
        assert!(said.contains(&super::Pin::ours().version), "{said}");
    }
}
