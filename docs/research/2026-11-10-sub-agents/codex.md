# OpenAI Codex: sub-agents and multi-agent, how they work and how they look

Research for Banda's sub-agent and workflow UI. Written 2026-11-10.

Versions read:
- Codex CLI installed: `codex-cli 0.167.0` (`codex --version`). `codex features list` was run locally.
- Codex source: `openai/codex` main at `caae161` (2026-11-09), sparse clone. Paths below are relative to `codex-rs/`.
- `@openai/codex@0.165.0` in Banda's `node_modules` is only the npm launcher (`bin/codex.js`). The Rust binary comes from the optional per-platform packages, so the source above is the reference.
- codex-acp: the installed `2.5.0` bundle (`node_modules/.pnpm/@agentclientprotocol+codex-acp@2.5.0_*/.../dist/index.js`, cited as `acp:LINE`). Also the GitHub HEAD `2.6.0` at `ab7a968` (cited as `src/...`).
- ChatGPT/Codex desktop app installed on this machine: `openai-codex-desktop 26.1103.60933` (`/usr/lib/chatgpt/resources/app.asar`). Its English UI strings were read from `id:"…",defaultMessage:"…"` pairs in the bundle.
- Official docs: `developers.openai.com/codex/*` now redirects (308) to `learn.chatgpt.com/docs/*`. Pages used: `agent-configuration/subagents`, `environments/git-worktrees`, `code-review`, `cloud`, `changelog`.

How the sketches were made. A sketch marked **[snapshot]** copies an `insta` snapshot from the Codex TUI tests, so it is exact output. A sketch marked **[reconstructed]** is laid out from real UI strings and code, but the geometry is my guess.

---

## 0. TL;DR for the designer

1. **Codex has two sub-agent engines.**
   - **V1 ("collab")** is on by default. The model gets `spawn_agent`, `send_input`, `wait_agent`, `close_agent` and `resume_agent`.
   - **V2** is opt-in through `features.multi_agent_v2`, or a model can select it. Agents get a **task path** such as `/root/review/tests`. Communication goes through a **mailbox**, using `send_message` and `followup_task`, and a child's final answer is posted back to its parent automatically. The tools are `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `list_agents` and `interrupt_agent`.
2. **Every sub-agent is a full Thread.** It has its own `threadId` (UUIDv7) and links to its parent through `parentThreadId`. It has a nickname taken from a list of scientists (Euclid, Hypatia, Robie…), and optionally a **role** (`default`, `worker`, `explorer`, or a custom one). Model and effort are inherited unless overridden.
3. **The parent's transcript only shows one-line lifecycle cells.** Examples: *Spawned Robie [explorer] (gpt-5 high)*, *Waiting for 2 agents*, *Finished waiting*, then `Robie [explorer]: Completed - 39916800`. The child's own work is never inlined. To see it, you **switch the view** to the child thread: `/subagents` picker, ⌥←/⌥→, or "o to open thread" from an approval.
4. **Approvals from children reach the user wherever they are.** The approval prompt carries `Thread: Robie [explorer]`. A banner says `! Approval needed in Robie [explorer]` and offers `/subagents to review requests`. In the command center the urgent state of a child **rolls up** to its root task, and a *failed* sub-agent does **not** mark the task as "Needs you".
5. **The desktop app (and the IDE extension, which shares the webview) adds four things.**
   - A collapsible **"N background agents"** strip above the composer, with rows like `@Robie is working`, a **Stop all** button and the hint "(@ to tag agents)".
   - A right-side **Subagents** panel with **Active · n** and **Done · n** lists. Each agent's detail shows **Status**, **Delegated task**, **Final response** and `model · effort`.
   - Inline **activity chips** in the turn, for example "Hooke, Turing and 2 more started working".
   - An **Activity → Subagents · 3 used** row in the summary card.
6. **"Ultra" reasoning is Codex's version of "ultracode".** It is a reasoning-effort level, described as "For demanding work using multiple agents · highest usage". Under V2 it switches the multi-agent mode from *explicit-request-only* to **proactive**, so the model fans out on its own.
7. **Data, end to end:** app-server v2 items `collabAgentToolCall` and `subAgentActivity`, plus the Thread fields `parentThreadId`, `agentNickname` and `agentRole`. **codex-acp** maps these to ACP **child sessions** through `subagent_update`, but only when the client declares `clientCapabilities.subagents: {}`. **Banda does not declare this today.** As a result Banda sees only flat tool calls titled `spawnAgent` or `wait`, and the children's own streams are dropped. Only the children's approvals and elicitations come through, and they are re-attributed to the root.

---

## 1. How it works (Codex CLI 0.167, core)

### 1.1 Feature flags and versions

`codex features list` (local, 0.167.0):

```
multi_agent                    stable             true    <- V1 "collab" tools (Feature::Collab)
multi_agent_v2                 stable             false   <- V2 task-path + mailbox engine
multi_agent_v2_dynamic_tools   under development  false
multi_agent_mode               removed            false
agent_message_board            under development  false   <- "shared discussion tools for an agent tree"
wake_on_agent_messages         under development  false   <- agent messages wake an idle root
runtime_agent_instances        under development  false
subagent_thread_environments   under development  false
subagent_default_context_limits under development false
guardian_native_multi_agent_history under development false
send_message_to_user_async     under development  false
enable_fanout                  removed            false   (old CSV fan-out, see 1.6)
```

- In source HEAD the feature key `multi_agent` is `Stage::Deprecated, default_enabled: true` (`features/src/lib.rs:1640-1644`). The `[agents] enabled` setting replaces it.
- `multi_agent_v2` is `Stable, default_enabled: false` (`features/src/lib.rs:1646-1650`).
- How the version is chosen (`core/src/config/mod.rs:1730-1757`):
  1. `features.multi_agent_v2` on → **V2**.
  2. Otherwise `agents.enabled = false` → **Disabled**.
  3. Otherwise the **model catalog** may pick a version (`ModelInfo.multi_agent_version`, `protocol/src/openai_models.rs:528`).
  4. Otherwise `multi_agent` on → **V1**.
- So a model can silently move a session to V2. The UI has to handle both engines.
- Multi-agent is on through the defaults: `config.toml` needs no key for it.

### 1.2 Config (`~/.codex/config.toml`, `[agents]`)

Source: `config/src/config_toml.rs:768-816`, docs `learn.chatgpt.com/docs/agent-configuration/subagents`.

```toml
[agents]
enabled = true                              # default true; false = no multi-agent tools
max_concurrent_threads_per_session = 6      # alias: max_threads; V1 default 6 (mod.rs:270)
max_depth = 1                               # V1 only; default 1 (mod.rs:280) = children cannot spawn
default_subagent_model = "gpt-…"            # used when spawn_agent omits model
default_subagent_reasoning_effort = "high"
interrupt_message = true                    # model-visible note when an agent turn is interrupted
# job_max_runtime_seconds: removed, no-op

[agents.researcher]                         # a role (flattened map)
description = "Research-focused role."
config_file = "./agents/researcher.toml"    # role config layer
nickname_candidates = ["Herodotus", "Ibn Battuta"]

[features.multi_agent_v2]                   # V2 tuning (core/src/config/mod.rs:1412-1458)
max_concurrent_threads_per_session = 4      # V2 default 4 INCLUDING root -> 3 children
min_wait_timeout_ms = 10000
default_wait_timeout_ms = 30000
max_wait_timeout_ms = 3600000               # 1 h hard max
tool_namespace = "collaboration"
hide_spawn_agent_metadata = true            # V2 hides agent_type/model/effort from the tool by default
wait_agent_enabled = true
```

**Custom agent files.** Docs and `config_tests.rs:9370-9395` describe them:
- One TOML file per agent, in `~/.codex/agents/*.toml` (personal) or `.codex/agents/*.toml` (project).
- Required fields: `name`, `description`, `developer_instructions`.
- Optional fields: `model`, `model_reasoning_effort`, `model_reasoning_summary`, `model_verbosity`, `features.*` (to cut tools), `[[skills.config]]`.
- A file **cannot** override `sandbox_mode`, `approval_policy`, `model_provider` or `mcp_servers`. Children always inherit the parent turn's sandbox and approvals.
- A custom agent whose name matches a built-in (for example `explorer`) wins.

**Built-in roles** (`core/src/agent/role.rs:315-380`):

| role | description given to the model |
|---|---|
| `default` | "Default agent." |
| `explorer` | "Use `explorer` for specific codebase questions. Explorers are fast and authoritative… spawn multiple explorers in parallel… Reuse existing explorers for related questions." (has `explorer.toml` layer) |
| `worker` | "Use for execution and production work… Explicitly assign **ownership** of the task (files / responsibility)… tell workers they are **not alone in the codebase**…" |
| `awaiter` | commented out ("temp removed"): for long-running commands |

**Nicknames.**
- Picked from `core/assets/agent/agent_names.txt`, a list of 101 scientists (Euclid, Archimedes, Ptolemy, Hypatia, Avicenna…), or from the role's `nickname_candidates`.
- When the list runs out, names repeat with an ordinal: "Euclid the 2nd" (`core/src/agent/registry.rs:65-80`).

### 1.3 Model-facing tools

V1 lives in namespace `multi_agent_v1`; V2 tools are plain functions in namespace `collaboration`. Source: `core/src/tools/handlers/multi_agents_spec.rs`.

| V1 tool (line) | args | returns |
|---|---|---|
| `spawn_agent` (70) | `message` or `items[]`, `agent_type`, `fork_context` (bool), `model`, `reasoning_effort` | `{agent_id, nickname}` |
| `send_input` (166) | `target`, `message`/`items`, `interrupt` (bool: true = redirect now, false = queue) | `{submission_id}` |
| `wait_agent` (287) | `targets[]`, `timeout_ms` (default 30 000; min 10 000; max 3 600 000) | `{status: {id: AgentStatus}, timed_out}`. Returns on the **first** final status |
| `close_agent` (336) | `target` | `{previous_status}`. Closes descendants too. "Completed agents remain open and count toward the concurrency limit until closed." |
| `resume_agent` (265) | `id` | `{status}` |

| V2 tool (line) | args | returns |
|---|---|---|
| `spawn_agent` (108) | **`task_name`** (required, `[a-z0-9_]`), **`message`** (required), `agent_type`, `fork_turns` (`all`/`none`), `model`, `reasoning_effort` | `{task_name, nickname?}`. The canonical path is `/root/<parent path>/<task_name>` |
| `send_message` (204) | `target` (task name/path), `message` | none: "Does not trigger a new turn" |
| `followup_task` (236) | `target`, `message` | none: "trigger a turn if it is idle" |
| `wait_agent` (303) | `timeout_ms` only | `{message, timed_out}`: "Wait for a mailbox update from **any** live agent… Does not return the content". It also ends early when the user steers new input |
| `list_agents` (315) | `path_prefix` | `{agents: [{agent_name, agent_status}]}` |
| `interrupt_agent` (361) | `target` | `{previous_status}`. The agent stays available |

**`AgentStatus`** (`protocol/src/protocol.rs:2068-2084`; JSON schema `multi_agents_spec.rs:384-411`):
- Plain values: `pending_init | running | interrupted | shutdown | not_found`.
- With a payload: `{completed: string|null}` (the final message) and `{errored: string}`.

**How the parent waits and what it gets back.**
- **V1:** the parent calls `wait_agent(targets)` and blocks until any target reaches a final state or the wait times out. It gets back statuses that include the final message text. A notification message with the same status is also injected when an agent finishes.
- **V2:** the child's final answer is delivered into the parent's **mailbox** as an inter-agent completion message (`core/src/agent/control/completion.rs`, `session_prefix.rs:20-42`). It reads "Agent errored: …" or "Agent shut down." on failure. `wait_agent` only reports *which* agents have updates.
- **Root wake-up:** an idle root can be woken by agent messages only behind `wake_on_agent_messages`.
- **Delegation guidance in the tool description** (`multi_agents_spec.rs:692-770`): plan the critical path first, delegate sidecar tasks, give each task a disjoint write set, "Call wait_agent very sparingly", "Do not spawn sub-agents unless the user… explicitly ask[s]".

### 1.4 "Ultra" = proactive multi-agent ("ultracode")

- The effort ladder is `… high, xhigh, max, ultra` (`protocol/src/openai_models.rs:83`).
- The TUI puts Max and Ultra behind a second step called **"Advanced Reasoning"**, with a warning (`tui/src/chatwidget/model_popups.rs:695-725`):
  ```
  Advanced Reasoning
  ⚠ Consumes usage limits faster
  › Max     For difficult problems when quality matters more than speed · higher usage
    Ultra   For demanding work using multiple agents · highest usage
  ```
- Under V2, choosing Ultra changes the developer message `<multi_agent_mode>` from *explicitRequestOnly* to **Proactive** (`core/src/session/multi_agents.rs:82-120`). The text is: "Proactive multi-agent delegation is active… If at any point you can parallelize work by delegating tasks to another agent (no matter if you are root or subagent), you should do so using collaboration tools…" (snapshot `core/src/context/world_state/snapshots/…multi_agent_mode__tests__snapshots.snap`).
- The TUI warns when Ultra is combined with 8 or more threads: "Ultra reasoning may proactively use multiple agents. This session is configured for N concurrent threads with up to N-1 subagents…" (`model_popups.rs:766-788`).
- The desktop app says "Ultra with up to {count} agents can use your usage limits quickly". It also asks for confirmation when Ultra is combined with Full access ("Use Ultra with Full access?").

### 1.5 Related "parallel" concepts in Codex

- **Side conversation** (`/side`, also `/btw`). This is a *fork* of the current thread for a quick question, with hidden instructions telling it to avoid mutations (`tui/src/app/side.rs:1-48`).
  - Its footer shows the parent's state: "main needs approval", "parent failed", "main finished".
  - The desktop app calls these **Side chats**. They are temporary tabs ("Side chat 2"), have an "Unread response" state, and are listed in the summary side panel.
- **Agent message board** (`agent_message_board`, under development). It adds tree-scoped discussion channels for agents, with channel descriptions, permissions, and an MCP variant.
- **Guardian.** An auto-review agent that can deny actions. State-changing multi-agent calls are routed through Guardian review (changelog 0.166.0, PR #57451).
- **Hooks:** `SubagentStart` ("When a subagent starts") and `SubagentStop` ("When a subagent stops"). These are desktop settings strings.

### 1.6 Removed

- **`spawn_agents_on_csv` / agent jobs.** `SpawnCsv` and `enable_fanout` are now no-ops (`features/src/lib.rs:275-276`), and `agents.job_max_runtime_seconds` is retained only as a no-op.
- **CSV fan-out is gone.** Today's fan-out is model-driven (Ultra or an explicit ask).

---

## 2. How it looks: Codex TUI

### 2.1 Lifecycle cells in the parent transcript (V1) **[snapshot]**

`tui/src/snapshots/codex_tui__multi_agents__tests__collab_agent_transcript.snap`:

```
• Spawned Robie [explorer] (gpt-5 high)
  └ Compute 11! and reply with just the integer result.

• Sent input to Robie [explorer]
  └ Please continue and return the answer only.

• Waiting for Robie [explorer]

• Finished waiting
  └ Robie [explorer]: Completed - 39916800
    Bob [worker]: Error - tool timeout

• Closed Robie [explorer]
```

and `…collab_resume_interrupted.snap`:

```
• Resumed Robie [explorer]
  └ Interrupted
```

Rules (`tui/src/multi_agents.rs`):

- **Bullet and title.**
  - The bullet `•` is dim. The verb is **bold**. The nickname uses the accent colour, in bold. `[role]` is plain. The `(model effort)` suffix is **magenta**, and it appears on the spawn cell only (`:534-551`).
  - When an agent has no nickname, the cell shows its thread UUID in the accent colour.
- **Detail lines.** They hang under `  └ ` (dim), with continuation lines indented by 4 spaces (`:464-470`).
  - A prompt preview is capped at 160 graphemes.
  - A completed message preview is capped at 240 graphemes, and its whitespace is collapsed.
- **Status words and colours** (`:629-656`):

  | status | rendering |
  |---|---|
  | `Pending init` | accent colour |
  | `Running` | accent colour, bold |
  | `Interrupted` | yellow |
  | `Completed - <msg>` | green, then ` - ` dim, then the message |
  | `Error - <msg>` | red |
  | `Shutdown` | plain |
  | `Not found` | red |

- **When each tool shows a cell** (`:204-286`):
  - `spawn_agent`, `send_input` and `close_agent` render **only when they complete**. A failed spawn renders "Agent spawn failed".
  - `wait` renders twice: "Waiting for X" while in progress, then "Finished waiting" with one line per agent. With more than one target, the first cell reads "Waiting for 3 agents", followed by one line per agent.
  - V2 `send_message`, `followup_task`, `interrupt_agent` and `list_agents` produce **no cell**. They count as analytics only, and V2 draws `SubAgentActivity` instead.

### 2.2 V2 activity cells (path-based) **[reconstructed from `multi_agents.rs:326-339`]**

```
• Started `/root/review`
• Started `/root/tests`
• Interacted with `/root/review`
• Completed `/root/tests`
• Interrupted `/root/review`
```

- The verb is bold. The path appears in backticks, in the accent colour.
- `Interacted` does not change liveness.
- These cells are **deferred while the parent's answer is still streaming**, so the stream is not broken up (`chatwidget/tool_lifecycle.rs:143-156`).

### 2.3 Switching view to a child: `/subagents`, ⌥← / ⌥→

The `/subagents` command was formerly `/agent`. Its description is "switch between this session's subagents" (`tui/src/slash_command.rs:82-83,145`).

**[snapshot]** `codex_tui__app__tests__path_backed_agent_picker.snap`:

```
  Subagents
  Select an agent to watch. ⌥← previous, ⌥→ next.


› 1. • /root/review (needs approval)  00000000-0000-0000-0000-000000000002
  2. • /root/worker (needs approval)  00000000-0000-0000-0000-000000000123
  3. • Main [default] (current)       00000000-0000-0000-0000-000000000001

  enter select · esc back
```

- **The dot.** It is **green** for a live agent and plain/dim for a closed one (`multi_agents.rs:76-83`).
- **The name.** It is `Nickname [role]`, or `/root/path` under V2. The parent is always shown as **`Main [default]`**, and an agent with no data shows as "Agent".
- **The description column** shows the thread UUID.
- **Order.** Threads with **pending approvals come first** (changelog 0.167, PR #58720). Otherwise the order is the first-seen spawn order, which also drives ⌥←/⌥→ cycling (`app/agent_navigation.rs:17-20`).
- **"(needs approval)" suffix** (`app/session_lifecycle.rs:202`).
- **Archived threads** are dropped from the picker (`…untracked_thread_notifications_agent_picker.snap`).

**Footer while you watch a child [snapshot].** First `…selected_unloaded_subagent_V1.snap`:

```
› Ask Codex to do anything

  GPT-6.1-Sol default · /tmp/project · child-0 [worker] · ← for agents
```

Then V2 (`…_V2.snap`). Here the child is **owned by its parent agent**, so the user cannot type into it:

```
› Viewing sub-agent — direct input is disabled

  GPT-6.1-Sol default · /tmp/project · child-1 [worker] · ← for agents
```

(`bottom_pane/chat_composer.rs:1766-1768`; footer label and "for agents" hint at `bottom_pane/footer.rs:325,861`.)

**Status preview in V2 (`/subagents` with nothing to pick).** This is `app/agent_status_feed.rs:35-60`.
- It shows the last up to 3 lines from each running child.
- Each line is a one-line summary of an item: `$ cargo test`, `Updated 3 file(s)`, `MCP github/get_pr`, `Web search: …`, or the last reasoning summary.

```
/subagents
Sub-agents running

  • `/root/review`
      $ cargo test -p core
      Updated 2 file(s)
      Found the regression in parser.rs
  • `/root/tests`
      No recent activity yet.
```

### 2.4 Approvals from a child while you watch the parent

**[snapshot]** `bottom_pane/snapshots/…approval_overlay_cross_thread_prompt.snap`:

```
  Would you like to run the following command?

  Thread: Robie [explorer]

  $ echo hi


› 1. Yes, proceed (y)
  2. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel or o to open thread
```

**[reconstructed]** The banner above the composer for inactive threads with pending approvals (`bottom_pane/pending_thread_approvals.rs:47-66`). The `!` is red and bold, at most 3 rows are shown, then `...`:

```
  ! Approval needed in Robie [explorer]
  ! Approval needed in /root/tests
    /subagents to review requests
```

### 2.5 Agent command center (`codex agents`, `/agents`) **[snapshot]**

Added in 0.164 to 0.167. It is a full-screen dashboard of **tasks**, meaning root threads. Sub-agents are folded into their root (`app/agents_overview.rs:1-3`). From `codex_tui__app__agents_overview__tests__agents_overview.snap`:

```
  Agent command center  Group: Project  g
   All 3   Needs you 1   Working 1   Ready 0   Inactive 1                      tab/⇧tab filter
  ────────────────────────────────────────────────────────────────────────────────────────────
      Tasks                                           │ Task details
  /tmp/project  3                                     │
  › ● Build the dashboard                             │ Build the dashboard
    ● Repair authentication                           │ ● Needs input
    ○ Review yesterday's changes                      │
                                                      │ Model: gpt-6.1-sol
                                                      │ Reasoning: Unknown
                                                      │
                                                      │ Project
                                                      │ /tmp/project
                                                      │
                                                      │ Agent: Inspect keyboard shortcuts      <- the CHILD that needs you
                                                      │ Open task to review.
                                                      │ Waiting for approval.
                                                      │
                                                      │ Prompt
                                                      │ Build the dashboard
  ? help  esc back  ↑/↓ move  enter open  n new
```

- **Filters / groups** (`app/agent_center/mod.rs:12-18`):
  - `Needs you`: an active flag `waitingOnApproval` or `waitingOnUserInput`, or a root that hit a system error.
  - `Working`: active.
  - `Ready`: idle.
  - `Inactive`: not loaded, or a **sub-agent** system error.
- The rule comes from `app/agents_overview_view.rs:73-107`: "A subagent failure ends its work without asking the user to act" (changelog 0.166, #57315).
- **Roll-up** (`agents_overview_details.rs:140-203`): the details pane walks the whole child tree. It picks the most urgent thread (NeedsYou before Working before the rest) and labels it `Agent: <nickname or name>`. While working, it shows the child's **latest reasoning header** under "Latest activity".
- Other states:
  - Wide layout: a table with `Status` and `Updated` columns ("Ready  2m ago").
  - `Group: Directory` groups rows by cwd or worktree.
  - Empty state: "No tasks yet".
  - Lock state: "🔒 This conversation is open in another app" with the choices `r retry`, `f fork`, `←/esc command center`.

### 2.6 Codex Cloud best-of-N in the TUI (`codex cloud`) **[reconstructed from `cloud-tasks/src/ui.rs`]**

- `codex cloud exec --env ENV --attempts N` takes "Number of assistant attempts (best-of-N)" with a default of 1 (local `--help`).
- In the browser TUI, **Ctrl+N** opens the modal (`ui.rs:1009-1036`):

```
┌ Parallel Attempts ─────────────────┐
│ Use ↑/↓ to choose, 1-4 jump        │
│ › 1 attempt    1x parallel         │
│   2 attempts   2x parallel         │
│   3 attempts   3x parallel  Current│
│   4 attempts   4x parallel         │
└────────────────────────────────────┘
```

The task detail overlay (`ui.rs:385-414`) looks like this:

```
 Prompt  Diff  (← → to switch view)  Attempt 2/3  (Tab/Shift-Tab or [ ] to cycle attempts)
 ...diff of the selected attempt...
 a: Apply   Tab: Next attempt   [ ]: Cycle attempts   o: Set Env   n: New Task   q: Quit
```

- Attempt status words (`ui.rs:742-750`): `Pending` (cyan), `In progress` (magenta), `Completed` (green), `Failed` (red, bold), `Cancelled` (dim).
- **There is no "pick a winner" UI.** You flip through the attempts and **apply** one.
- The data per attempt is `TurnAttempt {turn_id, attempt_placement, created_at, status, diff, messages}` (`cloud-tasks-client/src/api.rs:56-74`).
- Third-party write-ups say the chatgpt.com/codex web view shows attempts as switchable versions. Current OpenAI docs do not show this layout, so I could not verify it.

---

## 3. How it looks: desktop app (macOS/Windows/Linux), IDE extension, iOS

These words are **exact English UI strings** from the installed desktop bundle (`openai-codex-desktop 26.1103`). The geometry is **[reconstructed]**. The IDE extension uses the same webview components, and the docs confirm the IDE panel ("active subagents appear above the composer… stop all… open an individual subagent thread").

### 3.1 In the transcript of the parent chat

Collab tool calls appear as **one action row**. The header is `{action}{countLabel}`, for example "Created 3 agents" or "Messaged an agent". Each agent gets one sub-row, and the row expands:

```
 ⌄ Created 3 agents
     Created Hooke with the instructions: Map the auth code paths…
     Created Turing with the instructions: Find test gaps in…
     Created Noether with the instructions: Review maintainability…
 ⌄ Messaged an agent
     Messaged Turing: also check the e2e folder
   Closed an agent
```

- **Verbs, as a set of three** (in progress → done → failed):

  | tool | in progress | done | failed |
  |---|---|---|---|
  | spawn | Creating | Created | Failed to create |
  | sendInput | Messaging | Messaged | Failed to message |
  | resume | Resuming | Resumed | Failed to resume |
  | close | Closing | Closed | Failed to close |
  | interrupt | Interrupting | Interrupted | Failed to interrupt |
  | list | Listing | Listed | Failed to list |

- **Per-agent state suffix** (lower case): `pending init`, `running`, `completed`, `errored`, `interrupted`, `shutdown`, `not found`.
- **Metadata:** "Input: {prompt}".

**Inline activity chips (V2 `subAgentActivity`).** The section has aria-label "Subagent activity". Agent names are **buttons** that open the agent:

```
 [◐ Hooke] [◐ Turing] and [+2 more] started working
 [● Turing] finished
 [● Hooke] and [● Noether] were interrupted
```

- The ICU message comes from `subagents.activity.summary`:
  - First part: `{first}`, `{first} and {second}`, `{first}, {second} and {third}`, or `{first}, {second} and {N more}`.
  - Verb part: "started working", "updated", "was/were interrupted", "finished", "finished with errors", "made progress".
- Other strings:
  - Single rows: "{displayName} started working", "{displayName} finished", "{displayName} interrupted", "{displayName} updated".
  - Messages: "Sent message to {agent}", "Sent message to parent".
  - The button's aria-label is "Open {displayName} subagent". An unnamed agent is shown as "Subagent", or "Agent" in fallback text.

### 3.2 Above the composer: background agents strip

The strings are `composer.backgroundSubagents.*`. The docs say: "When the background-agent UI is available, active subagents appear above the composer."

```
 ┌───────────────────────────────────────────────────────────────┐
 │ ⌄ 3 background agents (@ to tag agents)            [Stop all] │
 │   @Hooke   is working                                         │
 │   @Turing  is awaiting instruction                            │
 │   @Noether is done                                            │
 ├───────────────────────────────────────────────────────────────┤
 │ Ask Codex anything…                                           │
 └───────────────────────────────────────────────────────────────┘
```

- When collapsed it reads "3 background agents".
- The row tooltip is "Uses {model}".
- **Stop all** has the tooltip "Stop all subagents in this chat" and stops all **descendant** sub-agents.
- **@-mentions.** The `@` list has the sections **"Live agents"** and **"Custom agents"** ("Loading agents…"). You can address a running agent or invoke a configured custom agent from the composer.
- **A closed agent's chat** answers a send attempt with the toast "Ask parent to resume sub-agent to continue conversation". The user cannot revive a closed agent directly; the parent has to.

### 3.3 Right side panel: "Subagents" tab

The strings are `localConversation.subagentsPanel.*`. The docs say: "Open **Subagents** to see read-only **Active** and **Done** lists."

```
 Subagents                                  1 waiting
 ─────────────────────────────────────────────────────
 Active · 2
   ◐ Hooke     Working        Mapping auth code paths…
   ○ Turing    Waiting
 Done · 3
   ● Noether   Done           Found 2 maintainability risks…
   ● Euclid    Done           Finished
   ✕ Galileo   Failed         Stopped
```

Detail view (the "Back to subagents" arrow returns to the list):

```
 ← Hooke                         GPT-6 Sol · High
 Status          Working
 Delegated task  Map the code paths affected by the auth change…
 Final response  (Loading the final response… / No final response is available.)
 [ transcript of the child thread ]
```

- **Statuses:**
  - Desktop "Work" mode: `Waiting`, `Working`, `Done`, `Failed`. Done covers "stopped normally, was interrupted, or shut down".
  - Local mode: `Waiting` and `Working`.
  - Tab thumbnails: `Working`, `Idle`, `Failed`.
- **Fallback preview text:** "Working" when there is no objective yet, "Finished" or "Stopped" when there is no final response.
- **Effort words in the header:** None, Minimal, Light (= low), Medium, High, Extra High (= xhigh), Max, Ultra, Persistent.
- **Branch edits:** if the user switches conversation branches, a stale agent shows "This subagent is no longer available on the current branch."
- **Web/ChatGPT "Work" panel:** the docs say it is read-only, with no stop or steer controls. Stop and steer happen by asking the parent.

### 3.4 Summary card and other surfaces

- **Activity card** (the "dynamic isle"). Title "Activity", with rows `Browser · 2 tabs` and **`Subagents · 3 used`**. The count includes active and finished agents, and clicking the row opens the panel.
- **Thread summary side panel.** It has sections **Subagents**, **Background processes** and **Side chats**.
- **Tab thumbnails.** Each shows "{n} loaded agents" and a status per agent.
- **Settings.**
  - Storage category "Subagents" ("Disk space used by unarchived Codex subagent histories").
  - Hooks events `SubagentStart` and `SubagentStop`.
  - External config migration item "Agents".
- **iOS app** (1.2026.293): "Tap a sub-agent's name in task activity to open its conversation."

### 3.5 Worktrees, cloud and review in the app (context for "parallel threads")

- **Composer mode toggle `Local / Worktree`.** It has a command "Toggle Local/Worktree". The menu offers "New local worktree · {repo}" and "New remote worktree · {repo}", with an `Environment` picker and a `Branch` picker.
  - Onboarding: "Start another task without interrupting your work" / "Git worktree gives your task its own workspace".
  - Education copy: "Use as many as you need. Codex adds them to your chat summary."
- **Chat header buttons:** **Create branch here**, **Open** (IDE or terminal), **Hand off** ("Handing off to local workspace").
  - "Hand off chat to worktree" moves the chat's work into a worktree.
  - "Fork chat into new worktree" is offered both from `/fork` and from older turns.
- **Worktree limits:** the app keeps the 15 most recent managed worktrees (Settings › Worktrees). A worktree is never deleted while its chat is pinned or running, and a snapshot is taken before deletion.
- **Cloud:** "Work in › Cloud", "Select environment", "Start a new task". The current docs page says nothing about attempts or versions (see 2.6 for the CLI).
- **`/review`** starts "a dedicated reviewer that reads the selected diff and reports findings without changing your working tree".
  - Presets: base branch, uncommitted changes, a commit, custom instructions.
  - In the TUI it renders as `>> Code review started: … <<` / `<< Code review finished: … >>` (`tui/src/thread_transcript/other_items.rs:97-105`). The reviewer runs as `SubAgentSource::Review`.
  - The app setting **General › Code review › "Detached"** starts a **separate review chat**. In the IDE the same setting is `chatgpt.reviewDelivery = detached`.
  - The review pane has the scopes Unstaged / Staged / Commit / Branch / Last turn, inline comments with "+", and Stage/Revert per file or hunk.

---

## 4. Data

### 4.1 Thread-level (app-server v2)

The `Thread` struct is at `app-server-protocol/src/protocol/v2/thread_data.rs:205-293`:

```jsonc
{
  "id": "019a…",                 // UUIDv7; a sub-agent is its own thread
  "sessionId": "…",              // shared by all threads of one session tree
  "parentThreadId": "019a…",     // set only for sub-agents (line 222)
  "forkedFromId": null,          // forks (side chats) use this instead
  "source": { "subAgent": { "thread_spawn": {
      "parent_thread_id": "…", "depth": 1,
      "agent_path": "/root/review",      // V2 only
      "agent_nickname": "Robie", "agent_role": "explorer" } } },
  "threadSource": "subagent",    // analytics: user | subagent | guardianReview | memoryConsolidation | feature
  "agentNickname": "Robie",      // line 280
  "agentRole": "explorer",       // line 282
  "status": { "type": "active", "activeFlags": ["waitingOnApproval"] }, // notLoaded | idle | systemError | active (thread.rs:1729-1746)
  "model": "…", "reasoningEffort": "high", "cwd": "/abs/worktree", "name": null, "preview": "…"
}
```

- `SubAgentSource` = `review | compact | thread_spawn{…} | memory_consolidation | other(String)` (`protocol/src/protocol.rs:3267-3282`).
- **Tree queries:** `thread/list` takes `parentThreadId` (direct children) or `ancestorThreadId` (all descendants; experimental) (`v2/thread.rs:1508-1516`).
- `sourceKinds` adds `subAgent`, `subAgentReview`, `subAgentCompact`, `subAgentThreadSpawn` and `subAgentOther` (`:1566-1579`).
- **Lifecycle notifications** are per thread: `thread/started`, `thread/status/changed`, `thread/name/updated`, `thread/closed`, `thread/archived`, `turn/started`, `turn/completed`, `item/*`. The client subscribes to every child thread id (codex-acp does this, see 4.4).

### 4.2 Items (app-server v2, `v2/item.rs`)

```jsonc
// item/started + item/completed, on the SENDER's (parent's) thread
{ "type": "collabAgentToolCall",            // item.rs:481
  "id": "call_…",
  "tool": "spawnAgent",                     // spawnAgent|sendInput|resumeAgent|wait|closeAgent|sendMessage|followupTask|interruptAgent|listAgents (1240)
  "status": "inProgress",                   // inProgress|completed|failed|interrupted (1338)
  "senderThreadId": "<parent>",
  "receiverThreadIds": ["<child1>", "<child2>"],   // for spawn = the new children
  "prompt": "Compute 11!…",                 // may be empty "to prevent CoT leaking"
  "model": "gpt-…", "reasoningEffort": "high",     // spawn only
  "agentsStates": { "<child1>": { "status": "completed", "message": "39916800" } }
                                            // status: pendingInit|running|interrupted|completed|errored|shutdown|notFound (1396-1412)
}

// V2 only: lifecycle of a path-named agent, also on the parent's thread
{ "type": "subAgentActivity",               // item.rs:504
  "id": "…", "kind": "started",             // started|interacted|interrupted|completed (1375)
  "agentThreadId": "<child>", "agentPath": "/root/review",
  "model": "gpt-…", "reasoningEffort": "high" }   // only on creation records
```

**Core events** behind the items (`protocol/src/protocol.rs:1766-1787`, `4723-4900`). They come in begin/end pairs with `call_id` and `started_at_ms` / `completed_at_ms`:

| event | extra fields |
|---|---|
| `CollabAgentSpawnBegin/End` | End: `new_thread_id`, `new_agent_nickname`, `new_agent_role`, `prompt`, effective `model`, `reasoning_effort`, `status` |
| `CollabAgentInteractionBegin/End` | `receiver_*`, `prompt`, `status` |
| `CollabWaitingBegin/End` | `receiver_thread_ids` + `receiver_agents[]` (refs) / `statuses{}` + `agent_statuses[]` |
| `CollabCloseBegin/End`, `CollabResumeBegin/End` | none listed |
| `SubAgentActivity` | `{event_id, occurred_at_ms, agent_thread_id, agent_path, kind, model?, reasoning_effort?}` |

**There is no progress or usage per child in the parent's stream.** For that you subscribe to the child thread: its turns, items, token usage and `thread/status/changed`.

### 4.3 What the TUI keeps per agent

These are UI state hints for Banda:
- `AgentPickerThreadEntry {agent_nickname, agent_role, agent_path, is_running, is_closed}` (`tui/src/multi_agents.rs:34-46`).
- `AgentNavigationState` keeps the first-seen order, stopped threads ("must not be revived by delayed activity"), and parent-owned V2 children (`app/agent_navigation.rs`).
- A pending-approvals set per thread.

### 4.4 codex-acp 2.5.0: Codex sub-agents → ACP

The spec docs are `docs/subagent-sessions.md` (HEAD) and the ACP RFD PR agentclientprotocol/agent-client-protocol#1992. That RFD was merged 2026-09-30 as an *unstable* schema.

**Negotiation and the three modes** (`acp:46579-46586`, `src/subagents/AcpSubagents.ts:46-59`):

| mode | when | what the client gets |
|---|---|---|
| `standard` | `clientCapabilities.subagents` is an object (`{}`) **or** ACP protocol v2 | child **sessions**: `subagent_update` on the parent plus all child output under the child `sessionId` |
| `air` | JetBrains AIR (`_meta.jetbrains.air.capabilities.nativeSubagentSessions`) | legacy `subagent_spawned {subagentSessionId, name, task, capabilities}` + `subagent_state_update {subagentSessionId, state: completed\|cancelled\|failed}` (v2 wire: `_subagent_update`, `acp:31897-31920`) |
| `hidden` | anything else, **including Banda today** | plain tool calls on the root; child streams **not forwarded** |

The adapter's initialize response always advertises `agentCapabilities.sessionCapabilities.subagents: {}` (`acp:49724`).

**Standard mode, step by step** (`StandardSubagentEventRouter`, `acp:35753+`; `src/subagents/StandardSubagentEventRouter.ts`):

1. A `collabAgentToolCall(spawnAgent)` arrives with `receiverThreadIds`. The adapter registers each child, with its parent taken from `senderThreadId` (nested agents work) and description = `prompt`.
2. **Announce**, on the *parent* session, before any child output:
   `session/update {sessionUpdate:"subagent_update", sessionId:<child>, capabilities:{}, title?, description?}` (`acp:36021-36038`).
   - title = the last path segment of `agentPath`, humanized: `/root/code_mapper` → "Code mapper" (`acp:35123-35139`).
   - `thread/name/updated` later re-sends `subagent_update {title}` to the parent and `session_info_update {title}` to the child.
3. The child's messages, thoughts, plans, tool calls, diffs, permissions and elicitations then flow as normal `session/update`s **with the child's sessionId**.
   - The child sessionId equals the Codex thread id. AIR uses `<root>:subagent:<thread>`.
   - The child's model is reported as `config_option_update` with a single-option "Model" select described as "Model Codex uses for the subagent".
4. **State** is reported on the parent through `subagent_update {sessionId, state}` (`acp:32465-32472`). The state is one of:
   - `{state:"running"}`
   - `{state:"idle", stopReason: end_turn|cancelled|error|max_tokens|refusal, usage?}`
   - `{state:"requires_action"}`
   - `{state:"unknown"}`

   (zod `acp:24966-25042`.)
5. **Cancel.** The adapter advertises `capabilities:{cancel:{}}` on a child only while that child has a running turn, and `cancel:null` otherwise (`acp:36282`). `session/cancel` with the child sessionId interrupts that child **and its descendants** (`acp:36289`, `53785`).
6. **Children are read-only.** Any other client-initiated mutation on a child session (prompt, set config…) throws "Subagent sessions do not permit client-initiated mutations" (`acp:49655-49661`). Permission and elicitation prompts from children stay answerable.
7. **Follow-up turns.** A `followupTask`, `sendInput` or `resumeAgent` to a finished child re-opens it. AIR mints a new session id `<thread>:generation:2` (`acp:35504-35560`). Standard mode reuses the same session and sets it back to `running`.
8. **`session/load`** rebuilds the child tree from Codex history. An orphan with no proven outcome is reported as `disconnected`, and live timeouts or shutdown / notFound are reported as `failed`.
9. **Buffering.** Child notifications that arrive before the child is announced are held in a buffer of 32 MiB per child, with streaming deltas merged (`acp:35063-35121`).
10. **Root turn end** (AIR/legacy router). The adapter waits up to **10 minutes** for outstanding children, then marks them failed (`acp:35176`, `35388-35420`).

**Hidden (legacy) mode. This is what Banda gets today.**
- `collabAgentToolCall` becomes an ordinary ACP tool call (`CollabAgentReporter`, `acp:34920-34955`) with these fields:
  ```jsonc
  { "toolCallId": "call_…", "title": "spawnAgent", "kind": "other", "status": "in_progress",
    "rawInput": { "prompt": "…", "senderThreadId": "…", "receiverThreadIds": ["…"],
                  "agentsStates": {…}, "model": "…", "reasoningEffort": "high", "status": "inProgress" },
    "_meta": { …subagent: true… } }   // `subagent: true` only for spawnAgent
  ```
- `subAgentActivity` becomes a tool call titled "Start subagent Review", "Interact with subagent X", "Interrupt subagent X" or "Complete subagent X" (`SubagentActivityReporter`, `acp:34957-34990`).
- **Child item streams are dropped.** `CodexSubagentSubscriptions` still subscribes to each child, but without the capability it forwards only interactions: approvals and `requestUserInput` are **re-attributed to the root session** (`acp:40780-40790`, `40846`, `rootAttributed`).
- In Banda this means the user can be asked to approve a command that a child runs, but nothing tells them it was a child. That matches the docs: "Child permission and elicitation requests stay on the root session."

### 4.5 Field-name drift to watch

The RFD discussion merged spawn and state into one upsert, `subagent_update`, with `subagentSessionId` required and `name`/`task`/`capabilities`/`state` optional. codex-acp 2.5.0 standard mode instead sends `sessionId`, `title`, `description`, `capabilities` and `state`. Banda's client should accept both shapes until the schema stabilises.

---

## 5. What this means for Banda

These map directly onto Banda's own concepts: Thread, Pane, Group and Mark.

1. **Declare `clientCapabilities.subagents: {}` to codex-acp.**
   - Without it, Banda sees only `spawnAgent` and `wait` tool calls, and child approvals arrive mislabelled as the root's.
   - With it, each Codex sub-agent becomes an ACP child session. Banda can store it as a **child Thread**, using the parent link, title and description from `subagent_update`, a model, and a state of running, idle with a stopReason, requires_action or unknown. That is exactly ADR 0003's "subagents as child Threads".
2. **Use a two-level display.**
   - The parent transcript holds compact lifecycle rows. The Codex verbs work well: Created / Messaged / Waiting for / Finished waiting / Closed, or V2's started working / finished / interrupted. Agent names are clickable chips.
   - The child's own transcript opens in its own Pane or a side panel. It is never inlined. Codex never interleaves child output into the parent.
3. **Make the "who needs me" roll-up first-class.**
   - Show the child label on every approval ("Thread: Robie [explorer]"), with a jump-to-thread key.
   - Add a banner for pending approvals in other threads.
   - On the sidebar card or Mark, bubble a child's *needs you* up to the root. Do **not** bubble a child's *failure*, which the parent handles.
4. **Use one status vocabulary across surfaces.** The desktop app uses four words: **Waiting / Working / Done / Failed**, with "Done" covering interrupted and shut down. Banda's Mark (ADR 0099 already has a `subagents` count) can reuse this.
5. **Name agents from three parts.** Use the nickname, then the role in brackets, then the model and effort in a muted colour. Fall back to the V2 path, and then to "Agent". Keep the spawn order stable.
6. **Controls.**
   - "Stop all" stops descendants.
   - Per-child Stop is available only while the child is running, following the `capabilities.cancel` advertisement.
   - Children are read-only. Show a disabled composer: "Viewing sub-agent — direct input is disabled". Steering goes through the parent, or through `@agent` mentions that the parent relays.
7. **"Ultra" as a setting is a good model for ultracode.** It is an explicit, warned opt-in ("highest usage", concurrency warning) that turns on *proactive* fan-out. Pair it with a visible concurrency cap: the V2 default is 4 threads including root, the V1 default is 6.

## Sources

- Codex source (openai/codex `caae161`):
  - `core/src/tools/handlers/multi_agents_spec.rs`, `core/src/config/mod.rs`, `config/src/config_toml.rs`, `core/src/agent/role.rs`, `core/src/agent/registry.rs`, `core/src/session/multi_agents.rs`
  - `protocol/src/protocol.rs`, `app-server-protocol/src/protocol/v2/{item,thread,thread_data}.rs`
  - `tui/src/{multi_agents.rs, slash_command.rs, app/*, bottom_pane/*, chatwidget/*}` and the `tui/src/snapshots/*.snap` files named above
  - `cloud-tasks/src/ui.rs`, `features/src/lib.rs`
- codex-acp:
  - 2.5.0 `dist/index.js` (Banda `node_modules`)
  - github.com/agentclientprotocol/codex-acp `docs/subagent-sessions.md`, `src/subagents/*` (`ab7a968`)
  - ACP RFD https://github.com/agentclientprotocol/agent-client-protocol/pull/1992
- Docs:
  - https://learn.chatgpt.com/docs/agent-configuration/subagents (redirect target of developers.openai.com/codex/subagents and /codex/multi-agent)
  - https://learn.chatgpt.com/docs/environments/git-worktrees, https://learn.chatgpt.com/docs/code-review, https://learn.chatgpt.com/docs/cloud, https://learn.chatgpt.com/docs/changelog (0.163–0.167 entries quoted above)
- Local:
  - `codex --help`, `codex features list`, `codex agents --help`, `codex cloud exec --help`
  - the desktop bundle `/usr/lib/chatgpt/resources/app.asar` (English `defaultMessage` strings)
- Secondary (not relied on for facts): codex.danielvaughan.com posts on best-of-N and subagents.

---

## Fact check

Checked 2026-11-10 by a second agent against primary sources only:
- the same `openai/codex` clone at `caae161`, plus the files `core/src/session/multi_agents.rs`, `core/src/config/mod.rs`, `features/src/lib.rs`, `tui/src/multi_agents.rs`, `core/src/tools/handlers/multi_agents_spec.rs` and `app-server-protocol/src/protocol/v2/item.rs` fetched at tag `rust-v0.167.0`, the installed version;
- local `codex features list` (codex-cli 0.167.0);
- the codex-acp 2.5.0 bundle Banda actually links, plus the Rust crate `agent-client-protocol-schema` 1.13.0 from Banda's `Cargo.lock`;
- the desktop bundle `/usr/lib/chatgpt/resources/app.asar` (openai-codex-desktop 26.1103.60933), including the component code, not only the strings;
- learn.chatgpt.com `agent-configuration/subagents` and `changelog`.

Verdicts: **confirmed** = the source says the same. **corrected** = mostly right, with a fact fixed below.

| # | Claim | Verdict |
|---|---|---|
| 1 | V1 tools / V2 tools and namespaces | confirmed |
| 2 | How the version is chosen; local flags | confirmed |
| 3 | Limits and timeouts | confirmed, one fact added |
| 4 | Roles, custom agents, nicknames | **corrected** (nickname list) |
| 5 | Ultra turns on proactive delegation | confirmed, with caveats |
| 6 | TUI lifecycle cells, switching to a child | **corrected** (cells are not one line) |
| 7 | Cross-thread approvals, banner, roll-up | confirmed |
| 8 | Desktop strip and Subagents panel | **corrected** (two different panels) |
| 9 | `collabAgentToolCall` and `subAgentActivity` fields | confirmed |
| 10 | Sub-agent = Thread; tree filters | confirmed, one precision |
| 11 | codex-acp standard mode | confirmed |
| 12 | Hidden mode (Banda today) | confirmed; section 4.4 JSON **corrected** |

### Per claim

1. **Confirmed.** V1 tools are wrapped in namespace `multi_agent_v1` (`multi_agents_spec.rs:14,89,190,272,289,343`). V2 tool specs are plain functions (`:140,221,254,304,324,369`). They get the namespace when they are registered, from `features.multi_agent_v2.tool_namespace`, whose default is `"collaboration"` (`config/mod.rs:275,1447`; `tools/spec_plan.rs:1502-1611`). V2 `spawn_agent` requires `task_name` and `message` (`spec:154-157`). V2 `wait_agent` takes only `timeout_ms` (`:917-927`). The file is the same at 0.167.0.
   - Add: `disable_direct_message` removes `send_message` and `followup_task`, and `wait_agent_enabled = false` removes `wait_agent` (`spec_plan.rs:1556,1579`).
   - Add: in V1, models that support tool search get the tools as *deferred* (`spec_plan.rs:1616-1620`).
2. **Confirmed** (`config/mod.rs:1730-1757`; the same at the 0.167.0 tag).
   - `codex features list` prints `multi_agent stable true` and `multi_agent_v2 stable false`.
   - At HEAD, `multi_agent` has moved to `Stage::Deprecated`. At 0.167.0 it is still `Stable`.
3. **Confirmed.** The defaults are `DEFAULT_AGENT_MAX_THREADS = Some(6)` and `DEFAULT_AGENT_MAX_DEPTH = 1` (`mod.rs:270,280`), with the alias `max_threads` and "Ignored by V2" (`config_toml.rs:774-778`). V2 uses 4 threads including the root, so 3 children (`mod.rs:271,1759-1767`). The close_agent text says "Completed agents remain open and count toward the concurrency limit until closed" (`spec:349`).
   - Add: V1 uses the same wait bounds of 10 s / 30 s / 1 h (`spec_plan.rs:858-872`).
   - Add: when `features.multi_agent_v2.max_concurrent_threads_per_session` is unset, V2 falls back to **`agents.max_concurrent_threads_per_session + 1`** (`mod.rs:2930-2941`).
   - Add: the docs define `agents.max_concurrent_threads_per_session` as "excluding the primary" and do not state a numeric default.
4. **Corrected.**
   - Roles: `default` / `explorer` / `worker`, with `awaiter` commented out (`role.rs:315-380`). The docs call explorer "read-heavy codebase exploration agent".
     - However, `core/assets/agent/builtins/explorer.toml` is **0 bytes**. Explorer differs from default only by its description: nothing in the config makes it fast or read-only.
   - Custom agents: `~/.codex/agents/` and `.codex/agents/` are right (docs; `config_tests.rs:9373`).
     - A role layer can set only `developer_instructions`, `model`, `model_reasoning_effort`, `model_reasoning_summary`, `model_verbosity`, `personality` and `service_tier`.
     - It can only *disable* a few features and skills (`role.rs:34-45,86-110`). The header says: "Roles may customize the child or reduce its capabilities, but never replace the parent session's authority."
   - **Nicknames, fixed:**
     - `agent_names.txt` has 101 names, but they are not all scientists. It also lists philosophers (Socrates, Plato, Confucius, Kant, Nietzsche, Sartre, Arendt, Rawls…) and one plain "Jason".
     - The name is picked **at random** from the unused names (`registry.rs:278-283`), not in list order.
     - The ordinal format "Euclid the 2nd" is right (`registry.rs:65-80,286-298`).
     - "Robie" and "Bob" in the snapshots are test fixtures and are not in the list.
5. **Confirmed, with caveats** (`session/multi_agents.rs:82-120`, the same at 0.167.0; the strings are in `model_popups.rs:695-725`, and the warning threshold is 8 at `:9,766-788`). Ultra changes nothing when:
   - the session is on **V1**, which is the default (`effective_multi_agent_mode` returns `None` unless V2);
   - a custom hint is set through `features.multi_agent_v2.multi_agent_mode_hint_text` or the model catalog. That hint wins over the Ultra→Proactive switch (`:97-101`).
   - The model does not support Ultra. Unsupported Ultra or Persistent falls back to the model's default effort (`session/model_catalog_settings.rs:52`).
6. **Corrected (precision).**
   - Cells are a bold title line plus dim `└` detail lines, not one line each. A spawn shows a prompt preview of up to 160 graphemes. A finished wait shows one status line per agent, with messages up to 240 graphemes (`tui/multi_agents.rs:30-32,442-448`).
   - There are more titles than the claim lists: "Sent input to", "Resuming"/"Resumed", "Agent spawn failed", and the V2 cells "Started / Interacted with / Interrupted / Completed `` `/root/x` ``" (`:247-341`).
   - Switching is confirmed: `/subagents` ("switch between this session's subagents", `slash_command.rs:82-83,145`) and ⌥←/⌥→ (`multi_agents.rs:103-109`).
   - On macOS, Option+b and Option+f also work as a fallback when the composer is empty (`:135-184`).
7. **Confirmed.** The approval overlay snapshot shows `Thread: Robie [explorer]` and "…or o to open thread".
   - The banner shows `!` in red bold, at most 3 rows, then `...`, then "/subagents to review requests" (`pending_thread_approvals.rs:44-66`).
   - Roll-up: a task row takes the most urgent group across its subtree (`agents_overview.rs:1231-1242`, `min` over children).
   - A sub-agent with `SystemError` falls into "Inactive", not "Needs you" (`agents_overview_view.rs:79-95`; changelog 0.166.0 "Keep failed subagents from marking tasks as needing attention" #57315).
   - Detail labels: "Needs input" (the filter tab says "Needs you"), "Agent: <nickname | name | id>", and then "Waiting for approval.", "Waiting for your response." or "Task encountered an error." (`agents_overview_details.rs:174-203`).
8. **Corrected.** The strip strings are exact (`composer.backgroundSubagents.*`), but the bundle has **two different Subagents panels**:
   - **Codex local chat** (`localConversation.subagentsPanel.*`, component `LocalConversationSubagentsPanelTab`):
     - The list has the sections "Active · n" (4 rows visible) and "Done · n" (10 rows visible), with "n waiting" in the header.
     - A row shows a seeded avatar, the name, and a one-line preview: the objective cut to 60 characters, else a status summary, else "Working".
     - On the right of a row: the word "Waiting" for a waiting agent, a **live elapsed timer** while it is not done, and the relative time of its last message once it is done.
     - Detail view: a header with ← "Back to subagents", avatar, name and `{model} · {effort}` (efforts None…Persistent, low = "Light"). Below it is the **child's full transcript** (`LocalConversationBackgroundAgentTab`, with a `canInteract` flag).
     - This panel has no "Status / Delegated task / Final response" fields, and no "Failed" status.
   - **ChatGPT ("Work"/web) conversations** (`chatgptConversations.subagents.panel.*`): this is where "Status", "Delegated task", "Final response", "Loading the final response…", "No final response is available." and the statuses Waiting / Working / Done / Failed live.
   - **The background-agents strip**, from its code:
     - The header is a disclosure row with an icon, "N background agents", a **summed +/− line diff stat** across the agents, and an icon button "Stop all" with a spinner (tooltip "Stop all subagents in this chat").
     - Each row is a button: seeded avatar, name, and a status phrase that **shimmers while active**. A per-agent diff stat sits on the right.
     - The tooltip shows the role and "Uses {model}". A click opens that agent's thread.
     - No literal "@" was found in the row code. The string descriptions call the name a "mention label".
9. **Confirmed** (`v2/item.rs:481-513,1240-1412`; the same at 0.167.0). `subAgentActivity` also carries `id` and `reasoningEffort?`. `collabAgentToolCall.status` is `inProgress|completed|failed|interrupted`.
10. **Confirmed** (`thread_data.rs:205-293`: "Codex-generated thread IDs are UUIDv7"). On the wire the source is `{"subAgent":{"thread_spawn":{parent_thread_id, depth, agent_path?, agent_nickname?, agent_role?}}}` (`protocol.rs:3267-3282`).
    - Precision: **both** `parentThreadId` and `ancestorThreadId` are `#[experimental]` and mutually exclusive (`v2/thread.rs:1508-1516`).
11. **Confirmed** (`subagentProtocol`; `ensureAnnounced` sends `capabilities:{}` first; `publishCancellation` sends `{cancel:{}|null}`; `cancelChild` also covers descendants; `assertSessionMutationAllowed` runs on every routed request that carries a child sessionId).
    - Add: AIR (JetBrains) clients take other paths.
    - Add: under ACP **v2** the adapter *also* sends `state_update` on the child session itself (`updateSubagentState`).
    - The cited line numbers belong to the **unused** patch variant `…952416e…`. Banda links `…f1188fd…` (`platform/harnesses/adapters/node_modules`), whose lines shift by +4 after line 28101 and by +7 after line 54021. The logic is the same; only the Windows spawn lines differ.
12. **Confirmed**, but section 4.4's example is **corrected**:
    - The tool-call title is the **raw camelCase tool name for every collab tool**: `spawnAgent`, `sendInput`, `resumeAgent`, `wait`, `closeAgent`, `sendMessage`, `followupTask`, `interruptAgent`, `listAgents` (`CollabAgentReporter`, `title: item.tool`).
    - The activity title uses the **raw** last path segment, so "Start subagent code_mapper", not "Review"/"Code mapper".
    - `content` is removed (`standard.content: null`).
    - **There is no `_meta.subagent` for Banda.** The `subagent: true` fact is written only under `_meta.jetbrains.air.subagent` for AIR clients (`airMeta` vs `standardMeta`).
    - Child approvals, file-change and permission requests, elicitations and `requestUserInput` are answered under the root sessionId (`interactionSessionId` returns `rootSessionId` when `!supportsSubagents`).

### Corrections to other parts of the notes

- **4.4 step 2, the title source.** codex-acp 2.5.0 **never reads `agentNickname` or `agentRole`**: the bundle has 0 matches for "nickname" and none for `agentRole`.
  - A child's title comes only from a V2 `agentPath` (humanized) or from a later `thread/name/updated`.
  - Under V1, the default engine, a child is announced with **no title**: only `description` = the spawn prompt.
  - Banda would never see "Hooke [explorer]" through ACP. It needs its own fallback name, or a patch to the adapter.
- **4.5 field drift.** This mostly does not apply. Banda's locked `agent-client-protocol-schema` **1.13.0** already has the feature `unstable_subagents`, which includes:
  - `ClientCapabilities.subagents: SubagentCapabilities`;
  - `SessionUpdate::SubagentUpdate { sessionId, title, description, capabilities{cancel}, state, _meta }`, with patch semantics: omitted = unchanged, `null` = clear;
  - `StateUpdate` = `running | idle{stopReason, usage?} | requires_action | unknown` (`src/v1/client.rs:945-1016,1135-1200,3341,3484`).

  This is the same shape codex-acp sends, so turning it on is a Cargo feature plus `.subagents(SubagentCapabilities::new())` in `shows()` (`apps/agents/engine/src/acp.rs:356-369`). Only the legacy AIR shape (`subagent_spawned` / `subagent_state_update`) differs.
- **Which Codex Banda talks to.** Banda always sets `CODEX_PATH` to the Person's own CLI (`docs/research/2026-11-02-first-run-and-agent-setup.md:89`), so the protocol is the installed 0.167.0, not the npm `@openai/codex@0.165.0`.

### Sources used for this check

- `…/scratchpad/src/codex/codex-rs/…` at `caae161`.
- `https://raw.githubusercontent.com/openai/codex/rust-v0.167.0/codex-rs/…` (tag commit `086ccc8`).
- `node_modules/.pnpm/@agentclientprotocol+codex-acp@2.5.0_patch_hash=f1188fd…/…/dist/index.js` (linked) and `…952416e…` (cited).
- `~/.cargo/registry/src/*/agent-client-protocol-schema-1.13.0/src/v1/client.rs`.
- `/usr/lib/chatgpt/resources/app.asar`.
- https://learn.chatgpt.com/docs/agent-configuration/subagents and https://learn.chatgpt.com/docs/changelog (0.166.0 #57315 and #57451; 0.167.0 #58720).
