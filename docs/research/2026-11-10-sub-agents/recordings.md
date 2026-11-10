# Sub-agents recorded: what Banda gets (ADR 0103, step 0)

- **Date:** 2026-11-10. Paid runs, as ADR 0003, decision 13, allows, on the
  cheapest model each Harness offers: Claude's Haiku 5.5 at low effort,
  Codex's `gpt-6-luna` at low reasoning.
- **Versions:** Claude Code 2.1.322 through `claude-agent-acp` 0.99.1;
  Codex 0.167.0 through `codex-acp` 2.5.0; Banda at `49e52c63`.
- **How:** `record_the_real_harnesses_with_sub_agents`
  (`apps/agents/engine/tests/agents.rs`), as the edit recordings are made;
  the replay tests beside it play them through the engine with the fake
  agent. Line numbers below are the recordings' lines.

## Part A: as Banda is today, without `clientCapabilities.subagents`

Recordings in `apps/agents/engine/tests/recordings/`:

| File | Lines, bytes | What was asked |
|---|---|---|
| `claude-subagents.jsonl` | 136, 90 KB | Full access: three Agent calls at once in the foreground (prompt at 15), one in the background (61), one whose sub-agent starts its own (82). Supervised: one whose `echo delta > d.txt` asks (100–136) |
| `claude-workflow.jsonl` | 45, 28 KB | Supervised: the Workflow tool with a two-agent script, the second agent's command asks |
| `codex-subagents.jsonl` | 39, 32 KB | Full access: spawn two, wait for both, report |

### Stray replies: not real

No message or thought chunk in the three files is stamped
`_meta.claudeCode.parentToolUseId`: in `claude-subagents.jsonl` the only
chunks are the parent's replies (55–57, 73, 79, 97, 129–133). What a
sub-agent says reaches Banda only as its Agent call's result. The replay
test
`claude_code_s_sub_agents_work_as_the_agent_s_own_and_write_no_reply_of_theirs`
holds it: the Agent's replies are exactly "alpha, bravo, charlie",
"started", "alpha" and "bravo", the parent's. Nothing in the engine was
changed.

Why none came, read from `claude-agent-acp` 0.99.1's
`dist/acp-agent.js` and the Agent SDK 0.3.312's `sdk.d.ts`:

- **Claude Code is not asked for it.** The adapter passes the SDK option
  `forwardSubagentText` only for a client that declares sub-agents
  (`acp-agent.js:8808-8812`, `:8934`, `:9062`). Without it the SDK emits
  "only tool_use/tool_result blocks from subagents" (`sdk.d.ts:1915-1921`).
- **A whole message's text is dropped.** Should a sub-agent's message
  carry text anyway, the adapter keeps only its other blocks for such a
  client (`acp-agent.js:6077-6081`).
- **A streamed delta would not be dropped.** "Every other client gets the
  streamed subagent text, like upstream" (`:2836-2845`): only an AIR client
  is spared it (`:5766-5774`). Such a chunk would come on the parent's
  session, stamped, and open a reply written as the parent's. It is
  _inferred_ that it never comes: the SDK's documentation of the option
  above rules it out, and none came here.

So the stray replies are not real with these versions, and nothing needs
fixing before lanes. Step 1 declares the capability, and a sub-agent's
text then comes on its own session (Part B).

_Limit:_ at low effort no thinking came at all, so a sub-agent's thinking
is unrecorded. It takes the same paths as text.

### Claude Code's Agent tool

- **The launch:** `tool_call` titled "Task", `kind: think`, `pending`,
  `rawInput: {}`, `_meta.claudeCode.toolName: "Agent"` (20, 26, 32). An
  update retitles it with the description (21, 27, 33). The next ones bring
  `rawInput` as Claude writes it, until the whole of it (`description`,
  `prompt`, `subagent_type: general-purpose`, `model`,
  `run_in_background`) comes with the prompt as content (25, 31, 37). In
  the Thread: a Think tool, "Read first line of a.txt".
- **Its end:** `completed`, content `[text "<tools-used-before-summary>Read</tools-used-before-summary>\n", text "alpha"]`
  (49, 51, 53). Banda keeps both parts, so the tag shows as text. A
  nested child's report has both in one block (93), and the outer launch's
  has no tag (95). The `agentId`, `<usage>` and the hand-back frame are in
  `rawOutput` (49), and the `agentId`, `agentType`, `toolsUsed`, `usage`,
  `totalTokens`, `totalDurationMs` and `resolvedModel` in an update's
  `_meta.claudeCode.toolResponse` (48). Banda reads neither here: it
  drops `_meta`, and reads `rawOutput` only for an MCP image when a call
  has no content (`tool_content`, `acp/said.rs:194`).
- **The child's calls:** ordinary `tool_call`s on the parent's session,
  stamped `_meta.claudeCode.parentToolUseId` with the launch's ID (39, 42,
  45; 75; 91; 120). The engine drops the stamp (`acp/said.rs:116-179` reads
  no `claudeCode` key): in the Thread they are the
  Agent's own tools in the parent's turn, after the three launches ("Read
  a.txt", "Read b.txt (1 - 1)", "Read c.txt").
- **Background:** the launch ends at once with "Async agent launched
  successfully…", the internal `agentId` and `output_file` in its content
  (71); the parent says "started" (73); the child's Read comes after it
  (75–77); then the parent's own "alpha" after the task notification (79,
  usage `_claude/origin.kind: task-notification` at 80). The adapter held
  the prompt until then (answer at 81): one turn, Done, nothing between
  turns.
- **Nested:** the child's own Agent call comes stamped with the outer
  launch (91, a Think "Read first line of file", `rawInput` and prompt in
  the `tool_call` itself), and ends with its report (93). The grandchild's
  Read never comes: two levels down, nothing of the work reaches Banda.
- **A child's permission request:** `session/request_permission` on the
  parent's session, its `toolCall` the child's Bash call with
  `_meta.claudeCode.parentToolUseId` = the launch (121), options
  allow-once / allow-with-updates / reject. It is routed and answered (122):
  in the Thread a Question "echo delta > d.txt" in the parent's turn, with
  nothing naming the sub-agent, as the engine reads no `_meta` there.

### Claude Code's Workflow tool

- **The call:** `tool_call` "Workflow", `kind: other`, `rawInput: {}` (17);
  the script with its `meta` comes in a later update's `rawInput` (18–19).
- **It asks first** under Supervised: `session/request_permission` titled
  "Workflow", with the script in `rawInput`, options "Yes" / "Yes, and
  don't ask again for Workflow commands" / "No" (20). In the Thread the
  Question is only "Workflow": Banda reads no `rawInput`, so no name,
  description or phases.
- **It ends at once:** an update carries
  `_meta.claudeCode.toolResponse` with `status: async_launched`, `taskId`,
  `taskType: local_workflow`, `workflowName`, `runId`, `summary`,
  `transcriptDir`, `scriptPath` (23); `completed` with that as text (24).
  The parent says "Launched." and the prompt is answered with `end_turn`
  (30): the turn is Done while the workflow works.
- **No progress comes:** no frame for the reading agent at all.
- **A workflow agent that asks:** between turns, a Bash `tool_call` with no
  `parentToolUseId` (31), then `session/request_permission` on the parent's
  session with no sign of which agent asks (32). In the Thread it opens a
  turn "‹Agent› went on by itself." holding a Question "echo delta >
  d.txt" (answered at 33). The call never gets an update: its row stays
  Pending.
- **Its end:** Claude's reply in that turn, "The workflow finished…"
  (35–43), and the usage with its cost, `_claude/origin.kind:
  task-notification` (45), which ends that turn.
- The replay (`a_claude_workflow_ends_its_turn_at_once_and_its_agent_asks_as_claude_by_itself`)
  holds this. The fake agent waits 100 ms after a prompt's answer before
  it says the rest, as a real Harness does. Without that pause the engine
  can put what comes right after `end_turn` into the turn that ended
  ([#1182](https://github.com/0x1oceanlabs/banda/issues/1182)).

### Codex's sub-agents

- **No `spawnAgent` row:** Codex 0.167 ran its V2 multi-agent, which the
  model catalog picks for `gpt-6-luna` (`multi_agent_version: v2`; the
  older `gpt-5.6-luna` has `v1`). Under V2 it reports activity items,
  `tool_call`s titled "Start subagent read_a" and "…read_b", `kind:
  other`, `rawInput: {agentThreadId, agentPath: "/root/read_a",
  activityKind: "started"}`, completed at once (15–16, 18–19). V1's
  `spawnAgent` row, the one ADR 0103's "Where it stands" describes, is
  unrecorded.
- **The wait:** a `tool_call` "wait", `rawInput` with `senderThreadId` the
  parent and `receiverThreadIds: []`, `agentsStates: {}` (21, 26), completed
  as each child ends (24, 29).
- **A child's end:** "Complete subagent read_a", `toolCallId`
  `subagent-completed-<an ID of Codex's>`, which is not the child's thread
  ID (22: `…-db94-…` for the thread `…-db7f-…`), `activityKind:
  "completed"`, no content (22–23, 27–28).
- **Nothing of the children's work or reports:** every frame is on the
  parent's session; the children's thread IDs are only in `rawInput`. In
  the Thread: six Other rows, then the parent's "alpha,bravo" (31–34).
  The replay test `codex_s_sub_agents_show_as_their_start_the_wait_and_their_end`
  holds it.
- _Unrecorded:_ a Codex child's approval without the capability, as this
  run had Full access. ADR 0103 says it comes as the parent's own Question;
  with the capability it comes on the child's session (Part B).

### What it means for step 1

- `parentToolUseId` is enough to route a Claude child's calls and its
  Question to a lane today: it is on every child call and on the request.
  It is not there for a grandchild's work, which never comes, nor for a
  workflow agent's.
- A workflow agent's Question names no agent and its call never ends: ADR
  0103's open question "who asks inside a Crew" is answered "nobody is
  named", without the capability.
- Codex gives a lane only a start, an end and a name (`agentPath`), no
  work: the capability is needed for anything more.

## Part B: with `clientCapabilities.subagents: {}`, the adapters spoken to directly

Recordings in
[`acp-with-subagents/`](acp-with-subagents/), one frame a line,
`{t, to, frame}` as the engine's recorder writes them plus `t`, the
milliseconds since the adapter started. `file:N` below is line N of a file
there.

- **How:** a small Node client in a scratch folder, not in the repo, spoke
  ACP to the bundles Banda carries (`platform/harnesses/adapters/dist/`,
  as built in a checkout of main, from the pinned `claude-agent-acp` 0.99.1
  and the patched `codex-acp` 2.5.0) on Node 24, as `carried.rs` and `list.rs` start them:
  `CLAUDE_CODE_EXECUTABLE` and `BANDA_CLAUDE_SESSIONS` for Claude, `CODEX_PATH`
  for Codex. No engine code ran or changed.
- **Declared:** Banda's `clientCapabilities` as `claude-edit.jsonl:1` has
  them, plus `subagents: {}` (`claude-subagents.jsonl:1`). Claude's
  `session/new` carried `_meta.claudeCode.emitRawSDKMessages`, a filter
  list of `{type: "system", subtype}` for `task_started`, `task_progress`,
  `task_updated`, `task_notification`, `background_tasks_changed` and
  `init` (`claude-subagents.jsonl:3`; the adapter also takes `true`,
  `acp-agent.js:9615-9623`). It also carried `options.settingSources: []`
  and `promptSuggestions: false`, to keep the Person's hooks and plugins out
  and spare a model call. Banda sends neither: it sends `settingSources:
  ["user"]` in a Project the Person has not trusted, and none in one they
  have (`acp/opening.rs:100-104`), so Part A ran with the Person's own
  settings.
- **Asked, under Supervised** (`default`, `read-only`), each Question
  answered "allow once" after 1.5 s:

| File | Lines | What was asked |
|---|---|---|
| `claude-subagents.jsonl` | 168 | Three Agent calls at once (prompt at 15); one in the background (76); one told to start its own, which read the file itself (113); one whose slow command asks and is then stopped alone (138) |
| `claude-nested.jsonl` | 81 | One sub-agent that starts an Explore sub-agent of its own |
| `claude-workflow.jsonl` | 105 | The Workflow tool with a two-phase, two-agent script (15); then a one-agent script whose slow command asks, stopped by `session/cancel` on the parent between turns (76) |
| `codex-two.jsonl` | 60 | Two sub-agents at once, one of whose commands asks |
| `codex-spawn.jsonl` | 89 | Two sub-agents, which the model declined to start (13–60); one whose slow command is then stopped alone (61) |

- **Scrubbed** as `record_the_real_harnesses_editing_a_file` does: who is
  signed in, the home folder and Claude's configuration folder written out,
  commands cut to Claude Code's own, the `agent` option to its default and
  current value. The raw `init` frame is cut to its model, mode and built-in
  tools.
- **Limits:**
  - One run each, at low effort.
  - No sub-agent failed, so `idle` with `error`, `refusal` or `max_*` and
    the RFD's `unknown` are unrecorded.
  - No `workflow_log` came.
  - Codex ran its V2 multi-agent (the model catalog has
    `multi_agent_version: v2` for `gpt-6-luna`), so V1's untitled children
    are unrecorded.
  - The first workflow's agents misread their briefs and looked for the
    Workflow tool: the first read both files with Bash, the second only
    searched for the tool (their `resultPreview`, `claude-workflow.jsonl:53,
    56`), and Claude's reply says so (62–73). The frames' shapes stand; the
    result is not the script's.

### Stray replies: none

Nothing a sub-agent says comes on the parent's session. Each child's text
comes on the child's own session, stamped
`_meta.claudeCode.parentToolUseId` with its launch and with a message ID
of its own: `claude-subagents.jsonl:49, 59, 66, 97`,
`claude-nested.jsonl:67, 72`. No chunk on the parent's session carries the
stamp, in any file. With the capability the adapter asks Claude Code for a
child's text (`forwardSubagentText`, Part A) and routes it to the child's
session. Two things still need care in step 1:

- **A report's first block is an internal tag:** the `:reply` message's
  content is `[text "<tools-used-before-summary>Read</tools-used-before-summary>\n", text "banana"]`
  (`claude-subagents.jsonl:57, 65, 70`), or both in one block
  (`claude-nested.jsonl:71`). Step 1 should strip the tag.
- **A background child's `:reply` can be the launch receipt:** in
  `claude-nested.jsonl:28` the child's message to the parent is "Async
  agent launched successfully… agentId: …", sent 9 ms after its
  announcement and before it did anything. The child's real answer is its
  last message (`:72`) and `task_notification.summary`. In
  `claude-subagents.jsonl` the background child sent no `:reply` at all.
  Step 1 should take a background lane's report from its last message, and
  drop a `:reply` that starts "Async agent launched".

### `subagent_update`

| | Claude | Codex |
|---|---|---|
| Child session | the SDK's agent ID, which is also the task's `task_id`: `a42c2c74e051aeb54` (`claude-subagents.jsonl:21-22`) | `<root>:subagent:<child thread ID>` (`codex-two.jsonl:15-16`) |
| Announced | in one update: `title`, `description`, `capabilities: {cancel: {}}`, `state: running` (`claude-subagents.jsonl:22`) | `{title, capabilities: {}}`, then `running` twice, then `capabilities: {cancel: {}}`, each its own update (`codex-two.jsonl:15, 17-19`) |
| `title` | the Agent call's description, which the model writes: "Read a.txt one line", "Run timeout tail then cat a.txt" (`:22, :143`) | the last segment of the child's agent path, the spawn's `task_name` under V2, with `_` and `-` as spaces and its first letter upper case (`nameFromAgentPath` in `codex-acp`'s `dist/index.js:35132-35138`): `read_a` gives "Read a" (`codex-two.jsonl:15`, whose prompt named it). "Run command" (`codex-spawn.jsonl:63`) is _presumably_ `run_command`: that prompt named none |
| `description` | the role, `subagent_type`: "general-purpose", "Explore" (`claude-nested.jsonl:52`) | none |
| Model | the child's `config_option_update`: `agent` ("Subagent type") at once, then `model` ("Haiku 5.5") once it answers and `mode` and `effort`, in either order (`claude-subagents.jsonl:25, 38-39, 90, 93`; `claude-nested.jsonl:55-58`) | the child's `config_option_update`: `model`, `reasoning_effort` (`codex-two.jsonl:16`) |
| Prompt | `session_message` twice, `messageId` = the launch's tool use ID: the parent's outgoing view on the parent with `recipientMessageId`, then the child's incoming view with `senderMessageId` (`claude-subagents.jsonl:23-24`). No `tool_call` for the Agent launch comes at all, on any session: this `messageId`, and the raw `task_started.tool_use_id`, are all that tie a lane to where it started | none: no `session_message` at all, no spawn call, no `user_message_chunk` |
| Report | `session_message` from the child, `messageId` `<launch>:reply`, on the parent, after its `idle` (`claude-subagents.jsonl:57`; caveats above) | none: the child's own last `agent_message_chunk` (`codex-two.jsonl:31, 46`) |
| Usage | none on the child's session, nor in its `idle`; only in raw `task_progress.usage` and `task_notification.usage` (`claude-subagents.jsonl:37, 52`) | `usage_update {used, size}` on the child's session, its context and not a cost (`codex-two.jsonl:29, 45`); none in its `idle` |

**Order.** The announcement comes before any traffic of the child, its
Question included, as the RFD says.

- **Claude, start:** raw `task_started` (`claude-subagents.jsonl:21`), the
  announcement (22), the two prompt views (23–24), the child's options
  (25), its work, stamped, on its session (40–42).
- **Claude, end:** raw `task_updated {patch: {status: completed}}` (50),
  `idle` with `end_turn` (51), raw `task_notification` (52), the `:reply`
  (57).
- **Three at once:** announced in the prompt's order (a, b, c), 0.6 s apart
  (22, 27, 32).
  They end in any order (51, 63, 68), and the parent's reply comes after
  the last (72).
- **Codex, end:** `config_option_update`, `idle` with `end_turn`, then
  `capabilities: {cancel: null}` (`codex-two.jsonl:33-35`). Its `wait` call,
  a `tool_call` on the parent titled "wait", `kind: other`, `rawInput:
  {senderThreadId, receiverThreadIds: [], agentsStates: {}}`, ends in the
  same millisecond (30, 36).

**States seen:** `running`; `requires_action`; `idle` with `end_turn` or
`cancelled`.

**A child's Question** is the child's, by session ID, in both:

- **Claude:** `requires_action` (`claude-subagents.jsonl:151`), then
  `session/request_permission` with the child's `sessionId` (152), its
  `toolCall._meta.claudeCode` stamped `parentToolUseId` too; after the
  answer, `running` (154).
  Options: allow-once, allow-with-updates (`allow_always`), reject.
- **Codex:** the child's `tool_call` (`codex-two.jsonl:38`),
  `requires_action` (39), the request with the child's `sessionId`, titled
  "Run command" (40), then `running` after the answer (43).

Today's engine would answer either `Cancelled`, since `Routes::of` knows
only the Thread's own sessions (ADR 0103, "Where it stands"): step 1 maps
the child's session first (decision 7).

**Nesting** (`claude-nested.jsonl`):

- The grandchild is announced on the child's stream: `subagent_update`
  with `params.sessionId` = the child (52), after a raw `task_started` with
  `spawn_depth: 2` and `parent_task_id` = the child (51).
- Its prompt goes child → grandchild (53–54), its work comes on its own
  session (59–66), which Part A never got, and its `idle` and `:reply` come
  on the child's stream (69, 71). The child's own `idle` comes on the
  parent's (74).
- So the parent of a lane is the `sessionId` its `subagent_update` came on.

**Background:**

- A `background_tasks_changed` naming the child comes first, then
  `task_started` with `is_backgrounded: true` (`claude-subagents.jsonl:80-81`).
- The parent answers "started" while the child runs (87).
- The prompt is held until the child ends (99) and the parent replies
  after it, in the same turn (104–109). The answer comes at 112, and nothing
  goes on by itself.
- The child the nested prompt asked for in the foreground ran in the
  background too (`claude-nested.jsonl:23`), and its turn was held the same
  way (81).

**Stopping one child: it works, in both, with a catch for Codex.**

- **Claude:**
  - `session/cancel` with the child's session (`claude-subagents.jsonl:156`).
    Within 8 ms come raw `task_updated {status: killed}` (157), `idle` with
    `cancelled` (158), and `task_notification {status: stopped}` for the
    child and for its command (159–160).
  - The child's call then fails with "The user doesn't want to proceed…"
    (161–162). It comes after the child's `idle`, so it still belongs to
    the lane.
  - The parent's turn goes on: it says "stopped" and ends with `end_turn`
    (164–168). No `:reply` comes.
- **Codex:**
  - `session/cancel` with the child's session (`codex-spawn.jsonl:71`), then
    the child's call fails (73), `idle` with `cancelled` (74), and
    `cancel: null` (75).
  - The command is not killed: it reports `completed`, exit 0, when its own
    `timeout 60` ran out (76).
  - **The parent never learns it.** Each `wait` runs 90 s and ends with
    `agentsStates: {}` (69–77, 79–80, 82–83), and the parent calls it
    again, until it is itself cancelled 330 s after the child (85–89).
  - So a Codex child stopped alone leaves its parent waiting. _Proposed:_
    Banda's Stop of one Codex sub-agent sends the parent a word (a steer
    naming it), or stops the turn with it.

### Claude's raw SDK frames, `_claude/sdkMessage`

Each frame is `params: {sessionId: <root>, message}`; the message's
`session_id` is the root's too. Trimmed:

- **`task_started`**:
  - A sub-agent: `{task_id, run_id, tool_use_id, description, subagent_type,
    is_backgrounded, spawn_depth, parent_task_id?, task_type: "local_agent",
    prompt}` (`claude-subagents.jsonl:21`).
  - A command a sub-agent runs: `{task_id: "bijy6xkwr", owned_by_subagent:
    true, parent_task_id, task_type: "local_bash"}` (155).
  - A workflow: `{task_id: "wu8k0p16z", task_type: "local_workflow",
    workflow_name: "read-two", prompt: <the script>}`
    (`claude-workflow.jsonl:27`).
  - A workflow agent's command has `owned_by_subagent` but no
    `parent_task_id` (99).
- **`task_progress`**: `{task_id, description, subagent_type, usage:
  {total_tokens, tool_uses, duration_ms}, last_tool_name}`. A workflow's
  also has `summary` (the script's description) and, when the tree changed,
  `workflow_progress` (`claude-workflow.jsonl:30`, 53, 56, 101).
  - The `description` reads "‹Phase›: ‹label›" while an agent works,
    "Check: cat b.txt" (53), and the script's description after the stop
    (101).
  - Eight of the first run's eleven have no `workflow_progress`, only
    `usage` (47–52, 54–55).
- **`workflow_progress`** is the whole tree each time, not a change: `:53`
  holds both phases and both agents.
  - `{type: "workflow_phase", index, title}`, 1-based.
  - `{type: "workflow_agent", index, label, phaseIndex, phaseTitle, agentId,
    model: "claude-haiku-5-5", state, queuedAt, startedAt, lastProgressAt,
    attempt, promptPreview, promptFramed, lastToolName?, lastToolSummary?,
    tokens?, toolCalls?, durationMs?, resultPreview?, error?,
    endedWithRun?}`.
  - States seen: `start`, `done`, and `error` with `error: "Stopped because
    the workflow was stopped"` and `endedWithRun: "stopped"` (101).
  - An agent appears only once the script calls it, so a phase's total
    grows as it runs.
- **`task_updated`**: `{task_id, patch: {status: completed | killed,
  end_time}}` (`claude-subagents.jsonl:50, 157`).
- **`task_notification`**: `{task_id, tool_use_id, status: completed |
  stopped, output_file, summary, usage}`.
  - A sub-agent's `summary` is its answer, "banana" (52).
  - A workflow's is "Dynamic workflow "Read two small files" completed"
    (`claude-workflow.jsonl:58`).
- **`background_tasks_changed`**: `{tasks: [{task_id, run_id, task_type,
  subagent_type?, description}]}`, the whole list each time, `[]` when
  none is left (`claude-subagents.jsonl:80, 101`; `claude-workflow.jsonl:26,
  59`). It names background sub-agents and workflows, not foreground ones.

### Claude's Workflow tool, with the capability

- **The call:** a `tool_call` "Workflow", `kind: other`, `rawInput: {}`
  (`claude-workflow.jsonl:21`). The script comes in an update (22) and in
  the permission request's `rawInput` (24), so Banda can read its `meta`
  for the Question to start a Crew.
- **The launch:** after "allow", `background_tasks_changed` (26),
  `task_started` (27), and the result in
  `_meta.claudeCode.toolResponse`: `{status: async_launched, taskId,
  taskType, workflowName, runId, summary, transcriptDir, scriptPath}` (28).
  The prompt is answered with `end_turn` at once (46).
- **Its agents are not children:** no `subagent_update`, no stream of
  theirs. Their progress is only in `workflow_progress`.
- **Its end, then Claude by itself:** `task_updated` completed,
  `task_notification`, `background_tasks_changed []` (57–59).
  - Claude then replies on the parent's session with no prompt open
    (62–73): the "went on by itself" turn.
  - Its `usage_update` names the task's run:
    `_meta._claude/origin: {kind: task-notification, producer: session-task,
    runId}` (75), where `runId` is `task_started.run_id`
    (`0mwaee106-…`, 27), not the tool response's `runId` (`wf_f79500da-24b`,
    28). This ties "Crew finished" to the reply.
- **A workflow agent's Question names nobody** (the ADR's open question),
  with the capability too:
  - Between turns, an eager `tool_call` for its Bash on the parent's
    session, with `toolName` only and no `parentToolUseId` (95), then
    `session/request_permission` on the parent's session with no `_meta`
    (96).
  - The `task_progress` that came then had no `workflow_progress` (97).
    Only after the stop does the agent's `lastToolSummary` show the
    command (101).
  - _Proposed:_ such a Question names the Crew: a request on the parent's
    session, with no `parentToolUseId`, while no prompt is open and a
    workflow is in `background_tasks_changed`. With two Crews at work it
    cannot tell which: the raw `task_started` of the agent's command comes
    only after the answer, and has no `parent_task_id` (99).
- **That call never ends:** no update follows 95, even after the stop.
  Only the raw `task_notification` of its command names its tool use ID,
  `status: stopped` (105). _Proposed:_ the engine ends a Crew's open calls
  when the Crew ends.
- **The Thread's Stop reaches a Crew** (the ADR's other open question):
  `session/cancel` on the parent with no prompt open (100) stops the
  workflow. Its agent goes `error` (101), then come `task_updated` killed,
  `task_notification` stopped, `background_tasks_changed []` and the
  command stopped (102–105). With the declaration no patch is needed (the
  adapter's `perTaskStopAffordance`, ADR 0103's open question); a cancel
  without it was not recorded.
- **Agents' transcripts reach Banda's store:** the shim kept them in
  `BANDA_CLAUDE_SESSIONS` as
  `claude/<root>/subagents%2Fworkflows%2F<runId>%2Fagent-<agentId>.jsonl`,
  with the tool response's `runId` (`wf_…`) and the `agentId` of
  `workflow_progress`. A sub-agent's is
  `claude/<root>/subagents%2Fagent-<child session>.jsonl`.
  - The account's folder has the same, with `journal.jsonl` and a
    `.meta.json` per agent, in `transcriptDir`.
  - So the Crew Pane can show an agent's work (the ADR's third open
    question), read from the store.

### Proposed: `ListedThread`'s sub-agent fields

_A proposal for step 3, which ADR 0103 leaves to these recordings._ It
differs from decision 10's list: there `failed` is a field of
`ListedThread` and `crew` carries `title, phase, phases, working, done`;
here `failed` and the one label sit in `subagents`, and `crew` carries what
line 2 says. What the sidebar and the Mark need (ADR 0103, decisions 10,
13, 28 and 32):

- the Mark: how many direct sub-agents work, one grey satellite each, three
  at most, and whether one failed, the red one;
- line 2: a count, "3 sub-agents at work"; or one name, "Waiting on
  Explore"; or a Crew, "Crew audit-routes · Fix 4/7";
- Asks: who asks.

A list of up to three `{state, label}` carries more than that. A sub-agent
that asks makes the Thread ask, and has no orange satellite. Line 2 names
at most one. Each state change of any child would change the list, so
more facts. Counts and one label are enough:

```rust
pub struct ListedThread {
    // …
    /// Its direct sub-agents, while it works and has had any.
    pub subagents: Option<Subagents>,
    /// Its Crew at work, after its turn too.
    pub crew: Option<CrewBrief>,
    /// The Thread whose Agent started it (ADR 0098, decision 24).
    pub parent: Option<ThreadId>,
}

/// Direct: announced on the Thread's own session, not a child's.
pub struct Subagents {
    /// Running or requires_action: the grey satellites, "3 sub-agents at work".
    pub working: u16,
    /// Ended idle with error, refusal or max_* since its turn began: the red one.
    pub failed: u16,
    /// The one at work's label, when `working` is 1: "Waiting on Explore".
    pub only: Option<String>,
}

/// "Crew ‹title› · ‹phase› ‹done›/‹of›".
pub struct CrewBrief {
    pub title: String,  // the script's meta.name, as task_started.workflow_name
    pub phase: String,  // the phase of the latest agent to start
    pub done: u16,      // that phase's agents done
    pub of: u16,        // that phase's agents so far: it grows as the script calls them
}

// Asking (the list's Question) gains:
//   asker: Option<String>  // the lane's label; "Crew ‹title›" for a workflow agent's
```

- **A label:** the role when it is a named type other than Claude's
  default `general-purpose` ("Explore", `claude-nested.jsonl:52`), else the
  title ("Read a.txt one line", `claude-subagents.jsonl:22`, whose role is
  `general-purpose`; Codex's "Read a", `codex-two.jsonl:15`). A Codex child
  with no agent path gets the adapter's fallback, "Agent" or "Agent
  ‹the last 8 of its thread ID›" (`codex-acp` `dist/index.js:35859`,
  `:52126`, read from the code: V1 is unrecorded); Banda names it as ADR
  0103, decision 17, says.
- **`working`** counts the `subagent_update` states of the lanes whose
  update came on the root session. Grandchildren are announced on a
  child's, so they do not count. `background_tasks_changed` cannot stand
  in: it lists background sub-agents only.
- **`crew`** comes from the last `workflow_progress`, and stays while
  `background_tasks_changed` names the workflow.
- **`parent` and the Thread's own state** are as the ADR has them.
