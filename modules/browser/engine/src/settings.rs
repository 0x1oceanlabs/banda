//! How the browser looks and searches (ADR 0013, decision 4): the
//! Person's `~/.config/banda/browser.toml`, over Banda's defaults. The
//! browser's switch writes `tabs` into it, as the sidebar's menu writes its
//! preset.
//!
//! It is this machine's, as the look is, so `banda look` resolves it with
//! the look, watches it with the look's files, and names its problems in
//! the same list: the look carries it as `files["browser.toml"]`. The
//! window only draws what it says.

use banda_look::{OneFile, Problem};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use toml::Spanned;
use ts_rs::TS;

/// Where a browser Pane shows its tabs.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "browser/")]
pub enum Tabs {
    /// A row above the page.
    #[default]
    Top,
    /// A rail of icons beside the page, opening to titles on hover.
    Left,
}

/// What the Person said of a site for every Agent (ADR 0029, decision 6):
/// Agents use it without asking, or never.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "browser/")]
pub enum SiteRule {
    /// Agents use it without asking.
    Allow,
    /// No Agent uses it, and none asks.
    Deny,
}

/// What Agents may do in the browser.
#[derive(Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct AgentsSettings {
    /// Whether Agents may use Banda's browser tools. Turning this off
    /// refuses new calls, including from Threads already open.
    pub enabled: Option<bool>,
    /// Whether Agents may request images of pages. Off when left out.
    /// Password and card fields are masked; other visible content is sent.
    pub screenshots: Option<bool>,
    /// The sites Agents may use without asking, or never, by site, as
    /// github.com, which covers its subdomains. Your answers on a tab
    /// write them; localhost never asks.
    pub sites: Option<BTreeMap<String, SiteRule>>,
}

/// The file as Banda writes it first, every default named.
pub const TEMPLATE: &str = include_str!("../browser.toml");

/// Banda's search, for words that are not an address.
pub const SEARCH: &str = "https://duckduckgo.com/?q=%s";

/// How Banda's browser shows its tabs, where it searches, and the sites
/// Agents may use. Every key is optional.
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
    /// What Agents may do in the browser.
    pub agents: Option<AgentsSettings>,
}

/// How the browser looks and searches, every key resolved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "browser/")]
pub struct Browser {
    pub tabs: Tabs,
    /// An address with `%s` where the words go.
    pub search: String,
    /// The extensions whose buttons sit in the row.
    pub pinned: Vec<String>,
    /// Whether ads and trackers are blocked.
    pub blocker: bool,
    /// What the Person said of each site for every Agent, by site.
    pub sites: BTreeMap<String, SiteRule>,
    pub tools: bool,
    pub screenshots: bool,
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
            agents: Some(AgentsSettings {
                enabled: Some(true),
                screenshots: Some(false),
                sites: Some(BTreeMap::new()),
            }),
        }
    }

    fn over(self, under: Self) -> Self {
        BrowserSettings {
            tabs: self.tabs.or(under.tabs),
            search: self.search.or(under.search),
            pinned: self.pinned.or(under.pinned),
            blocker: self.blocker.or(under.blocker),
            agents: match (self.agents, under.agents) {
                (Some(mine), Some(base)) => Some(AgentsSettings {
                    enabled: mine.enabled.or(base.enabled),
                    screenshots: mine.screenshots.or(base.screenshots),
                    sites: mine.sites.or(base.sites),
                }),
                (mine, base) => mine.or(base),
            },
        }
    }

    fn resolved(self) -> Browser {
        let agents = self.agents.unwrap_or_default();
        Browser {
            tabs: self.tabs.unwrap_or_default(),
            search: self
                .search
                .map_or_else(|| SEARCH.to_owned(), Spanned::into_inner),
            pinned: self.pinned.unwrap_or_default(),
            blocker: self.blocker.unwrap_or(true),
            sites: agents.sites.unwrap_or_default(),
            tools: agents.enabled.unwrap_or(true),
            screenshots: agents.screenshots.unwrap_or(false),
        }
    }

    /// The search is an http or https address with `%s` in it, and each
    /// site a bare name, as a page's host is: github.com.
    fn check(&mut self, path: &Path, text: &str, problems: &mut Vec<Problem>) {
        if let Some(sites) = self
            .agents
            .as_mut()
            .and_then(|agents| agents.sites.as_mut())
        {
            sites.retain(|site, _| {
                // As a page's host names it: lowercase, an IPv6 one in [].
                let bare = !site.is_empty()
                    && site.chars().all(|c| {
                        c.is_ascii_lowercase() || c.is_ascii_digit() || "-._:[]".contains(c)
                    });
                if !bare {
                    problems.push(Problem::of_key(
                        path,
                        "agents.sites",
                        format!("{site:?} is a site's bare name in lowercase, as github.com"),
                    ));
                }
                bare
            });
        }
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
    use banda_look::theme::Places;

    fn resolved(text: Option<&str>) -> (Browser, Vec<Problem>) {
        let folder = tempfile::tempdir().unwrap();
        if let Some(text) = text {
            std::fs::write(folder.path().join("browser.toml"), text).unwrap();
        }
        let mut problems = Vec::new();
        let mut watched = Vec::new();
        let (browser, _) = banda_look::file::resolve::<BrowserSettings>(
            &Places::at(folder.path()),
            &mut problems,
            &mut watched,
        );
        assert_eq!(watched, vec![folder.path().join("browser.toml")]);
        (browser, problems)
    }

    #[test]
    fn agent_tools_and_screenshots_are_independent_and_keep_sites() {
        let (defaults, problems) = resolved(None);
        assert!(defaults.tools);
        assert!(!defaults.screenshots);
        assert!(problems.is_empty());
        let (browser, problems) = resolved(Some(
            "[agents]\nenabled = false\nscreenshots = true\n[agents.sites]\n\"example.com\" = \"allow\"\n",
        ));
        assert!(!browser.tools);
        assert!(browser.screenshots);
        assert_eq!(browser.sites.get("example.com"), Some(&SiteRule::Allow));
        assert!(problems.is_empty());
    }

    #[test]
    fn an_agents_table_keeps_defaults_for_keys_it_does_not_set() {
        let mine: BrowserSettings = toml::from_str("[agents]\nscreenshots = true\n").unwrap();
        let merged = mine.over(BrowserSettings::defaults()).agents.unwrap();
        assert_eq!(merged.enabled, Some(true));
        assert_eq!(merged.screenshots, Some(true));
        assert_eq!(merged.sites, Some(BTreeMap::new()));
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
        assert!(browser.sites.is_empty());
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
    fn the_sites_are_bare_names_each_allowed_or_denied() {
        let (browser, problems) = resolved(Some(
            "[agents.sites]\n\"github.com\" = \"allow\"\n\"bank.example\" = \"deny\"\n\"https://x.com\" = \"allow\"\n",
        ));
        assert_eq!(
            browser.sites.into_iter().collect::<Vec<_>>(),
            vec![
                ("bank.example".to_owned(), SiteRule::Deny),
                ("github.com".to_owned(), SiteRule::Allow)
            ]
        );
        assert_eq!(problems.len(), 1);
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
