//! What runs in front in a terminal, and where: the process group the
//! terminal gives what is typed, read as tmux names a window. Its words and
//! folder come from the system: `/proc` on Linux, the kernel's process
//! arguments and `proc_pidinfo` on macOS, which `sysinfo` reads.

use crate::model::Title;
use std::os::fd::OwnedFd;
use std::path::{Path, PathBuf};

/// Programs that run a script: the script names what runs.
const RUNNERS: [&str; 7] = ["node", "bun", "deno", "python", "python3", "ruby", "perl"];
/// The most characters a title's program has.
const LONGEST: usize = 80;

/// A shell's terminal, looked at again and again.
pub struct Front {
    /// The PTY's own end.
    pty: OwnedFd,
    /// The shell's process group: in front, it may have moved to another
    /// folder since.
    shell: Option<i32>,
    home: Option<PathBuf>,
    seen: Option<(i32, Title)>,
    reader: Reader,
}

impl Front {
    pub fn new(pty: OwnedFd, shell: Option<i32>) -> Front {
        Front {
            pty,
            shell,
            home: dirs::home_dir(),
            seen: None,
            reader: Reader::new(),
        }
    }

    /// What runs in front now, if it can tell. A program other than the
    /// shell keeps its words and folder while it runs, so the system is
    /// asked only when another one comes to the front.
    pub fn look(&mut self) -> Option<Title> {
        let group = rustix::termios::tcgetpgrp(&self.pty).ok()?.as_raw_pid();
        if let Some((seen, title)) = &self.seen
            && *seen == group
            && Some(group) != self.shell
        {
            return Some(title.clone());
        }
        let title = self.read(group)?;
        self.seen = Some((group, title.clone()));
        Some(title)
    }

    /// What `process` runs and where.
    fn read(&mut self, process: i32) -> Option<Title> {
        let (words, folder) = self.reader.read(process)?;
        Some(Title {
            program: program_of(&words)?,
            folder: shown(&folder, self.home.as_deref()),
        })
    }
}

/// Reads a process's words and folder from `/proc`.
#[cfg(not(target_os = "macos"))]
struct Reader;

#[cfg(not(target_os = "macos"))]
impl Reader {
    fn new() -> Reader {
        Reader
    }

    fn read(&mut self, process: i32) -> Option<(Vec<String>, PathBuf)> {
        let line = std::fs::read(format!("/proc/{process}/cmdline")).ok()?;
        let words = line
            .split(|byte| *byte == 0)
            .filter(|word| !word.is_empty())
            .map(|word| String::from_utf8_lossy(word).into_owned())
            .collect();
        let folder = std::fs::read_link(format!("/proc/{process}/cwd")).ok()?;
        Some((words, folder))
    }
}

/// Reads a process's words and folder as macOS gives them, through
/// `sysinfo`: the engine has no unsafe code of its own.
#[cfg(target_os = "macos")]
struct Reader {
    /// None where `sysinfo` cannot read this system.
    system: Option<sysinfo::System>,
    /// The process read last, forgotten once it is gone.
    last: Option<sysinfo::Pid>,
}

#[cfg(target_os = "macos")]
impl Reader {
    fn new() -> Reader {
        Reader {
            system: sysinfo::System::new().ok(),
            last: None,
        }
    }

    fn read(&mut self, process: i32) -> Option<(Vec<String>, PathBuf)> {
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, UpdateKind};
        let system = self.system.as_mut()?;
        let pid = Pid::from_u32(u32::try_from(process).ok()?);
        let asked = match self.last.replace(pid) {
            Some(last) if last != pid => vec![pid, last],
            _ => vec![pid],
        };
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&asked),
            true,
            ProcessRefreshKind::nothing()
                .with_cmd(UpdateKind::Always)
                .with_cwd(UpdateKind::Always)
                .without_tasks(),
        );
        let found = system.process(pid)?;
        let words = found
            .cmd()
            .iter()
            .map(|word| word.to_string_lossy().into_owned())
            .collect();
        Some((words, found.cwd()?.to_path_buf()))
    }
}

/// A command line in a few words: `-bash` is `bash`, a script stands for
/// the program that runs it.
fn program_of(words: &[String]) -> Option<String> {
    let (first, rest) = words.split_first()?;
    let name = base(first.trim_start_matches('-'));
    let (name, rest) = match rest.split_first() {
        Some((script, after)) if RUNNERS.contains(&name) && !script.starts_with('-') => {
            (base(script), after)
        }
        _ => (name, rest),
    };
    let line = std::iter::once(name)
        .chain(rest.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(" ");
    Some(if line.chars().count() > LONGEST {
        let cut: String = line.chars().take(LONGEST - 1).collect();
        format!("{cut}…")
    } else {
        line
    })
}

fn base(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// A folder as a Person writes it: `~/code` for one in their home.
fn shown(folder: &Path, home: Option<&Path>) -> String {
    match home.and_then(|home| folder.strip_prefix(home).ok()) {
        Some(inside) if inside.as_os_str().is_empty() => "~".to_owned(),
        Some(inside) => format!("~/{}", inside.display()),
        None => folder.display().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn program(words: &[&str]) -> String {
        let words: Vec<String> = words.iter().map(|w| (*w).to_owned()).collect();
        program_of(&words).unwrap()
    }

    #[test]
    fn a_script_stands_for_the_program_that_runs_it() {
        assert_eq!(program(&["node", "/usr/bin/pnpm", "dev"]), "pnpm dev");
        assert_eq!(
            program(&["/usr/bin/python3", "-m", "http.server"]),
            "python3 -m http.server"
        );
        assert_eq!(program(&["-bash"]), "bash");
        assert_eq!(program(&["/usr/bin/vim", "src/main.rs"]), "vim src/main.rs");
    }

    #[test]
    fn a_long_command_is_cut() {
        let long = "x".repeat(200);
        assert_eq!(program(&["echo", &long]).chars().count(), LONGEST);
    }

    #[test]
    fn a_folder_in_home_starts_with_a_tilde() {
        let home = Some(Path::new("/home/roma"));
        assert_eq!(shown(Path::new("/home/roma"), home), "~");
        assert_eq!(
            shown(Path::new("/home/roma/code/banda"), home),
            "~/code/banda"
        );
        assert_eq!(shown(Path::new("/home/romb"), home), "/home/romb");
        assert_eq!(shown(Path::new("/etc"), None), "/etc");
    }
}
