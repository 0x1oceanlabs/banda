//! The Tiling's file, `~/.config/banda/tiling.toml`: how the Tiling
//! behaves, as the Person chooses (ADR 0127, decision 4). It holds the
//! Flow, and rules by kind of Pane: how wide a new column for one opens,
//! and where it opens when no one named a place.
//!
//! The engine reads it as a Pane opens ([`read`]), so a key, an Agent and
//! `banda` get the same answer, and `placing` decides by it. A client that
//! draws ahead takes the same file from the look, as `files["tiling.toml"]`,
//! and gives its copy of the rule the same.
//!
//! The Flow was `agents.toml`'s before: what that file still says is read
//! while this one does not say it (ADR 0069 grace).

use banda_look::columns::share;
use banda_look::keyed::{Moved, Renamed, spans_in};
use banda_look::{OneFile, Problem};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use toml::Spanned;
use ts_rs::TS;

/// The file's name in the config folder.
pub const NAME: &str = "tiling.toml";

/// The file as Banda writes it first, every default named.
pub const TEMPLATE: &str = include_str!("../tiling.toml");

/// How an Agent's windows stand, its Flow (ADR 0079): where its Thread
/// opens, and what a pick of it shows.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "workspaces/")]
pub enum Flow {
    /// Where the window has it: beside the Pane in front, and a pick goes
    /// to wherever its Pane is. `off` before ADR 0079 (grace).
    #[serde(alias = "off")]
    Free,
    /// Each Project on its own workspace, its Agents in a row, a pick at
    /// the left (ADR 0065, ADR 0102). `project` before ADR 0079, `space`
    /// before ADR 0069 (grace).
    #[default]
    #[serde(alias = "project")]
    #[serde(alias = "space")]
    Row,
    /// As the row, and what has the focus fills the screen (ADR 0102).
    Solo,
}

impl From<Flow> for crate::placing::Flow {
    /// Solo is each client's view of the row (ADR 0087, decision 10).
    fn from(flow: Flow) -> Self {
        match flow {
            Flow::Free => Self::Free,
            Flow::Row | Flow::Solo => Self::Row,
        }
    }
}

/// Where a Pane opens when no one named a place, as a rule of its kind
/// says. Each is a place `placing` gives already: a rule chooses among
/// them, by the Pane in front.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "workspaces/")]
pub enum Opens {
    /// Right of the Pane in front, in a column of its own.
    Beside,
    /// Under the Pane in front, in its column.
    Below,
    /// In the Group of the Pane in front, which starts one when it is in
    /// none (ADR 0065).
    Group,
    /// Last on its Project's workspace, in the row, as a Thread opens (ADR
    /// 0102).
    Project,
}

/// A rule for one kind of Pane, as the file says it. Every key is
/// optional: what a rule leaves out is as the kind's App and the Flow say.
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RuleSettings {
    /// A new column's width for a Pane of this kind: a share of the
    /// screen, such as "1/3", or "1" for all of it.
    #[schemars(with = "Option<String>")]
    pub width: Option<Spanned<String>>,
    /// Where a Pane of this kind opens when no one named a place: "beside",
    /// right of the Pane in front; "below", under it, in its column;
    /// "group", in its Group; or "project", last on its Project's
    /// workspace, in the row. With no Pane in front, and in the row from a
    /// workspace of another Project, it opens as the Flow says.
    pub opens: Option<Opens>,
}

/// How the Tiling behaves. Every key is optional.
#[derive(Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TilingSettings {
    /// The Flow (ADR 0079). `flow` in agents.toml before ADR 0127 (grace).
    pub flow: Option<Flow>,
    /// Rules by kind of Pane, each a table named by the kind:
    /// `[rule.terminal.terminal]` is the rule of `terminal.terminal`.
    pub rule: Option<BTreeMap<String, BTreeMap<String, RuleSettings>>>,
}

/// A rule for one kind of Pane, resolved.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "workspaces/")]
pub struct Rule {
    /// A new column's width for a Pane of this kind, a share of the screen.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<String>,
    /// Where a Pane of this kind opens when no one named a place.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opens: Option<Opens>,
}

/// How the Tiling behaves, every key resolved.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "workspaces/")]
pub struct Tiling {
    pub flow: Flow,
    /// The rules, by kind of Pane: `terminal.terminal`.
    pub rules: BTreeMap<String, Rule>,
}

impl OneFile for TilingSettings {
    const NAME: &'static str = NAME;
    const TEMPLATE: &'static str = TEMPLATE;
    const RENAMED: &'static [Renamed] = &[
        Renamed::value("flow", "off", "free"),
        Renamed::value("flow", "project", "row"),
        Renamed::value("flow", "space", "row"),
    ];
    const MOVED: &'static [Moved] = &[
        Moved {
            file: "agents.toml",
            was: "flow",
            now: "flow",
        },
        // Its name there before ADR 0079.
        Moved {
            file: "agents.toml",
            was: "workspaces",
            now: "flow",
        },
    ];
    type Resolved = Tiling;

    fn defaults() -> Self {
        TilingSettings {
            flow: Some(Flow::default()),
            rule: None,
        }
    }

    fn over(self, under: Self) -> Self {
        TilingSettings {
            flow: self.flow.or(under.flow),
            rule: self.rule.or(under.rule),
        }
    }

    fn resolved(self) -> Tiling {
        let rules = (self.rule.into_iter().flatten())
            .flat_map(|(app, panes)| {
                panes.into_iter().map(move |(pane, rule)| {
                    let rule = Rule {
                        width: rule.width.map(Spanned::into_inner),
                        opens: rule.opens,
                    };
                    (format!("{app}.{pane}"), rule)
                })
            })
            .filter(|(_, rule)| *rule != Rule::default())
            .collect();
        Tiling {
            flow: self.flow.unwrap_or_default(),
            rules,
        }
    }

    /// A width that is no share of the screen is named and left out; the
    /// rest of its rule still holds.
    fn check(&mut self, path: &Path, text: &str, problems: &mut Vec<Problem>) {
        let rules = self.rule.iter_mut().flatten();
        for rule in rules.flat_map(|(_, panes)| panes.values_mut()) {
            if let Some(width) = rule.width.take_if(|width| share(width.get_ref()).is_none()) {
                let says = "width is a share of the screen, such as \"1/3\", \"2/5\" or \"1\"";
                problems.push(Problem::at(path, text, Some(width.span()), says));
            }
        }
    }
}

/// How the Tiling behaves on this machine, as the `tiling.toml` in
/// `config` says now, read when asked, so a change holds from the next
/// Pane with nothing to follow. A file that is not there says nothing; a
/// wrong key is logged and left out, as the look leaves it out.
pub fn read(config: &Path) -> Tiling {
    banda_look::file::resolved_at::<TilingSettings>(&config.join(NAME))
}

/// What is wrong in `text`, the file at `path`, that the file alone cannot
/// say: a rule of a kind of Pane that none of `kinds` is. The rule does
/// nothing, as no such Pane opens.
pub fn unknown_kinds(path: &Path, text: &str, kinds: &BTreeSet<String>) -> Vec<Problem> {
    let mut problems = Vec::new();
    for (app, _) in spans_in(text, &["rule"]) {
        for (pane, span) in spans_in(text, &["rule", &app]) {
            let kind = format!("{app}.{pane}");
            if kinds.contains(&kind) {
                continue;
            }
            let says = format!("rule.{kind}: no kind of Pane here is called {kind}");
            problems.push(Problem {
                key: Some(format!("rule.{kind}")),
                ..Problem::at(path, text, Some(span), says)
            });
        }
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_look::Places;
    use banda_look::keyed::Keyed;

    fn resolved(tiling: Option<&str>, agents: Option<&str>) -> (Tiling, Keyed, Vec<Problem>) {
        let folder = tempfile::tempdir().unwrap();
        for (name, text) in [(NAME, tiling), ("agents.toml", agents)] {
            if let Some(text) = text {
                std::fs::write(folder.path().join(name), text).unwrap();
            }
        }
        let (mut problems, mut watched) = (Vec::new(), Vec::new());
        let (tiling, keyed) = banda_look::file::resolve::<TilingSettings>(
            &Places::at(folder.path()),
            &mut problems,
            &mut watched,
        );
        assert_eq!(tiling, read(folder.path()), "the engine reads the same");
        (tiling, keyed, problems)
    }

    #[test]
    fn the_flow_is_the_row_unless_the_file_says_another() {
        let (tiling, keyed, problems) = resolved(None, None);
        assert_eq!(tiling, Tiling::default());
        assert_eq!(tiling.flow, Flow::Row);
        assert_eq!(keyed["flow"].from.layer, "defaults");
        assert!(problems.is_empty());
        let (tiling, _, problems) = resolved(Some(TEMPLATE), None);
        assert_eq!(tiling, Tiling::default(), "the template says the defaults");
        assert!(problems.is_empty(), "{problems:?}");
        let (tiling, keyed, _) = resolved(Some("\nflow = \"solo\"\n"), None);
        assert_eq!(tiling.flow, Flow::Solo);
        assert_eq!(keyed["flow"].from.line, Some(2));
    }

    #[test]
    fn the_template_s_rule_reads_once_its_lines_are_said() {
        let said: String = TEMPLATE
            .lines()
            .map(|line| line.strip_prefix("# ").unwrap_or(line).to_owned() + "\n")
            .filter(|line| line.starts_with('[') || line.contains(" = "))
            .collect();
        let (tiling, _, problems) = resolved(Some(&said), None);
        assert!(problems.is_empty(), "{problems:?}\n{said}");
        let rule = Rule {
            width: Some("1/3".to_owned()),
            opens: Some(Opens::Beside),
        };
        assert_eq!(
            tiling.rules,
            BTreeMap::from([("terminal.terminal".to_owned(), rule)])
        );
    }

    #[test]
    fn what_agents_toml_still_says_of_the_flow_is_read_while_this_file_does_not_say_it() {
        let (tiling, keyed, problems) =
            resolved(None, Some("enter = \"queue\"\nflow = \"free\"\n"));
        assert_eq!(tiling.flow, Flow::Free);
        assert!(problems.is_empty(), "{problems:?}");
        let from = &keyed["flow"].from;
        assert_eq!((from.layer.as_str(), from.line), ("file", Some(2)));
        assert!(from.path.as_deref().unwrap().ends_with("agents.toml"));
        // Under its names from before ADR 0079 too.
        let (tiling, _, _) = resolved(None, Some("workspaces = \"off\"\n"));
        assert_eq!(tiling.flow, Flow::Free);
        // This file's own word wins, and a rule alone leaves the Flow there.
        let (tiling, keyed, _) = resolved(Some("flow = \"solo\"\n"), Some("flow = \"free\"\n"));
        assert_eq!(tiling.flow, Flow::Solo);
        assert!(keyed["flow"].from.path.as_deref().unwrap().ends_with(NAME));
        let rule = "[rule.git.diff]\nopens = \"below\"\n";
        let (tiling, _, _) = resolved(Some(rule), Some("flow = \"free\"\n"));
        assert_eq!(tiling.flow, Flow::Free);
        assert_eq!(tiling.rules["git.diff"].opens, Some(Opens::Below));
        // What does not read there says nothing here.
        let (tiling, _, problems) = resolved(None, Some("flow = \"sideways\"\n"));
        assert_eq!(tiling.flow, Flow::Row);
        assert!(problems.is_empty(), "{problems:?}");
    }

    #[test]
    fn a_rule_holds_a_width_and_where_its_kind_opens() {
        let text = "[rule.terminal.terminal]\nwidth = \"1/3\"\n\n\
                    [rule.git.diff]\nopens = \"group\"\nwidth = \" 2/3 \"\n\n\
                    [rule.files.tree]\n";
        let (tiling, keyed, problems) = resolved(Some(text), None);
        assert!(problems.is_empty(), "{problems:?}");
        let kinds: Vec<_> = tiling.rules.keys().map(String::as_str).collect();
        assert_eq!(
            kinds,
            ["git.diff", "terminal.terminal"],
            "one that sets nothing is none"
        );
        assert_eq!(
            tiling.rules["terminal.terminal"].width.as_deref(),
            Some("1/3")
        );
        assert_eq!(tiling.rules["terminal.terminal"].opens, None);
        assert_eq!(tiling.rules["git.diff"].opens, Some(Opens::Group));
        assert_eq!(keyed["rule.git.diff.opens"].from.line, Some(5));
    }

    #[test]
    fn a_wrong_value_is_named_and_left_out_and_the_rest_holds() {
        let text = "[rule.terminal.terminal]\nwidth = \"wide\"\nopens = \"beside\"\n\n\
                    [rule.git.diff]\nopens = \"sideways\"\nwidth = \"1/2\"\n";
        let (tiling, _, problems) = resolved(Some(text), None);
        let said: Vec<_> = (problems.iter())
            .map(|problem| (problem.key.as_deref(), problem.line))
            .collect();
        assert_eq!(
            said,
            [
                (Some("rule.git.diff.opens"), Some(6)),
                (Some("rule.terminal.terminal.width"), Some(2)),
            ]
        );
        let terminal = &tiling.rules["terminal.terminal"];
        assert_eq!(
            (terminal.width.as_deref(), terminal.opens),
            (None, Some(Opens::Beside))
        );
        let diff = &tiling.rules["git.diff"];
        assert_eq!((diff.width.as_deref(), diff.opens), (Some("1/2"), None));
        // A key no rule has is named too.
        let (_, _, problems) = resolved(Some("[rule.git.diff]\nheight = \"1/2\"\n"), None);
        assert_eq!(problems.len(), 1, "{problems:?}");
    }

    #[test]
    fn an_old_name_of_a_flow_reads_and_is_told() {
        let (tiling, _, problems) = resolved(Some("flow = \"project\"\n"), None);
        assert_eq!(tiling.flow, Flow::Row);
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(problems[0].message.contains("\"row\""));
    }

    #[test]
    fn a_rule_of_a_kind_no_app_has_is_named_at_its_line() {
        let kinds = BTreeSet::from(["terminal.terminal".to_owned()]);
        let path = Path::new("/c/tiling.toml");
        let text = "flow = \"row\"\n\n[rule.terminal.terminal]\nwidth = \"1/3\"\n\n\
                    [rule.terminal.shell]\nwidth = \"1/3\"\n\n[rule.nobody]\n";
        let problems = unknown_kinds(path, text, &kinds);
        let said: Vec<_> = (problems.iter())
            .map(|problem| (problem.key.as_deref(), problem.line))
            .collect();
        assert_eq!(said, [(Some("rule.terminal.shell"), Some(6))]);
        assert!(problems[0].message.contains("terminal.shell"));
        assert!(
            unknown_kinds(path, "rule = \n", &kinds).is_empty(),
            "not TOML"
        );
    }
}
