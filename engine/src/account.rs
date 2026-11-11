//! `banda account` and `banda secret`: filters over the machine's Accounts
//! (ADR 0108, decision 3). stdout holds only the result, one JSON value a
//! line; a refusal goes to stderr as `{"error": …}`, with the exit codes as
//! they are. A list is a stream narrowed by flags, and a command that takes
//! an ID takes `-` for the IDs on stdin, one a line, as bare IDs or as the
//! list's own lines. A key travels only on a pipe: in on stdin, out only
//! from `secret get`.

use crate::Failure;
use crate::client::Client;
use crate::places::Places;
use banda_harnesses::accounts::AccountList;
use banda_harnesses::model::{AccountKind, HarnessView};
use banda_kernel::CommandId;
use banda_kernel::Refusal;
use clap::{Subcommand, ValueEnum};
use serde_json::{Value, json};
use std::path::PathBuf;

#[derive(Subcommand)]
pub enum AccountCommand {
    /// The machine's Accounts, one JSON object a line, each with its
    /// `role` (`default` or `fallback`) when it has one.
    List {
        /// Only the accounts of this Harness, as `claude` or `codex`.
        #[arg(long)]
        of: Option<String>,
        /// Only those of this kind: subscription, api or gateway.
        #[arg(long, value_parser = kind)]
        kind: Option<AccountKind>,
        /// Only those offered for new Threads.
        #[arg(long, conflicts_with = "disabled")]
        enabled: bool,
        /// Only those not offered.
        #[arg(long)]
        disabled: bool,
        /// Only the one with this role.
        #[arg(long)]
        role: Option<Role>,
        /// Print only this field of each, as it is: `--field id` for IDs
        /// to pipe on.
        #[arg(long)]
        field: Option<String>,
    },
    /// Find existing profile folders, including Omarchy's, one JSON object
    /// a line. Does not read credentials.
    Discover,
    /// Create an Account with a private folder of its own, ready for sign-in.
    Add {
        harness: String,
        #[arg(long)]
        id: String,
        #[arg(long)]
        name: Option<String>,
    },
    /// Add an Account that reaches its models through a gateway at `url`,
    /// as OpenRouter: its key is read from stdin into the keyring.
    Gateway {
        harness: String,
        #[arg(long)]
        id: String,
        #[arg(long)]
        url: String,
        #[arg(long)]
        name: Option<String>,
    },
    /// Sign a Codex Account in with an OpenAI API key, read from stdin.
    /// Codex keeps it; Banda does not.
    ApiKey { id: String },
    /// Connect an existing profile on the engine's machine, without copying credentials.
    Connect {
        harness: String,
        #[arg(long)]
        id: String,
        #[arg(long)]
        folder: PathBuf,
        #[arg(long)]
        name: Option<String>,
    },
    /// Ask the Harness whether this Account is signed in. Returns no
    /// credentials. `-` reads the IDs from stdin.
    Status { id: String },
    /// Start sign-in. The Person completes the browser step or supplies a code.
    Login {
        id: String,
        #[arg(long)]
        way: Option<String>,
    },
    /// Read sign-in progress and terminal output as JSON.
    LoginStatus { login: String },
    /// Send one line to the sign-in terminal (for example a confirmation code).
    LoginInput { login: String, text: String },
    /// Cancel a running sign-in.
    LoginCancel { login: String },
    /// Refresh after sign-in ends; use account status to confirm the identity.
    LoginFinish { login: String },
    /// Remove an Account; its Threads move to the default after their
    /// Turn. `-` reads the IDs from stdin.
    Remove { id: String },
    /// Change the display name; the ID stays.
    Rename { id: String, name: String },
    /// Offer the Account for new Threads. `-` reads the IDs from stdin.
    Enable { id: String },
    /// Stop offering the Account for new Threads. Running Turns continue.
    /// `-` reads the IDs from stdin.
    Disable { id: String },
    /// Choose the default for new Threads.
    Default { id: String },
    /// Choose the fallback for new Threads; without an ID, clear it.
    Fallback { id: Option<String> },
}

/// A role a new Thread gives an account.
#[derive(Clone, Copy, PartialEq, ValueEnum)]
pub enum Role {
    Default,
    Fallback,
}

#[derive(Subcommand)]
pub enum SecretCommand {
    /// Print a gateway account's key, for its Harness: Claude Code's
    /// apiKeyHelper and Codex's auth command run it. Only the Person and
    /// that account's own Harness process get it.
    Get { account: String },
    /// Keep a new key for a gateway account, read from stdin. It may be a
    /// reference instead: op://… for 1Password, pass:<name> for pass.
    Set { account: String },
}

/// `banda secret`: the key printed as it is, or kept from stdin.
pub async fn secret(places: &Places, what: SecretCommand) -> Result<(), Failure> {
    let (method, account, key) = match what {
        SecretCommand::Get { account } => ("harnesses.secret", account, None),
        SecretCommand::Set { account } => ("harnesses.set_key", account, Some(read_key()?)),
    };
    let mut params = json!({ "harness": account });
    if let Some(key) = key {
        params["key"] = json!(key);
    }
    let mut client = Client::connect(places).await?;
    let answer = one(&mut client, method, params).await?;
    match answer.as_str() {
        // The key alone, for the Harness that asked.
        Some(key) => println!("{key}"),
        None => print(&answer),
    }
    Ok(())
}

/// `banda account`: one method's answer, or a list as a stream.
pub async fn account(places: &Places, what: AccountCommand) -> Result<(), Failure> {
    let plan = plan(what)?;
    let mut client = Client::connect(places).await?;
    match plan {
        Plan::List { narrow, field } => {
            let answer = one(&mut client, "harnesses.accounts", json!({})).await?;
            let list: AccountList = serde_json::from_value(answer).map_err(Failure::broken)?;
            for (account, role) in roles(&list) {
                if !narrow.keeps(account, role) {
                    continue;
                }
                let mut line = serde_json::to_value(account).map_err(Failure::broken)?;
                if let Some(role) = role {
                    line["role"] = json!(role.name());
                }
                match &field {
                    Some(field) => println!("{}", plain(&line[field])),
                    None => println!("{line}"),
                }
            }
        }
        Plan::Discover => {
            let found = one(&mut client, "harnesses.account_profiles", json!({})).await?;
            for profile in found.as_array().into_iter().flatten() {
                println!("{profile}");
            }
        }
        Plan::One(method, params) => print(&one(&mut client, method, params).await?),
        Plan::Each(id, method, mut params) => {
            let ids = match id.as_str() {
                "-" => read_ids()?,
                _ => vec![id],
            };
            // Every ID is asked; a refusal of one is said and the rest go on,
            // the last said as the program ends.
            let mut refused = None;
            for id in ids {
                params["harness"] = json!(id);
                match one(&mut client, method, params.clone()).await {
                    Ok(answer) => print(&answer),
                    Err(Failure::Refused(refusal)) => {
                        if let Some(earlier) = refused.replace(refusal) {
                            eprintln!("{}", Failure::said(&earlier));
                        }
                    }
                    Err(broken) => return Err(broken),
                }
            }
            if let Some(refusal) = refused {
                return Err(Failure::Refused(refusal));
            }
        }
    }
    Ok(())
}

/// What a command does: list, discover, call once, or call for each ID
/// with these params and its `harness`.
enum Plan {
    List {
        narrow: Narrow,
        field: Option<String>,
    },
    Discover,
    One(&'static str, Value),
    Each(String, &'static str, Value),
}

fn plan(what: AccountCommand) -> Result<Plan, Failure> {
    Ok(match what {
        AccountCommand::List {
            of,
            kind,
            enabled,
            disabled,
            role,
            field,
        } => Plan::List {
            narrow: Narrow {
                of,
                kind,
                offered: (enabled || disabled).then_some(enabled),
                role,
            },
            field,
        },
        AccountCommand::Discover => Plan::Discover,
        AccountCommand::Status { id } => Plan::Each(id, "harnesses.account_status", json!({})),
        AccountCommand::Remove { id } => Plan::Each(id, "harnesses.remove_account", json!({})),
        AccountCommand::Enable { id } => {
            Plan::Each(id, "harnesses.update_account", json!({ "enabled": true }))
        }
        AccountCommand::Disable { id } => {
            Plan::Each(id, "harnesses.update_account", json!({ "enabled": false }))
        }
        AccountCommand::Gateway {
            harness,
            id,
            url,
            name,
        } => Plan::One(
            "harnesses.add_gateway",
            json!({ "harness": harness, "id": id, "url": url, "name": name, "key": read_key()? }),
        ),
        AccountCommand::ApiKey { id } => Plan::One(
            "harnesses.api_key",
            json!({ "harness": id, "key": read_key()? }),
        ),
        AccountCommand::Add { harness, id, name } => Plan::One(
            "harnesses.connect_account",
            json!({ "harness": harness, "id": id, "name": name }),
        ),
        AccountCommand::Connect {
            harness,
            id,
            folder,
            name,
        } => Plan::One(
            "harnesses.connect_account",
            json!({ "harness": harness, "id": id, "folder": folder, "name": name }),
        ),
        AccountCommand::Login { id, way } => Plan::One(
            "harnesses.login_account",
            json!({ "harness": id, "way": way }),
        ),
        AccountCommand::LoginStatus { login } => {
            Plan::One("harnesses.login_status", json!({ "login": login }))
        }
        AccountCommand::LoginInput { login, text } => Plan::One(
            "harnesses.login_input",
            json!({ "login": login, "text": format!("{text}\n") }),
        ),
        AccountCommand::LoginCancel { login } => {
            Plan::One("harnesses.login_cancel", json!({ "login": login }))
        }
        AccountCommand::LoginFinish { login } => {
            Plan::One("harnesses.login_finish", json!({ "login": login }))
        }
        AccountCommand::Rename { id, name } => Plan::One(
            "harnesses.update_account",
            json!({ "harness": id, "name": name }),
        ),
        AccountCommand::Default { id } => Plan::One(
            "harnesses.set_start",
            json!({ "role": "account", "harness": id }),
        ),
        AccountCommand::Fallback { id } => Plan::One(
            "harnesses.set_start",
            json!({ "role": "fallback", "harness": id }),
        ),
    })
}

/// `--kind`, as `AccountKind` names itself.
fn kind(name: &str) -> Result<AccountKind, String> {
    serde_json::from_value(json!(name)).map_err(|_| format!("{name} is no kind of account"))
}

/// What `list`'s flags keep.
struct Narrow {
    of: Option<String>,
    kind: Option<AccountKind>,
    offered: Option<bool>,
    role: Option<Role>,
}

impl Narrow {
    fn keeps(&self, account: &HarnessView, role: Option<Role>) -> bool {
        (self.of.as_ref()).is_none_or(|of| *of == account.harness)
            && (self.kind).is_none_or(|kind| kind == account.kind)
            && (self.offered).is_none_or(|on| on == account.enabled)
            && (self.role).is_none_or(|wanted| Some(wanted) == role)
    }
}

impl Role {
    fn name(self) -> &'static str {
        match self {
            Role::Default => "default",
            Role::Fallback => "fallback",
        }
    }
}

/// Each account of the answer, with the role the engine gave it.
fn roles(list: &AccountList) -> impl Iterator<Item = (&HarnessView, Option<Role>)> {
    list.accounts.iter().map(|account| {
        let is = |named: &Option<String>| named.as_deref() == Some(&*account.id);
        let role = if is(&list.default) {
            Some(Role::Default)
        } else if is(&list.fallback) {
            Some(Role::Fallback)
        } else {
            None
        };
        (account, role)
    })
}

/// A field as a line of text: a string as it is, else its JSON.
fn plain(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// The IDs on stdin, one a line: a bare ID, or a JSON object's `id`, as
/// `list` prints them.
fn read_ids() -> Result<Vec<String>, Failure> {
    use std::io::BufRead;
    let mut ids = Vec::new();
    for line in std::io::stdin().lock().lines() {
        let line = line.map_err(Failure::broken)?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let id = match serde_json::from_str::<Value>(line) {
            Ok(Value::Object(mut object)) => match object.remove("id") {
                Some(Value::String(id)) => id,
                _ => {
                    return Err(Failure::Refused(Refusal::invalid(format!(
                        "A line on stdin has no \"id\": {line}"
                    ))));
                }
            },
            _ => line.to_owned(),
        };
        ids.push(id);
    }
    Ok(ids)
}

/// One call's answer.
async fn one(client: &mut Client, method: &str, params: Value) -> Result<Value, Failure> {
    client.call(method, None, CommandId::new(), params).await
}

/// An answer on its own line; nothing for one that says nothing.
fn print(answer: &Value) {
    if !answer.is_null() {
        println!("{answer}");
    }
}

/// A key from stdin: its first line, typed unseen at a terminal.
fn read_key() -> Result<String, Failure> {
    use std::io::{BufRead, IsTerminal, Write};
    let stdin = std::io::stdin();
    let mut line = String::new();
    if stdin.is_terminal() {
        eprint!("Key: ");
        let _ = std::io::stderr().flush();
        read_unseen(&stdin, &mut line)
    } else {
        stdin.lock().read_line(&mut line)
    }
    .map_err(Failure::broken)?;
    let key = line.trim();
    if key.is_empty() {
        return Err(Failure::broken("No key was given on stdin."));
    }
    Ok(key.to_owned())
}

/// Reads a line typed at the terminal, with its echo off where it can be.
fn read_unseen(stdin: &std::io::Stdin, line: &mut String) -> std::io::Result<usize> {
    use std::io::BufRead;
    #[cfg(unix)]
    {
        use rustix::termios::{LocalModes, OptionalActions, tcgetattr, tcsetattr};
        if let Ok(was) = tcgetattr(stdin) {
            let mut quiet = was.clone();
            quiet.local_modes.remove(LocalModes::ECHO);
            if tcsetattr(stdin, OptionalActions::Now, &quiet).is_ok() {
                let read = stdin.lock().read_line(line);
                let _ = tcsetattr(stdin, OptionalActions::Now, &was);
                eprintln!();
                return read;
            }
        }
    }
    stdin.lock().read_line(line)
}
