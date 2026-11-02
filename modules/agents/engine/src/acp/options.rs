//! A session's options and modes: what it runs with, and how a Thread's
//! settings become them. They become the session's options when a turn
//! starts ([`Session::settle`]): the mode maps onto the Harness's own modes
//! where it has Claude Code's or Codex's, never freer than the one chosen.

use super::*;

/// What a session runs with, as the Harness last said.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Running {
    /// The Harness has modes of its own and enforces the Thread's mode.
    pub native: bool,
    /// The mode it runs in, when that is one of Banda's.
    pub mode: Option<Mode>,
    /// It plans before it changes anything.
    pub plan: bool,
    /// Its options, and whether it can plan. Its slash commands and
    /// skills are not here: see `commands`.
    pub offer: Offer,
    /// The commands it said, or `None` before it has: a session that has
    /// not said them yet leaves the Thread's.
    pub commands: Option<Commands>,
}

/// What a session said a message can ask it to run.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Commands {
    pub slash_commands: Vec<SlashCommand>,
    pub skills: Vec<Skill>,
    /// The skills it runs as slash commands, as Claude Code does.
    pub slashed: Vec<String>,
}

/// Each mode as the Harnesses with modes of their own name it, Claude
/// Code's first, then Codex's; from the strictest to the freest.
const MODES: [(Mode, [&str; 2]); 4] = [
    (Mode::Supervised, ["default", "read-only"]),
    (Mode::AcceptEdits, ["acceptEdits", "workspace-write"]),
    (Mode::Auto, ["auto", "agent"]),
    (Mode::FullAccess, ["bypassPermissions", "agent-full-access"]),
];
/// Planning: one of Claude Code's modes, and Codex's collaboration mode.
const PLAN: &str = "plan";
const WORKING: &str = "default";
const COLLABORATION: &str = "collaboration_mode";
/// What each session has said of itself.
pub(super) type Learned = Arc<Mutex<HashMap<acp::SessionId, Known>>>;

/// A session's options, and whether its modes are Claude Code's or Codex's:
/// decided by the list it opened with, so a later list that leaves the modes
/// out does not change who keeps to the Thread's mode. And what it last
/// said it has used and which slash commands it takes, which may come
/// between turns: Claude Code sends its slash commands just after the
/// session opens.
#[derive(Clone, Default)]
pub(super) struct Known {
    pub(super) native: bool,
    pub(super) options: Vec<acp::SessionConfigOption>,
    pub(super) usage: Option<Usage>,
    /// The commands it said, or `None` before it has.
    pub(super) said: Option<Vec<acp::AvailableCommand>>,
    /// The folder it works in, where its project's skills are.
    pub(super) folder: Option<PathBuf>,
    /// What it said, its skills told by their files: read again only as
    /// what it said or its folder changes, which may come in either order.
    commands: Option<Commands>,
}

impl Known {
    pub(super) fn new(options: Vec<acp::SessionConfigOption>) -> Known {
        Known {
            native: native(&options),
            options,
            ..Known::default()
        }
    }

    pub(super) fn read_commands(&mut self) {
        self.commands = (self.said.as_ref()).map(|said| commands(said, self.folder.as_deref()));
    }
}

/// Changes what is known of `session`, from nothing if it is new.
pub(super) fn update<R>(
    learned: &Learned,
    session: &acp::SessionId,
    change: impl FnOnce(&mut Known) -> R,
) -> R {
    change(learned.lock().unwrap().entry(session.clone()).or_default())
}

/// Keeps the options a session opened with, in `folder`.
pub(super) fn opened(
    learned: &Learned,
    session: &acp::SessionId,
    now: Vec<acp::SessionConfigOption>,
    folder: &Path,
) {
    update(learned, session, |known| {
        known.native = native(&now);
        known.options = now;
        known.folder = Some(folder.to_owned());
        known.read_commands();
    });
}

/// Keeps a session's newest options. An empty list, which is what an update
/// that cannot be read becomes, keeps the last.
pub(super) fn learn(
    learned: &Learned,
    session: &acp::SessionId,
    now: Vec<acp::SessionConfigOption>,
) -> Known {
    let mut all = learned.lock().unwrap();
    match all.get_mut(session) {
        Some(known) => {
            if !now.is_empty() {
                known.options = now;
            }
            known.clone()
        }
        None => all
            .entry(session.clone())
            .or_insert(Known::new(now))
            .clone(),
    }
}

/// The values a choice option offers; none for any other.
pub(super) fn values(option: &acp::SessionConfigOption) -> Vec<&str> {
    let acp::SessionConfigKind::Select(select) = &option.kind else {
        return Vec::new();
    };
    match &select.options {
        acp::SessionConfigSelectOptions::Ungrouped(choices) => {
            choices.iter().map(|c| &*c.value.0).collect()
        }
        acp::SessionConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|g| &g.options)
            .map(|c| &*c.value.0)
            .collect(),
        _ => Vec::new(),
    }
}

fn current(option: &acp::SessionConfigOption) -> Option<OptionValue> {
    match &option.kind {
        acp::SessionConfigKind::Select(select) => {
            Some(OptionValue::Choice(select.current_value.0.to_string()))
        }
        acp::SessionConfigKind::Boolean(toggle) => Some(OptionValue::Toggle(toggle.current_value)),
        _ => None,
    }
}

fn category(option: &acp::SessionConfigOption) -> Option<String> {
    let word = serde_json::to_value(option.category.as_ref()?).ok()?;
    word.as_str().map(str::to_owned)
}

/// The Harness's own permission modes.
pub(super) fn is_mode(option: &acp::SessionConfigOption) -> bool {
    option.category == Some(acp::SessionConfigOptionCategory::Mode)
}

/// Codex's switch between planning and working.
fn is_collaboration(option: &acp::SessionConfigOption) -> bool {
    &*option.id.0 == COLLABORATION || category(option).as_deref() == Some(COLLABORATION)
}

fn mode_of(value: &str) -> Option<Mode> {
    MODES
        .iter()
        .find(|(_, values)| values.contains(&value))
        .map(|(mode, _)| *mode)
}

/// Whether the Harness has modes Banda knows: Claude Code's or Codex's,
/// told by the two strictest, which each offers always. Another Harness's
/// mode named `default` is not enough.
pub(super) fn native(options: &[acp::SessionConfigOption]) -> bool {
    let Some(modes) = options.iter().find(|o| is_mode(o)) else {
        return false;
    };
    let offers = values(modes);
    (0..2).any(|harness| {
        MODES[..2]
            .iter()
            .all(|(_, names)| offers.contains(&names[harness]))
    })
}

/// What a session runs with, from its options.
pub(super) fn running(known: &Known) -> Running {
    let (native, options) = (known.native, &known.options);
    let modes = options.iter().find(|o| is_mode(o));
    let collaboration = options.iter().find(|o| is_collaboration(o));
    let now = |option: Option<&acp::SessionConfigOption>| match option.and_then(current) {
        Some(OptionValue::Choice(value)) => Some(value),
        _ => None,
    };
    let (mode_now, planning_now) = (now(modes), now(collaboration));
    let plans = [modes, collaboration]
        .into_iter()
        .flatten()
        .any(|o| values(o).contains(&PLAN));
    let mut offered: Vec<HarnessOption> = options
        .iter()
        .filter(|o| !(native && (is_mode(o) || is_collaboration(o))))
        .filter_map(harness_option)
        .collect();
    let rank = |o: &HarnessOption| match o.category.as_deref() {
        Some("model") => 0,
        Some("thought_level") => 1,
        Some("model_config") => 2,
        _ => 3,
    };
    offered.sort_by_key(rank);
    Running {
        native,
        mode: mode_now.as_deref().and_then(mode_of),
        plan: native
            && [mode_now, planning_now]
                .iter()
                .any(|v| v.as_deref() == Some(PLAN)),
        offer: Offer {
            options: offered,
            plans: native && plans,
            slash_commands: Vec::new(),
            skills: Vec::new(),
            no_images: false,
            outdated: None,
        },
        commands: known.commands.clone(),
    }
}

/// The commands a session in `folder` said, its slash commands apart
/// from its skills: Codex says each of its skills as a command named `$`
/// and the skill's name, which a message names anywhere in its text.
/// Claude Code says its skills as slash commands: one whose `SKILL.md` is
/// in the folder or the home folder is a skill too (issue #149).
fn commands(said: &[acp::AvailableCommand], folder: Option<&Path>) -> Commands {
    let home = dirs::home_dir();
    let mut commands = Commands::default();
    for command in said {
        let skill = |name: &str| Skill {
            name: name.to_owned(),
            description: command.description.clone(),
        };
        match command.name.strip_prefix('$') {
            Some("") => {}
            Some(name) => commands.skills.push(skill(name)),
            None => {
                if crate::skills::file(&command.name, folder, home.as_deref()).is_some() {
                    commands.skills.push(skill(&command.name));
                    commands.slashed.push(command.name.clone());
                }
                commands.slash_commands.push(slash_command(command));
            }
        }
    }
    commands
}

fn slash_command(command: &acp::AvailableCommand) -> SlashCommand {
    SlashCommand {
        name: command.name.clone(),
        description: command.description.clone(),
        hint: match &command.input {
            Some(acp::AvailableCommandInput::Unstructured(input)) => Some(input.hint.clone()),
            _ => None,
        },
    }
}

fn harness_option(option: &acp::SessionConfigOption) -> Option<HarnessOption> {
    let choices = match &option.kind {
        acp::SessionConfigKind::Select(select) => match &select.options {
            acp::SessionConfigSelectOptions::Ungrouped(choices) => choices.iter().collect(),
            acp::SessionConfigSelectOptions::Grouped(groups) => {
                groups.iter().flat_map(|g| &g.options).collect()
            }
            _ => Vec::new(),
        },
        _ => Vec::new(),
    };
    Some(HarnessOption {
        id: option.id.0.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
        category: category(option),
        value: current(option)?,
        choices: choices
            .into_iter()
            .map(|c| OptionChoice {
                value: c.value.0.to_string(),
                name: c.name.clone(),
                description: c.description.clone(),
            })
            .collect(),
    })
}

/// The value `option` should have for a session to run as `wanted`, if it
/// offers one.
fn wanted_value(
    option: &acp::SessionConfigOption,
    native: bool,
    wanted: &Settings,
) -> Option<OptionValue> {
    let offers = values(option);
    let choice = |value: &str| {
        offers
            .contains(&value)
            .then(|| OptionValue::Choice(value.to_owned()))
    };
    if native && is_mode(option) {
        if wanted.plan && offers.contains(&PLAN) {
            return choice(PLAN);
        }
        // The chosen mode, or else the freest one below it.
        let at = MODES.iter().position(|(m, _)| *m == wanted.mode)?;
        return MODES[..=at]
            .iter()
            .rev()
            .flat_map(|(_, values)| values)
            .find_map(|value| choice(value));
    }
    if native && is_collaboration(option) {
        return choice(if wanted.plan { PLAN } else { WORKING });
    }
    match (wanted.options.get(&*option.id.0)?, &option.kind) {
        (OptionValue::Choice(value), acp::SessionConfigKind::Select(_)) => choice(value),
        (OptionValue::Toggle(on), acp::SessionConfigKind::Boolean(_)) => {
            Some(OptionValue::Toggle(*on))
        }
        _ => None,
    }
}

/// The next option to set for a session to run as `wanted`: the mode, the
/// plan, the model, then the rest in the Harness's order. `tried` are the
/// options set already this time.
pub(super) fn next_change(
    known: &Known,
    wanted: &Settings,
    tried: &[String],
) -> Option<(String, acp::SessionConfigOptionValue)> {
    let (native, options) = (known.native, &known.options);
    let order = |o: &acp::SessionConfigOption| {
        if native && is_mode(o) {
            0
        } else if native && is_collaboration(o) {
            1
        } else if o.category == Some(acp::SessionConfigOptionCategory::Model) {
            2
        } else {
            3
        }
    };
    let mut candidates: Vec<_> = options
        .iter()
        .filter(|o| !tried.iter().any(|t| **t == *o.id.0))
        .collect();
    candidates.sort_by_key(|o| order(o));
    candidates.into_iter().find_map(|option| {
        let value = wanted_value(option, native, wanted)?;
        (current(option)? != value).then(|| {
            let value = match value {
                OptionValue::Choice(id) => acp::SessionConfigOptionValue::value_id(id),
                OptionValue::Toggle(on) => acp::SessionConfigOptionValue::boolean(on),
            };
            (option.id.0.to_string(), value)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn select(id: &str, now: &str, values: &[&str]) -> acp::SessionConfigOption {
        let choices = values
            .iter()
            .map(|v| acp::SessionConfigSelectOption::new(v.to_string(), *v))
            .collect::<Vec<_>>();
        acp::SessionConfigOption::select(id.to_owned(), id.to_owned(), now.to_owned(), choices)
    }

    fn codex() -> Vec<acp::SessionConfigOption> {
        use acp::SessionConfigOptionCategory as Category;
        vec![
            select(
                "mode",
                "agent",
                &["read-only", "workspace-write", "agent", "agent-full-access"],
            )
            .category(Category::Mode),
            select("reasoning_effort", "medium", &["low", "medium", "high"])
                .category(Category::ThoughtLevel),
            select("model", "gpt", &["gpt", "gpt-mini"]).category(Category::Model),
            select(COLLABORATION, WORKING, &[WORKING, PLAN])
                .category(Category::Other(COLLABORATION.to_owned())),
        ]
    }

    /// Sets each next change in turn, as the Harness would take it.
    fn settle(options: Vec<acp::SessionConfigOption>, wanted: &Settings) -> Vec<String> {
        let mut known = Known::new(options);
        let mut tried = Vec::new();
        let mut set = Vec::new();
        while let Some((id, value)) = next_change(&known, wanted, &tried) {
            let value = value.as_value_id().unwrap().0.to_string();
            set.push(format!("{id}={value}"));
            let option = known.options.iter_mut().find(|o| *o.id.0 == *id).unwrap();
            if let acp::SessionConfigKind::Select(select) = &mut option.kind {
                select.current_value = acp::SessionConfigValueId::new(value);
            }
            tried.push(id);
        }
        set
    }

    #[test]
    fn codex_gets_its_own_modes_and_plans_in_its_collaboration_mode() {
        let wanted = Settings {
            plan: true,
            ..Settings::default()
        };
        assert_eq!(
            settle(codex(), &wanted),
            ["mode=agent-full-access", "collaboration_mode=plan"]
        );
        let running = running(&Known::new(codex()));
        assert!(running.native && running.offer.plans);
        assert_eq!(running.mode, Some(Mode::Auto));
        let offered: Vec<_> = running
            .offer
            .options
            .iter()
            .map(|o| o.id.as_str())
            .collect();
        assert_eq!(
            offered,
            ["model", "reasoning_effort"],
            "the model first; the modes stand apart"
        );
    }

    #[test]
    fn a_mode_the_harness_lacks_falls_to_the_freest_one_below_it() {
        // Claude Code offers no bypass when it runs as root.
        let claude = vec![
            select(
                "mode",
                "default",
                &["default", "acceptEdits", "plan", "auto"],
            )
            .category(acp::SessionConfigOptionCategory::Mode),
        ];
        assert_eq!(settle(claude.clone(), &Settings::default()), ["mode=auto"]);
        let planning = Settings {
            mode: Mode::AcceptEdits,
            plan: true,
            ..Settings::default()
        };
        assert_eq!(settle(claude.clone(), &planning), ["mode=plan"]);
        let supervised = Settings {
            mode: Mode::Supervised,
            ..Settings::default()
        };
        assert!(settle(claude, &supervised).is_empty(), "it runs so already");
    }

    #[test]
    fn a_mode_named_default_alone_is_not_claude_codes() {
        let other = vec![
            select("mode", "default", &["default", "autoEdit", "yolo"])
                .category(acp::SessionConfigOptionCategory::Mode),
        ];
        assert!(!native(&other));
        assert!(native(&codex()));
    }

    #[test]
    fn a_session_keeps_who_enforces_its_mode_and_its_last_options() {
        let learned = Learned::default();
        let session = acp::SessionId::new("s");
        assert!(learn(&learned, &session, codex()).native);
        let kept = learn(&learned, &session, Vec::new());
        assert_eq!(
            kept.options.len(),
            codex().len(),
            "an empty list keeps the last"
        );
        let model = vec![codex().remove(2)];
        let now = learn(&learned, &session, model);
        assert!(
            now.native,
            "a list without the modes changes nothing about them"
        );
        assert_eq!(now.options.len(), 1);
    }

    #[test]
    fn modes_banda_does_not_know_are_options_like_any_other() {
        let other = vec![
            select("mode", "ask", &["ask", "code"])
                .category(acp::SessionConfigOptionCategory::Mode),
        ];
        let running = running(&Known::new(other.clone()));
        assert!(!running.native && !running.offer.plans);
        assert_eq!(running.offer.options[0].id, "mode");
        let mut wanted = Settings::default();
        wanted
            .options
            .insert("mode".into(), OptionValue::Choice("code".into()));
        assert_eq!(settle(other.clone(), &wanted), ["mode=code"]);
        wanted
            .options
            .insert("mode".into(), OptionValue::Choice("gone".into()));
        assert!(
            settle(other, &wanted).is_empty(),
            "a value it no longer offers"
        );
    }
}
