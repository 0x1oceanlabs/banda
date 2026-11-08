//! The keys module (ADR 0071, decision 5): Banda's actions with their keys
//! in force, and the lines of `keys.toml` that bind them. `banda keys` is
//! its command, and an Agent in a Thread has its methods as tools, so the
//! Person asks in words: "put the column's full width on Alt+M".
//!
//! A line is written as `banda settings set` writes it, its comments and
//! the file's other lines kept, and refused as it refuses: with every
//! manifest's actions, a line the look would name is not written, as an
//! action Banda has not, args it does not take, a key the window's fields
//! would type, a `none` that frees nothing. Only the Person binds a key
//! that acts as them (ADR 0083, decision 3).

use banda_kernel::{Call, Kind, Module, Nothing, Participant, Refusal, Right, Scope, Tool};
use banda_look::Problem;
use banda_look::keys::{self as look, Args, Keys, Mod, NONE};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use ts_rs::TS;

/// The file the Person's keys are in.
const FILE: &str = "keys.toml";

/// An action as `banda keys` lists it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "keys/")]
pub struct Listed {
    pub id: String,
    pub title: String,
    pub section: String,
    /// Where its keys work: a scope's table, as `composer`; none for the
    /// window's, everywhere.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scope: Option<String>,
    /// Its keys in force, as they are pressed with the mod in force.
    pub keys: Vec<ListedKey>,
    /// What it takes, each arg by its name: what it is.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub takes: BTreeMap<String, String>,
}

/// One key of an action, and whose it is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "keys/")]
pub struct ListedKey {
    /// As Banda writes it: `Ctrl+Alt+Shift+R`.
    pub key: String,
    /// A line of the Person's in keys.toml binds it; else it is Banda's.
    pub mine: bool,
    /// What it gives its action.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub args: Option<Args>,
}

/// A key to bind to an action.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "keys/")]
pub struct Bind {
    /// The key, as `Alt+M` or `Ctrl+Alt+Return`: Alt, Ctrl, Super and
    /// Shift, then a letter, a digit, F1 to F24, an arrow's name, Return,
    /// Space, Tab and the like.
    pub key: String,
    /// The action's id, as `keys_list` lists it.
    pub action: String,
    /// What the action takes, when it takes any, as `keys_list` says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub args: Option<Args>,
    /// The scope whose table the key goes in, as `composer`, for an action
    /// of a scope; none for the window's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scope: Option<String>,
}

/// A key of keys.toml, in the window's table or a scope's.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "keys/")]
pub struct Key {
    /// The key, as `Alt+M`.
    pub key: String,
    /// The scope whose table it is in; none for the window's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scope: Option<String>,
}

/// The mod to hold for every Banda key.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "keys/")]
pub struct SetMod {
    /// One or two of Alt, Ctrl and Super (⌘ on a Mac), as `Ctrl+Alt`.
    pub keys: String,
}

/// Every action there is with its keys in force, and what is wrong in the
/// Person's keys.toml.
pub fn list(config: &Path) -> (Vec<Listed>, Vec<Problem>) {
    let (keys, problems) = resolved(config);
    // The look gives each action its keys, in the manifests' order.
    let listed = banda_settings::manifests()
        .actions
        .iter()
        .zip(&keys.actions)
        .map(|(action, inforce)| Listed {
            id: action.id.clone(),
            title: action.title.clone(),
            section: action.section.clone(),
            scope: action.scope.clone(),
            keys: inforce
                .keys
                .iter()
                .map(|key| ListedKey {
                    key: key.text(),
                    mine: key.line.is_some(),
                    args: key.args.clone(),
                })
                .collect(),
            takes: action.takes().into_iter().collect(),
        })
        .collect();
    (listed, problems)
}

/// Binds `bind.key` to its action, in its scope's table.
pub fn bind(config: &Path, bind: &Bind) -> Result<String, Vec<Problem>> {
    let key = named(config, &bind.key)?;
    // The line names the id that was checked, as the look reads it.
    let action = bind.action.trim();
    let value = match &bind.args {
        None => quoted(action),
        Some(args) => call_of(action, args),
    };
    let path = look::path_of(&key, bind.scope.as_deref());
    banda_settings::set(config, FILE, &path, &value)?;
    Ok(format!("{key} runs “{}” now", title_of(action)))
}

/// Whether `by` may bind `bind`: only the Person binds a key whose action,
/// with the args it is given, acts as them, as one that sends words to an
/// Agent or opens a file in its app (ADR 0083, decision 3). The action is
/// found as the look finds a line's, and any caller but the Person binds
/// only an action Banda has.
fn may_bind(by: Participant, bind: &Bind) -> Result<(), Refusal> {
    if let Participant::Person(_) = by {
        return Ok(());
    }
    let id = bind.action.trim();
    if id == NONE {
        return Ok(());
    }
    let manifests = banda_settings::manifests();
    let Some((_, action)) = look::action_named(&manifests, id) else {
        return Err(Refusal::invalid(format!(
            "Banda has no action {id}; keys_list lists them"
        )));
    };
    let Some(given) = action.as_person(bind.args.as_ref()) else {
        return Ok(());
    };
    let with = if given.is_empty() {
        String::new()
    } else {
        format!(" with {}", given.join(", "))
    };
    Err(Refusal::forbidden(format!(
        "Only your Person binds a key to {}{with}: it acts as them. Give them \
         the line, to add to keys.toml themselves.",
        action.id
    )))
}

/// A key of a settings file to set, as `banda settings set` takes it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "keys/")]
pub struct SetSetting {
    /// The file's name, as `look.toml`.
    pub file: String,
    /// The key, dotted, as `tile.border`.
    pub key: String,
    /// A TOML value, or else the text as a string.
    pub value: String,
}

/// A key of a settings file to take out, so its default is back.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "keys/")]
pub struct ResetSetting {
    pub file: String,
    pub key: String,
}

/// A key of a settings file to name otherwise, its value kept.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "keys/")]
pub struct RenameSetting {
    pub file: String,
    pub key: String,
    pub to: String,
}

/// Whether `by` may change `key` of the file `name` as `why` says, which
/// says why only the Person may (ADR 0083): the Person changes any key.
fn may_change(by: Participant, name: &str, key: &str, why: Option<&str>) -> Result<(), Refusal> {
    match (by, why) {
        (Participant::Agent(_), Some(why)) => {
            Err(Refusal::forbidden(format!("{name}: {key}: {why}")))
        }
        _ => Ok(()),
    }
}

/// Frees `key` in its scope's table, so it goes to the Pane.
pub fn free(config: &Path, key: &Key) -> Result<String, Vec<Problem>> {
    let text = named(config, &key.key)?;
    let path = look::path_of(&text, key.scope.as_deref());
    banda_settings::set(config, FILE, &path, &quoted(NONE))?;
    Ok(format!("{text} goes to the Pane now"))
}

/// Takes the Person's line of `key` out, so Banda's own key, if any, is
/// back.
pub fn reset(config: &Path, key: &Key) -> Result<String, Vec<Problem>> {
    let text = named(config, &key.key)?;
    banda_settings::reset(config, FILE, &look::path_of(&text, key.scope.as_deref()))?;
    Ok(format!("{text} is Banda's own again"))
}

/// Sets the mod (ADR 0068), and moves the Person's lines held with the
/// old one to the new, each at its level, as Settings does: a `none` held
/// with it goes, as its key is no longer Banda's. Alt, Banda's own, takes
/// the `mod` line out.
pub fn set_mod(config: &Path, set: &SetMod) -> Result<String, Vec<Problem>> {
    let file = config.join(FILE);
    let to = look::mod_of(&set.keys, cfg!(target_os = "macos"))
        .map_err(|message| vec![Problem::whole(&file, message)])?;
    let (keys, _) = resolved(config);
    if to == Mod::default() {
        banda_settings::reset(config, FILE, "mod")?;
    } else {
        banda_settings::set(config, FILE, "mod", &quoted(&to.text()))?;
    }
    for moved in look::moves(&keys.binds, keys.held, to) {
        let path = look::path_of(&moved.bind.text, moved.bind.scope.as_deref());
        match moved.to {
            Some(to) => banda_settings::rename(config, FILE, &path, &to)?,
            None => banda_settings::reset(config, FILE, &path)?,
        }
    }
    Ok(format!("Banda's keys are held with {} now", to.text()))
}

/// The Person's keys and what is wrong in them, read as the look reads
/// them, with every manifest's actions.
fn resolved(config: &Path) -> (Keys, Vec<Problem>) {
    let places = banda_look::theme::Places::at(config);
    let mut problems = Vec::new();
    let (keys, _) = look::resolve(
        &places,
        &banda_settings::manifests(),
        &mut problems,
        &mut Vec::new(),
    );
    (keys, problems)
}

/// The key `text` names, as Banda writes it; or why it names none.
fn named(config: &Path, text: &str) -> Result<String, Vec<Problem>> {
    look::canonical(text).ok_or_else(|| {
        vec![Problem::whole(
            &config.join(FILE),
            format!("{text:?} names no key: write it as Alt+M or Ctrl+Alt+Return"),
        )]
    })
}

/// `text` as a TOML string.
fn quoted(text: &str) -> String {
    toml_edit::Value::from(text).to_string()
}

/// A line that gives its action what it takes:
/// `{ action = "browser.open", args = { address = "…" } }`.
fn call_of(action: &str, args: &Args) -> String {
    let mut call = toml_edit::InlineTable::new();
    call.insert("action", action.into());
    call.insert("args", toml_of(&Value::Object(args.clone())));
    call.to_string()
}

/// A JSON value as TOML: null has no TOML, so it is the empty string.
fn toml_of(value: &Value) -> toml_edit::Value {
    match value {
        Value::Null => "".into(),
        Value::Bool(on) => (*on).into(),
        Value::Number(number) => match number.as_i64() {
            Some(whole) => whole.into(),
            None => number.as_f64().unwrap_or_default().into(),
        },
        Value::String(text) => text.as_str().into(),
        Value::Array(items) => toml_edit::Value::Array(items.iter().map(toml_of).collect()),
        Value::Object(fields) => {
            let mut table = toml_edit::InlineTable::new();
            for (name, value) in fields {
                table.insert(name, toml_of(value));
            }
            toml_edit::Value::InlineTable(table)
        }
    }
}

/// An action's title, by its id, for what was done; its id when Banda has
/// none such.
fn title_of(id: &str) -> String {
    let manifests = banda_settings::manifests();
    look::action_named(&manifests, id)
        .map_or_else(|| id.to_owned(), |(_, action)| action.title.clone())
}

/// The keys module, over the Person's config folder.
pub struct KeysModule {
    config: PathBuf,
    /// The file that keeps the modes the Person chose for each Harness's
    /// new Threads in Settings; none in a test that gives none.
    modes: Option<PathBuf>,
}

impl KeysModule {
    pub fn new(config: PathBuf) -> Self {
        KeysModule {
            config,
            modes: None,
        }
    }

    /// Keeps in `file`, in the engine's state folder, the mode the Person
    /// chooses for a Harness's new Threads as they set it through
    /// `settings_set`, as the settings Pane does (ADR 0083, F0-3).
    pub fn modes_chosen_in(self, file: PathBuf) -> Self {
        KeysModule {
            modes: Some(file),
            ..self
        }
    }

    /// Keeps what a change `by` the Person makes of a new Thread's mode
    /// they chose, as `keep` does it in the file of those; an Agent's
    /// change is no choice, and reaches no mode (`only_the_person`).
    fn keep_choice(
        &self,
        by: Participant,
        keep: impl FnOnce(&Path) -> std::io::Result<()>,
    ) -> Result<(), Refusal> {
        match (by, &self.modes) {
            (Participant::Person(_), Some(modes)) => keep(modes).map_err(|error| {
                Refusal::invalid(format!(
                    "The file changed, but Banda did not keep that you chose it: {error}"
                ))
            }),
            _ => Ok(()),
        }
    }

    async fn list(&self, _: Call, _: Nothing) -> Result<Vec<Listed>, Refusal> {
        Ok(list(&self.config).0)
    }

    async fn bind(&self, call: Call, key: Bind) -> Result<String, Refusal> {
        may_bind(call.participant(), &key)?;
        bind(&self.config, &key).map_err(refused)
    }

    async fn free(&self, _: Call, key: Key) -> Result<String, Refusal> {
        free(&self.config, &key).map_err(refused)
    }

    async fn reset(&self, _: Call, key: Key) -> Result<String, Refusal> {
        reset(&self.config, &key).map_err(refused)
    }

    async fn set_mod(&self, _: Call, set: SetMod) -> Result<String, Refusal> {
        set_mod(&self.config, &set).map_err(refused)
    }

    async fn settings_set(&self, call: Call, set: SetSetting) -> Result<String, Refusal> {
        let SetSetting { file, key, value } = set;
        let why = banda_settings::only_the_person(&file, &key, Some(&value));
        may_change(call.participant(), &file, &key, why)?;
        banda_settings::set(&self.config, &file, &key, &value).map_err(refused)?;
        self.keep_choice(call.participant(), |modes| {
            banda_settings::chose(modes, &file, &key, Some(&value))
        })?;
        Ok(format!("{key} is {value} in {file} now"))
    }

    async fn settings_reset(&self, call: Call, reset: ResetSetting) -> Result<String, Refusal> {
        let ResetSetting { file, key } = reset;
        let why = banda_settings::only_the_person(&file, &key, None);
        may_change(call.participant(), &file, &key, why)?;
        banda_settings::reset(&self.config, &file, &key).map_err(refused)?;
        self.keep_choice(call.participant(), |modes| {
            banda_settings::chose(modes, &file, &key, None)
        })?;
        Ok(format!("{key} is as Banda has it in {file} now"))
    }

    async fn settings_rename(&self, call: Call, rename: RenameSetting) -> Result<String, Refusal> {
        let RenameSetting { file, key, to } = rename;
        let why = banda_settings::only_the_person_renames(&file, &key, &to);
        may_change(call.participant(), &file, &key, why)?;
        banda_settings::rename(&self.config, &file, &key, &to).map_err(refused)?;
        self.keep_choice(call.participant(), |modes| {
            banda_settings::chose_renamed(modes, &file, &key, &to)
        })?;
        Ok(format!("{key} is {to} in {file} now"))
    }
}

/// A refusal of a change, with what was wrong, line by line.
fn refused(problems: Vec<Problem>) -> Refusal {
    let said: Vec<String> = problems.iter().map(ToString::to_string).collect();
    Refusal::invalid(said.join("\n"))
}

banda_kernel::methods! {
    KeysModule(Call) as "KeysMethods" in "keys/" {
        /// Every action of Banda's window and its modules: its id, title,
        /// section, the scope its keys work in (none: everywhere), its
        /// keys in force, whose each is (the Person's line in keys.toml,
        /// or Banda's own), and what it takes. Find an action by its title
        /// here before binding it.
        call list(Nothing) -> Vec<Listed>, Read, tool "keys_list";
        /// Binds a key to an action, in keys.toml: `Alt+M` to
        /// `column.maximize`, with the args it takes when it takes any,
        /// in its scope's table for an action of a scope. Banda's keys
        /// hold the mod (Alt, unless keys.toml moved it). It refuses, with
        /// why, an action Banda has not, args it does not take, a key the
        /// window's fields would type, and a key only your Person binds:
        /// one that sends words to an Agent, or runs or opens something
        /// outside Banda, as `thread.new` with `ask` does. Tell your Person
        /// what changed, and that `keys_reset` undoes it.
        call bind(Bind) -> String, Write, tool "keys_bind";
        /// Frees a key, in keys.toml: it goes to the Pane, as Alt+F to a
        /// shell, and the action that had it keeps its other keys.
        call free(Key) -> String, Write, tool "keys_free";
        /// Takes the Person's line of a key out of keys.toml, so Banda's
        /// own key is back.
        call reset(Key) -> String, Write, tool "keys_reset";
        /// Sets the mod, held for every Banda key and the mouse's moves:
        /// one or two of Alt, Ctrl and Super, as `Ctrl+Alt` where the
        /// desktop holds Alt. It moves the Person's lines with it.
        call set_mod(SetMod) -> String, Write, tool "keys_mod";
        /// Sets a key of one of Banda's settings files, as `banda settings
        /// set` does (and does through this under your pass: behind the
        /// fence the files are read-only). It refuses what only your
        /// Person changes: which program a Harness runs and with what, how
        /// freely a new Thread's Agent acts, what Agents may do in the
        /// browser, what Banda sends, this machine's name and icon, and
        /// keys, which `keys_bind` binds. Tell your Person what changed.
        call settings_set(SetSetting) -> String, Write, tool "settings_set";
        /// Takes a key of a settings file out, as `banda settings reset`
        /// does, with `settings_set`'s refusals.
        call settings_reset(ResetSetting) -> String, Write, tool "settings_reset";
        /// Names a key of a settings file otherwise, in its table, as
        /// `banda settings rename` does, with `settings_set`'s refusals for
        /// the key and for what it becomes.
        call settings_rename(RenameSetting) -> String, Write, tool "settings_rename";
    }
}

#[async_trait::async_trait]
impl Module for KeysModule {
    fn name(&self) -> &'static str {
        "keys"
    }

    fn scope(&self) -> Scope {
        Scope::Machine
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    fn tools(&self) -> Vec<Tool> {
        Self::method_tools(self.name())
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::{AgentId, Code, PersonId};
    use banda_look::keys::RunsAsPerson;
    use serde_json::json;

    fn keys_toml(config: &Path) -> String {
        std::fs::read_to_string(config.join(FILE)).unwrap_or_default()
    }

    fn keys_of(config: &Path, id: &str) -> Vec<String> {
        let (listed, _) = list(config);
        let action = listed.iter().find(|action| action.id == id).unwrap();
        action.keys.iter().map(|key| key.key.clone()).collect()
    }

    fn bound(key: &str, action: &str) -> Bind {
        Bind {
            key: key.to_owned(),
            action: action.to_owned(),
            args: None,
            scope: None,
        }
    }

    #[test]
    fn a_key_bound_runs_its_action_and_reset_takes_it_back() {
        let config = tempfile::tempdir().unwrap();
        let config = config.path();
        let said = bind(config, &bound("alt+m", "column.maximize")).unwrap();
        assert!(said.starts_with("Alt+M runs"), "{said}");
        assert!(keys_of(config, "column.maximize").contains(&"Alt+M".to_owned()));
        assert!(keys_toml(config).contains("\"Alt+M\" = \"column.maximize\""));
        let key = Key {
            key: "Alt+M".to_owned(),
            scope: None,
        };
        reset(config, &key).unwrap();
        assert!(!keys_of(config, "column.maximize").contains(&"Alt+M".to_owned()));
    }

    #[test]
    fn a_line_the_look_would_name_is_refused_and_the_file_kept() {
        let config = tempfile::tempdir().unwrap();
        let config = config.path();
        bind(config, &bound("Alt+M", "column.maximize")).unwrap();
        let before = keys_toml(config);
        let refused = bind(config, &bound("Alt+J", "no.such")).unwrap_err();
        assert!(
            refused[0].message.contains("Banda has no action no.such"),
            "{refused:?}"
        );
        let mut args = Args::new();
        args.insert("nope".to_owned(), Value::from(1));
        let wrong = Bind {
            args: Some(args),
            ..bound("Ctrl+Alt+H", "browser.open")
        };
        assert!(bind(config, &wrong).is_err());
        // A key the window's fields would type.
        assert!(bind(config, &bound("M", "column.maximize")).is_err());
        assert_eq!(keys_toml(config), before);
    }

    #[test]
    fn a_key_with_args_and_a_scope_s_key_are_written_where_they_belong() {
        let config = tempfile::tempdir().unwrap();
        let config = config.path();
        let mut args = Args::new();
        args.insert("address".to_owned(), Value::from("https://github.com"));
        let open = Bind {
            args: Some(args),
            ..bound("Ctrl+Alt+H", "browser.open")
        };
        bind(config, &open).unwrap();
        let send = Bind {
            scope: Some("composer".to_owned()),
            ..bound("Ctrl+Return", "agents.composer.send")
        };
        bind(config, &send).unwrap();
        let text = keys_toml(config);
        assert!(
            text.contains(r#""Ctrl+Alt+H" = { action = "browser.open", args = { address = "https://github.com" } }"#),
            "{text}"
        );
        assert!(text.contains("[binds.composer]"), "{text}");
        let (listed, problems) = list(config);
        assert!(problems.is_empty(), "{problems:?}");
        let opens = listed
            .iter()
            .find(|action| action.id == "browser.open")
            .unwrap();
        assert!(opens.keys[0].mine);
        assert_eq!(opens.takes.len(), 4);
    }

    #[test]
    fn a_key_freed_goes_to_the_pane_but_one_banda_has_not_is_refused() {
        let config = tempfile::tempdir().unwrap();
        let config = config.path();
        let maximize = keys_of(config, "column.maximize");
        let key = Key {
            key: maximize[0].clone(),
            scope: None,
        };
        free(config, &key).unwrap();
        assert!(keys_of(config, "column.maximize").is_empty());
        let nothing = Key {
            key: "Ctrl+Alt+Super+F12".to_owned(),
            scope: None,
        };
        let refused = free(config, &nothing).unwrap_err();
        assert!(refused[0].message.contains("frees nothing"), "{refused:?}");
    }

    #[test]
    fn a_new_mod_moves_the_person_s_lines_with_it() {
        let config = tempfile::tempdir().unwrap();
        let config = config.path();
        bind(config, &bound("Alt+M", "column.maximize")).unwrap();
        // A `none` held with Alt goes: Alt+F is no key of Banda's then.
        let alt_f = Key {
            key: "Alt+F".to_owned(),
            scope: None,
        };
        free(config, &alt_f).unwrap();
        set_mod(
            config,
            &SetMod {
                keys: "Ctrl+Alt".to_owned(),
            },
        )
        .unwrap();
        let text = keys_toml(config);
        assert!(text.contains("mod = \"Ctrl+Alt\""), "{text}");
        assert!(
            text.contains("\"Ctrl+Alt+M\" = \"column.maximize\""),
            "{text}"
        );
        assert!(
            !text.lines().any(|line| line.starts_with("\"Alt+F\"")),
            "{text}"
        );
        assert!(
            set_mod(
                config,
                &SetMod {
                    keys: "Shift".to_owned()
                }
            )
            .is_err()
        );
        // Alt, Banda's own, takes the line out.
        set_mod(
            config,
            &SetMod {
                keys: "Alt".to_owned(),
            },
        )
        .unwrap();
        assert!(
            !keys_toml(config)
                .lines()
                .any(|line| line.starts_with("mod ="))
        );
    }

    fn given(bind: Bind, args: Value) -> Bind {
        Bind {
            args: args.as_object().cloned(),
            ..bind
        }
    }

    #[test]
    fn an_agent_binds_a_key_that_stays_in_the_window() {
        let agent = Participant::Agent(AgentId::new());
        // An action that acts as the Person only with some args, given
        // none of them; a page, which opens in Banda; and a key freed.
        let staying = [
            bound("Alt+M", "column.maximize"),
            bound("Ctrl+Alt+N", "thread.new"),
            given(
                bound("Ctrl+Alt+N", "thread.new"),
                json!({ "project": "p", "harness": "fake" }),
            ),
            given(
                bound("Ctrl+Alt+A", "file.attach"),
                json!({ "file": "/tmp/a.rs" }),
            ),
            given(
                bound("Ctrl+Alt+H", "browser.open"),
                json!({ "address": "https://github.com" }),
            ),
            bound("Alt+F", "none"),
        ];
        for bind in staying {
            assert_eq!(may_bind(agent, &bind), Ok(()), "{bind:?}");
        }
    }

    #[test]
    fn only_the_person_binds_a_key_that_acts_as_them() {
        let agent = Participant::Agent(AgentId::new());
        let ask = given(bound("Ctrl+Alt+H", "thread.new"), json!({ "ask": "hello" }));
        let refused = may_bind(agent, &ask).unwrap_err();
        assert_eq!(refused.code, Code::Forbidden);
        assert!(
            refused
                .message
                .starts_with("Only your Person binds a key to thread.new with ask:"),
            "{}",
            refused.message
        );
        let file = json!({ "file": "/tmp/a.pdf" });
        let acting = [
            given(bound("Ctrl+Alt+O", "file.outside"), file.clone()),
            given(bound("Ctrl+Alt+F", "file.folder"), file),
            given(
                bound("Ctrl+Alt+A", "file.attach"),
                json!({ "file": "/tmp/a.rs", "comment": "this" }),
            ),
            given(
                bound("Ctrl+Alt+A", "file.attach"),
                json!({ "file": "/tmp/a.rs", "text": "fn a() {}" }),
            ),
            given(
                bound("Ctrl+Alt+L", "problems.look-into"),
                json!({ "fingerprint": "3124" }),
            ),
            // The action as the look finds it, spaces around its id aside.
            given(
                bound("Ctrl+Alt+H", " thread.new"),
                json!({ "ask": "hello" }),
            ),
            given(
                bound("Ctrl+Alt+H", "thread.new\n"),
                json!({ "ask": "hello" }),
            ),
            given(
                bound("Ctrl+Alt+H", "\u{a0}thread.new"),
                json!({ "ask": "hello" }),
            ),
        ];
        for bind in acting {
            let refused = may_bind(agent, &bind).unwrap_err();
            assert_eq!(refused.code, Code::Forbidden, "{bind:?}");
        }
        // An action Banda has not is refused too.
        let nothing = may_bind(agent, &bound("Alt+J", "no.such")).unwrap_err();
        assert_eq!(nothing.code, Code::Invalid);
        assert!(nothing.message.contains("Banda has no action no.such"));
        // The Person binds it, as with a line of their own in keys.toml.
        let person = Participant::Person(PersonId::new());
        assert_eq!(may_bind(person, &ask), Ok(()));
    }

    #[test]
    fn a_line_names_the_action_it_was_checked_for() {
        let config = tempfile::tempdir().unwrap();
        let config = config.path();
        bind(config, &bound("Alt+M", " column.maximize\n")).unwrap();
        assert!(keys_toml(config).contains("\"Alt+M\" = \"column.maximize\""));
    }

    #[test]
    fn an_action_marked_by_args_names_args_it_takes() {
        for action in &banda_settings::manifests().actions {
            let Some(RunsAsPerson::Given(names)) = &action.runs_as_person else {
                continue;
            };
            let takes: Vec<String> = action.takes().into_iter().map(|(name, _)| name).collect();
            for name in names {
                assert!(takes.contains(name), "{} takes no {name}", action.id);
            }
        }
    }
}
