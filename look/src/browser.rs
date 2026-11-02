//! How the browser looks and searches (ADR 0013, decision 4): the
//! Person's `~/.config/banda/browser.toml`, over Banda's defaults. The
//! browser's switch writes `tabs` into it, as the sidebar's menu writes its
//! preset.
//!
//! It is this machine's, as the look is, so `banda look` resolves it with
//! the look, watches it with the look's files, and names its problems in
//! the same list. The window only draws what it says.

use crate::Problem;
use crate::file::OneFile;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::Path;
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
#[derive(Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct BrowserSettings {
    /// Where the tabs are: a row above the page, or a rail beside it.
    pub tabs: Option<Tabs>,
    /// Where words that are not an address go: an http or https address
    /// with %s where the words go. DuckDuckGo when left out.
    #[schemars(with = "Option<String>")]
    pub search: Option<Spanned<String>>,
    /// The extensions whose buttons sit in the row, by their IDs; the rest
    /// are behind the Extensions button. The row's menu writes it.
    pub pinned: Option<Vec<String>>,
    /// Whether Banda blocks ads and trackers in the browser, with
    /// EasyList, EasyPrivacy and uBlock Origin's lists. On when left out.
    pub blocker: Option<bool>,
}

/// How the browser looks and searches, every key resolved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Browser {
    pub tabs: Tabs,
    /// An address with `%s` where the words go.
    pub search: String,
    /// The extensions whose buttons sit in the row.
    pub pinned: Vec<String>,
    /// Whether ads and trackers are blocked.
    pub blocker: bool,
}

impl OneFile for BrowserSettings {
    const NAME: &'static str = "browser.toml";
    const TEMPLATE: &'static str = TEMPLATE;
    type Resolved = Browser;

    fn defaults() -> Self {
        BrowserSettings {
            tabs: Some(Tabs::default()),
            search: Some(Spanned::new(0..0, SEARCH.to_owned())),
            pinned: Some(Vec::new()),
            blocker: Some(true),
        }
    }

    fn over(self, under: Self) -> Self {
        BrowserSettings {
            tabs: self.tabs.or(under.tabs),
            search: self.search.or(under.search),
            pinned: self.pinned.or(under.pinned),
            blocker: self.blocker.or(under.blocker),
        }
    }

    fn resolved(self) -> Browser {
        Browser {
            tabs: self.tabs.unwrap_or_default(),
            search: self
                .search
                .map_or_else(|| SEARCH.to_owned(), Spanned::into_inner),
            pinned: self.pinned.unwrap_or_default(),
            blocker: self.blocker.unwrap_or(true),
        }
    }

    /// The search is an http or https address with `%s` in it.
    fn check(&mut self, path: &Path, text: &str, problems: &mut Vec<Problem>) {
        let Some(search) = &self.search else { return };
        let address = search.get_ref();
        let web = address.starts_with("https://") || address.starts_with("http://");
        if !web || !address.contains("%s") {
            problems.push(Problem::at(
                path,
                text,
                Some(search.span()),
                "search is an http or https address with %s where the words go",
            ));
            self.search = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::Places;

    fn resolved(text: Option<&str>) -> (Browser, Vec<Problem>) {
        let folder = tempfile::tempdir().unwrap();
        if let Some(text) = text {
            std::fs::write(folder.path().join("browser.toml"), text).unwrap();
        }
        let mut problems = Vec::new();
        let mut watched = Vec::new();
        let (browser, _) = crate::file::resolve::<BrowserSettings>(
            &Places::at(folder.path()),
            &mut problems,
            &mut watched,
        );
        assert_eq!(watched, vec![folder.path().join("browser.toml")]);
        (browser, problems)
    }

    #[test]
    fn no_file_is_tabs_on_top_and_duckduckgo() {
        let (browser, problems) = resolved(None);
        assert_eq!(browser.tabs, Tabs::Top);
        assert_eq!(browser.search, SEARCH);
        assert!(browser.blocker);
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
            "tabs = \"left\"\nsearch = \"https://kagi.com/search?q=%s\"\npinned = [\"abc\"]\nblocker = false\n",
        ));
        assert!(!browser.blocker);
        assert_eq!(browser.tabs, Tabs::Left);
        assert_eq!(browser.pinned, vec!["abc".to_owned()]);
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
