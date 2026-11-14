//! A machine's settings, read through its engine (ADR 0106, decision 7):
//! the part of each file that is the machine's own, as ADR 0101's decision
//! 3 classes it, so another device's window shows this machine's
//! Harnesses, accounts and what it sends, and nothing of this device's
//! own, nor of the Person's shared copy, leaves it.

use banda_kernel::{Refusal, Stream};
use banda_look::keyed::Keyed;
use banda_look::{Class, Places, Problem, SettingsFile};
use banda_settings::Settings;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::sync::{mpsc, watch};
use ts_rs::TS;

/// A settings file of this machine's to read.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "keys/")]
pub struct ReadSetting {
    /// The file's name, as `harnesses.toml`.
    pub file: String,
}

/// The machine's part of a settings file, as this machine has it now.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "keys/")]
pub struct SettingsRead {
    /// The file's name, as `agents.toml`.
    pub file: String,
    /// Where the file is on this machine, there or not yet: its config
    /// folder, which its system, its build and `BANDA_CONFIG` name, with
    /// the file's name. A window of another device shows it in place of
    /// opening the file, which it cannot.
    pub path: String,
    /// The file as the look resolves it, for a file it resolves: the
    /// machine's keys as the file says them, the rest as Banda has them.
    /// None for a file the look only checks, as the Harness list.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values: Option<Value>,
    /// Each key of the machine's, its value and where it comes from.
    pub keyed: Keyed,
    /// What is wrong in the file at the machine's keys, or in the file as
    /// a whole.
    pub problems: Vec<Problem>,
    /// What tells this read from another: the same while the machine's
    /// keys, their lines and what is wrong at them read the same, and
    /// for a file the look only checks, its text. A change of another
    /// key alone leaves it, unless the change moves the machine's lines.
    pub rev: String,
}

/// A settings file whose machine's part reads otherwise now.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "keys/")]
pub struct SettingChanged {
    /// The file's name, as `agents.toml`.
    pub file: String,
    /// Its read's `rev` now.
    pub rev: String,
}

/// The machine's part of the settings file `name` in `config`, or why
/// there is none to read.
pub fn read(settings: Settings, config: &Path, name: &str) -> Result<SettingsRead, Refusal> {
    let Some(file) = settings.file(name) else {
        return Err(Refusal::not_found(format!(
            "{name} is not one of Banda's settings files"
        )));
    };
    if !file.has(Class::Machine) {
        return Err(Refusal::invalid(format!(
            "{name} holds nothing of this machine's own: each window reads its own copy of it"
        )));
    }
    Ok(read_of(config, file))
}

fn read_of(config: &Path, file: &SettingsFile) -> SettingsRead {
    let part = file.part(&Places::at(config), Class::Machine);
    let said = serde_json::to_vec(&(&part.value, &part.keyed, &part.problems, &part.text));
    let digest = Sha256::digest(said.expect("settings are plain data"));
    SettingsRead {
        file: file.name.to_owned(),
        path: config.join(file.name).display().to_string(),
        values: part.value,
        keyed: part.keyed,
        problems: part.problems,
        rev: format!("{digest:x}")[..16].to_owned(),
    }
}

/// Each settings file with a part that is this machine's, and its `rev`
/// now.
pub fn revs(settings: Settings, config: &Path) -> Vec<SettingChanged> {
    (settings.files())
        .filter(|file| file.has(Class::Machine))
        .map(|file| SettingChanged {
            file: file.name.to_owned(),
            rev: read_of(config, file).rev,
        })
        .collect()
}

/// Each machine file's `rev`, first as it is now, then each one again as
/// its part reads otherwise; `heard` says when something in `config`
/// changed. A change of this device's own keys alone says nothing.
pub fn follow(settings: Settings, config: PathBuf, mut heard: watch::Receiver<()>) -> Stream {
    let (say, stream) = mpsc::channel(8);
    tokio::spawn(async move {
        let mut told: HashMap<String, String> = HashMap::new();
        loop {
            heard.mark_unchanged();
            let reading = config.clone();
            let Ok(now) = tokio::task::spawn_blocking(move || revs(settings, &reading)).await
            else {
                return;
            };
            for changed in now {
                if told.get(&changed.file) == Some(&changed.rev) {
                    continue;
                }
                told.insert(changed.file.clone(), changed.rev.clone());
                let Ok(piece) = serde_json::to_value(&changed) else {
                    return;
                };
                if say.send(piece).await.is_err() {
                    return;
                }
            }
            tokio::select! {
                changed = heard.changed() => if changed.is_err() {
                    return;
                },
                () = say.closed() => return,
            }
        }
    });
    stream
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::whole::WHOLE;
    use banda_kernel::Code;
    use serde_json::json;

    fn config_with(files: &[(&str, &str)]) -> tempfile::TempDir {
        let config = tempfile::tempdir().unwrap();
        for (name, text) in files {
            std::fs::write(config.path().join(name), text).unwrap();
        }
        config
    }

    #[test]
    fn a_machine_file_is_read_whole() {
        let config = config_with(&[("sharing.toml", "problems = true\n")]);
        let read = read(WHOLE, config.path(), "sharing.toml").unwrap();
        assert_eq!(read.file, "sharing.toml");
        assert_eq!(
            read.values,
            Some(json!({ "problems": true, "usage": false }))
        );
        let problems = &read.keyed["problems"];
        assert_eq!(
            (problems.from.layer.as_str(), problems.from.line),
            ("file", Some(1))
        );
        assert_eq!(read.keyed["usage"].from.layer, "defaults");
        assert!(read.problems.is_empty());
        assert_eq!(read.rev.len(), 16);
    }

    #[test]
    fn of_a_file_of_two_classes_only_the_machine_s_part_is_read() {
        let browser = "search = \"https://kagi.com/?q=%s\"\ntabs = 3\n\n\
                       [agents]\nscreenshots = \"no\"\nsites.github = \"allow\"\n";
        let config = config_with(&[("browser.toml", browser)]);
        let read = read(WHOLE, config.path(), "browser.toml").unwrap();
        let keys: Vec<&String> = read.keyed.keys().collect();
        assert!(
            keys.iter().all(|key| key.starts_with("agents.")),
            "{keys:?}"
        );
        assert_eq!(read.keyed["agents.sites.github"].from.line, Some(6));
        let values = read.values.unwrap();
        assert_eq!(values["sites"], json!({ "github": "allow" }));
        // This device's search is Banda's here, not the file's.
        assert_eq!(values["search"], json!("https://duckduckgo.com/?q=%s"));
        let said: Vec<_> = (read.problems.iter())
            .map(|problem| (problem.key.as_deref(), problem.line))
            .collect();
        assert_eq!(said, [(Some("agents.screenshots"), Some(5))]);
    }

    #[test]
    fn the_harness_list_is_read_for_its_problems_alone() {
        let config = config_with(&[("harnesses.toml", "[[harness]]\nid = \"x\"\n")]);
        let read = read(WHOLE, config.path(), "harnesses.toml").unwrap();
        assert_eq!(read.values, None);
        assert!(read.keyed.is_empty());
        assert_eq!(read.problems.len(), 1, "{:?}", read.problems);
    }

    #[test]
    fn a_read_says_where_its_file_is_there_or_not() {
        // A Harness list with no problems and a file not written yet name
        // their path nowhere else.
        let config = config_with(&[("harnesses.toml", "[[harness]]\nid = \"claude\"\n")]);
        for name in ["harnesses.toml", "machine.toml"] {
            let read = read(WHOLE, config.path(), name).unwrap();
            assert!(read.problems.is_empty(), "{name}: {:?}", read.problems);
            let named = (read.keyed.values()).any(|setting| setting.from.path.is_some());
            assert!(!named, "{name}");
            let path = config.path().join(name).display().to_string();
            assert_eq!(read.path, path, "{name}");
        }
    }

    #[test]
    fn a_file_with_nothing_of_the_machine_s_is_refused() {
        let config = tempfile::tempdir().unwrap();
        for name in ["look.toml", "keys.toml", "sidebar.toml", "terminal.toml"] {
            let refused = read(WHOLE, config.path(), name).unwrap_err();
            assert_eq!(refused.code, Code::Invalid, "{name}");
            assert!(refused.message.contains("each window reads its own copy"));
        }
        let unknown = read(WHOLE, config.path(), "hosts.toml").unwrap_err();
        assert_eq!(unknown.code, Code::NotFound);
    }

    #[test]
    fn a_rev_changes_with_the_machine_s_part_alone() {
        let config = config_with(&[("files.toml", "editor = \"vim\"\npinned = [\"/a\"]\n")]);
        let rev = |config: &Path| read(WHOLE, config, "files.toml").unwrap().rev;
        let before = rev(config.path());
        assert_eq!(rev(config.path()), before, "the same, read again");
        // This device's editor, on its own line, changes.
        std::fs::write(
            config.path().join("files.toml"),
            "editor = \"zed\"\npinned = [\"/a\"]\n",
        )
        .unwrap();
        assert_eq!(rev(config.path()), before);
        std::fs::write(
            config.path().join("files.toml"),
            "editor = \"zed\"\npinned = [\"/b\"]\n",
        )
        .unwrap();
        assert_ne!(rev(config.path()), before);
    }

    #[test]
    fn a_harness_list_s_rev_changes_with_its_text() {
        let one = "[[harness]]\nid = \"claude\"\n";
        let config = config_with(&[("harnesses.toml", one)]);
        let before = read(WHOLE, config.path(), "harnesses.toml").unwrap();
        assert!(before.problems.is_empty(), "{:?}", before.problems);
        let two = "[[harness]]\nid = \"claude\"\nenabled = false\n\n\
                   [[harness]]\nid = \"codex\"\n";
        std::fs::write(config.path().join("harnesses.toml"), two).unwrap();
        let after = read(WHOLE, config.path(), "harnesses.toml").unwrap();
        assert!(after.problems.is_empty(), "{:?}", after.problems);
        assert_ne!(after.rev, before.rev, "the list it checks alone changed");
    }

    #[test]
    fn every_file_with_a_machine_s_part_has_a_rev() {
        let config = tempfile::tempdir().unwrap();
        let mut files: Vec<String> = (revs(WHOLE, config.path()).into_iter())
            .map(|changed| changed.file)
            .collect();
        files.sort();
        assert_eq!(
            files,
            [
                "agents.toml",
                "browser.toml",
                "files.toml",
                "harnesses.toml",
                "machine.toml",
                "sharing.toml",
            ]
        );
    }
}
