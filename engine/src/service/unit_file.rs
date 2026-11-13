//! The engine's systemd unit as a file, enabled, while "Start Banda at
//! login" is on (`machine.toml`'s `start-at-login`, on by default; ADR
//! 0086, plan step 8). The user manager starts it as the Person logs in,
//! and from boot where the user's linger is on (`loginctl enable-linger`),
//! as on a machine that serves others with nobody logged in.
//!
//! - **At login**, the unit is `<config>/systemd/user/<name>.service`,
//!   with a link to it in `default.target.wants`, as `systemctl enable`
//!   makes: a client writes both and starts it with `systemctl start`.
//!   The link is made here, not by `systemctl enable`, which refuses while
//!   a unit of that name started with `systemd-run` still runs.
//! - **On demand**, while it is off, there is no file: a client starts a
//!   transient unit with `systemd-run`, as before, and it goes as the
//!   Person logs out.
//!
//! Only the default state folder's engine of a released Banda starts at
//! login: a test's, a trial's or a checkout's unit is always transient. What its starter's session lends it,
//! its display and ssh agent where the user manager lacks them, is no
//! part of the file: a client puts that in a drop-in under the runtime
//! folder, `<runtime>/systemd/user/<name>.service.d/session.conf`, which
//! goes as the session does, so a boot never hands the engine an ssh
//! agent that has gone.
//!
//! The engine keeps the file as the setting changes, and names its own
//! program there each time it starts ([`follow_login`]): after it moved
//! onto a new copy (ADR 0119), a boot, or a crash, starts that copy.
//! `banda stop` stops the unit and leaves it enabled, as Quit Banda leaves
//! macOS's plist in LaunchAgents: the next client, or the next boot,
//! starts it.

use super::{Systemd, Unit};
use std::io;
use std::path::{Path, PathBuf};
use tokio::sync::watch;

/// The target whose start starts the unit: the user manager's own, at
/// login or at boot.
const WANTED_BY: &str = "default.target";

/// Where a unit's files are, while it starts at login.
#[derive(Clone, Debug)]
pub struct Files {
    /// `<config>/systemd/user/<name>.service`.
    unit: PathBuf,
    /// The link to it in `default.target.wants`, which enables it.
    wanted: PathBuf,
    /// What its starter's session lends it, under the runtime folder;
    /// none where the manager names no runtime folder.
    session: Option<PathBuf>,
}

impl Files {
    /// The files of unit `name`, in the folders the user manager reads,
    /// as its `manager` environment names them; none with no home.
    pub fn of(name: &str, manager: &[(String, String)]) -> Option<Files> {
        let config = (super::given(manager, "XDG_CONFIG_HOME").map(PathBuf::from))
            .or_else(|| dirs::home_dir().map(|home| home.join(".config")))?;
        let runtime = super::given(manager, "XDG_RUNTIME_DIR").map(PathBuf::from);
        Some(Files::under(&config, runtime.as_deref(), name))
    }

    /// The files of unit `name` under `config` and `runtime`.
    fn under(config: &Path, runtime: Option<&Path>, name: &str) -> Files {
        let file = format!("{name}.service");
        let units = config.join("systemd/user");
        Files {
            unit: units.join(&file),
            wanted: units.join(format!("{WANTED_BY}.wants")).join(&file),
            session: runtime.map(|runtime| {
                (runtime.join("systemd/user"))
                    .join(format!("{file}.d"))
                    .join("session.conf")
            }),
        }
    }

    /// Writes the unit `text` and the link that enables it, and the
    /// `session`'s drop-in, or takes it away when there is none; says
    /// whether any of them changed, so the manager reads them again.
    pub fn put(&self, text: &str, session: Option<&str>) -> io::Result<bool> {
        let mut changed = written(&self.unit, text)?;
        if std::fs::read_link(&self.wanted).ok().as_deref() != Some(self.unit.as_path()) {
            gone(std::fs::remove_file(&self.wanted))?;
            link(&self.unit, &self.wanted)?;
            changed = true;
        }
        if let Some(path) = &self.session {
            changed |= match session {
                Some(text) => written(path, text)?,
                None => removed(path)?,
            };
        }
        Ok(changed)
    }

    /// Takes the unit, its link and its session's drop-in away; says
    /// whether any was there.
    pub fn take_away(&self) -> io::Result<bool> {
        let mut changed = removed(&self.wanted)?;
        changed |= removed(&self.unit)?;
        if let Some(path) = &self.session {
            changed |= removed(path)?;
        }
        Ok(changed)
    }
}

/// Writes `text` to `path` unless it holds it already; says whether it
/// wrote.
fn written(path: &Path, text: &str) -> io::Result<bool> {
    if std::fs::read_to_string(path).is_ok_and(|held| held == text) {
        return Ok(false);
    }
    crate::places::write_private(path, text.as_bytes())?;
    Ok(true)
}

/// Removes `path`; says whether it was there.
fn removed(path: &Path) -> io::Result<bool> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

/// `removed`, where a file that was not there is gone too.
fn gone(removed: io::Result<()>) -> io::Result<()> {
    match removed {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// Links `wanted` to `unit`, as `systemctl enable` does.
#[cfg(unix)]
fn link(unit: &Path, wanted: &Path) -> io::Result<()> {
    if let Some(folder) = wanted.parent() {
        std::fs::create_dir_all(folder)?;
    }
    std::os::unix::fs::symlink(unit, wanted)
}

#[cfg(not(unix))]
fn link(_: &Path, _: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "a systemd unit is Linux's",
    ))
}

/// `text` as one quoted word of a unit file: in `ExecStart=`, where a
/// `$` names a variable, `exec`.
fn quoted(text: &str, exec: bool) -> String {
    let mut word = text
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('%', "%%");
    if exec {
        word = word.replace('$', "$$");
    }
    format!("\"{word}\"")
}

/// `Environment=` lines for `env`.
fn environment(env: &[(String, String)]) -> String {
    (env.iter())
        .map(|(name, value)| {
            format!(
                "Environment={}\n",
                quoted(&format!("{name}={value}"), false)
            )
        })
        .collect()
}

impl Unit {
    /// The unit's file: what `systemd-run` is told of it, with
    /// `CollectMode` for `--collect`, and the target that starts it.
    pub(super) fn file(&self) -> String {
        let (unit, service) = self.properties();
        let line = |property: &&str| format!("{property}\n");
        format!(
            "# Written by Banda: \"Start Banda at login\" in machine.toml keeps it, and\n\
             # takes it away once it is off.\n\
             [Unit]\n\
             Description={description}\n\
             CollectMode=inactive-or-failed\n\
             {unit}\n\
             [Service]\n\
             {service}{environment}ExecStart={program} serve\n\
             \n\
             [Install]\n\
             WantedBy={WANTED_BY}\n",
            description = self.description(),
            unit = unit.iter().map(line).collect::<String>(),
            service = service.iter().map(line).collect::<String>(),
            environment = environment(&self.env),
            program = quoted(&self.program.display().to_string(), true),
        )
    }

    /// The drop-in with what its starter's session lends it; none when
    /// it lends nothing.
    pub(super) fn session_file(&self) -> Option<String> {
        (!self.session.is_empty()).then(|| format!("[Service]\n{}", environment(&self.session)))
    }
}

/// Keeps the unit file of `places`' engine, which runs `program` as its
/// unit `unit`, as "Start Banda at login" says while `at_login` follows
/// it: written, enabled and naming this engine's program while it is on,
/// taken away once it is off. For the default state folder's engine only,
/// and only as its unit's own process (Linux).
pub fn follow_login(
    places: &crate::places::Places,
    unit: &str,
    program: PathBuf,
    mut at_login: watch::Receiver<bool>,
) {
    let systemd = &super::User;
    let manager = systemd.environment();
    let Some(files) = super::files_of(places, unit, &manager) else {
        return;
    };
    let Some(version) = systemd.version() else {
        return;
    };
    let engine: Vec<(String, String)> = std::env::vars().collect();
    let path = super::given(&engine, "PATH");
    let unit = Unit {
        name: unit.to_owned(),
        program,
        env: super::kept(&engine, places, &manager, path.as_deref()),
        session: Vec::new(),
        version,
        files: Some(files),
        at_login: true,
    };
    tokio::spawn(async move {
        loop {
            let on = *at_login.borrow_and_update();
            let unit = unit.clone();
            let settled = tokio::task::spawn_blocking(move || {
                // A client's drop-in stays as it wrote it.
                let session = (unit.files.as_ref())
                    .and_then(|files| files.session.as_deref())
                    .and_then(|path| std::fs::read_to_string(path).ok());
                settle(&super::User, &unit, on, session.as_deref())
            });
            match settled.await {
                Ok(Ok(())) => tracing::debug!(at_login = on, "the engine's unit file is in place"),
                Ok(Err(error)) => {
                    tracing::warn!(%error, at_login = on, "the engine's unit file was not kept");
                }
                Err(error) => tracing::warn!(%error, "the engine's unit file was not kept"),
            }
            if at_login.changed().await.is_err() {
                return;
            }
        }
    });
}

/// Writes `unit`'s files and the link that enables it while `at_login`,
/// with `session` as its session's drop-in, else takes them away; the
/// manager reads its units again when they changed.
pub(super) fn settle(
    systemd: &dyn Systemd,
    unit: &Unit,
    at_login: bool,
    session: Option<&str>,
) -> Result<(), String> {
    let Some(files) = &unit.files else {
        return Ok(());
    };
    let changed = if at_login {
        files.put(&unit.file(), session)
    } else {
        files.take_away()
    };
    match changed {
        Ok(true) => systemd.reload(),
        Ok(false) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_word_of_a_unit_file_is_quoted_as_systemd_reads_it() {
        assert_eq!(quoted("/a b/banda", true), "\"/a b/banda\"");
        assert_eq!(
            quoted("50% \"x\" \\ $HOME", false),
            r#""50%% \"x\" \\ $HOME""#
        );
        assert_eq!(quoted("$HOME", true), "\"$$HOME\"");
    }

    #[cfg(unix)]
    #[test]
    fn the_files_are_written_enabled_once_and_taken_away() {
        let dir = tempfile::tempdir().unwrap();
        let (config, runtime) = (dir.path().join("config"), dir.path().join("run"));
        let files = Files::under(&config, Some(&runtime), "banda-engine");
        let unit = config.join("systemd/user/banda-engine.service");
        let wanted = config.join("systemd/user/default.target.wants/banda-engine.service");
        let session = runtime.join("systemd/user/banda-engine.service.d/session.conf");

        assert!(files.put("[Unit]\n", Some("[Service]\n")).unwrap());
        assert_eq!(std::fs::read_to_string(&unit).unwrap(), "[Unit]\n");
        assert_eq!(std::fs::read_link(&wanted).unwrap(), unit);
        assert_eq!(std::fs::read_to_string(&session).unwrap(), "[Service]\n");
        assert!(
            !files.put("[Unit]\n", Some("[Service]\n")).unwrap(),
            "unchanged"
        );
        assert!(
            files.put("[Unit]\n", None).unwrap(),
            "the session lends nothing now"
        );
        assert!(!session.exists());

        assert!(files.take_away().unwrap());
        assert!(!unit.exists() && wanted.symlink_metadata().is_err());
        assert!(!files.take_away().unwrap(), "nothing left");
    }
}
