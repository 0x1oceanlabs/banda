# T3 Code: how it reaches Claude Code and Codex

- **Date:** 2026-10-31.
- **Source:** github.com/pingdotgg/t3code at commit `15fe2832` (2026-10-31), MIT
  licence, copyright 2026 T3 Tools Inc.
- **How:** we read the docs and code of a shallow clone and ran nothing. The
  clone holds one commit, so no commit messages were available.
- **Limits:** this is evidence, not a decision. It builds on
  [the earlier note](2026-10-31-t3-code.md), read at `79f1fadf`, and does not
  repeat it. Line numbers are at `15fe2832` and will drift. "Inferred" marks
  what we concluded rather than read.

Paths are relative to their repository. Short keys:

| Key | Path |
|---|---|
| `CA` | `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` |
| `XA` | `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts` |
| `AA` | `packages/provider-acp/src/server/adapter.ts` |
| `AR` | `packages/provider-acp/src/server/AcpSessionRuntime.ts` |
| `PA` | `packages/provider-core/src/server/ProviderAdapter.ts` |
| `OV` | `packages/contracts/src/orchestrationV2.ts` |
| `SM` | `apps/server/src/orchestration-v2/ProviderSessionManager.ts` |
| `P/` | `apps/server/src/provider/` |
| `O/` | `apps/server/src/orchestration-v2/` |
| `D/` | `docs/` |

## 1. Processes and their lifetime

| | Claude Code | Codex | ACP agents |
|---|---|---|---|
| Client | Official Agent SDK `@anthropic-ai/claude-agent-sdk` ^0.3.276 (`apps/server/package.json:36`) | Their own JSON-RPC client. Its types are generated from `openai/codex` `codex-rs/app-server-protocol` at a pinned ref (`packages/effect-codex-app-server/scripts/generate.ts:16-19`) | Their own `effect-acp` client and one shared adapter (`AA`) |
| Program | The installed `claude` CLI, started by the SDK through a spawn hook (`CA:1026-1050`). The default binary is `claude` (`packages/contracts/src/settings.ts:714`) | `codex app-server` (`P/codexLaunchArgs.ts:12-15`, `XA:1515-1522`) | The agent's command |
| One process per | Thread (`O/Orchestrator.ts:1065-1082`, `CA:372`) | Provider instance (one account), shared by its Threads: `provider-session:provider-instance:<id>:shared` (`packages/provider-core/src/server/IdAllocator.ts:255-258`) | Thread (`AA:516`) |
| How turns go in | One long `query()` per Thread, fed by a prompt queue (`CA:965-972`, `CA:1045-1050`) | Requests on one connection. Codex accepts one `initialize` per process (`XA:1716-1730`) | ACP requests |

- **Lifetime.** A runtime is released after 30 minutes idle, or 4 hours if
  background work pins it (`SM:57-58`, `SM:1114-1180`). On Linux each agent
  runs in a `systemd-run --scope` unit; Codex's is shared, so a tool's
  out-of-memory kill spares it (`packages/shared/src/AgentScope.ts:14-17`,
  `:92-111`; `XA:1405`). A watcher kills the Claude CLI's process group when T3's pipe
  closes, even if T3 crashes (`CA:335-362`).
- **Crashes.** If Claude ends mid-turn, the turn fails as `transport_error`
  (`CA:7700-7714`). The next turn reopens the query with `resume` (inferred
  from `CA:1512-1514`, `CA:10209-10218`). A Codex exit is a typed error
  (`packages/effect-codex-app-server/src/errors.ts:136-149`). A stop waits
  15 s in the session manager (`SM:60-61`). Claude waits 10 s for the CLI to
  exit, then offers Force stop (`CA:332-333`).
- **Versions.** They read `claude --version` (`P/ClaudeProvider.ts:493`),
  `codex --version` (`P/CodexProvider.ts:623`) and Codex's `initialize` user
  agent (`P/CodexProvider.ts:539-540`). A manifest rates each CLI version per
  T3 release as supported, graceful, unsupported or broken. Codex: ≥0.159.0
  recommended, <0.149.0 broken. Claude: ≥2.1.280 recommended, <2.1.111
  unsupported (`P/model-manifest.json:4-34`). It ships in the app and
  refreshes from GitHub (`P/ModelManifest.ts:21-26`); the app warns and can
  run the CLI's installer (`D/user/install.md:179-191`). Registry agents
  install at exact versions (`D/user/providers-acp.md:47-52`).

## 2. Sign-in

- **Claude.** T3 uses Claude Code's own login; the Person runs
  `claude auth login` (`D/user/install.md:164`). A probe `query()` reads
  `initializationResult().account`: email, subscription, token source, API
  key source (`P/ClaudeProvider.ts:350`, `:372-389`). Signed out, the app
  says to run `claude auth login` (`:612-626`). Each account gets its own
  `CLAUDE_CONFIG_DIR` (`D/user/providers-claude.md:9-30`). For reset credits
  only, T3 reads the OAuth token in `<config>/.credentials.json` (not on
  macOS) and calls `api.anthropic.com/api/oauth/usage`
  (`P/claudeResetCredits.ts:14`, `:140-159`).
- **Codex, existing login.** The Person runs `codex login`, and Codex keeps
  its `auth.json` (`D/user/providers-codex.md:22-26`). T3 calls
  `account/read` and reads `requiresOpenaiAuth` (`P/CodexProvider.ts:542-550`).
- **Codex, "Connect with ChatGPT".** T3 runs its own OAuth PKCE flow with
  auth.openai.com, as a dynamic client named "T3 Code", for scope
  `chatgpt.tokens.use.direct` (`P/CodexChatGptAuth.ts:36`, `:517-536`). T3
  stores the tokens (`P/CodexManagedTokenBroker.ts:159-164`) and serves them
  on a private socket (`:35-41`). Codex runs with a custom model provider,
  `openai_token_sharing`, whose `auth` command is T3 itself
  (`P/CodexManagedRuntime.ts:22-32`, `:87-93`). Multi-agent is off there
  (`:28-29`), and API key variables are removed (`:116-123`). So in this
  mode the ChatGPT token passes through T3.
- **ACP.** Browser or terminal sign-in, as the agent advertises; credentials
  stay in its store (`D/user/providers-acp.md:54-73`). A throwaway
  `session/new` proves readiness (`D/orchestration-v2/orchestrator-mcp-server.md:134-138`).

## 3. Sessions and IDs

- **Rule:** "Provider ids are evidence. App ids are identity"
  (`D/orchestration-v2/entity-ids-and-correlation.md:3-7`). A binding records
  how it was matched: native_exact, native_scoped, ordinal, fingerprint or
  synthetic (`:75-92`). In code, item and turn IDs are derived from the
  Harness's IDs, such as `node:provider:<driver>:native-item:<id>`; other IDs
  are a prefix plus a UUIDv4 (`IdAllocator.ts:234-252`, `:279-291`).
- **Runs.** A Run is the app's turn. It can hold several provider-turn
  attempts: after a steer, a retry or a recovery
  (`D/orchestration-v2/feature-lifecycles.md:101-116`).

| | Claude | Codex | ACP |
|---|---|---|---|
| Create | T3 makes a UUIDv4 and passes it as `sessionId` (`CA:953`, `CA:1512-1514`) | `thread/start` with cwd, model and config (`XA:6953-6965`) | `session/new` (`AR:2207`) |
| Resume after restart | `resume: <id>` (`CA:1512-1514`) | `thread/resume` (`XA:6988`, `XA:7773-7775`) | `session/load` if the agent loads, else `session/resume` (`AR:2169-2200`) |
| History | Not read from Claude (`CA:11320-11326`). T3's own record is the history | `thread/read`, `thread/turns/list` (`P/CodexThreadRevert.ts:24-40`) | Replay through `session/load`; import through `session/list` (`AR:2456`, `D/user/providers-acp.md:94-105`) |
| Rollback | Close the query, reopen it with `resumeSessionAt` at an earlier message (`CA:11328-11345`) | `thread/revert` before a turn found through `thread/turns/list` (`P/CodexThreadRevert.ts:6-41`) | Not in ACP. Files are restored, and the next turn starts a fresh session (`AA:593-594`, `D/user/providers-acp.md:127-131`) |
| Fork | SDK `forkSession` (`CA:11420-11426`) | `thread/fork` (`XA:7825`) | `session/fork` when advertised (`AA:619`, `AR:2434`) |

## 4. Questions, approvals and modes

Four permission modes: Supervised, Auto-accept edits, Auto and Full access,
which is the default (`packages/contracts/src/providerPolicy.ts:25-32`,
`D/user/permission-modes.md:13-18`). Plan is a separate interaction mode,
`default | plan` (`providerPolicy.ts:34-36`).

| Mode | Codex `approvalPolicy` + sandbox (`XA:698-737`) | Claude `permissionMode` (`CA:2488-2534`) |
|---|---|---|
| Supervised | `untrusted` + `readOnly` | `default` |
| Auto-accept edits | `on-request` + `workspaceWrite` | `acceptEdits` |
| Auto | `on-request`, reviewer `auto_review` + `workspaceWrite` | `auto` |
| Full access | `never` + `dangerFullAccess` | `bypassPermissions` |
| Plan | `collaborationMode` on each `turn/start` (`XA:798-810`) | `plan` |

- **Codex** asks through `item/commandExecution/requestApproval`,
  `item/fileChange/requestApproval`, `mcpServer/elicitation/request` and
  `item/tool/requestUserInput` (`XA:5197`, `:5268`, `:5401`, `:5617`). Its
  async questions are notifications. The answer goes back as a new user
  message, and they survive reconnects and restarts
  (`D/internals/providers.md:106-114`, `D/user/providers-codex.md:79-86`).
- **Claude** answers go through the SDK's `canUseTool` callback (`CA:1560`,
  `CA:9601-9613`). If Claude's settings forbid bypass, Full access falls back
  to `auto` or `default` (`CA:2560-2564`). A read-only sandbox maps to
  `dontAsk` with a read-only tool list (`CA:2496-2497`). A typed reply to a
  waiting approval declines it with feedback
  (`D/user/permission-modes.md:45-46`).
- **ACP:** T3 answers `request_permission` itself by the Thread's mode
  (allow, ask or deny), which they call `client-boundary` enforcement
  (`packages/provider-acp/src/server/clientPolicy.ts:150-200`, `AA:605`,
  `D/user/providers-acp.md:114-117`). Claude and Codex declare `native`
  enforcement (`CA:461`, `XA:328`).
- **Their rule against their code.** The doc says: "Do not imitate a missing
  mode by answering approvals in T3: T3's check is weaker than the agent's
  own enforcement", and pass option IDs through unchanged
  (`D/internals/adding-a-provider.md:28-35`). The code has five decisions:
  accept, acceptForSession, acceptAlways, decline, cancel
  (`providerPolicy.ts:47-53`). For ACP it maps a decision back to the first
  option of the matching kind (`AA:1048-1059`), and auto-approval prefers
  allow-once (`AA:1062-1068`).
- **Restart.** All three declare `pendingRequestsSurviveRestart: false` and
  `approvalCallbacksAreLiveOnly: true` (`CA:376`, `:419`; `XA:244`, `:286`;
  `AA:520`, `:562`). At startup, open requests become `expired` with the
  answer path `not_resumable`; structured questions switch to the `message`
  path (`O/ProviderRuntimeRecoveryService.ts:360-385`). A request has a kind,
  a status and an answer path: live, message or not_resumable (`OV:1200-1224`).

## 5. Stop, steer and queue

- **Intents:** turn_start, queued_turn, steer, promoted_queued_to_steer
  (`OV:1474-1479`). Without native steering, steer becomes interrupt and
  restart inside the same Run (`D/orchestration-v2/feature-lifecycles.md:61-101`).
- **Claude steer:** a user message with `priority: "now"` goes into the live
  query, after foreground subagents move to the background (`CA:10845-10900`).
  It can cancel pending tools (`OV:286`, `CA:393`).
- **Codex steer:** `turn/steer` with `expectedTurnId` (`XA:7160-7164`).
  **ACP:** no active steering, so interrupt and restart (`AA:536-537`).
- **Interrupt:** Claude `query.interrupt`, then close and wait
  (`CA:10741-10745`); Codex `turn/interrupt` (`XA:2583`); ACP `session/cancel` (`AR:2352`).
- **Queue:** the server keeps queued messages, and the Person can edit them.
  After a Stop or a restart they wait for Resume (`D/user/composer.md:55-61`,
  `:199-216`). After a restart, interrupted Runs are cancelled, and a project
  setting can send "Continue where you left off." (`O/RestartContinuation.ts:33`,
  `O/ProviderRuntimeRecoveryService.ts:750-757`).
- **Outbox:** effect kinds like ours: turn start, interrupt, steer, restart;
  request respond; rollback; checkpoint capture (`O/EffectOutbox.ts:28-100`).

## 6. Model, effort and options

- **Claude:** models and options come from T3's manifest, not from Claude:
  effort levels (low to max, `ultracode`, a prompt-injected `ultrathink`),
  effort maps, context windows, and a minimum CLI version per model
  (`P/model-manifest.json:121`, `:155-210`; `P/ClaudeModelCatalog.ts:146-202`).
  They go into the `query()` options (`CA:1542-1555`); `setModel` changes the
  model in a session (`CA:525`).
- **Codex:** `model/list`, paged, from the app-server
  (`P/CodexProvider.ts:360-376`), with its own list for token-sharing
  accounts (`:557`). Model, effort and service tier go on each `turn/start`
  (`XA:761-806`). Reasoning summaries are always "detailed" (`XA:798`).
- **ACP:** from the agent's `configOptions` or `models`, set with
  `session/set_config_option`, `session/set_model` and `session/set_mode`
  (`AR:2006-2036`, `AR:2619-2659`). A `config_option_update` refreshes the
  picker (`AR:1738`, `D/user/providers-acp.md:79-87`).

## 7. Usage and limits

A turn's usage holds token counts, the prompt-cache lifetime and the
auto-compact point (`OV:216-227`); a Thread keeps its context use (`OV:1092`).

| Harness | Source |
|---|---|
| Claude | SDK `result` messages, one per segment, summed across steers (`P/ClaudeTurnTokenUsage.ts:24-35`). `rate_limit_event` updates the limits (`CA:8183-8192`). A probe calls the SDK's `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` (`P/ClaudeProvider.ts:363`). Windows: five-hour and weekly (`P/claudeUsageLimits.ts:25-26`) |
| Codex | `thread/tokenUsage/updated` (`XA:4431`), with `modelContextWindow` (`XA:203`); `account/rateLimits/updated` (`XA:4401`); a probe calls `account/rateLimits/read` (`P/CodexProvider.ts:580`) |
| ACP | The v2 `usage_update` drives the context meter (`AA:4618`, `D/user/providers-acp.md:102-103`) |

A failure has a class (usage_limit, provider_error, transport_error,
permission_error, validation_error, unknown), a code, whether a retry can
work, and the reset time (`OV:1442-1465`). The Thread names the window that
ran out and when it resets (`D/user/providers-claude.md:70-76`,
`D/user/providers-codex.md:95-100`). The Usage page reads past usage from
each Harness's own local files (`D/user/usage.md:11-44`).

## 8. Content

| Content | Claude | Codex | ACP |
|---|---|---|---|
| Text, reasoning | SDK partial messages (`CA:1550`); thinking summaries requested (`CA:1566`) | `item/agentMessage/delta`, `item/reasoning/*Delta` | Message and thought chunks (`AA:1181-1182`) |
| Tool calls | Claude's tool IDs (`CA:457`) | Codex's item IDs (`XA:323`) | Weak IDs (`AA:601`) |
| Command output | Not streamed (`CA:401`); background output read from files (`Adapters/ClaudeTaskOutputTail.ts`) | `item/commandExecution/outputDelta` (`XA:4321`) → `command_output.delta`, not stored (`PA:130-137`) | Agent terminal updates; only Devin runs in T3's terminals (`D/user/providers-acp.md:119-121`) |
| File changes | All three: a `file_change` item with diff, old and new text, additions, deletions (`OV:1644-1654`). Codex's `turn/diff/updated` is switched off (`XA:232-236`); diffs come from T3's checkpoints (earlier note) | | |
| Plans, todos | ExitPlanMode, TodoWrite (`CA:9641`, `CA:9057`); todos need `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (`D/user/providers-claude.md:90-95`) | `turn/plan/updated`, `item/plan/delta` (`XA:4363`, `:4348`) | `plan` update (`AA:1191`) |
| Questions | AskUserQuestion through `canUseTool` (`CA:9657`) | `item/tool/requestUserInput` (`XA:5617`) | Elicitation |
| Subagents | `Agent` tool tracked; lifecycle, no thread IDs (`CA:9619-9628`, `CA:430-436`) | Threads with IDs; wait, close, fork (`XA:297-303`) | None portable (`AA:573`); a Claude hook reads Claude's (`packages/provider-acp-registry/src/server/claudeAcp.ts:24-80`) |
| Images, files | Image and PDF blocks, up to 100 pages and 28 MiB (`CA:2185-2186`, `:2325`, `:2380`) | Images as data URLs; other files as paths in the text (`XA:3210-3245`) | Text resources shown, others as placeholders (`D/user/providers-acp.md:103-105`) |
| Commands, skills | From `initializationResult`; skills from the config folder and `.claude/skills` (`P/ClaudeProvider.ts:388`, `D/user/providers-claude.md:78-88`) | `skills/list` (`P/CodexProvider.ts:556`) | `available_commands_update` (`AA:5910`) |

**MCP they add.** T3 serves its own HTTP MCP server, `t3-code`. Each provider
session gets a credential scoped to environment, Thread, instance and
session; it expires and is revoked on release
(`D/orchestration-v2/orchestrator-mcp-server.md:29-55`). Claude gets it via
`setMcpServers` after the query opens, to keep credentials off the command
line (`CA:973`, `CA:1059`). Codex gets a `mcp_servers.t3-code` config with an
Authorization header on `thread/start` (`XA:1355-1361`); their doc describes
`-c` overrides instead (`orchestrator-mcp-server.md:59-71`). ACP agents get a
stdio bridge that is T3 itself, because "codex-acp 1.2.0 and pi-acp drop
injected HTTP servers" (`AA:660-672`).

## 9. Their canonical model

```text
ProviderAdapterV2                                  PA:657-673
  getCapabilities()            -> ProviderCapabilities
  planSelectionTransition(in)  -> plan
  openSession(in)              -> SessionRuntime   (scoped: closing the scope stops it)

SessionRuntime                                     PA:567-655
  events: Stream<Event>
  ensureThread  resumeThread  readThreadSnapshot  rollbackThread  forkThread
  startTurn  steerTurn  interruptTurn  respondToRuntimeRequest
  optional: injectHistory  compactThread  stopTask  awaitBackgroundTasks
            stopSubagent  unloadThread  uploadFeedback  mcpApps
            getModelContextWindow  hasPendingBackgroundWork
```

- **Inputs.** A turn carries the app's IDs: run, attempt, root node and
  provider-turn ordinal (`PA:441-456`). The runtime policy holds the mode,
  interaction mode, cwd, and approval and sandbox policies (`PA:48-54`).
- **Events** (`PA:78-174`): `app_thread.created`, `provider_session.updated`,
  `provider_thread.updated`, `provider_turn.updated`, `node.updated`,
  `subagent.updated`, `message.updated`, `turn_item.updated`,
  `background_work.updated`, `command_output.delta`, `runtime_request.updated`,
  `plan.updated`, `turn.terminal`. Each `*.updated` event carries the whole
  entity. Only `command_output.delta` is a delta, and it is not stored
  (`PA:130-137`). `turn.terminal` says completed, interrupted, cancelled or
  failed (with an optional retry), and whether the thread is `reusable` or
  `broken` (`PA:149-173`).

**Capabilities.** Twelve groups (`OV:378-395`), declared per adapter:

| Flag | Claude (`CA:370-462`) | Codex (`XA:238-330`) | ACP (`AA:514-640`) |
|---|---|---|---|
| Threads per process | one | many | one |
| Switch model / mode in session | yes / no | yes / yes | if offered / no |
| Requests survive restart | no | no | no |
| Read thread snapshot | no | yes | if it loads sessions |
| Roll back conversation / fork | yes / yes | yes / yes | files only / if advertised |
| Native turn IDs | weak | strong | weak |
| Active steering | yes, cancels pending tools | yes | no, restart |
| Streams tool output | no | yes | yes |
| Subagents | yes, no thread IDs | yes, with thread IDs | no |
| Enforcement | native | native | client-boundary |

- **Fallbacks.** One per missing ability: restart for steering, a synthetic
  fork, a fresh provider context after rollback, no plan panel
  (`D/orchestration-v2/provider-capability-system.md:216-246`). "A capability
  left on that fails at runtime is a bug" (`D/internals/adding-a-provider.md:24-27`).
- **Coalescing.** Per turn and item, a buffer emits the whole text so far
  every 50 ms (`Adapters/ProviderTextDeltaCoalescer.ts:7-27`, `:40-45`;
  `CA:7249`; `XA:211`). Plans flush every 400 ms (`XA:213`). A second 50 ms
  window per Thread, at most 512 pending, sits before the clients
  (`O/ThreadLiveEventCoalescer.ts:18-19`).
- **Errors.** Sixteen tagged adapter errors, one per operation
  (`PA:177-419`), under the failure class of section 7. Protocol-error
  reasons come from a fixed list, to keep private configuration out (`PA:379-384`).

## 10. Testing, beyond the earlier note

- At this commit there are 91 fixture folders: 39 Claude and 27 Codex
  transcripts (`O/testkit/fixtures/`).
- Integration tests may not mock the adapter, the normalizer or the
  orchestrator, nor feed pre-normalized events to an adapter. Time and
  randomness come from Effect's test services
  (`D/orchestration-v2/testing-strategy.md:27-60`).
- **Replay boundaries:** Claude, the async iterable that the SDK's `query()`
  returns, with the options sent recorded too (`:137-140`). Codex, the
  JSON-RPC frames (`:114-116`). ACP, a child-process peer that checks every
  outgoing frame (`:142-146`).
- A fixture records provider version, model, cwd policy and capture time;
  redaction keeps IDs and order (`:186-194`). The Codex replay ignores cwd,
  model and MCP servers, which differ per machine
  (`packages/effect-codex-app-server/src/replay.ts:239-242`).

## 11. Why native for Claude and Codex

- **What they write** (no other reason found; the clone has no commit
  history): ACP agents start as Registry entries; "Other
  protocols get a native adapter" (`D/internals/adding-a-provider.md:10-17`).
  ACP has no rewind, no portable subagent lineage, and a fresh session after
  rollback (`D/user/providers-acp.md:123-131`). "ACP does not define native
  subagents or active steering"
  (`D/orchestration-v2/orchestrator-mcp-server.md:111`).
- **What the code shows (inferred as a reason):** the native adapters declare
  abilities the ACP adapter lacks: active steering, subagents, native
  enforcement, and for Codex strong IDs and snapshots (section 9). They use
  calls with no ACP equivalent. Claude: `resumeSessionAt`, `forkSession`,
  `priority: "now"`, `setMcpServers`, `rate_limit_event`, the account in
  `initializationResult`. Codex: `turn/steer`, `thread/revert`,
  `thread/fork`, `account/rateLimits/*`, goals.
- **Claude through ACP still exists** as a second route. A Registry entry
  `claude-acp` or a local `claude-agent-acp` runs on the shared ACP adapter,
  with ACP v2 preview on by default
  (`packages/provider-acp-registry/src/server/adapter.ts:194-205`,
  `D/user/providers-acp.md:17-19`). Agents with a native driver are hidden
  from the Registry list (`D/user/providers-acp.md:8-10`).

## Against our adapter today

Our paths are under `modules/agents/engine/src/`.

| Area | Ours | T3 Code |
|---|---|---|
| Processes | One Harness process per Agent, one session per Thread inside it (`live.rs:49-68`, `acp.rs:105-106`) | One per Thread for Claude and ACP; one per account for Codex |
| Lifetime | No idle release: a process stays until it dies or the engine stops (`live.rs:56-67`) | Released after 30 minutes idle |
| Protocol | ACP v1 only; other versions refused (`acp.rs:283-297`) | ACP v2 preview first, v1 accepted (`AR:2047`, `D/user/providers-acp.md:12-15`) |
| Install | Pinned adapter packages through `npx -y` (`settings.rs:45-61`) | The Person's own CLI, checked against a version range; Registry agents at exact versions |
| Capabilities | Only `load_session` read (`acp.rs:290`), kept as evidence of how long a session lasts (`acp.rs:69-86`) | Twelve groups per adapter, negotiated for ACP |
| Sessions | `session/new` on a Thread's first turn in a process; no load, resume or fork (`acp.rs:159-189`). Session ID stored as evidence (`turn.rs:217-224`) | Create, resume, history, rollback and fork per Harness (section 3) |
| Prompt | Text only (`acp.rs:203-206`) | Text, images, PDFs and file paths |
| Updates | Message chunks, thought chunks, tool calls, tool updates; the rest dropped (`acp.rs:323-340`) | Also plans, usage, commands, mode and option updates, terminals |
| Questions | Option IDs passed unchanged; a Question with only "always" answers is refused and the turn fails (`turn.rs:329-338`); never answered for the Person | Five fixed decisions mapped back to option kinds; ACP requests answered by mode |
| Restart | Every effect abandoned (`lib.rs:264-267`); a running turn becomes Interrupted (`turn.rs:82-100`); open Questions close (`turn.rs:53-69`) | Requests expire as not_resumable; Runs cancelled; optional continuation message; queue held |
| Queue, steer | The outbox, keyed by Agent, runs one turn at a time (`turn.rs:3-4`, `lib.rs:338-342`); Stop sends ACP cancel (`acp.rs:218-223`, `live.rs:82-92`); no steer | Queue, steer, steer by restart, held queue |
| Coalescing | 80 ms; each fact carries the new piece of text (`turn.rs:31-32`, `model.rs:226-232`) | 50 ms; each update carries the whole text of the item |
| IDs | A new ID per item; Harness tool call IDs mapped to items in memory for the turn (`turn.rs:249-250`, `turn.rs:375-376`) | App IDs derived from Harness IDs, with how each was matched |
| Errors | Plain strings (`acp.rs:116-118`); stop reasons mapped to Done or Stopped with a plain reason (`acp.rs:376-395`) | Tagged errors; a failure class with retry and reset time |
| Not in ours yet | Sign-in checks, model and effort choice, permission modes, usage and limits, MCP injection, rollback, fork (method table, `lib.rs:11-20`) | All present |
