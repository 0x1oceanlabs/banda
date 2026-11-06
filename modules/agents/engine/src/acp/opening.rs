//! Opening a Harness's session for a Thread: a new one, one the Thread
//! had, continued, or a fork, and what the Thread keeps of it.

use super::*;

/// What a Thread keeps of its session: evidence, not identity (ADR 0002,
/// decision 7).
#[derive(Serialize, Deserialize)]
pub struct Evidence {
    harness: String,
    session: String,
    lasts: Lasts,
    /// The Thread's next session is to be a fork of `session` at this
    /// reply (ADR 0027): its conversation to there, and no further. It
    /// goes before a session open in this process, which knows more.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fork: Option<ForkAt>,
}

/// A reply of a session, which a fork of it goes to: by the ID the
/// Harness gave its message, as Claude Code's and Codex's adapters find it
/// in the request's `_meta.jetbrains.air.fork`, JetBrains AIR's extension.
/// None goes back before the first reply: a new session, as a Thread
/// edited from its first message is.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ForkAt {
    pub message: Option<String>,
}

/// `meta` with what forks a session at `message`.
fn forked_at(mut meta: acp::Meta, message: &str) -> acp::Meta {
    let fork = serde_json::json!({ "version": 1, "messageId": message });
    meta.insert(
        "jetbrains".to_owned(),
        serde_json::json!({ "air": { "fork": fork } }),
    );
    meta
}

impl Evidence {
    /// The session of a Thread that forks this one's at `at`.
    pub fn forked_at(mut self, at: ForkAt) -> Evidence {
        self.fork = Some(at);
        self
    }

    /// The session a new process of `harness` may continue: one of its
    /// own, or one of an entry `kin` says shares its sessions, another
    /// account of the same Harness (ADR 0078, decision 4).
    fn continued_by(&self, harness: &str, kin: &dyn Fn(&str) -> bool) -> Option<acp::SessionId> {
        let lasts = matches!(self.lasts, Lasts::Harness);
        let ours = self.harness == harness || kin(&self.harness);
        (lasts && ours).then(|| acp::SessionId::new(self.session.as_str()))
    }
}

/// How a Thread's session came to be open in this process.
pub enum Opened {
    /// It was open already.
    Known,
    /// The Harness continued the session the Thread had before.
    Continued,
    /// A new session. `lost` when the Thread had one the Harness could not
    /// continue.
    New { evidence: Evidence, lost: bool },
}

/// How long a session outlives its Harness process.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Lasts {
    /// It ends with the process.
    Process,
    /// The Harness can load it again after a restart.
    Harness,
}

/// What a session's request gives its Agent to reach Banda (ADR 0019),
/// and what its Harness may load of the Project's folder (ADR 0083,
/// decision 5).
struct Given {
    /// `banda mcp`, as ACP hands an MCP server to a session, named `banda`.
    servers: Vec<acp::McpServer>,
    /// Claude Code's options, which its adapter takes from
    /// `_meta.claudeCode.options`; another Harness passes them by. None
    /// when there are none.
    ///
    /// - `env`: the same pass for the `banda` the Agent runs in its shell.
    ///   The adapter starts the session's Claude Code with it over its
    ///   process's own, and its shell inherits it. Another Harness's
    ///   Agents' shells keep their process's (`live.rs`).
    /// - `settingSources`: in a Project the Person has not trusted, the
    ///   Person's own settings alone, so Claude Code loads none of the
    ///   folder's settings, hooks, `CLAUDE.md` or `.mcp.json` servers.
    ///   Codex's process is told by its variable
    ///   ([`banda_harnesses::UNTRUSTED_VARIABLE`]).
    meta: Option<acp::Meta>,
}

impl Given {
    fn of(banda: Option<Program>, trusted: bool) -> Given {
        let mut options = serde_json::Map::new();
        if !trusted {
            options.insert("settingSources".to_owned(), serde_json::json!(["user"]));
        }
        let mut servers = Vec::new();
        if let Some(Program { program, args, env }) = banda {
            options.insert("env".to_owned(), serde_json::json!(env));
            let variables = env.into_iter();
            let server = acp::McpServerStdio::new("banda", program).args(args).env(
                variables
                    .map(|(name, value)| acp::EnvVariable::new(name, value))
                    .collect(),
            );
            servers.push(acp::McpServer::Stdio(server));
        }
        let meta = (!options.is_empty()).then(|| {
            let claude = serde_json::json!({ "options": options });
            acp::Meta::from_iter([("claudeCode".to_owned(), claude)])
        });
        Given { servers, meta }
    }
}

impl Connection {
    /// A session of its own in `folder`, in no Thread's place and with no
    /// `banda mcp`, for a short run (`agents.write`); closed after with
    /// [`Session::close`]. It loads what the Project's folder names only
    /// as the Thread's own would.
    pub async fn aside(self: &Arc<Self>, folder: &Path) -> Result<Session, Ending> {
        let new = acp::NewSessionRequest::new(folder).meta(Given::of(None, self.trusted).meta);
        let made = self.open(new, "open a session").await?;
        let options = made.config_options.unwrap_or_default();
        opened(&self.learned, &made.session_id, options, folder);
        Ok(Session::new(self, made.session_id))
    }

    /// The Harness's session for `thread`, opened in `folder` on first use,
    /// with `roots` as extra roots its Agent may read (ADR 0026).
    /// A Thread that had a session continues it when the Harness can, by
    /// resuming it or else by loading it, also one another entry `kin` to
    /// this one opened; otherwise a new one opens. A
    /// session that opens, either way, gets `banda()`, the `banda mcp` its
    /// Agent reaches Banda through, as a stdio MCP server, its pass for
    /// the Agent's shell, and, in a Project not trusted, only the Person's
    /// own settings ([`Given`]).
    pub async fn session(
        self: &Arc<Self>,
        thread: ThreadId,
        folder: &Path,
        roots: &[PathBuf],
        earlier: Option<&Evidence>,
        kin: &(dyn Fn(&str) -> bool + Sync),
        banda: impl FnOnce() -> Option<Program>,
    ) -> Result<(Session, Opened), Ending> {
        let mut sessions = self.sessions.lock().await;
        // A session to fork goes before one open here, which knows more;
        // with no fork, the Thread goes on in the one it had.
        let fork = earlier.and_then(|earlier| Some((earlier, earlier.fork.as_ref()?)));
        let earlier = earlier.filter(|_| fork.is_none());
        if fork.is_none()
            && let Some(session) = sessions.get(&thread)
        {
            return Ok((Session::new(self, session.clone()), Opened::Known));
        }
        let given = Given::of(banda(), self.trusted);
        if let Some((
            earlier,
            ForkAt {
                message: Some(message),
            },
        )) = fork
        {
            if !self.agreed.forks {
                return Err(Ending::failed(
                    format!("{} cannot fork a conversation.", self.process.name()),
                    None,
                ));
            }
            let fork = acp::ForkSessionRequest::new(earlier.session.clone(), folder)
                .additional_directories(roots.to_vec())
                .mcp_servers(given.servers)
                .meta(forked_at(given.meta.unwrap_or_default(), message));
            let made = self.open(fork, "fork this Thread's conversation").await?;
            let (session, options) = (made.session_id, made.config_options);
            return Ok(self.opened(thread, &mut sessions, session, options, folder, false));
        }
        if let Some(session) = earlier.and_then(|e| e.continued_by(self.process.harness(), kin))
            && let Some(options) = self.continue_session(&session, folder, roots, &given).await
        {
            opened(&self.learned, &session, options, folder);
            sessions.insert(thread, session.clone());
            return Ok((Session::new(self, session), Opened::Continued));
        }
        let new = acp::NewSessionRequest::new(folder)
            .additional_directories(roots.to_vec())
            .mcp_servers(given.servers)
            .meta(given.meta);
        let made = self.open(new, "open a session").await?;
        let (session, options) = (made.session_id, made.config_options);
        Ok(self.opened(
            thread,
            &mut sessions,
            session,
            options,
            folder,
            earlier.is_some(),
        ))
    }

    /// Asks the Harness for a session, `doing` that in plain words if it
    /// cannot, or does not within a minute.
    pub(super) async fn open<R: agent_client_protocol::JsonRpcRequest>(
        &self,
        request: R,
        doing: &str,
    ) -> Result<R::Response, Ending> {
        let asked = self.process.cx().send_request(request).block_task();
        match timeout(OPENING, asked).await {
            Ok(made) => made.map_err(|error| failed(self.process.name(), &error)),
            Err(_) => Err(Ending::failed(
                format!("{} did not {doing} within a minute.", self.process.name()),
                Some(Failure::HarnessStopped),
            )),
        }
    }

    /// A session the Harness opened anew for `thread`, and its evidence.
    pub(super) fn opened(
        self: &Arc<Self>,
        thread: ThreadId,
        sessions: &mut HashMap<ThreadId, acp::SessionId>,
        session: acp::SessionId,
        options: Option<Vec<acp::SessionConfigOption>>,
        folder: &Path,
        lost: bool,
    ) -> (Session, Opened) {
        opened(&self.learned, &session, options.unwrap_or_default(), folder);
        sessions.insert(thread, session.clone());
        let evidence = Evidence {
            harness: self.process.harness().to_owned(),
            session: session.0.to_string(),
            lasts: if self.agreed.loads || self.agreed.resumes {
                Lasts::Harness
            } else {
                Lasts::Process
            },
            fork: None,
        };
        (Session::new(self, session), Opened::New { evidence, lost })
    }

    /// Asks the Harness to continue `session`: resumed if it can, else
    /// loaded. A load replays the conversation, which nobody hears: the
    /// Thread already shows it. The session's options, if it is open again.
    async fn continue_session(
        &self,
        session: &acp::SessionId,
        folder: &Path,
        roots: &[PathBuf],
        given: &Given,
    ) -> Option<Vec<acp::SessionConfigOption>> {
        let answer = if self.agreed.resumes {
            let resume = acp::ResumeSessionRequest::new(session.clone(), folder)
                .additional_directories(roots.to_vec())
                .mcp_servers(given.servers.clone())
                .meta(given.meta.clone());
            let asked = self.process.cx().send_request(resume).block_task();
            timeout(OPENING, asked)
                .await
                .map(|a| a.map(|r| r.config_options))
        } else if self.agreed.loads {
            let load = acp::LoadSessionRequest::new(session.clone(), folder)
                .additional_directories(roots.to_vec())
                .mcp_servers(given.servers.clone())
                .meta(given.meta.clone());
            let asked = self.process.cx().send_request(load).block_task();
            timeout(OPENING, asked)
                .await
                .map(|a| a.map(|r| r.config_options))
        } else {
            return None;
        };
        match answer {
            Ok(Ok(options)) => Some(options.unwrap_or_default()),
            Ok(Err(error)) => {
                tracing::info!(%error, "the Harness could not continue a session");
                None
            }
            Err(_) => {
                tracing::info!("the Harness took too long to continue a session");
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn a_session_s_shell_gets_the_pass_its_banda_mcp_has() {
        let env = BTreeMap::from([
            (
                "BANDA_ENGINE".to_owned(),
                "ws://127.0.0.1:4000/ws".to_owned(),
            ),
            ("BANDA_TOKEN".to_owned(), "f00d".to_owned()),
        ]);
        let banda = Program {
            program: "/bin/banda".to_owned(),
            args: vec!["mcp".to_owned()],
            env: env.clone(),
        };
        let given = Given::of(Some(banda), true);
        let [acp::McpServer::Stdio(server)] = &given.servers[..] else {
            panic!("one stdio server: {:?}", given.servers);
        };
        let served: BTreeMap<_, _> = (server.env.iter())
            .map(|v| (v.name.clone(), v.value.clone()))
            .collect();
        assert_eq!(served, env);
        let shell = json!({ "claudeCode": { "options": { "env": env } } });
        assert_eq!(given.meta.clone().map(Value::Object), Some(shell));
        let forked = Value::Object(forked_at(given.meta.unwrap(), "m1"));
        assert_eq!(
            forked["claudeCode"]["options"]["env"]["BANDA_TOKEN"],
            "f00d"
        );
        assert_eq!(forked["jetbrains"]["air"]["fork"]["messageId"], "m1");

        let none = Given::of(None, true);
        assert!(none.servers.is_empty());
        assert_eq!(none.meta, None, "no pass, no _meta");
    }

    #[test]
    fn a_session_in_a_project_not_trusted_reads_only_the_persons_own_settings() {
        let env = BTreeMap::from([("BANDA_TOKEN".to_owned(), "f00d".to_owned())]);
        let banda = Program {
            program: "/bin/banda".to_owned(),
            args: vec!["mcp".to_owned()],
            env: env.clone(),
        };
        let trusted = Given::of(Some(banda.clone()), true).meta.map(Value::Object);
        let options = &trusted.unwrap()["claudeCode"]["options"];
        assert_eq!(options.get("settingSources"), None, "Claude Code's own");

        let given = Given::of(Some(banda), false);
        assert_eq!(given.servers.len(), 1, "it reaches Banda all the same");
        let meta = Value::Object(given.meta.unwrap());
        let only = json!({ "env": env, "settingSources": ["user"] });
        assert_eq!(meta["claudeCode"]["options"], only);
        // A fork, a resume and a load carry the same `_meta`.
        let forked = Value::Object(forked_at(meta.as_object().unwrap().clone(), "m1"));
        assert_eq!(
            forked["claudeCode"]["options"]["settingSources"],
            json!(["user"])
        );

        let aside = Given::of(None, false).meta.map(Value::Object);
        assert_eq!(
            aside,
            Some(json!({ "claudeCode": { "options": { "settingSources": ["user"] } } })),
            "a short run with no pass"
        );
    }
}
