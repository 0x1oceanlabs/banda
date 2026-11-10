//! Account folders shared by Settings and the CLI (ADR 0104). The
//! settings writer implements the small write boundary; this module owns
//! the machine API and never reads a provider's credentials.
use crate::model::HarnessView;
use banda_kernel::Refusal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct AccountProfile {
    pub harness: String,
    /// An existing folder; the Harness must still check its sign-in.
    pub folder: String,
    /// The Account already using this folder, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub account: Option<String>,
}

#[derive(Clone, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export_to = "harnesses/")]
pub struct ConnectAccount {
    /// The registered Harness: claude or codex.
    pub harness: String,
    /// Stable Account ID: lowercase letters, digits and hyphens.
    pub id: String,
    /// Its display name. The Harness's name when omitted.
    #[ts(optional)]
    pub name: Option<String>,
    /// Adopt an existing folder. Omitted: create an empty private folder.
    #[ts(optional)]
    pub folder: Option<String>,
}

#[derive(Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export_to = "harnesses/")]
pub struct RemoveAccount {
    pub harness: String,
    /// If supplied, refuse when the default changed since confirmation.
    #[ts(optional)]
    pub to: Option<String>,
}

/// Kept with the old entry so a resumed session still knows its source.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Retirement {
    pub to: String,
    pub by: banda_kernel::Participant,
}

/// The one settings writer, injected by the engine to avoid making the
/// Harness module depend on every module whose settings it describes.
pub trait AccountSettings: Send + Sync {
    fn remove(
        &self,
        id: &str,
        expected: Option<&str>,
        by: banda_kernel::Participant,
    ) -> Result<String, Refusal>;
    fn profiles(&self) -> Result<Vec<AccountProfile>, Refusal>;
    fn connect(&self, account: ConnectAccount) -> Result<HarnessView, Refusal>;
}

/// A provider's report without the sign-in program's environment.
#[derive(Serialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct AccountStatus {
    pub harness: String,
    pub ways: Vec<AccountWay>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub signed_in_as: Option<crate::model::SignedInAs>,
}

/// A sign-in choice without its program or environment.
#[derive(Serialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct AccountWay {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export_to = "harnesses/")]
pub struct LoginAccount {
    pub harness: String,
    /// From account_status.ways; the sole way when omitted.
    #[ts(optional)]
    pub way: Option<String>,
}

#[derive(Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export_to = "harnesses/")]
pub struct LoginId {
    pub login: String,
}

#[derive(Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export_to = "harnesses/")]
pub struct LoginInput {
    pub login: String,
    /// Terminal input, including a newline when submitting a code.
    pub text: String,
}

#[derive(Clone, Serialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct LoginStatus {
    pub login: String,
    pub harness: String,
    /// The last 64 KiB of terminal output. No credential files are read.
    pub output: String,
    pub done: bool,
    /// Set only when done. Ask account_status after login_finish to
    /// confirm who signed in; a successful exit alone is not proof.
    #[ts(optional)]
    pub succeeded: Option<bool>,
}

/// Bounded, engine-owned sign-ins. Dropping the service cancels each
/// live process; a login lasts at most ten minutes. At most one per
/// Account and eight in total; reports expire fifteen minutes after they start.
pub(crate) struct Logins(std::sync::Mutex<std::collections::HashMap<String, Login>>);
struct Login {
    status: std::sync::Arc<std::sync::Mutex<LoginStatus>>,
    input:
        Option<std::sync::Arc<tokio::sync::Mutex<Box<dyn tokio::io::AsyncWrite + Send + Unpin>>>>,
    cancel: Option<tokio::sync::oneshot::Sender<()>>,
    born: std::time::Instant,
}
impl Default for Logins {
    fn default() -> Self {
        Self(std::sync::Mutex::new(Default::default()))
    }
}
impl Logins {
    /// Reserves a slot before starting anything; no two logins can race
    /// to write the same Account's credentials.
    pub fn reserve(
        &self,
        harness: &str,
    ) -> Result<(LoginStatus, tokio::sync::oneshot::Receiver<()>), Refusal> {
        let mut all = self.0.lock().unwrap();
        all.retain(|_, job| {
            !(job.status.lock().unwrap().done
                && job.born.elapsed() > std::time::Duration::from_secs(15 * 60))
        });
        if all.values().any(|job| {
            let state = job.status.lock().unwrap();
            state.harness == harness && !state.done
        }) {
            return Err(Refusal::conflict(
                "This Account already has a sign-in running.",
            ));
        }
        if all.len() >= 8 {
            return Err(Refusal::conflict(
                "Finish or cancel an earlier sign-in first.",
            ));
        }
        let login = uuid::Uuid::now_v7().to_string();
        let status = LoginStatus {
            login: login.clone(),
            harness: harness.into(),
            output: String::new(),
            done: false,
            succeeded: None,
        };
        let (cancel, receiver) = tokio::sync::oneshot::channel();
        all.insert(
            login,
            Login {
                status: std::sync::Arc::new(std::sync::Mutex::new(status.clone())),
                input: None,
                cancel: Some(cancel),
                born: std::time::Instant::now(),
            },
        );
        Ok((status, receiver))
    }
    pub fn terminal(
        &self,
        id: &str,
        mut process: banda_kernel::Started,
        pty: banda_kernel::Pty,
        cancel: tokio::sync::oneshot::Receiver<()>,
    ) {
        use tokio::io::AsyncReadExt;
        let state = {
            let mut all = self.0.lock().unwrap();
            let job = all.get_mut(id).unwrap();
            job.input = Some(std::sync::Arc::new(tokio::sync::Mutex::new(pty.input)));
            job.status.clone()
        };
        tokio::spawn(async move {
            let mut output = pty.output;
            let reader_state = state.clone();
            let read = async move {
                let mut bytes = [0; 4096];
                while let Ok(n) = output.read(&mut bytes).await {
                    if n == 0 {
                        break;
                    }
                    append(
                        &mut reader_state.lock().unwrap().output,
                        &String::from_utf8_lossy(&bytes[..n]),
                    );
                }
                std::future::pending::<()>().await;
            };
            tokio::pin!(read);
            let result = tokio::select! {
                result = process.wait() => result.is_ok_and(|exit| exit.success()),
                _ = &mut read => unreachable!("the reader stays pending after EOF"),
                _ = cancel => { let _ = process.stop(std::time::Duration::from_secs(2)).await; false },
                _ = tokio::time::sleep(std::time::Duration::from_secs(600)) => { let _ = process.stop(std::time::Duration::from_secs(2)).await; false },
            };
            // Drain what was printed just before exit, without allowing a
            // descendant holding the PTY to hold the engine forever.
            let _ = tokio::time::timeout(std::time::Duration::from_millis(100), &mut read).await;
            process.kill();
            let mut state = state.lock().unwrap();
            state.done = true;
            state.succeeded = Some(result);
        });
    }
    pub fn agent(
        &self,
        id: &str,
        run: impl std::future::Future<Output = Result<(), Refusal>> + Send + 'static,
        cancel: tokio::sync::oneshot::Receiver<()>,
    ) {
        let state = self.0.lock().unwrap().get(id).unwrap().status.clone();
        tokio::spawn(async move {
            let result = tokio::select! {
                result = run => result,
                _ = cancel => Err(Refusal::conflict("Sign-in cancelled.")),
                _ = tokio::time::sleep(std::time::Duration::from_secs(600)) => Err(Refusal::conflict("Sign-in timed out.")),
            };
            let mut state = state.lock().unwrap();
            state.done = true;
            state.succeeded = Some(result.is_ok());
            if let Err(error) = result {
                append(&mut state.output, &error.message);
            }
        });
    }
    pub fn status(&self, id: &str) -> Result<LoginStatus, Refusal> {
        let all = self.0.lock().unwrap();
        let job = all
            .get(id)
            .ok_or_else(|| Refusal::not_found("No such sign-in; it may have expired."))?;
        Ok(job.status.lock().unwrap().clone())
    }
    pub async fn input(&self, id: &str, text: &str) -> Result<(), Refusal> {
        use tokio::io::AsyncWriteExt;
        if text.len() > 4096 {
            return Err(Refusal::invalid("Sign-in input is at most 4096 bytes."));
        }
        let input = {
            let all = self.0.lock().unwrap();
            let job = all
                .get(id)
                .ok_or_else(|| Refusal::not_found("No such sign-in."))?;
            if job.status.lock().unwrap().done {
                return Err(Refusal::conflict("This sign-in has ended."));
            }
            job.input
                .clone()
                .ok_or_else(|| Refusal::conflict("Complete this sign-in in the browser."))?
        };
        let mut input = input.lock().await;
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            input.write_all(text.as_bytes()).await?;
            input.flush().await
        })
        .await
        .map_err(|_| Refusal::conflict("The sign-in is not reading input."))?
        .map_err(|_| Refusal::conflict("The sign-in no longer accepts input."))
    }
    pub fn cancel(&self, id: &str) -> Result<(), Refusal> {
        let mut all = self.0.lock().unwrap();
        let job = all
            .get_mut(id)
            .ok_or_else(|| Refusal::not_found("No such sign-in."))?;
        if let Some(cancel) = job.cancel.take() {
            let _ = cancel.send(());
        }
        Ok(())
    }
    pub fn forget(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }
}
fn append(output: &mut String, text: &str) {
    output.push_str(text);
    if output.len() > 65_536 {
        let mut start = output.len() - 65_536;
        while !output.is_char_boundary(start) {
            start += 1;
        }
        output.drain(..start);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sign_ins_are_exclusive_bounded_and_cancellable() {
        let logins = Logins::default();
        let (first, cancel) = logins.reserve("claude-work").unwrap();
        assert!(logins.reserve("claude-work").is_err());
        logins.agent(&first.login, std::future::pending(), cancel);
        assert!(logins.input(&first.login, "code").await.is_err());
        logins.cancel(&first.login).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !logins.status(&first.login).unwrap().done {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(logins.status(&first.login).unwrap().succeeded, Some(false));
        logins.forget(&first.login);
        assert!(logins.status(&first.login).is_err());
        for i in 0..8 {
            logins.reserve(&format!("claude-{i}")).unwrap();
        }
        assert!(logins.reserve("claude-nine").is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn terminal_sign_in_keeps_output_accepts_input_and_stops() {
        use banda_kernel::{Environment, Program, PtySize};
        let logins = Logins::default();
        let (first, cancel) = logins.reserve("claude-work").unwrap();
        let program = Program::terminal(
            "sh",
            vec![
                "-c".into(),
                "printf 'Enter code: '; read code; test \"$code\" = accepted && printf 'Signed in'"
                    .into(),
            ],
        );
        let (process, pty) = banda_environments::Local
            .pty(&program, PtySize { rows: 20, cols: 80 })
            .unwrap();
        logins.terminal(&first.login, process, pty, cancel);
        assert!(logins.input(&first.login, &"x".repeat(4097)).await.is_err());
        logins.input(&first.login, "accepted\n").await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while !logins.status(&first.login).unwrap().done {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let done = logins.status(&first.login).unwrap();
        assert_eq!(done.succeeded, Some(true), "{}", done.output);
        assert!(done.output.contains("Signed in"), "{}", done.output);
        assert!(logins.input(&first.login, "again").await.is_err());
    }

    #[test]
    fn terminal_output_is_bounded_on_a_character_boundary() {
        let mut output = String::new();
        append(&mut output, &"я".repeat(40_000));
        assert!(output.len() <= 65_536);
        append(&mut output, "last");
        assert!(output.ends_with("last"));
    }
}
