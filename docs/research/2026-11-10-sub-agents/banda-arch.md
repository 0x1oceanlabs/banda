# Sub-agents and workflows: how they fit Banda's architecture

- **Date:** 2026-11-10. Research only, before mockups. No paid run was made.
- **Banda:** this repo at `26feb9be` (main). Paths below are from the repo root.
- **Adapters, as Banda pins and carries them:**
  - **C:** `@agentclientprotocol/claude-agent-acp` 0.99.1, in
    `node_modules/.pnpm/@agentclientprotocol+claude-agent-acp@0.99.1*/node_modules/@agentclientprotocol/claude-agent-acp/`.
    Paths are under `dist/` unless they are `README.md`.
  - **X:** `@agentclientprotocol/codex-acp` 2.5.0 (the patched copy), `dist/index.js` (one bundle).
  - **SDK:** `@anthropic-ai/claude-agent-sdk` 0.3.312, `sdk.d.ts` and `sdk-tools.d.ts`.
  - **R:** the Rust crates `agent-client-protocol` 3.6.0 and `agent-client-protocol-schema` 1.13.0 in
    `~/.cargo/registry`.
- **Spec:** the Subagent Sessions RFD, https://agentclientprotocol.com/rfds/subagents. Its revisions
  run from 2026-08-19 to 2026-11-09, behind `unstable_subagents`.
- **T3 Code:** github.com/pingdotgg/t3code at `337c5858`. Used only for precedent.
- **"Inferred"** marks a claim reached from source code that no recording shows. The repo has two
  recordings, `apps/agents/engine/tests/recordings/{claude,codex}-edit.jsonl`, and neither has any
  sub-agent traffic. The T3 scenarios named in ADR 0002 d11 are not in the repo.

---

## TL;DR

1. **What happens today.** Banda does not declare `clientCapabilities.subagents`
   (`apps/agents/engine/src/acp.rs:356-370`), so both adapters fall back to their legacy form.
   - **Claude:** an Agent/Task call arrives as one `think` tool call titled with the task's
     description. Every call the child makes arrives on the parent's session as an ordinary tool
     call, with `_meta.claudeCode.parentToolUseId`, which Banda drops. The Person sees a brain-icon
     row ("Explore auth flow"), followed by the child's calls flattened into the parent's work line
     and counted as the parent's.
   - **Codex:** the Person sees a wrench row with the literal title `spawnAgent`, and none of the
     child's work. The child's approvals show up as the parent's own Questions.
   - **Claude's Workflow tool (ultracode):** the Person sees a wrench row titled "Workflow", then
     nothing until the workflow ends and "‹Agent› went on by itself." appears. Banda's composer
     already offers the Ultracode switch, so a Person can reach this today.
2. **What ACP offers.** The RFD gives each sub-agent a child session: `subagent_update` (title,
   description, state, `cancel` capability), the child's own `session/update` stream, and
   `session_message` for the prompt and the report. Both pinned adapters implement it once the
   client declares `subagents: {}`. Banda's crate already has the types behind the
   `unstable_subagents` feature.
   - **Prerequisite:** the engine must route child session ids to the parent Thread. Today a
     child's permission request would be auto-cancelled, because `Routes::of` returns `None` for an
     unknown session.
3. **Gap: workflows.** Neither adapter forwards Claude's workflow progress over ACP: no phases and
   no per-agent states. That data exists only in the SDK's `task_progress.workflow_progress`
   (undocumented; T3 parses it) and in the workflow's transcript folder.
   - **Way in for Banda:** without declaring AIR, Banda can get it through
     `_meta.claudeCode.emitRawSDKMessages`, as `_claude/sdkMessage` notifications.
4. **Recommended shape (option B).** A Harness's sub-agent is a **lane of its Thread**: a small
   record with its own slice of the Thread's Body, kept by the Thread's host.
   - **It is not:** an Entry flattened into the parent's Body (option A), nor a Thread of its own
     (option C).
   - **Why:** this keeps ADR 0006 (one Agent per Thread, so a sub-agent is part of it), ADR 0098
     d23 (no sidebar card) and ADR 0099 d3 (satellites).
   - **Crews:** a Harness workflow becomes a **Crew**, a lane group with phases, owned by the
     Thread. "Workflow" is already taken by ADR 0082, so the word needs Roma.
   - **Banda's own fan-out** (ADR 0019 `send`) stays real child Threads (ADR 0098 d24). One client
     model draws both in the same Crew view.
   - **Order of work:** engine data first (lanes, facts, `ListedThread.subagents`), then the client
     core (`subagents.ts`), then the views: an anchor entry in the Thread, the Crew Pane in the
     Group's Deck, sidebar line 2 and the satellites.

---

## 1. What Banda receives today, and how it renders

### 1.1 What Banda declares

`shows()` (`apps/agents/engine/src/acp.rs:356-370`) declares:

- form elicitation;
- `session.notices`;
- boolean config options;
- `_meta.terminal_output_delta`.

The recorded `initialize` (`claude-edit.jsonl`, line 1) also has `auth.terminal: true`, which the
harnesses crate adds. It carries no `subagents`, no AIR capabilities and no
`_meta["subagent-transcript"]`.

As a result:

- **Claude** uses no native form: `subagentForm()` returns `undefined` (C `acp-subagents.js:4-8`).
  "Without either signal, Agent and Task stay ordinary tool calls and child interactions stay on the
  root session" (C `README.md:102-104`).
- **Codex** uses `"hidden"` (X `dist/index.js:46575-46581`, `subagentProtocol`).
- **The crate** has subagent types only behind `unstable_subagents`. Banda enables only
  `unstable_session_fork` (`Cargo.toml:13`), so `subagent_update` would not even parse.

What the engine reads from an update (`apps/agents/engine/src/acp/said.rs:116-178`):

- message and thought chunks: text and `messageId`;
- `tool_call` and `tool_call_update`: id, title, kind, status, content, locations;
- the `_meta` keys `terminal_output_delta` and `terminal_exit`;
- plan, usage, notices, config options and commands.

Every other `_meta` is dropped, `claudeCode.toolName` and `claudeCode.parentToolUseId` among them.
`rawInput` is never read.

### 1.2 Claude Code: an Agent or Task call (foreground)

**On the wire to Banda (C):**

| Frame | Fields | Source |
|---|---|---|
| `tool_call` for the launch | `title` = the input's `description` (else "Task"), plus " (high effort)" when an effort was given; `kind: "think"`; `content` = `[text: prompt]`; `_meta.claudeCode.toolName: "Agent"` | `tool-calls/reporters/agent.js:4-12`, `tool-calls/renderer.js:579-590` |
| the child's tool calls | ordinary `tool_call` and `tool_call_update` on the **parent's** session id, stamped `_meta.claudeCode.parentToolUseId = <launch id>` | `acp-agent.js:566-574` (`stampParentToolUseId`), `:7791`, `:10587`, `:11011` |
| the child's streamed text and thinking | `agent_message_chunk` and `agent_thought_chunk` with the stamp. "Every other client gets the streamed subagent text, like upstream." The SDK's `stream_event` carries `parent_tool_use_id` (SDK `sdk.d.ts:5754-5763`) | `acp-agent.js:2836-2845`, `:5755-5772` |
| the child's consolidated message | not forwarded to a plain client (`parent_tool_use_id !== null` and `!forwardsSubagentText()`) | `acp-agent.js:6064-6066` |
| the child's permission request | on the parent's session, attributed to the launch call | `acp-agent.js:4655-4662` (comment) |
| the launch's result | `tool_call_update` whose `content` is the child's report, with the `agentId:` trailer, the `<usage>` block and the hand-back frame stripped | `tool-calls/reporters/agent.js:14-34` |

**In the engine:**

- **The launch** becomes `Body::Tool { tool: Think, title: "<description>" }`.
- **The child's calls** become sibling `Body::Tool` entries in the **parent's** turn, interleaved in
  time with the parent's calls, and with other parallel children's when several run.
- **The child's streamed text** opens new reply entries, because the transcript starts a new entry
  whenever the Harness names a new message (`transcript.rs:601-609`). Those entries are authored by
  the parent Thread's Agent. This is _inferred_: the adapter source sends them, and no recording
  shows it.

**In the window** (`apps/agents/pane/src/entries/parts/ToolCall.tsx`):

- **The row:** `BrainIcon`, which is `think`'s icon (`:200`), with the title as the subject. The
  title takes a past-tense verb only when the description starts with one Banda knows. "Search
  for…" reads "Searched for…"; "Explore…" stays as written (`entries/parts/calls.ts`, `said`).
- **Opened:** it shows the prompt as a `<pre>` block while running. Once done, the report replaces
  the prompt: each `tool_call_update` field replaces its own.
- **The work line** (`thread/timeline.ts:296-380`) counts the launch as "thought". It counts the
  child's calls as the parent's: "Worked for 3m · ran 12 commands, read 31 files".
- **The live line** says the parent's last call. It names no sub-agent.
- **Nothing in the engine or window knows a sub-agent exists.** ADR 0099 d11's
  `ListedThread.subagents` cannot be counted without reading `_meta.claudeCode.toolName`.

### 1.3 Claude Code: background sub-agents

- **The turn waits for them.** A turn that spawned background sub-agents is **held open** by the
  adapter until they end (`Turn.deferredSettle`). Only an AIR client with `backgroundSubagents` gets
  the turn's end earlier (C `acp-agent.js:1225-1233`, `:3462-3475`).
- **Banda's turn stays `running`,** so the Mark keeps working, which is right. The child's calls
  keep arriving as flat siblings.
- **A Stop:** `session/cancel` interrupts Claude Code and stops the foreground children. Background
  children keep running; the RFD prefers that, and the client stops each one with its own cancel
  (C `README.md:71-83`). For Banda, with no child sessions, a background child cannot be stopped
  alone.
- **After the parent's turn ends:** whatever a child says opens a turn of the Agent's own (with the
  notice "‹Agent› went on by itself.", `between.rs:183`). It ends after 60 s of silence
  (`between.rs:37`).

### 1.4 Claude Code: the Workflow tool (dynamic workflows, ultracode)

- **Turning it on in Banda.** Banda reads Claude's config options and shows boolean ones, so the
  composer already offers **Ultracode**: "Dynamic workflows on every task, at any effort level"
  (C `session-ultracode.js:7`; Banda `apps/agents/pane/src/composer/picker.test.ts:40`).
- **The tool's input** (SDK `sdk-tools.d.ts:2871-2900`): `script` (it starts
  `export const meta = { name, description, phases }` and uses
  `agent()/parallel()/pipeline()/phase()`), `name`, `args`, `scriptPath`, `resumeFromRunId`.
- **Its result** (`:4148-4190`): `status: "async_launched"`, `taskId`,
  `taskType: "local_workflow"`, `workflowName`, `runId`, `transcriptDir` ("Directory where subagent
  transcripts are written"), `scriptPath`.
- **Over ACP to Banda,** the call is reported by `GenericReporter` as `title: "Workflow"`,
  `kind: "other"` (C `tool-calls/reporters/interaction.js:159-181`). Banda shows a `WrenchIcon` row
  "Workflow" that finishes at once, since the tool only launches.
- **The workflow then runs in the background** as an SDK task of type `local_workflow`
  (C `async-tasks.js:871-878`).
- **Progress reaches no client but AIR.** The adapter sends task progress only to AIR's async-task
  extension (C `acp-agent.js:4636-4648`, `async-tasks.js:129-167`), and that path drops
  `workflow_progress` too: no file in C mentions it.
- **The turn is not held,** because only sub-agent tasks defer the turn's end
  (`registerLiveTask(…, !!message.subagent_type)`, C `acp-agent.js:4672`). The turn ends, the Mark
  goes Done or idle, and the Person sees nothing while a crew of agents works. When the workflow
  ends, Claude wakes and Banda opens a turn "‹Agent› went on by itself."
- **The agents inside a workflow** "appear only in transcripts, not provider events" (T3
  `apps/server/src/orchestration-v2/workflowAgentTranscript.ts:2`).
- **Where progress actually lives** is the SDK's `task_progress` message for the workflow task. It
  carries an undocumented `workflow_progress` array that T3 parses
  (`apps/server/src/orchestration-v2/Adapters/claudeWorkflowProgress.ts`):
  - `{type: "workflow_phase", index, title}`;
  - `{type: "workflow_agent", index, label, state: queued|start|done|error, agentId, phaseIndex,
    phaseTitle, model, attempt, tokens, toolCalls, durationMs, queuedAt, startedAt, lastProgressAt,
    promptPreview, resultPreview}`.
- **Risk (_inferred_): the Harness process may be let go mid-workflow.** It is let go after 30 min
  idle (`platform/harnesses/engine/src/hosts.rs:31`). `Connection::idle_since`
  (`apps/agents/engine/src/acp.rs`) is `None` only while a turn's prompt is open, and nothing touches
  the host during a silent background workflow. So a workflow, or a background Bash, that runs over
  30 minutes with no between-turn traffic can be killed with its process. `serving()` saves only
  processes that listen on TCP.

### 1.5 Codex: multi-agent (`multi_agent` is on by default in Codex 0.167)

In the hidden form (X):

- **The collab calls:** `spawnAgent` and the other collab tools become `tool_call`s titled with the
  tool's name (`title: item.tool`), `kind: "other"`. Their `rawInput` carries `prompt`,
  `senderThreadId`, `receiverThreadIds`, `agentsStates`, `model` and `reasoningEffort`
  (X `dist/index.js:34917-34948`).
- **Activity items** add calls such as "Start subagent explorer" and "Complete subagent explorer"
  (`:34952-34982`).
- **The child thread's events** are not forwarded. Only its interactions (approvals, elicitations)
  are re-attributed to the root session (`:40785`, `interactionSessionId` `:40840-40844`).

What Banda shows:

- a `WrenchIcon` row with the literal title "spawnAgent";
- the rawInput is dropped, so not even the prompt shows;
- no work of the child;
- a child's approval as a Question in the parent Thread, titled with the child's command, with no
  sign that a sub-agent asks.

### 1.6 Summary: what the Person sees today

| Harness action | Thread entry | Work line | Mark / sidebar | Stop |
|---|---|---|---|---|
| Claude Agent (foreground) | brain row "Explore auth flow", prompt then report inside | the child's calls flat, counted as the parent's; the child's narration as stray replies (_inferred_) | working, no satellites | stops all |
| Claude Agent (background) | same; the turn held open | same, later | working until all end | background children survive; none can be stopped alone |
| Claude Workflow | wrench row "Workflow" | nothing for the whole run | Done or idle while it runs; then "went on by itself" | the adapter stops background workflows after a cancel only with `perTaskStopAffordance` (C `acp-agent.js:6415-6430`) |
| Codex spawnAgent | wrench row "spawnAgent" | nothing of the child | working while the parent waits | the parent's turn only |

---

## 2. What ACP offers, and what Banda's engine would need

### 2.1 The Subagent Sessions RFD (unstable)

- **Declaring it:** `clientCapabilities.subagents: {}`. It is v1 only; in v2 it is baseline.
- **`subagent_update`** on the **parent's** stream. Its `update.sessionId` is the child. Its patch
  fields are `title`, `description`, `capabilities.cancel`, `state`, `cwd`,
  `additionalDirectories` and `_meta`: omitted keeps a field, `null` clears it.
  - **The first update announces the child, before any traffic that names it,** permission requests
    included.
  - **The parent is never guessed.**
- **State:**
  - `running`;
  - `requires_action`;
  - `idle`, with `stopReason` `end_turn | max_tokens | max_turn_requests | refusal | cancelled |
    error{error}`;
  - `unknown`.

  Idle does not end the child: the parent may message it again.
- **The child's own `session/update`s** (tool calls, chunks, plan) come with the child's session
  id, on the same connection. No load or subscribe is needed.
- **Permission requests** carry the **child's** session id and stay attributed to it.
- **`session_message` and `session_message_chunk`** are inter-session messages:
  `senderSessionId`, `recipientSessionId`, and `senderMessageId`/`recipientMessageId` linking the
  outgoing and incoming views. A delegated task is a session message, not a user message.
- **The client may only `session/cancel` a child** whose `capabilities.cancel` is set. It cannot
  prompt, steer, configure, fork, close, load or resume one.
- **Nesting:** a grandchild is announced on the child's stream. Replay announces the ancestors
  first.
- **Rust:** `agent-client-protocol-schema` 1.13.0 has `SubagentUpdate`, `StateUpdate`,
  `IdleStopReason`, `SubagentSessionCapabilities`, `SessionMessage`, `SessionMessageChunk` and
  `ClientCapabilities::subagents` (R `src/v1/client.rs:164-180`, `:186-300`, `:953-1400`, `:3341`).
  `agent-client-protocol` 3.6.0 exposes them through the feature `unstable_subagents`.

### 2.2 claude-agent-acp 0.99.1, its RFD form (C `README.md:39-104`, `native-subagents.js`)

- **The announcement:** each Agent/Task sub-agent is announced as `subagent_update` with
  `title` = the agent's name, else the task's description, else its role. `description` = the
  role (`subagent_type`) when it differs (`rfdLabels`, `:1509`). The update also carries
  `capabilities: {cancel: {}}` and `state: running` (`announceNativeSubagent`, `:1275-1300`).
- **The child's model** comes in a child `config_option_update`.
- **Session messages replace the launch's tool call** in the parent (`linkedSessionMessages`,
  `:1394`; `launchReply`, `:1434`):
  - **The prompt** is a `session_message`, with the launch id as `messageId`.
  - **A foreground child's report** is a `session_message` from the child to the parent
    (`<launch>:reply`).
  - **In hand-back mode,** the `SubagentHandback` call is the message.
- **States:**
  - `requires_action` while one of the child's requests is open;
  - `idle` with `end_turn` or `cancelled`;
  - `idle`+`error` with the SDK's text;
  - `idle` with no reason when Claude Code exits (`reportState`, `:876-882`).
- **A child keeps its session for every delegation to it:** SendMessage to it opens a new
  "generation" under the same session.
- **`session/cancel` with the child's id** stops that child only (`Query.stopTask`). The parent's
  turn goes on.
- **Replay** restores children under their live ids. A launch without Claude Code's metadata file
  stays a tool call, with a notice that its history is missing.
- **Workflows are not mapped to children** (§1.4). Whether a workflow's agents get announced as
  root children is **unknown**: nothing in C names them. T3 says they reach no provider event.

### 2.3 codex-acp 2.5.0, its standard form (X)

- **Ids:** child session id = `<root>:subagent:<codex thread id>`, URI-encoded
  (`SubagentAssociations.sessionId`, `:35667`).
- **Titles** come from the agent path's last segment, else "Agent" (`:36040-36050`).
- **Announcement** carries `capabilities: {}` (`:36016-36025`). `cancel` is then toggled on while
  the child runs a turn (`publishCancellation`, `:36270-36280`).
- **States** are `running`, `idle` (`completed`, `cancelled` or `failed` from the child's
  `turn/completed`) and `unknown`.
- **Approvals** come on the child's session (`interactionSessionId`, `:40840-40844`).
- **Child histories** are rebuilt on `session/load`.
- **Turn diffs** of child turns are folded into the root turn's file-change report (`:37124-37160`).

### 2.4 What Banda's engine must do to declare it

The steps are in order. Each line names the file it touches.

1. **`Cargo.toml:13`:** add `"unstable_subagents"` to the features.
2. **`acp.rs` `shows()`:** `.subagents(acp::SubagentCapabilities::new())`.
3. **Routing first.** In `acp/routes.rs`, add a map `child session → (root session, parent
   session)`, filled by `subagent_update`, before any child traffic arrives. `Routes::of(child)`
   answers the **root's** route.
   - **Otherwise the child's permission request is cancelled.** It would hit `asked.of()` → `None`
     → answered `Cancelled` (`acp.rs:255-258`), so the child is denied silently. The same happens to
     elicitations (`acp.rs:297`).
4. **`acp/said.rs`:**
   - wrap what a child says, `Said::In { child: acp::SessionId, said: Box<Said> }`, rather than add
     a field to every variant;
   - new `Said::Subagent { child, parent, title, description, state, can_cancel }`;
   - new `Said::Message { child, from, to, text, message }` from `session_message`, joined with its
     chunks.
5. **`transcript.rs`:** one writer per lane, keyed by Banda's `SubagentId`.
   - **The lane's tool calls** go to a per-lane `tools` map, since call ids are only unique per
     session.
   - **Its replies** are gathered per lane, so lanes never cut each other's text.
   - **The launch** no longer writes a `think` tool. It writes the lane's anchor (§4).
6. **`between.rs`:** a child's state change or its text between turns updates the lane, as `Used`
   and `Runs` are written now. It never opens a turn of the Agent's own, since the parent's turn
   that launched it is already over. A child's tool call between turns does the same: it belongs
   to the lane, not to a new turn.
7. **Stop.**
   - A new command `agents.stop_subagent {thread, subagent}` sends `session/cancel` with the child's
     session id, only while the lane `can_stop`. It needs the Write right, like `agents.stop`.
   - "Stop" on the Thread cancels the turn **and** every running lane: the Person expects
     everything to stop. That is the Person's word, so it is not a `rules::next` move.
8. **Keep the host:** `Connection::idle_since()` answers `None` while any lane of its sessions is
   `running` or `requires_action`. The same is needed for Claude background tasks (§2.5).
9. **Evidence, not identity** (ADR 0002 d7): Banda's `SubagentId` (UUIDv7) is the identity. The
   Harness's child session id is stored as evidence and matched on replay or re-announcement. A
   SendMessage that resumes a child maps to the same lane: a new "delegation" in it, not a new lane.
10. **A load or resume that replays children** must not duplicate lanes. Banda keeps its own copy,
    so a replayed child's traffic is matched by its child session id and ignored.

### 2.5 Workflows over ACP: three ways in

| Way | What Banda gets | Cost | Verdict |
|---|---|---|---|
| (a) `_meta.claudeCode.emitRawSDKMessages: [{type:"system",subtype:"task_started"}, {…"task_progress"}, {…"task_updated"}, {…"task_notification"}, {…"background_tasks_changed"}]` on `session/new` and `session/load` | `_claude/sdkMessage` notifications (C `acp-agent.js:4038-4043`, filter `:9615-9623`) with raw frames: `workflow_name`, `workflow_progress` (phases and agents), `background_tasks_changed` (a level signal of live background work, SDK `sdk.d.ts:3807-3840`) | an ext-notification handler in `acp.rs`; a parser like T3's (~120 lines); Claude-only; `workflow_progress` is undocumented and may change | **take**: it is the only way without AIR, and it also fixes the idle-sweep risk |
| (b) Declare AIR | async tasks with progress, typed failures, goals | the adapter then assumes the client renders all of AIR (`acp.rs` module doc) | no |
| (c) Upstream: ask claude-agent-acp to expose workflow agents as RFD children, or a `_meta` on the Workflow call | the clean way | wait on others; Banda carries the adapter, so a patch is possible (as for Codex, `platform/harnesses/adapters/patches/`) | also: a small patch is a fallback |

- **Per-agent transcripts:** a workflow's per-agent transcripts are files in `transcriptDir`. T3
  reads them incrementally with byte cursors (`workflowAgentTranscript.ts`).
- **Banda already has Claude's transcripts.** It keeps them in the Project's store through its SDK
  shim (`platform/harnesses/adapters/claude-sdk.mjs`, `src/sessions.ts`:
  `<root>/<session>/<subpath>.jsonl` for a sub-agent's). Whether workflow transcripts go through
  that store's subpaths is **unverified**.

---

## 3. Fit with Banda's words and models

### 3.1 What is a Harness's sub-agent, in Banda's terms?

| Candidate | Fits | Breaks |
|---|---|---|
| **An Entry in the parent's Body** (the child's entries tagged) | ADR 0091 (an entry per body kind); one Pane follows one Thread's facts | ADR 0058 d4: the work line mixes two agents' work. Every reader of a Thread's items (`did()`, the live line, `touching`, `changes`, the pulls listener, find, copy as Markdown, fork and rewind) must learn the tag or miscount. ThreadView grows with every lane: a 20-agent workflow is thousands of items |
| **A lane: a light child session with its own Body, inside the Thread** | ADR 0006 (still one Agent per Thread; a sub-agent is the Harness's helper, with no settings or identity); ADR 0098 d23 (no card); ADR 0099 d3 (satellites); ADR 0002 d7 (Harness id as evidence); the RFD's model (a child cannot be prompted or configured) | needs a new record, a read and a follow. Lane entries need a home |
| **A child Thread** (ADR 0003's "Later: subagents as child Threads"; T3's provider-native child threads) | ADR 0019 and 0098 d24 already have child Threads; the Thread Pane draws it; the `read` tool reads it | a Thread is "a session with a Harness" that takes messages, has turns, a queue, settings, Seen, Later, Archive, Calls, `item@1`, fork, rewind and a move between accounts (ADR 0078). A native child has none of these: no prompt response, so no turn of its own; no settings; it lives in the parent's session and dies with it. Each rule would branch on "native child". It also doubles the meaning of "child" in ADR 0098 (d23 no card vs d24 a card) |

- **T3's precedent** (`packages/contracts/src/orchestrationV2.ts:154-164`, `:518-525`, `:884-921`):
  a provider-native sub-agent is a hidden child thread (`lineage.relationshipToParent:
  "subagent"`, `creationSource: "provider"`). It never shows in thread lists ("Subagents and side
  chats live inside their parent's view"), and it cannot receive messages.
- **T3's parent record:** the parent also keeps an `OrchestrationV2Subagent` with `status`,
  `progress`, `result` and `workflow: {name, phases[], agents[], totals}`. So T3 has both a summary
  record and a hidden thread.
- **For Banda,** option B gets the same reading without making Thread polymorphic.

### 3.2 ADR 0006: no Agent to manage

- **This holds if sub-agents are lanes:**
  - "Each Thread has its own Agent, and only one" (d4).
  - A sub-agent is what that Agent's Harness does inside its turn, as a tool call is: it has a
    label from the Harness and no name, settings, Pane list or identity of its own.
  - The author of a lane's entries stays the Thread's `Participant::Agent`. The lane id says which
    helper.
- **Under the Thread's pass:** a sub-agent's calls to Banda's tools run under the parent Thread's
  pass, because they go through the same Harness session's gateway. So a Visual a sub-agent shows
  lands in the parent Thread, and a Pane it opens joins the parent's Group (ADR 0065 d7). That is
  consistent. Note it in the ADR.
- **A Banda child Thread (ADR 0019) is different:** it has its own Agent and its own pass, and it
  is walled to the same Project. It stays a Thread.

### 3.3 ADR 0019 and ADR 0098 d23–d24: two kinds of children, kept apart

| | A Harness's sub-agent | A Thread started by an Agent (`send` with `harness`) |
|---|---|---|
| Lives in | the parent's Harness session (child ACP session) | its own Harness session, process per Project and Harness |
| Prompted by | its parent only (SendMessage) | anyone: its Person, any Agent, through `send` |
| Sidebar | no card; line 2 counts it; satellites (d23, ADR 0099 d3) | a card under its parent in Working, ↳; Your turn when it calls (d24) |
| Banda record | lane (new) | Thread with turns whose `opener = Asked`, `from_thread` (`model.rs:287-311`, `store.rs:750-758`) |
| Stop | `session/cancel(child)` | `agents.stop` on its turn |
| Answer back | its report as a `session_message` | its last reply goes back as a message, `Opener::Answered` (ADR 0019 d4) |

- **Gap in d24:** ADR 0098 d24 needs a parent link on `ListedThread`. Today the only link is the
  turn-level `from_thread`, which the client cannot read from `ListedThread`. Add
  `ListedThread.parent: Option<ThreadId>`, the Thread whose Agent started it, alongside this work.

### 3.4 Workflows: mapping onto Threads, Panes, Groups and workspaces

**Words first.**

- **Taken:** GLOSSARY's **Workflow** is ADR 0082's "steps across Apps run on the host", and
  **Task** is reserved as `task@1`.
- **Conflict:** Claude Code's "Workflow" (a scripted fan-out of agents in phases) needs a different
  Banda word. "Run" collides with the turn's "runs" and with T3's runs.
- **Proposal: a Crew,** "the sub-agents one Thread set to work together, in phases". The Harness's
  own label stays the Crew's title ("Workflow · review-pr").

**How a Crew maps.**

- **The data:** a Crew belongs to its Thread, as a lane does.
  - Harness side: `{id, thread, turn, title, phases[], state, started, ended, evidence:{runId,
    transcriptDir, scriptPath, taskId}}`.
  - Its members: the lanes in it, each with `phase`.
- **Threads, Panes and Groups:** a Crew opens a **Pane** of the Threads App, the **Crew Pane**,
  which joins the Thread's **Group**, last in the Deck right of the Thread (ADR 0065 d7, as a Diff
  opened from the Thread does). Workspaces are unchanged: a Crew is not a workspace.
- **Banda's own orchestration** (an Agent fans out with `send` to new Threads, in phases):
  - each member is a real child Thread, with its own Group on the Project's workspace (ADR 0065 d7:
    "A Thread an Agent opens starts a Group of its own and never joins the opener's");
  - a Crew record with `members: thread ids` groups them;
  - ADR 0082 says a workflow is an App's run table plus outbox steps, run on the host: the Crew
    table **is** that run table;
  - phases advance by outbox steps keyed `CommandId::derive(crew, step)`;
  - this is the natural first user of `task@1` (vision §7, decision 10). Not now.
- **One client model draws both:** members are lanes or child Threads, with the same row shape.

### 3.5 Where the UI lives

| Place | What shows there | Data it reads |
|---|---|---|
| **Thread, entry** `subagent` (new Body kind, the anchor, at the launch point) | one row: the satellite glyph, title, role in grey, "· 12 calls · 48s", a tag (Working / Waiting for you / Done / Failed / Stopped); live: its last action ("· Reading auth.ts"). Opened: the prompt (2 lines, more on click), the lane's work folded as one line, its report as quoted prose; buttons Open beside, Stop | `Subagent` summary; lane items read on open |
| **Thread, line** `crew` (several anchors from one message, or a Harness Crew) | "3 sub-agents · 2 working, 1 done" with the anchors under it. For a Crew: title, a phase strip (✓ Plan — ● Review 4/7 — ○ Verify), totals (agents, tokens, time), Open | `Crew` + lanes |
| **Thread, work line and live line** (ADR 0058 d4/d5) | the parent's work only; the live line "· 3 sub-agents at work" or "· Waiting on Explore" | lane states |
| **Composer dock** (ADR 0058 d6) | a lane's Question with its name: "Explore asks: Allow `pnpm test`?" | `Question` with `sub` |
| **Pane** `agents.crew` (and `agents.subagent` for one lane) | the big view: phases as columns or bands, agents as rows with state, model, attempt, tokens, calls, duration, last line; click → that lane's transcript (Thread view, read-only, no message box) | Crew read + follow |
| **Group** (ADR 0065) | the Crew Pane in the Thread's Deck; the plate's colour unchanged (the Agent's state) | — |
| **Sidebar card** (ADR 0098 d8, d23) | no card per sub-agent; line 2 "3 sub-agents at work" / "Workflow review-pr · phase 2/4"; Asks when a lane asks | `ListedThread.subagents`, `ListedThread.crew` |
| **Mark** (ADR 0099 d2–d3) | satellites, one per running sub-agent, three at most | `ListedThread.subagents` |
| **Bar** | nothing new: the logo's hat shows the loudest Thread (ADR 0099 d9) | — |
| **Drawer / phone** (ADR 0089 d8) | the anchor opens the lane as a pushed screen; Crew as a screen | same reads |

### 3.6 Fit with the client core (ADR 0087–0089, 0091)

- **The anchor and the Crew line** are an entry and a line in `apps/agents/pane/src/entries/` and
  `lines/`, one file and one table row each (ADR 0091 d2–d3, d8).
- **A pure `thread/subagents.ts`** beside `timeline.ts` places anchors, groups parallel launches and
  words the counts. The phone and the web share it (ADR 0089 d1).
- **Opening a lane or Crew** is an act in `useThreadAround()`, "open a sub-agent" / "open a crew"
  (ADR 0091 d4). It becomes `pane.pick` or an intent later.
- **No Item per lane** (ADR 0087 d6, `item@1`): the sidebar list reads only the Thread's Item, so
  d23 holds by construction.
- **Configure** (ADR 0088): the Crew Pane is a plain Pane. Rows animate state by colour and
  opacity only, and the satellites tick on the one clock.

---

## 4. Architecture options

### Option A: tagged entries in the parent's Body

- **Engine:**
  - the feature and the capability;
  - the routing of §2.4;
  - `Item.sub: Option<SubagentId>` (a column on `agents_items`);
  - a `Body::Subagent {title, role, state, can_stop, prompt, report}` anchor, updated in place like a
    tool's status.
- **Client:** the timeline nests `sub` items under their anchor, and `did()` skips them.
- **Cost:** engine S–M (~400 lines + tests), client M.
- **What it costs later:**
  - every reader of items must learn `sub`: `did`, `touching`, `changes`, find, the minimap,
    copy as Markdown, fork and rewind;
  - the pulls listener must ignore lane commands or credit them;
  - ThreadView grows unbounded with crews;
  - no room for phases.
- **Good for:** a first step only.

### Option B: lanes in the Thread (**recommended**)

- **Engine:** everything in §2.4, plus the following.
  - **A table `agents_subagents`:**
    - `id`, `thread`, `turn`, `parent_sub?`, `crew?`, `phase?`;
    - `title`, `role?`, `model?`, `state`, `stop?`, `error?`, `can_stop`, `background`;
    - `started`, `ended?`, `prompt`, `report?`;
    - evidence: `harness_session`.
  - **Lane entries** stay in `agents_items` with a `sub` column, but `agents.thread` leaves them out.
  - **`agents.subagent {thread, sub}`** answers a lane's items.
  - **Facts** carry `sub`, so a client following the Thread updates an open lane, or nothing.
  - **A table `agents_crews`** for Harness workflows, from `_claude/sdkMessage` (§2.5a).
- **Contract:** the types below. ListedThread gains `subagents`, `crew?` and `doing` (ADR 0099
  d11).
- **Client core:** `subagents.ts`, `crew.ts` (pure, tested).
- **Views:** the entry, the line, the Crew Pane, line 2 and the satellites.
- **Cost:** engine M–L (~900–1200 lines, five or six PRs), contract S, client core S, views M–L.
- **Gains:** the parent Thread stays a quiet document. Lanes load on demand. Workflows fit. ADR
  0006, 0098 d23 and 0099 hold unchanged.

### Option C: every sub-agent a child Thread (T3's way)

- **Engine:**
  - `ThreadSummary.parent` and `lineage: subagent | asked | side | fork`, with `native: bool`;
  - a native child's Harness session is the child session inside the parent's process;
  - the lists hide it.
- **Every Thread rule branches on native:** turns, queue, settings, `can`, Seen, Later, Archive,
  Calls, `item@1`, fork, rewind, accounts (ADR 0078 moves a Thread's session; its children cannot
  move), `send` (a native child refuses messages).
- **Cost:** L to XL, and risky to existing invariants: one running turn per Thread, `rules::next`'s
  table.
- **Gains:** one Pane kind (the Thread Pane) for everything; the `read` tool reads sub-agents.
  Option B gets the second through `agents.subagent` marked `tool` too.

### Recommendation

**Option B for a Harness's sub-agents and Crews. Keep ADR 0019 children as Threads, with a parent
link.** The order is data first, then the client core, then the views.

#### Contract (Rust in `apps/agents/engine/src/model.rs`; TS generated into `@banda/contract/agents`)

```rust
pub struct SubagentId(Uuid);           // Banda's; the Harness's child session id is evidence
pub struct CrewId(Uuid);

pub enum SubagentState { Running, Asks, Done, Stopped, Failed, Unknown }
// Asks = RFD requires_action; Done = idle end_turn; Stopped = idle cancelled;
// Failed = idle error | refusal | max_*; Unknown = unknown

pub struct Subagent {                   // in ThreadView.subagents, the lane's summary
    pub id: SubagentId,
    pub turn: Option<TurnId>,           // the turn that launched it
    pub parent: Option<SubagentId>,     // nesting
    pub crew: Option<CrewId>,
    pub phase: Option<u16>,
    pub title: String,                  // subagent_update.title
    pub role: Option<String>,           // description / subagent_type
    pub model: Option<String>,          // the child's config_option_update
    pub state: SubagentState,
    pub why: Option<String>,            // the error text, or the stop reason in words
    pub can_stop: bool,                 // capabilities.cancel
    pub background: bool,
    pub started: i64,
    pub ended: Option<i64>,
    pub prompt: String,                 // session_message to the child (first delegation)
    pub report: Option<String>,         // the child's message back (launchReply / handback)
    pub calls: u32,                     // counted by the engine as it writes the lane
    pub failed: u32,
    pub doing: Option<Doing>,           // ADR 0099 d11's shape: kind + since
}

pub struct Crew {                       // a Harness workflow (or later a Banda one)
    pub id: CrewId,
    pub turn: Option<TurnId>,
    pub title: String,                  // "review-pr" (workflow_name)
    pub phases: Vec<Phase>,             // {index, title}
    pub agents: Vec<CrewAgent>,         // for members with no lane (workflow agents seen only in progress)
    pub state: SubagentState,
    pub started: i64,
    pub ended: Option<i64>,
    pub tokens: Option<u64>,
}
pub struct CrewAgent { pub index: u16, pub label: String, pub phase: Option<u16>,
    pub state: SubagentState, pub model: Option<String>, pub attempt: Option<u16>,
    pub tokens: Option<u64>, pub calls: Option<u32>, pub took: Option<u64>,
    pub prompt: Option<String>, pub result: Option<String>, pub lane: Option<SubagentId> }

// Item gains `sub: Option<SubagentId>` (entries of a lane);
// Body gains `Subagent { sub: SubagentId }` and `Crew { crew: CrewId }` anchors.
// ThreadView gains `subagents: Vec<Subagent>` and `crews: Vec<Crew>`.
// ListedThread gains (ADR 0099 d11):
//   subagents: u16            — running or asking lanes;
//   crew: Option<CrewBrief>   — {title, phase, phases, working, done} of the running crew;
//   doing / stepped / compacting / limit_until as ADR 0099 says;
//   parent: Option<ThreadId>  — for ADR 0098 d24.
// Question gains `sub: Option<SubagentId>` (who asks).
```

**Facts** (`Fact` in `model.rs:1008+`), published later as `threads.subagent.*@1`:

- `subagent.started {thread, turn, sub, parent?, crew?, title, role?, prompt, background}`;
- `subagent.changed {thread, sub, state?, title?, model?, can_stop?, doing?}`, throttled to 1/s as
  ADR 0099 d11 says;
- `subagent.ended {thread, sub, state, why?, report?}`;
- `crew.started`, `crew.progressed {crew, phases?, agents?}`, `crew.ended`.

Lane entries use the existing item facts, with the Item carrying `sub`.

**Methods:**

- `agents.subagent {thread, sub} -> SubagentView` (Read; mark it `tool "read_subagent"`?);
- `agents.crew {thread, crew} -> CrewView` (Read);
- `agents.stop_subagent {thread, sub}` (Write).

#### Engine pieces

| Piece | File | What |
|---|---|---|
| feature + declare | `Cargo.toml`, `acp.rs` `shows()` | `unstable_subagents`; `subagents: {}`; Claude `_meta.claudeCode.emitRawSDKMessages` filter on `session/new` and `load` (in `acp/opening.rs`) |
| route children | `acp/routes.rs`, `acp.rs` handlers | child → root route; the permission and elicitation handlers use it; `Said::In` |
| parse | `acp/said.rs` | `subagent_update`, `session_message(_chunk)`; `_claude/sdkMessage` (`task_*`, `background_tasks_changed`, `workflow_progress`) |
| write | `transcript.rs` (+ a `transcript/lanes.rs`) | lanes, per-lane pieces and tools; anchors; counts and `doing` |
| between | `between.rs` | lane updates write at once; never open a turn for them |
| store | `store.rs` | `agents_subagents`, `agents_crews`, `agents_items.sub`; migrations |
| rules | `rules.rs` (new `rules/subagent.rs`) | may stop a lane; Stop all on the Thread's stop |
| keep host | `acp.rs` `idle_since`, Activity | busy while a lane or background task runs |
| list | `model.rs` ListedThread + its projection | `subagents`, `crew`, `parent` |
| tests | recordings | record Claude: Agent foreground, background, 3 in parallel, nested, Workflow; Codex: spawnAgent. Each with and without the capability (paid runs; ADR 0003 d13 allows recording) |

#### Client core, then views

1. `apps/agents/pane/src/thread/subagents.ts` (pure):
   - anchors in the timeline, and parallel launches grouped into one `crew` line;
   - the words: "3 sub-agents · 2 working, 1 done", "Waiting on Explore";
   - what the live line names.
2. Satellites: `markOf` reads `subagents` (ADR 0099 d12).
3. The views:
   - `entries/subagent.tsx`;
   - `lines/crew.tsx`;
   - `crew/CrewPane.tsx` (Pane kind `agents.crew`, `PaneKind.grouped`-aware, opens into the
     Thread's Group Deck);
   - the lane view: the Thread view reused read-only, with no message box.
4. The sidebar's line 2 words, in ADR 0098's `card.ts`.

#### Plan (one PR each, tried in the window)

0. **The ADR, its mockups and the recordings.** Record first: the "stray replies" inference (§1.2)
   needs proof. If it holds, it is a bug to fix even before lanes: drop or route chunks stamped
   `parentToolUseId`.
1. **Engine:** the feature, the declaration, routing, lanes with their store and facts,
   `agents.subagent`, Stop, keeping the host. The window draws anchors as today's tool row, so
   nothing breaks.
2. **Engine:** `ListedThread.subagents`, `parent` and `doing`; this is ADR 0099's step 2.
3. **Client core:** `subagents.ts`, its tests and the timeline's anchors.
4. **Views:** the anchor entry, the lane view, line 2 and the satellites (ADR 0099 step 3).
5. **Claude workflows:** raw SDK frames into Crews; the Crew line and the Crew Pane.
6. **Later:** Banda Crews from `send` (an ADR 0082 run table), and `task@1`.

#### ADRs this amends

- **ADR 0003:** "Later: subagents as child Threads" becomes lanes. The child session id is evidence.
- **ADR 0002, d7 and d11:** the Harness's child session ids are evidence. Add recordings with
  sub-agents.
- **ADR 0006:** a consequence only: a Harness's sub-agents are part of the Thread's Agent, with no
  name, settings or pass of their own.
- **ADR 0019:** native sub-agents are not its children. `ListedThread.parent` is added. A future
  Banda Crew is built on `send`.
- **ADR 0058, d4–d6:** the work line leaves lanes out; the live line names sub-agents; a lane's
  Question names its asker.
- **ADR 0091, d2–d3:** new entry kinds `subagent` and `crew` (does a Crew card stay out of its
  turn's fold, as a Visual does?) and the new line `crew`.
- **ADR 0065, d7:** the Crew Pane opens in the Thread's Group Deck.
- **ADR 0087, d6:** the Threads App gains Pane kinds `agents.crew` and `agents.subagent`. No new
  Item.
- **ADR 0098, d8, d23–d24:** line 2's words for lanes and crews; d24 gets its `parent` field.
- **ADR 0099, d2–d3, d11:** `subagents` counts running or asking lanes; add `crew`; the satellites'
  source.
- **ADR 0086 and the harnesses' idle release** (`hosts.rs`): a host with running lanes or
  background tasks is not idle.
- **ADR 0082 and 0085, vision §7:** a Banda Crew is the Threads App's run table; it is the
  candidate first `task@1`.
- **GLOSSARY:** add **Sub-agent** and **Crew** (or Roma's word). Note that Claude's "Workflow" is a
  Crew in Banda's words.
- **docs/architecture.md:** the agents section, on how sub-agents arrive and are kept.

#### Open questions for Roma

1. **The word** for "sub-agents working together in phases": Crew? (Workflow and Task are taken.)
2. **Does the Crew Pane open by itself** when a workflow starts, in the Group's Deck, or only on a
   click on the Crew card?
3. **May the Person stop one sub-agent?** The RFD allows it; Claude grants `cancel`, and Codex
   grants it while the child runs. Does the Thread's Stop stop background sub-agents too? The
   proposal is yes.
4. **Claude workflows:** read the raw SDK frames (an undocumented `workflow_progress`, as T3 does)
   now, or patch or ask upstream first?
5. **Banda's own fan-out:** should its child Threads show in the same Crew view? The proposal is
   yes, later.

---

## Appendix: the evidence in one list

- **Banda declares no subagents:** `apps/agents/engine/src/acp.rs:356-370`; the recorded initialize
  in `apps/agents/engine/tests/recordings/claude-edit.jsonl:1`.
- **Updates Banda keeps:** `apps/agents/engine/src/acp/said.rs:116-178`. Kinds it maps:
  `:277-289`. `_meta` read: `:102-103`, `:136-150`.
- **Routing:** `acp/routes.rs:28-35`. Permission and elicitation with an unknown session are
  cancelled: `acp.rs:255-258`, `:297-299`.
- **A new message id opens a new reply entry:** `transcript.rs:601-609`.
- **Between turns:** `between.rs:1-17`, `:37`, `:183`.
- **Idle release after 30 min:** `platform/harnesses/engine/src/hosts.rs:31`, `:201`, `:294`.
  `serving` is TCP only: `serving.rs:1-15`.
- **Body, ToolKind, Opener, ListedThread:** `model.rs:592`, `:349`, `:287`, `:793`. ListedThread
  has no `doing` or `subagents` yet.
- **Window:**
  - icons: `apps/agents/pane/src/entries/parts/ToolCall.tsx:193-203`;
  - verbs: `entries/parts/calls.ts`;
  - work-line counts: `thread/timeline.ts:296-380`;
  - entry rules: `entries/kinds.ts`;
  - the Mark still has 8 states: `client/ui/src/components/banda-mark.tsx:19-36`.
- **C, the Claude adapter:**
  - `README.md:39-104`;
  - `acp-subagents.js:4-15`;
  - `native-subagents.js:876-882`, `:1275-1300`, `:1394-1460`, `:1509-1517`;
  - `acp-agent.js:566-574`, `:1225-1233`, `:1403-1413`, `:2836-2845`, `:4038-4043`, `:4636-4775`,
    `:6415-6430`, `:9615-9623`;
  - `tool-calls/reporters/agent.js:4-34`, `tool-calls/renderer.js:579-590`,
    `tool-calls/reporters/interaction.js:159-181`;
  - `async-tasks.js:129-167`, `:871-878`, `session-ultracode.js:7`.
- **X, the Codex adapter** (`dist/index.js`): `:34917-34982`, `:35667`, `:36016-36050`,
  `:36270-36280`, `:40763-40790`, `:40840-40844`, `:46575-46581`. README `:18`, `:96-100`.
- **SDK:** `sdk.d.ts:3807-3840` (`background_tasks_changed`), `:6304-6440` (task messages,
  `workflow_name`), `:5754-5763` (`stream_event.parent_tool_use_id`), `:2120-2131`
  (`agentProgressSummaries`); `sdk-tools.d.ts:2871-2900`, `:4148-4190` (Workflow input and output).
- **R, the Rust crates:** schema 1.13.0 `src/v1/client.rs:164-180`, `:186-300`, `:953-1400`,
  `:3341`; crate 3.6.0 `Cargo.toml` `unstable_subagents`.
- **The RFD:** https://agentclientprotocol.com/rfds/subagents (fetched 2026-11-10).
- **T3:**
  - `packages/contracts/src/orchestrationV2.ts:154-164`, `:518-525`, `:801-848`, `:884-921`;
  - `packages/client-runtime/src/state/threadSubagents.ts` (pill "2/3", "3 done");
  - `apps/server/src/orchestration-v2/Adapters/claudeWorkflowProgress.ts`;
  - `apps/server/src/orchestration-v2/workflowAgentTranscript.ts`.
- **Banda ADRs read:** 0002, 0003, 0006, 0010, 0018, 0019, 0029, 0034 (d10 side chat as a hidden
  Thread), 0058, 0065, 0087–0089, 0091, 0098, 0099; the vision 2026-11-06 §4.4 and §7; GLOSSARY.
