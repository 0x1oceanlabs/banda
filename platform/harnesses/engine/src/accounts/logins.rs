use super::LoginStatus;
use banda_kernel::Refusal;
use std::future::Future;
use tokio::sync::watch;

/// Bounded, engine-owned sign-ins. Dropping the service cancels each
/// live process; a login lasts at most ten minutes. At most one per
/// Account and eight in total; reports expire fifteen minutes after they
/// start. The engine runs each to its end, and finishes it, whether a
/// window watches it or not (ADR 0108, decision 5).
pub(super) struct Logins(std::sync::Mutex<std::collections::HashMap<String, Login>>);
struct Login {
    status: watch::Sender<LoginStatus>,
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
            !(job.status.borrow().done
                && job.born.elapsed() > std::time::Duration::from_secs(15 * 60))
        });
        if all.values().any(|job| {
            let state = job.status.borrow();
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
            written: 0,
            done: false,
            succeeded: None,
        };
        let (cancel, receiver) = tokio::sync::oneshot::channel();
        all.insert(
            login,
            Login {
                status: watch::Sender::new(status.clone()),
                input: None,
                cancel: Some(cancel),
                born: std::time::Instant::now(),
            },
        );
        Ok((status, receiver))
    }
    /// Runs a sign-in in a terminal to its end; then `finish`, before it
    /// is said to be done.
    pub fn terminal(
        &self,
        id: &str,
        mut process: banda_kernel::Started,
        pty: banda_kernel::Pty,
        cancel: tokio::sync::oneshot::Receiver<()>,
        finish: impl Future<Output = ()> + Send + 'static,
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
                // A character cut by a read waits for the rest of it.
                let mut cut = Vec::new();
                while let Ok(n) = output.read(&mut bytes).await {
                    if n == 0 {
                        break;
                    }
                    cut.extend_from_slice(&bytes[..n]);
                    let whole = match std::str::from_utf8(&cut) {
                        Err(error) if error.error_len().is_none() => error.valid_up_to(),
                        _ => cut.len(),
                    };
                    let text = String::from_utf8_lossy(&cut[..whole]).into_owned();
                    cut.drain(..whole);
                    reader_state.send_modify(|state| append(state, &text));
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
            end(&state, finish, result.then_some(()).ok_or(None)).await;
        });
    }
    /// Runs a sign-in the Harness does itself to its end; then `finish`,
    /// before it is said to be done.
    pub fn agent(
        &self,
        id: &str,
        run: impl Future<Output = Result<(), Refusal>> + Send + 'static,
        cancel: tokio::sync::oneshot::Receiver<()>,
        finish: impl Future<Output = ()> + Send + 'static,
    ) {
        let state = self.0.lock().unwrap().get(id).unwrap().status.clone();
        tokio::spawn(async move {
            let result = tokio::select! {
                result = run => result,
                _ = cancel => Err(Refusal::conflict("Sign-in cancelled.")),
                _ = tokio::time::sleep(std::time::Duration::from_secs(600)) => Err(Refusal::conflict("Sign-in timed out.")),
            };
            end(&state, finish, result.map_err(|error| Some(error.message))).await;
        });
    }
    pub fn status(&self, id: &str) -> Result<LoginStatus, Refusal> {
        Ok(self.watch(id)?.borrow().clone())
    }
    /// A sign-in's status as it changes, till it is done.
    pub fn watch(&self, id: &str) -> Result<watch::Receiver<LoginStatus>, Refusal> {
        let all = self.0.lock().unwrap();
        let job = all
            .get(id)
            .ok_or_else(|| Refusal::not_found("No such sign-in; it may have expired."))?;
        Ok(job.status.subscribe())
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
            if job.status.borrow().done {
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
/// Ends a sign-in: `finish` first, then it is said to be done, with why
/// it failed when it says.
async fn end(
    state: &watch::Sender<LoginStatus>,
    finish: impl Future<Output = ()>,
    result: Result<(), Option<String>>,
) {
    finish.await;
    state.send_modify(|state| {
        state.done = true;
        state.succeeded = Some(result.is_ok());
        if let Err(Some(why)) = &result {
            append(state, why);
        }
    });
}

/// Adds `text` to a sign-in's output, keeping its last 64 KiB, and counts it.
fn append(state: &mut LoginStatus, text: &str) {
    state.written += text.len() as u64;
    let output = &mut state.output;
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
        logins.agent(&first.login, std::future::pending(), cancel, async {});
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
        let finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let finishing = finished.clone();
        let finish = async move { finishing.store(true, std::sync::atomic::Ordering::SeqCst) };
        let mut watched = logins.watch(&first.login).unwrap();
        logins.terminal(&first.login, process, pty, cancel, finish);
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
        // The engine finished it before saying it is done, and a watcher
        // heard it end.
        assert!(finished.load(std::sync::atomic::Ordering::SeqCst));
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            watched.wait_for(|status| status.done),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(done.output.contains("Signed in"), "{}", done.output);
        assert!(logins.input(&first.login, "again").await.is_err());
    }

    #[test]
    fn terminal_output_is_bounded_on_a_character_boundary() {
        let (mut state, _) = Logins::default().reserve("c").unwrap();
        append(&mut state, &"я".repeat(40_000));
        assert!(state.output.len() <= 65_536);
        append(&mut state, "last");
        assert!(state.output.ends_with("last"));
        // The count says how much was ever written, cut or not.
        assert_eq!(state.written, 80_004);
    }
}
