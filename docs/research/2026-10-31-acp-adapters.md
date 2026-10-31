# ACP and the Claude and Codex adapters: what a Thread can get

- **Date:** 2026-10-31.
- **Sources:**
  - **S**: the ACP spec, github.com/agentclientprotocol/agent-client-protocol at
    `b4c72a8` (JSON schema v1 1.28.0, v2 2.0.0-alpha.11, Rust schema crate 1.14.0).
  - **C**: github.com/agentclientprotocol/claude-agent-acp at `eb78afa`, version
    0.99.1, the version we pin. It wraps `@anthropic-ai/claude-agent-sdk` 0.3.312
    (C `package.json:69`).
  - **X**: github.com/agentclientprotocol/codex-acp at `927c480`, version 2.5.0,
    the version we pin. TypeScript; it starts the Codex App Server and depends on
    `@openai/codex` `^0.165.0` (X `package.json:72`).
  - **E**: our engine, `modules/agents/engine/src/` on branch `docs/harness-research`.
  - **R**: the Rust crates we build with, from `~/.cargo/registry`:
    `agent-client-protocol-3.6.0` and `agent-client-protocol-schema-1.13.0`
    (`Cargo.lock:6-7`, `39-40`).
  - **T**: github.com/pingdotgg/t3code at `15fe2832`, only to re-check the
    earlier note's claims.
- **How:** we read shallow clones and ran nothing. Paths under C and X are
  under `src/` unless they start with `docs/`, `README` or `CHANGELOG`. Paths
  under R are under `src/` (schema paths under `src/v1/`). A bare S page such
  as `initialization.mdx` is in `docs/protocol/v1/`; `rfds/` and `protocol/v2/`
  are under `docs/`; a bare `meta*.json` or `schema*.json` is in `schema/v1/`;
  `docs.json` is `docs/docs.json`.
- **Limits:** this is evidence, not a decision. We read the ACP v1 surface,
  which is what we speak. Both adapters also serve the draft v2 (C
  `README.md:114-128`, X `CodexAcpServer.ts:858`). "Inferred" marks a claim we
  reached from code, not from a statement. Line numbers drift: re-check them
  against a fresh clone.

## Words

- **Stable**: in S `schema/v1/meta.json` or a Completed RFD.
- **Unstable**: in S `schema/v1/meta.unstable.json` or a Draft, Active or
  Preview RFD (S `docs/docs.json:196-262`).
- **Extension**: a `_meta` key or a `_`-prefixed method that one or both
  adapters define. ACP allows both (S `docs/protocol/v1/extensibility.mdx:8,45,115`).
- **Plain client**: a client that declares no adapter extension. We are one.

## Capability table

| Capability | Spec | Claude adapter 0.99.1 | Codex adapter 2.5.0 | Our engine today |
|---|---|---|---|---|
| **1. initialize** | | | | |
| Protocol version | v1 stable; v2 a draft (S `schema/v2/Cargo.toml:3`) | v1, and v2 when asked (C `README.md:116-122`) | v1, and v2 when asked (X `CodexAcpServer.ts:798,858`) | asks v1, refuses other answers (E `acp.rs:284-299`) |
| `loadSession` | stable (S `protocol/v1/initialization.mdx:223`) | `true` (C `acp-agent.ts:3102`) | `true` (X `CodexAcpServer.ts:836`) | read and stored as `lasts`, never used to load (E `acp.rs:183,290`) |
| Session capabilities | list, resume, close, delete, additionalDirectories stable (S `meta.json:12-15`); fork, systemPrompt unstable (S `meta.unstable.json:18`, `docs.json:198,239`) | all of these; `subagents` only for AIR (C `acp-agent.ts:3063-3072`) | all of these and `subagents` (X `CodexAcpServer.ts:810-822`) | none read |
| Prompt content | text and resource_link baseline (S `content.mdx:31,170`); image, audio, embedded context optional (S `initialization.mdx:243-254`) | image, embeddedContext (C `acp-agent.ts:3087-3090`); audio refused with -32602 (C `acp-agent.ts:3896-3912`) | image, embeddedContext (X `CodexAcpServer.ts:837-840`) | one text block (E `acp.rs:205`) |
| MCP transports | stdio baseline, http and sse optional (S `session-setup.mdx:399,407`) | http, sse (C `acp-agent.ts:3091-3094`) | http; sse and acp refused with -32602 (X `CodexAcpServer.ts:842-846`, `McpServerConfig.ts:68-78`) | sends none: `mcpServers` empty (E `acp.rs:172`; R schema `agent.rs:846-855`) |
| Client `elicitation` | stable (S `initialization.mdx:160`) | form: AskUserQuestion, MCP forms. Without it AskUserQuestion is disabled and MCP elicitations auto-decline (C `acp-agent.ts:11983-11986,12120-12126`) | form: Plan-mode and async questions, MCP forms; url: device-code login. Without form, questions get empty answers (X `CodexElicitationHandler.ts:420-423`, `CodexAuthMethod.ts:77-79`) | not declared (E `acp.rs:284-286`) |
| Client `auth.terminal` | stable (S `initialization.mdx:123`, `docs.json:242`) | needed for every login method (C `acp-agent.ts:2980-3060`) | not used: no terminal login (X `docs/air-extensions.md:294`) | not declared |
| Client `session.notices`, `session.compaction`, `session.configOptions.boolean` | stable; agents must not send notices or compaction updates without them (S `initialization.mdx:172-217`) | honoured (C `session-notices.ts:18-23`, `context-compaction.ts:47-49`, `acp-agent.ts:11417`) | honoured (X `SessionNotice.ts:4`, `CodexSessionCompactions.ts:14`, `FastModeConfig.ts:21-23`) | not declared |
| Client `fs`, `terminal` | stable (S `initialization.mdx:135-151`) | no caller found; Claude Code edits and runs itself (inferred from C `acp-agent.ts:10066-10074`) | not used (inferred: no caller in X `src/`) | not declared |
| **2. Sign-in** | | | | |
| Auth methods | `agent` and `terminal` types stable (S `authentication.mdx:78-128`) | `claude-ai-login` (subscription) runs `--cli auth login --claudeai`; `console-login`; over SSH `claude-login` runs `--cli`. Offered only with `auth.terminal` or `_meta["terminal-auth"]`. `gateway` only with `auth._meta.gateway` (C `acp-agent.ts:2956-3060`) | `api-key`; `chat-gpt` unless `NO_BROWSER`; `chat-gpt-device-code` with url elicitation; `gateway` on opt-in (X `CodexAuthMethod.ts:72-85`) | ignored |
| Subscription login flow | terminal: the client runs the same program with the method's `args` in a terminal, waits for exit 0, then restarts and re-initializes (S `authentication.mdx:169-188`) | `--cli` makes the adapter run the bundled Claude CLI with the rest of the arguments (C `index.ts:13-16`). `authenticate` accepts only gateway ids (C `acp-agent.ts:3369-3399`) | the client calls `authenticate {methodId:"chat-gpt"}`; the adapter opens the browser itself and waits for the login to complete (X `CodexAcpClient.ts:267-279`) | none |
| "Auth required" | `-32000` (S `error.mdx:34`) | the turn's `session/prompt` fails with -32000; the CLI's "/login" text is suppressed (C `acp-agent.ts:2366-2372,7686-7692,8399-8404`) | `session/new` fails with -32000 when no login and no `DEFAULT_AUTH_REQUEST` (X `CodexAcpServer.ts:1082-1099,1276`); a failed `authenticate` is -32000 with `data.methodId` (X `CodexAcpServer.ts:2203-2206`) | flattened to a string (E `acp.rs:175,213`, `turn.rs:237`) |
| Who is signed in | `auth/status` unstable Draft (S `meta.unstable.json:26,41`, `docs.json:203`) | pushes `_auth/status_update` {kind, label, account} (C `auth-status.ts:1-54`) | same notification (X `AuthStatusMeta.ts:34`) | ignored by the crate (R `jsonrpc.rs:488`) |
| `logout` | stable (S `authentication.mdx:196-222`) | yes (C `acp-agent.ts:3795`) | yes (X `CodexAcpServer.ts:2237`) | not used |
| **3. Sessions** | | | | |
| New | stable | yes | yes | one per Thread per process, in memory (E `acp.rs:106,159-188`) |
| Load with replay | stable: replay the whole conversation as `session/update`, then answer (S `session-setup.mdx:85-200`) | replays Claude Code's transcript (C `acp-agent.ts:3270-3290,9511-9518`) | replays the Codex thread history (X `CodexAcpServer.ts:1844-1868`) | never called |
| Resume, no replay | stable (S `session-setup.mdx:205-268`) | yes (C `acp-agent.ts:3262-3268`) | yes (X `CodexAcpServer.ts:1930`) | never called |
| List | stable (S `session-list.mdx:35`) | the SDK's sessions for a cwd, 1000 a page (C `acp-agent.ts:2036,3295-3331`) | the app server's threads (X `CodexAcpServer.ts:2018-2041`) | never called |
| Fork | unstable; "fork from a message" reserved for later (S `rfds/session-fork.mdx:45-47`) | yes; at a message via `_meta.jetbrains.air.fork` (C `fork-session.ts:17-60`, `acp-agent.ts:3230-3253`) | yes; same `_meta` (X `SessionFork.ts:78-135`) | none |
| Close | stable, idempotent (S `session-setup.mdx:270-330`) | yes (C `acp-agent.ts:9377`) | yes (X `CodexAcpServer.ts:2043`) | never called; the process ends instead |
| **4. Modes, models, config** | | | | |
| Session modes | stable, superseded by config options (S `session-config-options.mdx:460-470`) | `default` (Manual), `acceptEdits`, `plan`, `auto`, `bypassPermissions` unless root (C `session-mode.ts:353-394`, `permissions/modes.ts:9`). Starts in the transcript's mode or the settings' `defaultMode` (C `session-mode.ts:78-107`) | `read-only`, `workspace-write`, `agent` ("Auto review", the default), `agent-full-access`; each is an approval policy plus a sandbox (X `AgentMode.ts:38-95`) | ignored |
| Config options | stable; categories `mode`, `model`, `model_config`, `thought_level`; others reserved unless `_` (S `session-config-options.mdx:211-226`) | mode, model, effort (`thought_level`), fast mode and ultracode (`model_config`) (C `acp-agent.ts:13528-13560`, `session-effort.ts:121-134`) | mode, model, `reasoning_effort`, `fast-mode`, `collaboration_mode` default/plan with an unlisted category (X `ModelConfigOption.ts:6-7,69,89`, `CollaborationModeConfig.ts:10-22`) | ignored; never sets one |
| Model API | the unstable session model API was removed on 2026-06-01 (S `rfds/updates.mdx:341`) | not sent (C `acp-agent.ts:11753-11757`) | still sends `models` and serves `session/set_model` (X `CodexAcpServer.ts:1864`, `AcpExtensions.ts:42`) | n/a |
| **5. Permissions** | | | | |
| Option kinds | `allow_once`, `allow_always`, `reject_once`, `reject_always`; the Agent owns remembered decisions (S `tool-calls.mdx:216-243`) | allow-once, "Yes, and don't ask again for …" (`allow_always`), reject; ExitPlanMode offers mode switches as `allow_always` (C `permissions/options/shared.ts:3-60`, `options/tools.ts:31-126`) | allow once, `allow_for_session` (kind `allow_always`, scope this session), decline, cancel, exec-policy and network amendments (X `permissions/options.ts:16-77`) | drops every `*_always` option; fails the turn if none is left (E `rules.rs:61-74`, `turn.rs:330-338`) |
| Survives a restart | nothing in the spec (inferred: no mention found) | no (inferred: a pending JSON-RPC request on stdio) | no; recovery re-resumes sessions after an app-server crash, not requests (X `app-server-recovery/AppServerRecovery.ts:100-108`) | no: effects abandoned (E `lib.rs:264-267`) |
| **6. Stop, steer, queue** | | | | |
| Cancel | stable; the client answers open permission requests `cancelled` (S `prompt-turn.mdx:547-575`) | cancels the running and queued prompts sent before it; background subagents keep running (C `acp-agent.ts:8885-8912`, `README.md:71-83`) | aborts open requests, interrupts the turn (X `CodexAcpServer.ts:5648-5679`) | sends `session/cancel`, answers open Questions `cancelled` (E `acp.rs:219-224`, `live.rs`) |
| Mid-turn input | none (no steering in S `schema/v1/schema.unstable.json`) | `_session/steering`: `injected`, `startedNewTurn`, or `promptRequired` on opt-in (C `acp-agent.ts:680-685,4533-4608`) | the same method and outcomes (X `docs/steering.md:9-56`) | none |
| Queued prompts | v1 silent; v2 draft: hold or insert, never reject (S `protocol/v2/prompt-lifecycle.mdx:297-301`) | queues them; marker `agentCapabilities._meta.claudeCode.promptQueueing` (C `acp-agent.ts:3077-3080`) | a second prompt waits for the turn slot (X `CodexAcpServer.ts:4759-4785`) | its own outbox queue, one turn per Agent (E `turn.rs:3-4`) |
| **7. Content** | | | | |
| Message and thought chunks | stable, with `messageId` (S `prompt-turn.mdx:12-31,190`) | yes, with `messageId` (C `acp-agent.ts:5623`) | yes, with `messageId` (X `ContentChunks.ts:15-35`) | text only, no id (E `acp.rs:316-327`) |
| Tool calls | stable: kind, status, content (text, diff, terminal), locations, rawInput/Output (S `tool-calls.mdx:12-336`) | all, diffs from edits (C `diff.ts:183`); a plain client gets command output as a `console` code block (C `docs/air-extensions.md:244-245`) | all (X `tool-calls/reporters/FileChangeReporter.ts:65,104`); a plain client gets `content: [{type:"terminal"}]` and the output only in `_meta.terminal_output_delta` (X `docs/air-extensions.md:267,278,284`) | id, title, kind, status (E `acp.rs:328-340`) |
| Plan | stable `plan`; `plan_update` unstable (S `docs.json:201`) | `plan` from todos (C `acp-agent.ts:4463`) | `plan` (X `CodexEventHandler.ts:1087`); a plan-mode plan comes as one agent message (X `CodexPlanStream.ts:7-14`) | dropped |
| Commands, mode, config, info updates | stable | all; commands after session setup (C `acp-agent.ts:3283-3285`, `session-mode.ts:286`, `session-titles.ts:295`) | all but `current_mode_update` (inferred from grep); errors on retry go in `session_info_update._meta.codex` (X `CodexEventHandler.ts:799-806,1123-1136`) | dropped |
| Notices, compaction | stable, capability-gated | without the capability: a synthetic "Compact conversation" tool call (C `context-compaction.ts:10-18`) | same fallback (X `docs/session-compaction.md:23`) | not declared |
| Subagents | unstable, Active RFD (S `docs.json:210-213`) | child sessions after `clientCapabilities.subagents`; otherwise tool calls (C `README.md:41-112`) | same (X `docs/subagent-sessions.md:5-30`) | not declared |
| Slash commands | stable `available_commands_update` (S `slash-commands.mdx`) | Claude Code commands, `/mcp`, `/usage` (C `README.md:18-21`) | `/status`, `/mcp`, `/skills`, `/goal`, `/review`, `/compact`, `/logout` (X `README.md:27`) | dropped |
| **8. Usage and limits** | | | | |
| Context window | `usage_update` {used, size, cost?} stable (S `prompt-turn.mdx:425-449`) | used, size, cost in USD; `_meta["_claude/model"]` (C `acp-agent.ts:4971-4991,7346-7360`) | used, size; no cost (X `CodexEventHandler.ts:1337-1360`) | dropped |
| Per-turn tokens | `PromptResponse.usage` unstable Draft (S `schema.unstable.json:4279-4280`, `docs.json:202`) | `usage` and `_meta.quota` {token_count, model_usage[]} (C `acp-agent.ts:12898-12907,12960-12987`) | the same shape; all tokens on the current model (X `CodexAcpServer.ts:5578-5596`) | not compiled (R schema `agent.rs:3362`); `_meta` dropped |
| Rate limits | none (0 matches in S `schema/v1/schema*.json`) | `usage_update._meta["_claude/rateLimit"]` (C `acp-agent.ts:8624-8634`); 5-hour and weekly in `/usage` text (C `usage-markdown.ts:175-185`) | only in `/status` text (X `CodexCommands.ts:585-598,655-690`) | none |
| **10. Errors** | -32000 auth, -32002 not found, -32800 cancelled (S `error.mdx:33-35`) | provider failures end the prompt with -32603 and `data.errorKind` (C `acp-agent.ts:4993-4996,7754-7768,13208-13212`) | errors stream as agent text; a usage limit also ends the prompt with -32603 and `data.codexErrorInfo` (X `CodexEventHandler.ts:1144-1152,1309-1328`) | strings |

Row 9 (extensions) has its own table below.

## 9. Extensions that matter for a chat

| Key or method | Adapter | How a client gets it | What it gives |
|---|---|---|---|
| `_session/steering` request | both | the agent advertises `_meta.steering.supported`; the client may send `_meta.steering.idleBehavior: "promptRequired"` (C `acp-agent.ts:3142-3144`; X `docs/steering.md:9-56`) | input into the running turn |
| `_auth/status_update` notification | both | always sent; marker `agentCapabilities._meta.authStatus` (C `auth-status.ts:1-48`; X `CodexAcpServer.ts:847-851`) | who is signed in |
| `PromptResponse._meta.quota` | both | always (C `acp-agent.ts:12960-12987`; X `CodexAcpServer.ts:5579`) | tokens of the turn, by model |
| `usage_update._meta["_claude/rateLimit"]`, `"_claude/model"` | Claude | always (C `acp-agent.ts:4971-4991,8624-8634`) | the SDK's rate-limit info; the model |
| `_meta.claudeCode.options` on session/new and load | Claude | the client sends SDK options; ACP keeps cwd, permission mode and tool gating (C `acp-agent.ts:1845-1870`) | per-session Claude Code options |
| `_meta.claudeCode.emitRawSDKMessages` | Claude | on session/new (C `acp-agent.ts:1863-1870`) | raw SDK messages as `_claude/sdkMessage` |
| client `_meta.terminal_output` or `terminal_output_delta` | both | declared in `initialize` (C `tool-calls/client-capabilities.ts:38-46`; X `docs/air-extensions.md:263-289`) | streamed command output |
| client `_meta["terminal-auth"]` | Claude | declared in `initialize` (C `acp-agent.ts:2981`) | the exact login command and args |
| client `auth._meta.gateway` | both | declared in `initialize` (C `acp-agent.ts:2956`; X `CodexAuthMethod.ts:80`) | a gateway login method |
| `_meta.jetbrains.air.fork` on session/fork | both | sent by the client; no AIR check (inferred from C `fork-session.ts:47-60`, X `SessionFork.ts:78-83`) | fork at a message |
| `_meta.jetbrains.air` bundle | both | only for a client that declares AIR (C `docs/air-extensions.md:51-148`; X `docs/air-extensions.md:47-153`) | typed session failures, goals (`_session/goal`), async tasks (`_session/async_task/stop`), session index, permission presentation |
| `session/set_model`, `authentication/status` | Codex | ext methods (X `AcpExtensions.ts:42,84-90`) | legacy model switch; auth state on request |
| env `DEFAULT_AUTH_REQUEST`, `INITIAL_AGENT_MODE`, `NO_BROWSER` | Codex | process environment (X `README.md:75-77`) | auto-login, start mode, hide browser login |
| `--hide-claude-auth` flag | Claude | process argument (C `hide-claude-auth.ts:1-40`) | refuse any turn a claude.ai subscription would pay for |

## 10. How often they change

- **Claude adapter:** 43 releases from 2026-08-02 to 2026-10-29, about one every
  two days (C `CHANGELOG.md:3-555`). One marked breaking: 0.77.0 stopped
  forwarding `claudeCode.options.agent` (C `CHANGELOG.md:392-397`).
- **Codex adapter:** 26 releases from 2026-08-11 to 2026-10-29 (X
  `CHANGELOG.md:3-318`). One marked breaking: 2.0.0, the AIR tool-call contract,
  with changes "for every client" (X `CHANGELOG.md:131-138`). Its Codex
  dependency is a caret range, so `npx` can fetch a newer 0.165.x (inferred
  from X `package.json:72`).
- **Spec:** 9 JSON schema v1 releases in the same three months (S
  `schema/v1/CHANGELOG.md:10-106`) and 11 Rust schema crate releases (S
  `CHANGELOG.md:5-209`). The removals were in unstable parts only: next-edit
  suggestions on 2026-10-16 (S `CHANGELOG.md:124`). Our crate's schema 1.13.0 is
  from 2026-10-27 (S `CHANGELOG.md:64`).

## T3 Code's "What ACP lacks", re-checked

The list is in our earlier note (`2026-10-31-t3-code.md`), from T
`docs/user/providers-acp.md:124-131` and T
`packages/provider-acp/src/server/adapter.ts:514-660`.

1. **Conversation rollback. Partly.** The spec has no rewind or truncate
   method, stable or unstable (S `meta.json`, `meta.unstable.json`).
   `session/fork` is unstable, and the RFD leaves "forking from a specific
   message" for later (S `rfds/session-fork.mdx:45-47`). But both adapters fork
   at a message today through `_meta.jetbrains.air.fork = {version: 1,
   messageId}` (C `fork-session.ts:17-60`; X `SessionFork.ts:78-135`), and both
   tag chunks with `messageId`. So rollback works as "fork at a message, then
   use the fork", through an extension.
2. **Approvals that survive a restart. Still true.** The spec says nothing on
   it (inferred: no mention found). A permission request is a JSON-RPC request
   on the process's stdio. T3 marks `pendingRequestsSurviveRestart: false` (T
   `adapter.ts:520`). Codex's crash recovery resumes sessions, not requests (X
   `app-server-recovery/AppServerRecovery.ts:100-108`).
3. **Portable subagent lineage. Partly.** The Subagent Sessions RFD is Active
   and unstable (S `docs.json:210-213`). Both adapters implement it once the
   client declares `clientCapabilities.subagents`: `subagent_update` names the
   parent before child traffic (C `README.md:41-58`; X
   `docs/subagent-sessions.md:5-20`). Without it, subagents stay tool calls.
4. **Defined usage figures. Partly.** `usage_update` (context used, size, cost)
   is stable since 2026-06-05 (S `rfds/updates.mdx:284-287`). Per-turn tokens
   (`PromptResponse.usage`) are still a Draft (S `docs.json:202`), though both
   adapters fill it and the same `_meta.quota`. Rate limits have no spec field.
5. **HTTP MCP on some agents. No longer true for these two.** Claude takes http
   and sse (C `acp-agent.ts:3091-3094`). Codex takes http (X
   `McpServerConfig.ts:68-70,92-96`); T3's comment names codex-acp 1.2.0 (T
   `adapter.ts:660`). Codex still refuses sse (X `McpServerConfig.ts:74-75`).

## Against our adapter today

These are facts about E at this branch. They say what we drop, not what to do.

1. **We declare no client capabilities.** `initialize` carries only the
   protocol version and `clientInfo` (E `acp.rs:284-286`). So Claude offers no
   login method (C `acp-agent.ts:3052-3058`), disables AskUserQuestion (C
   `acp-agent.ts:11986`) and auto-declines MCP elicitations (C
   `acp-agent.ts:12120-12126`). Codex answers its questions with nothing (X
   `CodexElicitationHandler.ts:420-423`). Neither sends notices, compaction
   updates or subagent sessions to us.
2. **We read two fields of the `initialize` answer:** `protocolVersion` and
   `loadSession` (E `acp.rs:289-290`). We do not read `authMethods`,
   `sessionCapabilities`, `promptCapabilities`, `mcpCapabilities`, `agentInfo`
   or any `_meta`.
3. **`session/new` carries only the folder.** No MCP servers, no `_meta` (E
   `acp.rs:172`). We keep only `sessionId` from the answer, and drop `modes`,
   `configOptions` and Codex's `models` (E `acp.rs:175-178`).
4. **Sessions do not outlive the process.** The Thread-to-session map is in
   memory (E `acp.rs:106,167`). We write the session id as evidence and never
   read it back (E `turn.rs:218-222`, `store.rs:105-112`). We never call load,
   resume, list or close. After a restart a Thread's next turn opens a new
   session (inferred from E `acp.rs:159-188` and `live.rs:1-3`).
5. **A prompt is one text block** (E `acp.rs:205`).
6. **`said()` keeps four update kinds and few fields** (E `acp.rs:316-340`):
   - message and thought chunks: text only; `messageId` and non-text content
     are dropped;
   - `tool_call`: id, title, kind, status;
   - `tool_call_update`: id, title, status.

   Everything else returns `None`: `user_message_chunk` (load replays), tool
   `content` (diffs, text, terminals), `locations`, `rawInput`, `rawOutput`,
   every `_meta`, `plan`, `available_commands_update`, `current_mode_update`,
   `config_option_update`, `session_info_update` and `usage_update`. For Codex
   that means command output: for a plain client it lives only in
   `_meta.terminal_output_delta` (X `docs/air-extensions.md:278`).
7. **Tool kinds we don't name become Other**, including `switch_mode` (E
   `acp.rs:352-363`), which Claude uses for EnterPlanMode (C `CHANGELOG.md:31`).
8. **Updates outside a running prompt are dropped.** A route exists only while
   our `session/prompt` is open (E `acp.rs:194-215,236-246`). Claude sends its
   commands after session setup (C `acp-agent.ts:3283-3285`).
9. **A Question keeps the tool call's title and the options**, not its kind,
   content, locations or input (E `acp.rs:255-259`). We drop `*_always`
   options (E `rules.rs:61-74`). These include Codex's session-scoped
   `allow_for_session` (X `permissions/options.ts:32-41`) and Claude's
   plan-exit mode switches (C `permissions/options/tools.ts:58-126`). A
   request that comes when no turn listens is answered `cancelled` (E
   `acp.rs:261-269`).
10. **The prompt answer gives only the stop reason** (E `acp.rs:213,376-395`).
    We drop `_meta.quota`. Our build has no `usage` field: we enable only the
    `process` feature (E `../Cargo.toml:11`; R schema `agent.rs:3362`).
11. **Errors become strings** (E `acp.rs:121-123,175,213`, `turn.rs:237`).
    "Auth required" (-32000) looks like any other failure.
12. **Extension traffic is ignored.** The crate ignores notifications nobody
    handles (R `jsonrpc.rs:488`), so `_auth/status_update` goes nowhere. We
    never send `_session/steering`.
13. **Unstable update kinds would not parse in our build.** The schema enum has
    no catch-all (R schema `client.rs:98-180`). The crate logs the error and
    drops the notification (R `jsonrpc/handlers.rs:275`,
    `jsonrpc/incoming_actor.rs:691-697`). The adapters send these kinds only
    after a negotiation we do not make.
14. **Stop matches the spec.** We send `session/cancel` and answer open
    Questions `cancelled` (E `acp.rs:219-224`; S `prompt-turn.mdx:563`).
15. **We queue turns ourselves**, one per Agent (E `turn.rs:3-4`, `lib.rs:338-342`),
    so the adapters' own prompt queues stay idle.
16. **We start each adapter with `npx -y` at an exact version** (E
    `settings.rs:53-60`). The first start may download it; we allow two
    minutes (E `acp.rs:27-29`).
