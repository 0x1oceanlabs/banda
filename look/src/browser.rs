//! How the browser looks and searches (ADR 0013, decision 4): the
//! Person's `~/.config/banda/browser.toml`, over Banda's defaults. The
//! browser's switch writes `tabs` into it, as the sidebar's menu writes its
//! preset.
//!
//! It is this machine's, as the look is, so `banda look` resolves it with
//! the look, watches it with the look's files, and names its problems in
//! the same list. The window only draws what it says.

use crate::Problem;
use crate::theme::Places;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use toml::Spanned;
use ts_rs::TS;

/// Where a browser Pane shows its tabs.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum Tabs {
    /// A row above the page.
    #[default]
    Top,
    /// A rail of icons beside the page, opening to titles on hover.
    Left,
}

/// The file as Banda writes it first, every default named.
pub const TEMPLATE: &str = include_str!("../browser.toml");

/// Banda's search, for words that are not an address.
pub const SEARCH: &str = "https://duckduckgo.com/?q=%s";

/// How Banda's browser shows its tabs and where it searches. Every key is
/// optional.
#[derive(Debug, Default, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct BrowserSettings {
    /// Where the tabs are: a row above the page, or a rail beside it.
    pub tabs: Option<Tabs>,
    /// Where words that are not an address go: an http or https address
    /// with %s where the words go. DuckDuckGo when left out.
    #[schemars(with = "Option<String>")]
    pub search: Option<Spanned<String>>,
}

/// How the browser looks and searches, every key resolved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Browser {
    /// The file the switch writes into.
    pub file: String,
    pub tabs: Tabs,
    /// An address with `%s` where the words go.
    pub search: String,
}

/// Reads a `browser.toml`. A key that is wrong goes to `problems` and is
/// left out; `None` when the file cannot be read as the schema at all.
pub fn read_browser(
    path: &Path,
    text: &str,
    problems: &mut Vec<Problem>,
) -> Option<BrowserSettings> {
    let mut settings: BrowserSettings = match toml::from_str(text) {
        Ok(settings) => settings,
        Err(error) => {
            problems.push(Problem::toml(path, text, &error));
            return None;
        }
    };
    if let Some(search) = &settings.search {
        let address = search.get_ref();
        let web = address.starts_with("https://") || address.starts_with("http://");
        if !web || !address.contains("%s") {
            problems.push(Problem::at(
                path,
                text,
                Some(search.span()),
                "search is an http or https address with %s where the words go",
            ));
            settings.search = None;
        }
    }
    Some(settings)
}

/// The browser's settings on this machine; `browser.toml` is watched.
pub fn resolve(
    places: &Places,
    problems: &mut Vec<Problem>,
    watched: &mut Vec<PathBuf>,
) -> Browser {
    let file = places.browser_file();
    watched.push(file.clone());
    let mine = std::fs::read_to_string(&file)
        .ok()
        .and_then(|text| read_browser(&file, &text, problems))
        .unwrap_or_default();
    Browser {
        file: file.display().to_string(),
        tabs: mine.tabs.unwrap_or_default(),
        search: mine
            .search
            .map_or_else(|| SEARCH.to_owned(), Spanned::into_inner),
    }
}

/// Whether `banda look check` reads `path` as a `browser.toml`.
pub fn is_browser_file(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n == "browser.toml")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn places(config: &Path) -> Places {
        Places {
            config: config.to_owned(),
            omarchy_current: None,
            omarchy_themes: Vec::new(),
            fontconfig: None,
        }
    }

    fn resolved(text: Option<&str>) -> (Browser, Vec<Problem>) {
        let folder = tempfile::tempdir().unwrap();
        if let Some(text) = text {
            std::fs::write(folder.path().join("browser.toml"), text).unwrap();
        }
        let mut problems = Vec::new();
        let mut watched = Vec::new();
        let browser = resolve(&places(folder.path()), &mut problems, &mut watched);
        assert_eq!(watched, vec![folder.path().join("browser.toml")]);
        (browser, problems)
    }

    #[test]
    fn no_file_is_tabs_on_top_and_duckduckgo() {
        let (browser, problems) = resolved(None);
        assert_eq!(browser.tabs, Tabs::Top);
        assert_eq!(browser.search, SEARCH);
        assert!(problems.is_empty());
    }

    #[test]
    fn the_template_is_the_defaults() {
        let (browser, problems) = resolved(Some(TEMPLATE));
        assert_eq!((browser.tabs, browser.search.as_str()), (Tabs::Top, SEARCH));
        assert!(problems.is_empty());
    }

    #[test]
    fn the_file_chooses_the_tabs_and_the_search() {
        let (browser, problems) = resolved(Some(
            "tabs = \"left\"\nsearch = \"https://kagi.com/search?q=%s\"\n",
        ));
        assert_eq!(browser.tabs, Tabs::Left);
        assert_eq!(browser.search, "https://kagi.com/search?q=%s");
        assert!(problems.is_empty());
    }

    #[test]
    fn a_search_without_its_words_is_a_problem_and_left_out() {
        let (browser, problems) =
            resolved(Some("tabs = \"left\"\nsearch = \"https://kagi.com\"\n"));
        assert_eq!(browser.tabs, Tabs::Left);
        assert_eq!(browser.search, SEARCH);
        assert_eq!(problems.len(), 1);
        assert_eq!(problems[0].line, Some(2));
    }

    #[test]
    fn an_unknown_key_or_side_is_a_problem() {
        let (browser, problems) = resolved(Some("tabs = \"right\"\n"));
        assert_eq!(browser.tabs, Tabs::Top);
        assert_eq!(problems.len(), 1);
        let (_, problems) = resolved(Some("tab = \"left\"\n"));
        assert_eq!(problems.len(), 1);
    }
}
