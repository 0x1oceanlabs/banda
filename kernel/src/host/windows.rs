//! The host's ways on Windows (ADR 0090, decision 3): PATH from the
//! registry, the names a program there has, the programs Banda never runs,
//! and renames that wait out a file held a moment.

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;
use windows_registry::{CURRENT_USER, Key, LOCAL_MACHINE};

/// Where the registry keeps the user's variables, under `HKEY_CURRENT_USER`.
const USER: &str = "Environment";
/// Where it keeps the system's, under `HKEY_LOCAL_MACHINE`.
const SYSTEM: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";

/// The extensions of a program the engine can start: `CreateProcess`
/// starts an `.exe` and a `.com`, and Rust a `.cmd` and a `.bat` through
/// `cmd.exe`. `PATHEXT` names more, as `.js` and `.vbs`, that need a host
/// program of their own.
const STARTS: [&str; 4] = ["com", "exe", "bat", "cmd"];

/// `own`'s folders, then those of the system's PATH and the user's it
/// lacks, as the registry holds them now, each `%VARIABLE%` in them
/// expanded: what a fresh sign-in would have, after what the engine was
/// started with.
pub fn with_registry(own: OsString) -> OsString {
    with_keys(own, USER)
}

/// [`with_registry`], with the user's variables under `user`.
fn with_keys(own: OsString, user: &str) -> OsString {
    let user = CURRENT_USER.open(user).ok();
    let system = LOCAL_MACHINE.open(SYSTEM).ok();
    let keys: Vec<&Key> = [user.as_ref(), system.as_ref()]
        .into_iter()
        .flatten()
        .collect();
    let read = |key: Option<&Key>| key.and_then(|key| key.get_string("Path").ok());
    let registry = [read(system.as_ref()), read(user.as_ref())]
        .into_iter()
        .flatten()
        .map(|path| expanded(&path, |name| variable(name, &keys)));
    merged(own, registry)
}

/// The variable `name`: the engine's own, else the user's or the system's
/// in the registry, as one added since the engine started.
fn variable(name: &str, keys: &[&Key]) -> Option<String> {
    let own = std::env::var(name).ok();
    own.or_else(|| keys.iter().find_map(|key| key.get_string(name).ok()))
}

/// `text` with each `%NAME%` in it that `value` knows put in its place, as
/// `ExpandEnvironmentStrings` does; one it does not know stays as it is.
fn expanded(text: &str, value: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => match value(&after[..end]).filter(|_| end > 0) {
                Some(found) => {
                    out.push_str(&found);
                    rest = &after[end + 1..];
                }
                None => {
                    out.push('%');
                    rest = after;
                }
            },
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// `own`'s folders, then each of `more`'s that none before it is, compared
/// without case and without a last `\`.
fn merged(own: OsString, more: impl Iterator<Item = String>) -> OsString {
    let key = |folder: &Path| {
        let text = folder.to_string_lossy().to_lowercase();
        text.trim_end_matches(['\\', '/']).to_owned()
    };
    let mut seen = std::collections::HashSet::new();
    let mut folders = Vec::new();
    let more: Vec<String> = more.collect();
    let theirs = more.iter().flat_map(|path| std::env::split_paths(path));
    for folder in std::env::split_paths(&own).chain(theirs) {
        if !folder.as_os_str().is_empty() && seen.insert(key(&folder)) {
            folders.push(folder);
        }
    }
    std::env::join_paths(folders).unwrap_or(own)
}

/// The files `program` may be: itself, when its extension is one the
/// engine starts; else it with each of `PATHEXT`'s the engine starts, in
/// its order, as a shell tries them.
pub fn names(program: PathBuf) -> Vec<PathBuf> {
    if program.extension().is_some_and(starts) {
        return vec![program];
    }
    let listed = std::env::var("PATHEXT").unwrap_or_default();
    let mut extensions: Vec<String> = (listed.split(';'))
        .map(|extension| extension.trim().trim_start_matches('.').to_lowercase())
        .filter(|extension| STARTS.contains(&extension.as_str()))
        .collect();
    if extensions.is_empty() {
        extensions = STARTS.map(str::to_owned).to_vec();
    }
    let bare = program.into_os_string();
    (extensions.iter())
        .map(|extension| {
            let mut named = bare.clone();
            named.push(".");
            named.push(extension);
            PathBuf::from(named)
        })
        .collect()
}

/// Whether `extension` is one of a program the engine can start.
fn starts(extension: &std::ffi::OsStr) -> bool {
    STARTS
        .iter()
        .any(|starts| extension.eq_ignore_ascii_case(starts))
}

/// Whether `path` is a program the engine can start, and not one of the
/// stubs Banda never runs (`host::runnable`).
pub fn runnable(path: &Path) -> bool {
    let named = |part: &std::ffi::OsStr, names: &[&str]| {
        names.iter().any(|name| part.eq_ignore_ascii_case(name))
    };
    let aliased = (path.components()).any(|part| named(part.as_os_str(), &["WindowsApps"]));
    // The system's `wsl.exe` and `bash.exe` install WSL, whatever they are
    // asked: an installed WSL's own is in `%ProgramFiles%\WSL`.
    let system = (path.parent().and_then(Path::file_name))
        .is_some_and(|folder| named(folder, &["System32", "SysWOW64", "Sysnative"]));
    let installs = system && (path.file_stem()).is_some_and(|stem| named(stem, &["wsl", "bash"]));
    !aliased
        && !installs
        && path.extension().is_some_and(starts)
        && std::fs::metadata(path).is_ok_and(|meta| meta.is_file())
}

/// How many times a file is tried while another program holds it: for
/// 0.6 s in all.
pub const FILE: u32 = 6;
/// How many times a folder is: for 5 s in all, as a program stopped just
/// before may still work in it.
pub const FOLDER: u32 = 9;

/// `act`, done again up to `tries` times, each twice as long after the
/// last, starting 20 ms apart, while it fails as Windows fails on a file
/// another program holds ([`held`]).
pub fn tried<T>(tries: u32, mut act: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    let mut wait = Duration::from_millis(20);
    for _ in 1..tries {
        match act() {
            Err(error) if held(&error) => std::thread::sleep(wait),
            done => return done,
        }
        wait *= 2;
    }
    act()
}

/// Whether `error` says another program holds the file: `ERROR_ACCESS_DENIED`,
/// as a rename over a file open without delete sharing says,
/// `ERROR_SHARING_VIOLATION`, `ERROR_LOCK_VIOLATION`, or
/// `ERROR_USER_MAPPED_FILE`, a file another program has mapped.
fn held(error: &io::Error) -> bool {
    matches!(error.raw_os_error(), Some(5 | 32 | 33 | 1224))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;

    #[test]
    fn a_variable_is_expanded_where_it_is_known() {
        let known = |name: &str| match name.to_lowercase().as_str() {
            "userprofile" => Some(r"C:\Users\roma".to_owned()),
            "systemroot" => Some(r"C:\Windows".to_owned()),
            _ => None,
        };
        let path = r"%SystemRoot%\system32;%USERPROFILE%\.local\bin;%NOPE%\x;100%;%%";
        assert_eq!(
            expanded(path, known),
            r"C:\Windows\system32;C:\Users\roma\.local\bin;%NOPE%\x;100%;%%"
        );
    }

    #[test]
    fn the_registry_s_folders_come_after_the_engine_s_each_once() {
        let own = OsString::from(r"C:\Windows\system32;C:\Program Files\Git\cmd\");
        let more = [
            r"C:\WINDOWS\System32;C:\Program Files\Git\cmd".to_owned(),
            r"C:\Users\roma\AppData\Local\Programs\OpenAI\Codex\bin;;".to_owned(),
        ];
        let path = merged(own, more.into_iter());
        assert_eq!(
            path,
            r"C:\Windows\system32;C:\Program Files\Git\cmd\;C:\Users\roma\AppData\Local\Programs\OpenAI\Codex\bin"
        );
    }

    #[test]
    fn the_registry_s_path_holds_the_system_s_folders() {
        let path = with_registry(OsString::new());
        let folders: Vec<String> = std::env::split_paths(&path)
            .map(|folder| folder.to_string_lossy().to_lowercase())
            .collect();
        assert!(
            folders.iter().any(|folder| folder.ends_with(r"\system32")),
            "{folders:?}"
        );
        assert!(
            !folders.iter().any(|folder| folder.contains('%')),
            "{folders:?}"
        );
    }

    #[test]
    fn a_folder_the_user_s_path_gains_is_found_at_once() {
        // A key of its own stands for `HKCU\Environment`, which a test
        // leaves as it is.
        let user = format!(r"Software\Banda\test-{}", std::process::id());
        let key = CURRENT_USER.create(&user).unwrap();
        let installed = |path: &str| {
            key.set_expand_string("Path", path).unwrap();
            let found = with_keys(OsString::new(), &user);
            std::env::split_paths(&found).collect::<Vec<_>>()
        };
        let first = installed(r"C:\Tools\one");
        assert!(first.contains(&PathBuf::from(r"C:\Tools\one")), "{first:?}");
        let windows = std::env::var("SystemRoot").unwrap();
        let then = installed(r"C:\Tools\one;%SystemRoot%\banda-test");
        let expanded = PathBuf::from(format!(r"{windows}\banda-test"));
        assert!(then.contains(&expanded), "read again: {then:?}");
        drop(key);
        CURRENT_USER.remove_tree(&user).unwrap();
    }

    #[test]
    fn neither_the_store_s_aliases_nor_the_system_s_wsl_ever_run() {
        let folder = tempfile::tempdir().unwrap();
        let (system, installed) = (folder.path().join("System32"), folder.path().join("WSL"));
        for (at, name) in [
            (&system, "wsl.exe"),
            (&system, "bash.exe"),
            (&installed, "wsl.exe"),
        ] {
            std::fs::create_dir_all(at).unwrap();
            std::fs::write(at.join(name), "").unwrap();
        }
        assert!(!runnable(&system.join("wsl.exe")));
        assert!(!runnable(&system.join("BASH.EXE")));
        assert!(
            runnable(&installed.join("wsl.exe")),
            "an installed WSL's own"
        );
    }

    #[test]
    fn a_name_is_tried_with_each_extension_of_a_program() {
        let tried = names(PathBuf::from(r"C:\bin\npx"));
        assert!(
            tried.contains(&PathBuf::from(r"C:\bin\npx.cmd")),
            "{tried:?}"
        );
        assert!(
            tried.contains(&PathBuf::from(r"C:\bin\npx.exe")),
            "{tried:?}"
        );
        assert!(
            tried
                .iter()
                .all(|name| name.extension().is_some_and(starts))
        );
        let named = names(PathBuf::from(r"C:\bin\npx.CMD"));
        assert_eq!(named, [PathBuf::from(r"C:\bin\npx.CMD")]);
    }

    #[test]
    fn a_program_runs_by_its_extension_and_never_from_windows_apps() {
        let folder = tempfile::tempdir().unwrap();
        let apps = folder.path().join("Microsoft").join("WindowsApps");
        std::fs::create_dir_all(&apps).unwrap();
        for name in ["tool.exe", "tool.cmd", "notes.txt", "script.js"] {
            std::fs::write(folder.path().join(name), "").unwrap();
        }
        std::fs::write(apps.join("Claude.exe"), "").unwrap();
        assert!(runnable(&folder.path().join("tool.exe")));
        assert!(runnable(&folder.path().join("tool.cmd")));
        assert!(!runnable(&folder.path().join("notes.txt")));
        assert!(!runnable(&folder.path().join("script.js")));
        assert!(
            !runnable(&apps.join("Claude.exe")),
            "an alias of the Store's"
        );
        let path = std::env::join_paths([&apps, &folder.path().to_owned()]).unwrap();
        let found = crate::host::find("Claude", &path);
        assert_eq!(found, None, "the alias is passed over");
        let tool = crate::host::find("tool", &path).unwrap();
        assert!(
            tool.extension()
                .is_some_and(|extension| extension == "exe" || extension == "cmd"),
            "{}",
            tool.display()
        );
    }

    #[test]
    fn a_rename_waits_out_a_file_held_a_moment() {
        let folder = tempfile::tempdir().unwrap();
        let (from, to) = (folder.path().join("new"), folder.path().join("file"));
        std::fs::write(&from, "new").unwrap();
        std::fs::write(&to, "old").unwrap();
        // Open and shared with none, as an indexer may hold it.
        let held = std::fs::File::options()
            .read(true)
            .share_mode(0)
            .open(&to)
            .unwrap();
        let letting_go = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            drop(held);
        });
        crate::host::rename(&from, &to).unwrap();
        letting_go.join().unwrap();
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "new");
    }

    #[test]
    fn a_rename_that_cannot_be_made_fails_as_it_did() {
        let folder = tempfile::tempdir().unwrap();
        let gone = folder.path().join("gone");
        let error = crate::host::rename(&gone, &folder.path().join("to")).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
    }
}
