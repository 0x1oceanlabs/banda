//! What Files shows (ADR 0073, decision 13): the Person's
//! `~/.config/banda/files.toml`, over Banda's defaults. The places pinned,
//! whether hidden files and what git ignores show in a new Files Pane, and
//! the editor a file opens in, and whether the tree shows small pictures.
//! Pinning a folder in Files writes `pinned`
//! into it, as the browser's switch writes its tabs.
//!
//! It is this machine's, as the look is: the look resolves it, as
//! `files["files.toml"]`, and the window draws what it says.

use banda_look::{OneFile, Problem};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use ts_rs::TS;

/// The file as Banda writes it first, every default named.
pub const TEMPLATE: &str = include_str!("../files.toml");

/// What Files shows: its pinned places, and whether hidden and ignored
/// files show. Every key is optional.
#[derive(Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct FilesSettings {
    /// The folders pinned among Files' places, in their order: whole, or
    /// from ~, as ~/Pictures. A folder's menu in Files pins and unpins.
    pub pinned: Option<Vec<String>>,
    /// Whether a Files Pane shows hidden files, whose names start with a
    /// dot. Each Pane can show them or not for itself.
    pub hidden: Option<bool>,
    /// Whether a Files Pane shows what git ignores, greyed. Off hides it.
    pub ignored: Option<bool>,
    /// The editor a file opens in, by its id, as `zed` or `vscode`: Files'
    /// "Open in", and a path in a reply with Ctrl or ⌘. Empty is the first
    /// one found on this machine.
    pub editor: Option<String>,
    /// The previewer a file of an extension shows in, by its id, as
    /// `md = "files.code"`: what "Open with…" in a file's Pane picks. One
    /// that does not draw the file is passed over.
    pub previewers: Option<BTreeMap<String, String>>,
    /// Whether a row of the tree shows a picture's small picture in place
    /// of its icon. Off keeps the tree quiet; the Gallery shows them
    /// always.
    pub thumbnails: Option<bool>,
}

/// What Files shows, every key resolved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Finder {
    /// The folders pinned, as written: whole, or from `~`.
    pub pinned: Vec<String>,
    pub hidden: bool,
    pub ignored: bool,
    /// The editor's id; empty for the first one found.
    pub editor: String,
    /// The previewer's id, by an extension, lower case.
    pub previewers: BTreeMap<String, String>,
    pub thumbnails: bool,
}

impl OneFile for FilesSettings {
    const NAME: &'static str = "files.toml";
    const TEMPLATE: &'static str = TEMPLATE;
    type Resolved = Finder;

    fn defaults() -> Self {
        FilesSettings {
            pinned: Some(Vec::new()),
            hidden: Some(false),
            ignored: Some(true),
            editor: Some(String::new()),
            previewers: Some(BTreeMap::new()),
            thumbnails: Some(false),
        }
    }

    fn over(self, under: Self) -> Self {
        FilesSettings {
            pinned: self.pinned.or(under.pinned),
            hidden: self.hidden.or(under.hidden),
            ignored: self.ignored.or(under.ignored),
            editor: self.editor.or(under.editor),
            previewers: self.previewers.or(under.previewers),
            thumbnails: self.thumbnails.or(under.thumbnails),
        }
    }

    fn resolved(self) -> Finder {
        Finder {
            pinned: self.pinned.unwrap_or_default(),
            hidden: self.hidden.unwrap_or(false),
            ignored: self.ignored.unwrap_or(true),
            editor: self.editor.unwrap_or_default(),
            previewers: self.previewers.unwrap_or_default(),
            thumbnails: self.thumbnails.unwrap_or(false),
        }
    }

    /// Each pinned place is a whole path, or one from `~`; an extension is
    /// read in lower case, with no dot.
    fn check(&mut self, path: &Path, _text: &str, problems: &mut Vec<Problem>) {
        if let Some(previewers) = self.previewers.take() {
            self.previewers = Some(
                previewers
                    .into_iter()
                    .map(|(extension, id)| (extension.trim_start_matches('.').to_lowercase(), id))
                    .collect(),
            );
        }
        let Some(pinned) = self.pinned.as_mut() else {
            return;
        };
        pinned.retain(|place| {
            let whole = place.starts_with('/') || place == "~" || place.starts_with("~/");
            if !whole {
                problems.push(Problem::of_key(
                    path,
                    "pinned",
                    format!("{place:?} is a folder's whole path, or one from ~, as ~/Pictures"),
                ));
            }
            whole
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_look::theme::Places;

    fn resolved(text: Option<&str>) -> (Finder, Vec<Problem>) {
        let folder = tempfile::tempdir().unwrap();
        if let Some(text) = text {
            std::fs::write(folder.path().join("files.toml"), text).unwrap();
        }
        let mut problems = Vec::new();
        let mut watched = Vec::new();
        let (finder, _) = banda_look::file::resolve::<FilesSettings>(
            &Places::at(folder.path()),
            &mut problems,
            &mut watched,
        );
        assert_eq!(watched, vec![folder.path().join("files.toml")]);
        (finder, problems)
    }

    #[test]
    fn no_file_pins_nothing_hides_dotfiles_and_greys_what_git_ignores() {
        let (finder, problems) = resolved(None);
        assert_eq!(
            finder,
            Finder {
                pinned: Vec::new(),
                hidden: false,
                ignored: true,
                editor: String::new(),
                previewers: BTreeMap::new(),
                thumbnails: false,
            }
        );
        assert!(problems.is_empty());
    }

    #[test]
    fn the_template_is_the_defaults() {
        assert_eq!(resolved(Some(TEMPLATE)), resolved(None));
    }

    #[test]
    fn the_file_pins_places_and_shows_or_hides() {
        let (finder, problems) = resolved(Some(
            "pinned = [\"~/Pictures\", \"/srv/data\"]\nhidden = true\nignored = false\n",
        ));
        assert_eq!(finder.pinned, ["~/Pictures", "/srv/data"]);
        assert!(finder.hidden && !finder.ignored);
        assert!(problems.is_empty());
    }

    #[test]
    fn the_file_shows_small_pictures_in_the_tree() {
        let (finder, problems) = resolved(Some("thumbnails = true\n"));
        assert!(finder.thumbnails);
        assert!(problems.is_empty());
    }

    #[test]
    fn the_file_names_the_editor_a_file_opens_in() {
        let (finder, problems) = resolved(Some("editor = \"zed\"\n"));
        assert_eq!(finder.editor, "zed");
        assert!(problems.is_empty());
    }

    #[test]
    fn the_file_names_the_previewer_an_extension_shows_in() {
        let (finder, problems) = resolved(Some(
            "[previewers]\nmd = \"files.code\"\n\".SVG\" = \"files.page\"\n",
        ));
        assert_eq!(
            finder.previewers,
            BTreeMap::from([
                ("md".to_owned(), "files.code".to_owned()),
                ("svg".to_owned(), "files.page".to_owned()),
            ])
        );
        assert!(problems.is_empty());
    }

    #[test]
    fn a_pinned_place_that_is_not_a_whole_path_is_a_problem_and_left_out() {
        let (finder, problems) = resolved(Some("pinned = [\"Pictures\", \"~/Music\"]\n"));
        assert_eq!(finder.pinned, ["~/Music"]);
        assert_eq!(problems.len(), 1);
    }
}
