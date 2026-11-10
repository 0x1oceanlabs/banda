# Claude Code sub-agents and workflows: how they work, how they look

Research for Banda's sub-agent and workflow ("ultracode") UI. Covers Claude Code 2.1.x as of
2026-11-10 (CLI 2.1.321 on this machine, Agent SDK 0.3.312, claude-agent-acp 0.99.1).

Where the facts come from:
- **Docs**: the official pages at `https://code.claude.com/docs/en/<page>` (raw `.md` versions). Cited as `docs:<page>`.
- **CHANGELOG**: `https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md`. Cited as `CL <version>`.
- **SDK**: `@anthropic-ai/claude-agent-sdk@0.3.312` in `node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.3.312_*/node_modules/@anthropic-ai/claude-agent-sdk/`. Cited as `sdk.d.ts:N` and `sdk-tools.d.ts:N`.
- **ACP**: `@agentclientprotocol/claude-agent-acp@0.99.1` in `node_modules/.pnpm/@agentclientprotocol+claude-agent-acp@0.99.1_*/node_modules/@agentclientprotocol/claude-agent-acp/`. Cited as `acp:<file>:N`.
- **CLI source**: the Bun bundle of the installed `claude` (v2.1.321), read with `strings`. Its code is minified, so the renderings below are rebuilt from the React/Ink component code and its string literals. The glyphs and words are exact. The spacing is approximate. Cited as `cli:<component>`.

Nothing in this research started a paid model session.

---

## 0. The short version

- Claude Code has **three nested ways to delegate**. The **Agent tool** (formerly `Task`) starts one sub-agent from inside a turn. **Agent teams** are an experimental lead plus teammates with a shared task list and mailboxes. **Workflows** are a JavaScript script that a background runtime executes. The script fans out to dozens or hundreds of agents in phases. "**Ultracode**" means Claude writes a workflow for every substantive task.
- The **default changed in 2026**. A sub-agent spawned from the main conversation now runs **in the background**, as a **fork** that inherits the whole conversation (CLI v2.1.232, then all surfaces in v2.1.302). The parent keeps talking and gets a `<task-notification>` message when the sub-agent finishes. Foreground (blocking) is the exception: either Claude passes `run_in_background: false`, or the Person sets `CLAUDE_CODE_FORK_SUBAGENT=0`.
- **Only the final report returns** to the parent, along with an `agentId` and usage. Everything in between lives in a separate transcript, `subagents/agent-<id>.jsonl`.
- **The terminal UI has four layers**:
  1. The inline tool call. It shows the agent type and description, the last 3 tool rows, `+N more tool uses`, and finally `Done (N tool uses · 12.3k tokens · 1m 2s)`.
  2. The grouped parallel header, `Running 3 Explore agents…`, with a `├─`/`└─` tree.
  3. A persistent **agent panel below the prompt**. Its first row is `main`. Each row has a circle, a name or description, a live summary, elapsed time and `↓ 12.3k tokens`. The keys are ↑/↓, Enter to open and talk to the agent, and x to stop.
  4. `/tasks` and `/workflows`, full lists you can drill into.
- **Workflows** render as **phase boxes**. Each box has a header like `Title ✓ 3/5 · model`, rows of agents (`label agentType · model · 12k tok · 5 tools · 1m 2s`), a narrator line `❯ <log message>` above, and a 4-cell progress bar in a one-line background row under the prompt. `/workflows` is a 3-level drill-down: run, then phase, then agent. Inside it, `p` pauses, `x` stops, `r` restarts, `f` filters and `s` saves.
- **Other surfaces**:
  - VS Code has an **agent map**: a prompt pill `2 agents` that opens a tree with status, elapsed time and tokens.
  - Desktop has a **Background tasks pane** and a **subagent pane**.
  - Remote Control (web and mobile) mirrors sub-agent and workflow progress and lets you stop them.
  - `claude agents` ("agent view") lists background *sessions*, grouped as Needs input / Working / Ready for review / Completed.
- **The data model is rich**:
  - Every sub-agent message carries `parent_tool_use_id` and `agent_id`.
  - Tasks emit `task_started`, `task_progress`, `task_updated` and `task_notification`. These carry `task_id`, `tool_use_id`, `parent_task_id`, `spawn_depth`, usage and an optional AI summary.
  - `background_tasks_changed` is a level signal that replaces the whole list.
  - Workflows add hidden per-agent progress records (`workflow_agent` and `workflow_phase`).
- **Banda today gets almost none of this**. Banda runs Claude through claude-agent-acp 0.99.1 and does not declare the `subagents` client capability. So Agent calls arrive as ordinary tool calls. The sub-agent's own tool calls are flattened into the parent session and carry only `_meta.claudeCode.parentToolUseId`. The prompt response is held open until background sub-agents finish. If Banda declares `clientCapabilities.subagents`, each sub-agent becomes a **child session**, announced with `subagent_update` (running / requires_action / idle) and carrying its own `session_message`s. That is the natural hook for "sub-agent = child Thread" (ADR 0003 already says "Later: subagents as child Threads").

---

## 1. How sub-agents work

### 1.1 The Agent tool

The tool is named `Agent`. The `system:init` tools list still shows `Task`, and before v2.1.63 the tool itself was called `Task`, so match both (`docs:agent-sdk_subagents`).

Input, from `sdk-tools.d.ts:774-815`:

| field | meaning |
|---|---|
| `description` | 3–5 words. Becomes the row label everywhere. |
| `prompt` | The task text. |
| `subagent_type` | `Explore`, `Plan`, `general-purpose`, a custom name, or `fork`. |
| `model` | `sonnet` / `opus` / `haiku` / `fable`, or a full model id. |
| `effort` | Per-call reasoning effort. |
| `run_in_background` | **Background is the default** when the call comes from the main conversation. |
| `name` | Named agents only exist with agent teams on. A name makes the agent addressable by SendMessage and @-mention. |
| `isolation` | `"worktree"` (fresh git worktree) or `"remote"` (cloud agent; the result is `remote_launched`). |
| `team_name`, `mode` | Deprecated. |

Output (`sdk-tools.d.ts:102-208`) is a union of three shapes:
- `status:"completed"`: `{agentId, agentType, content[], resolvedModel, modelsUsed[], totalToolUseCount, totalDurationMs, totalTokens, usage{…}, toolsUsed, toolStats{readCount, searchCount, bashCount, editFileCount, linesAdded, linesRemoved, otherToolCount}, prompt, worktreePath?, worktreeBranch?}`
- `status:"async_launched"`: `{agentId, description, prompt, outputFile, canReadOutputFile}`
- `status:"remote_launched"`: `{taskId, sessionUrl, description, prompt, outputFile}`

Do not parse the tool_result text. The SDK passes this object as `tool_use_result` on the user message and says to "render from it instead of parsing tool_result text" (`sdk.d.ts:6568-6571`). `toolStats` with its lines added and removed is a ready-made "what did it do" badge.

### 1.2 Built-in types (`docs:sub-agents`)

| type | model | what it is |
|---|---|---|
| `Explore` | `opus` alias on a subscription, main model on 3P | Read-only search. Thoroughness levels quick / medium / very thorough. Skips CLAUDE.md and git status. One-shot, so it has **no agent ID** and cannot be resumed. |
| `Plan` | inherit | Read-only research for plan mode. Also one-shot. |
| `general-purpose` | inherit | All tools. |
| `statusline-setup` | Sonnet | Narrow helper. |
| `claude-code-guide` | Haiku | Answers questions about Claude Code. |
| `claude` | inherit | Catch-all. The default for dispatched background sessions. |
| `fork` | same as parent | Inherits the full conversation, system prompt, tools and model, and shares the prompt cache. A fork cannot fork again. |

### 1.3 Custom agents (`.claude/agents/*.md`)

Markdown with YAML frontmatter. The body is the system prompt (`docs:sub-agents`). Scope priority is managed > `--agents` JSON > `.claude/agents/` > `~/.claude/agents/` > plugin.

| field | notes |
|---|---|
| `name` (req) | Up to 256 characters, no `:`. |
| `description` (req) | Tells the main agent when to delegate. A combined size over 15,000 tokens triggers a warning. |
| `tools`, `disallowedTools` | `tools: Agent(worker, researcher)` restricts which types the agent may spawn. |
| `model` | sonnet / opus / haiku / fable / full id / inherit. Order of precedence: per-call `model` > frontmatter > `CLAUDE_CODE_SUBAGENT_MODEL` > main. |
| `color` | **red, blue, green, yellow, purple, orange, pink, cyan**: "display color in the task list and transcript". The agent type text is tinted with it. |
| `permissionMode`, `effort`, `maxTurns`, `autoCompactWindow` (100k–1M), `omitClaudeMd`, `initialPrompt` | |
| `memory: user\|project\|local` | Loads the first 200 lines or 25 KB of MEMORY.md. |
| `isolation: worktree`, `background: true` | Per-agent defaults. |
| `hooks`, `skills`, `mcpServers`, `experimental.cacheTtl` | A `Stop` hook here becomes `SubagentStop`. |

Some tools are **always removed** from sub-agents: AskUserQuestion, EndConversation, Enter/ExitPlanMode, ScheduleWakeup, WaitForMcpServers and Workflow. **Background** sub-agents keep only file, shell and web tools, plus TodoWrite, Skill, ToolSearch, worktree tools, Monitor, TaskStop, SendMessage, Artifact and all MCP tools.

### 1.4 How the main agent picks

There are three triggers:
- **Natural language**: the main model matches the task against each agent's `description`. Opus 5 is noted as delegating on its own.
- **@-mention**: `@"code-reviewer (agent)"` or `@agent-<name>`. *Running* named background sub-agents also show up in the typeahead with their status.
- **`claude --agent <name>`**: the whole session *is* that agent. The header shows `@<name>`.

The `/agents` command used to open a wizard with **Running** and **Library** tabs. Since v2.1.198 it only prints a reminder that you edit the files.

### 1.5 Foreground vs background

- **Foreground** blocks the parent turn. Its permission prompts pass straight through to the Person.
- **Background** runs concurrently. A permission prompt surfaces in the main session and names the sub-agent. Esc denies that one call. Since CL 2.1.290 the prompt also shows the `Ctrl+X Ctrl+K` hint.
- **Ctrl+B** moves a running foreground task (sub-agent or shell) to the background. In tmux you press it twice. The SDK equivalent is the `background_tasks` control request (`sdk.d.ts:3977-3985`). VS Code got a "Run in background" button under a running command or sub-agent in CL 2.1.287.
- **Defaults**: fork mode is on and background is the default (CL 2.1.232 terminal, 2.1.302 everywhere). `CLAUDE_CODE_FORK_SUBAGENT=0` lets Claude wait instead. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` turns off Ctrl+B and backgrounding.
- **After the reply**: if background work is still running when Claude finishes a reply, the CLI shows a timer line, `Waiting for N background agents/workflows to finish` (CL 2.1.152).
- **Stopping**: **Ctrl+X Ctrl+K** stops all background sub-agents. You press it twice within 3 s (`docs:interactive-mode`).

### 1.6 Forks, `/subtask`, `/fork`

- `subagent_type:"fork"` copies the conversation into a sub-agent, so it needs no context-setting prompt. It can still take `isolation:"worktree"`.
- `/subtask <task>`, typed by the Person, starts an in-session fork. Its name is taken from the first words of the task. It takes a concurrency slot but is never blocked by the limit.
- `/fork` (since CL 2.1.212) copies the session into a **separate background session**, which you see in agent view. It is not an in-session sub-agent.
- Deny `Agent(fork)` in permissions to forbid forks.

### 1.7 Isolation

- `isolation:"worktree"` gives the agent a fresh git worktree. The completed result carries `worktreePath` and `worktreeBranch`. The worktree is auto-removed if unchanged.
- `isolation:"remote"` launches a cloud agent. The parent sees `Cloud agent launched · <taskId> · <sessionUrl>` (`cli:vZs`).
- `/batch` is a bundled skill that fans out 5–30 worktree-isolated sub-agents (`docs:agents`).

### 1.8 Talking to a running or finished agent

- **SendMessage** `{to: <agentId or name>, message, summary}` continues an agent. The `summary` is a 5–10 word preview shown in the UI (`docs:tools-reference:49`). A message to a finished agent **resumes it in the background**. Agents stopped with `x` or `stop_task` do not auto-resume.
- **ListAgents** lists who can be messaged. **TaskStop** `{task_id}` stops a task.
- **In the UI**: select a row in the agent panel, press Enter to open its transcript, then type. The message goes to that agent. Since CL 2.1.251 the placeholder reads `Message @name…`.
  - `/compact`, `/clear` and `/rewind` ask for confirmation. `/model` and `/fast` are blocked.
  - `Ctrl+Enter` (or `Ctrl+X Ctrl+S`) sends to the viewed agent *now*.
  - `/btw` answers from the open transcript (CL 2.1.314).
- **Hand back**: `SubagentHandback` (auto mode, since v2.1.271) lets a sub-agent hand control back to the parent with a report.

### 1.9 Nesting and concurrency

- **Depth**: sub-agents can spawn sub-agents up to **depth 3** (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`). The panel shows a **tree**:
  - A row shows `(+N)` for its descendant count.
  - Opening a row shows its siblings and direct children, "with a path back to `main`".
- **Concurrency**: **20** concurrent sub-agents (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`). Beyond that, the error is `Concurrent subagent limit reached`. Ultracode is exempt.
- **Startup context**: the agent's own system prompt, the task message, CLAUDE.md (unless `omitClaudeMd` is set or the type is Explore or Plan), git status, preloaded skills, and a **sibling roster** (`main` plus the named agents).

### 1.10 What returns to the parent

- **Final report only.** It is scanned for injection. Instruction-shaped text gets backslashes inserted, plus a marker: `[harness: subagent output matched instruction-shaped pattern(s): …`.
- **Foreground**: the tool_result text ends with `agentId: <id>` and `<usage>subagent_tokens: N\ntool_uses: N\nduration_ms: N</usage>`.
- **Background**: the model immediately gets this text: "Async agent launched successfully... agentId: <id> (internal ID - do not mention to user. Use SendMessage with to: '<id>', summary: '<5-10 word recap>' to continue this agent.) The agent is working in the background. You will be notified automatically when it completes..." plus the `output_file` path. When it finishes, a **user-role** message arrives:
  ```
  <task-notification><task-id>…</task-id><tool-use-id>…</tool-use-id><status>completed|failed|stopped</status>
  <summary>…</summary><output-file>…</output-file><result>…</result></task-notification>
  ```
  `acp:dist/task-notifications.js` parses exactly these tags.
- **Model fallback**: if the requested model failed, the transcript gets the line `⚠ This agent switched to <model> because its earlier model could not be used.`

### 1.11 Agent teams (experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)

`docs:agent-teams` describes:
- A **lead** plus **teammates**. They share a task list (pending / in progress / completed, with blocking dependencies and file locks).
- **Storage**: mailboxes at `~/.claude/teams/{team}/inboxes/{agent}.json`, the team config at `~/.claude/teams/{team}/config.json`, and tasks at `~/.claude/tasks/{team}/`.
- **Idle notifications** carry the teammate's final answer. There is a plan-approval flow.
- **Hooks**: `TeammateIdle`, `TaskCreated`, `TaskCompleted`.
- **Display**: in-process by default, or **split panes** in tmux / iTerm2 (`teammateMode`, `--teammate-mode`).
- **Limits**: no nested teams, one team per session, in-process teammates can't run background sub-agents, and in-process teammates can't be resumed.
- **Desktop does not support teams.**

### 1.12 Agent view: background *sessions* (`claude agents`, research preview)

This is a separate layer: whole sessions running in the background, rather than sub-agents (`docs:agent-view`).
- `claude agents` opens a full-screen list grouped **Pinned / Ready for review / Needs input / Working / Completed**. `claude attach <id>`, `--bg`, `stop`, `logs`, `respawn` and `rm` manage sessions.
- The agent-view docs show how the Anthropic team groups *agent work by what the Person must do next*. Section 2.9 has the sketch.

---

## 2. The terminal UI

### 2.1 One foreground sub-agent, running

The inline Agent tool call is rebuilt from `cli:renderToolUseProgressMessage` (constant `NP=3`). The header names the agent type and puts the description in parentheses. Older builds showed `Task(…)`.

```
⏺ Explore(Find auth middleware)
  ⎿  Read(src/server/auth.ts)
     Search(pattern: "session", path: "src")
     Bash(rg -n "jwt" src | head -20)
     +9 more tool uses (ctrl+o to expand)
```
- The rows are the **last 3** tool uses of the sub-agent, condensed into the same one-line format the main transcript uses. The count is `+N more tool uses`.
- Before the first tool call the body reads `Initializing…`.
- **Runs of search and read collapse** into one line: `Searching for 3 patterns, reading 5 files…` while running, then `Searched for 3 patterns, read 5 files`.
- On a short terminal it collapses to one line: `In progress… · 12 tool uses · 18.4k tokens · (ctrl+o to expand)`.
- **Since CL 2.1.257** the token counter is live.

### 2.2 Finished

```
⏺ Explore(Find auth middleware)
  ⎿  Done (14 tool uses · 23.1k tokens · 1m 12s)
```
- The format is exactly `Done (${n} tool uses · ${tokens} tokens · ${duration})`, with `1 tool use` in the singular (`cli:vZs`).
- If the model switched mid-run, the model tag shows the models joined with ` → `.

### 2.3 Backgrounded (the 2026 default)

```
⏺ Explore(Find auth middleware)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)
```
- `↓` is the keybinding chip for "manage". It moves focus to the agent panel below the prompt.
- Variants:
  - `Fetching in background`, for web-fetch-style agents.
  - `Cloud agent launched · <taskId> · <sessionUrl>`, for remote isolation.
- **Ctrl+O** (transcript mode, any time) expands the call into a green bold `Prompt:` section (the full prompt, indented), the static list of all the sub-agent's tool calls, and a `Response:` section. Transcript mode also shows timestamps and the model per message.

### 2.4 Parallel group

When Claude spawns several agents in one message, the calls render as one grouped block (`cli:renderGroupedToolUse`). The row component takes `agentType, description, name, toolUseCount, tokens, color, isLast, isResolved, isAsync, lastToolInfo, hideType`.

```
⏺ Running 3 Explore agents…
   ├─ Explore (Auth middleware) · 5 tool uses · 12.3k tokens
   │  ⎿  Search(pattern: "jwt")
   ├─ Explore (Session storage) · 3 tool uses · 8.1k tokens
   │  ⎿  Read(src/db/session.ts)
   └─ Explore (Login UI) · 0 tool uses · 0 tokens
      ⎿  Initializing…
```
- **Header states**:
  - `Running **3** Explore agents…` while running. The count is bold, and the type is named when all agents share it.
  - `**3** agents finished`.
  - `**3** background agents launched (↓ to manage)`.
- **Rows**:
  - The agent **type is bold and tinted** with the agent's frontmatter `color`, and `hideType` drops it when the header already names it. Teammates show as `@name`.
  - Unresolved rows are **dimmed**.
  - The second line `⎿ ` shows the last tool, `Initializing…`, `Done`, or `Running in the background`.

### 2.5 The agent panel below the prompt

This is the most important piece of "always visible" UI. The functions are `cli:due/cue/pue/z$e/MY`, and `docs:sub-agents` and `docs:agent-teams` describe it. It sits **under the input box**, in the footer area. It appears whenever sub-agents, teammates or workflows exist.

```
╭────────────────────────────────────────────────────────────────────────────╮
│ >                                                                          │
╰────────────────────────────────────────────────────────────────────────────╯
  ❯ ● main                                                         ↑ 2 more
    ◯ auth-review         Reading session middleware   2m 14s · ↓ 31.2k tokens
    ├─ ◯ Explore (+2)     Searching for jwt usages        48s · ↓ 9.8k tokens
    │  └─ ◯ Find callers  Initializing…                    3s · ↑ 0.4k tokens
    ◯ release-notes       waiting                       1m 02s · 2 queued
    ◯ 2 idle agents
    ● deep-research  ▰▰▱▱ 3/12 agents                           4m 10s
                                                                    ↓ 1 more
  ↑/↓ select · enter view · x stop · esc collapse · ctrl+x ctrl+k stop all agents
```
- **First row** is always `main`. `●` (filled) marks the transcript you are *viewing*. `◯` (hollow) marks the others. The **selected** row gets a `❯ ` pointer and bold text.
- **Label**:
  - It is the agent's `name`, or else its `description`. Width is clamped to 4–28 characters.
  - `(+N)` in dim text counts the descendants of a nested agent.
  - Nested agents are indented with tree connectors.
- **Summary column**: the AI **progress summary** (`task_progress.summary`, refreshed about every 30 s when `agentProgressSummaries` is on), or else the description. A status word replaces it in some states: `waiting`, `idle`, `running`, `awaiting approval`.
- **Right column**, joined with ` · `:
  - elapsed time
  - `↓ 12.3k tokens`, where the arrow is `↓` while it receives output and `↑` otherwise
  - `N queued` in warning colour (messages queued for that agent)
  - a PR link when there is one
- **Circle colour**: `success` when completed, `error` when failed or killed.
- **Lifecycle**:
  - A **successful** row disappears **immediately**, and the footer shows `/tasks to see subagents` for 30 s (CL 2.1.232).
  - **Failed** or stopped rows stay for 30 s. `x` clears one early.
  - Idle teammates hide 30 s after the whole panel goes idle. More than 3 idle rows collapse into `◯ N idle agents`.
- **Overflow**: `↑ N more` and `↓ N more`. Since CL 2.1.232 the overflow marker sits at the left.
- **Workflows** get rows in the same panel, with a 4-cell bar and the agent count (2.5 and 3.5). Enter opens the workflow detail.
- **Keys**: ↑/↓ select, Enter opens the transcript and lets you message the agent, `x` stops (or clears when finished), Esc collapses or deselects, `Ctrl+X Ctrl+K` stops all. With teams, `Ctrl+T` opens the task list.
- `subagentStatusLine` (a setting, `sdk.d.ts:7701-7706`) lets the Person script a custom status line per sub-agent row. Since CL 2.1.214 the payload includes effort.

### 2.6 `/tasks`

`/tasks` is a full list of background work: sub-agents, shells, monitors and workflows.
- **Rows** lead with a status icon (CL 2.1.283) and show the model and effort per sub-agent (CL 2.1.243).
- **Completed** items are "marked done and sorted below running work" for 30 s.
- **Special rows**:
  - `System tasks` groups internal work (CL 2.1.285).
  - `Earlier in this session` reopens finished sub-agents (CL 2.1.319).

```
  Background tasks
  ❯ ⟳ auth-review        general-purpose · opus · high      2m 14s
    ⟳ npm test --watch   shell                              12m 03s
    ⟳ deep-research      workflow  ▰▰▱▱ 3/12                 4m 10s
    ✓ Explore            Explore · done                       1m 12s
    System tasks (2)
    Earlier in this session (5)
  ↑/↓ select · enter open · x stop · esc close
```
The icons here are representative. The source only confirms "status icon".

### 2.7 Footer and post-response hints

- `/tasks to see subagents` for 30 s after a sub-agent finishes.
- `Waiting for N background agents/workflows to finish` as a timer line after the reply.
- Agent view adds `← for agents`, `← 2 agents` and `← 2 done` (2.9).
- The terminal tab title reads like `2 awaiting input · claude agents`.
- **Notifications** (`agent_needs_input`, `agent_completed`) go to the terminal or OS notifier.

### 2.8 Agent teams panel

The panel is the same as 2.5, but rows are teammates. `@name` is tinted by colour. A teammate's state is `idle`, `running` or `awaiting approval`. In split-pane mode every teammate gets its own tmux or iTerm2 pane instead.

### 2.9 Agent view (`claude agents`)

```
 claude agents                                         3 working · 2 need input
 ──────────────────────────────────────────────────────────────────────────────
 Pinned
   ✽ banda-ci-fix     Rebasing #1144 onto main and rerunning CI           2m
 Needs input
   ✻ theme-1          Asks: keep glass on by default?                     5m   #1144
 Working
   ✽ files-wave-2     Writing tests for Home folder                       12m
 Ready for review
   ∙ sidebar-card     Opened PR with status chips                         1h   #1105
 Completed
   ∙ docs-sweep       Updated 14 docs links                               3h
 ──────────────────────────────────────────────────────────────────────────────
 space peek · enter attach · ← back · x stop
```
- **Icons**: `✽` animated means working. `✻` is used for needs input. `∙` means exited. `✢` means sleeping in a `/loop`.
- **Colours**: Needs input yellow, Idle dimmed, Completed green, Failed red, Stopped grey.
- **Row content**:
  - The name is tinted by `/color`.
  - The **Haiku-written one-line summary** updates at most every 15 s.
  - Age.
  - A PR label `#N`, coloured yellow for waiting, green for passed, purple for merged, and grey for draft or closed.
- **Space** opens a **peek panel** with the question, result or status (`waiting 3m`). You can reply inline. Enter or → attaches, ← detaches.

---

## 3. Workflows and ultracode

### 3.1 The model

- **What it is**: Claude writes a JavaScript **script**. A background runtime runs it, and each `agent()` call starts a sub-agent (`docs:workflows`). The script decides the next step, not the model.
- **Scale and recovery**: one run handles dozens to hundreds of agents. It can be resumed from a journal.
- **Launching**: Claude calls the `Workflow` tool with `{script | name | scriptPath, args, resumeFromRunId}` (`sdk-tools.d.ts:2871-2902`). It returns at once with `{status:"async_launched", taskId, taskType:"local_workflow", workflowName, runId, summary, transcriptDir, scriptPath, warning?}` (`sdk-tools.d.ts:4148-4184`).
- **Saved workflows** live in `.claude/workflows/` or `~/.claude/workflows/` and run as `/<name>`. Plugins provide `/plugin:name`. `/deep-research` is bundled.

### 3.2 The script API

From the model-facing tool description in `cli` v2.1.321, near the `workflow-authoring` skill text:

```js
export const meta = {                       // PURE literal; required: name, description
  name: 'find-flaky-tests',
  description: 'Find flaky tests and propose fixes',   // shown in the permission dialog
  whenToUse: '…',                                       // optional, shown in the workflow list
  phases: [                                             // one per phase() call, matched by title
    { title: 'Scan', detail: 'grep test logs for retries' },
    { title: 'Fix',  detail: 'one agent per flaky test', model: 'sonnet' },
  ],
}
phase('Scan')
const flaky = await agent('grep CI logs for retry markers', { schema: FLAKY_SCHEMA })
log(`${flaky.tests.length} flaky tests`)
phase('Fix')
const fixes = await pipeline(flaky.tests, t => agent(`Fix ${t}`, { label: t, isolation: 'worktree' }))
```

| hook | behaviour |
|---|---|
| `agent(prompt, {label, phase, schema, model, effort, isolation:'worktree'(|'remote'), agentType})` | Without a schema it returns text. With a schema, the sub-agent is forced to call `StructuredOutput` (up to 5 retries) and agent() returns the object. It returns **null** if the Person **skips** the agent or it dies. `label` is the display label. `phase` assigns a progress group explicitly. |
| `pipeline(items, stage1, stage2…)` | Each item runs through all stages with **no barrier**. This is the default. |
| `parallel(thunks)` | A barrier. Thrown results become `null`. |
| `phase(title)` | Starts a progress group. |
| `log(msg)` | A **narrator line** above the progress tree. |
| `args` | Workflow input, verbatim. |
| `budget` | `{total, spent(), remaining()}`. `total` comes from the Person's "+500k"-style directive. It is a **hard** ceiling shared across the main loop and all workflows. Once it is reached, `agent()` throws. |
| `workflow(nameOrRef, args)` | Runs a child workflow inline, **one level only**. Its agents show under a group named after the child in `/workflows`. |

**Rules**:
- The script must be plain JS. `Date.now()`, `Math.random()` and a bare `new Date()` throw, because they would break resume. There is no fs, Node or `import()`.
- **Concurrency** is `min(16, CPUs-2)` agents per workflow (`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`, 1–256). Excess calls queue.
- **Size limits**: at most 4,096 items per parallel() or pipeline() call, and 1,000 agents per run.
- Agent starts are staggered 5 s apart so the prompt cache can be shared (`CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS`).

### 3.3 Launch: the approval dialog

```
╭─ Run workflow? ────────────────────────────────────────────────────────────╮
│ find-flaky-tests                                                           │
│ Find flaky tests and propose fixes                                         │
│                                                                            │
│ Phases                                                                     │
│   1 Scan   grep test logs for retries                                      │
│   2 Fix    one agent per flaky test                                        │
│                                                                            │
│ ⚠ Large workflow: ~40 agents, ~2.1M tokens projected                       │
│                                                                            │
│ ❯ 1. Yes, run it                                                           │
│   2. Yes, and don't ask again for find-flaky-tests in ~/code/app           │
│   3. View raw script                                                       │
│   4. No                                                                    │
│                                                                            │
│ ctrl+g open script in editor · tab add a comment                           │
╰────────────────────────────────────────────────────────────────────────────╯
```
- The four options, `Ctrl+G` and `Tab` are from `docs:workflows`. The `Large workflow` warning shows at more than 25 agents or more than 1.5M projected tokens. The box layout is approximate.
- **When the dialog appears depends on the permission mode**:
  - **Auto**: first launch only, and skipped with ultracode.
  - **Manual / acceptEdits**: every run.
  - **Bypass**: never.
  - **`-p` or SDK**: never; you need `Workflow` or `Workflow(<name>)` allow rules.
- **Desktop** shows an approval **card** with the name, the phase list, a token-usage caution, and **Once / Always / Deny**.

### 3.4 Inline progress tree

This renders in the transcript while the workflow runs, and in `/workflows`. It is rebuilt from `cli:wf_chunk` (functions `aKr/ae/we/be/Se/cKr/dTt/Me`).

```
  ❯ 7 flaky tests found, fixing                                   ← newest log() line
    Scanning CI logs                                              ← 2 older log lines, dim
    Loaded 214 test files
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ Scan  ✓ 2/2 · sonnet                                                     │
  │ ✓ 2 done                                                                 │
  └──────────────────────────────────────────────────────────────────────────┘
                                     ↓
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ Fix  · 3/7 · opus · 1 failed                                             │
  │  ├─ · auth.spec.ts      general-purpose · opus · 12k tok · 5 tools · 1m 2s│
  │  ├─ · cart.spec.ts      …running                                         │
  │  ├─ ✗ search.spec.ts    general-purpose · opus · 3k tok · 2 tools · 21s  │
  │  │                      — agent stalled on all 6 attempts                │
  │  └─ · login.spec.ts (retry 1)  …running                                  │
  └──────────────────────────────────────────────────────────────────────────┘
```
- **Narrator**: the latest `log()` line has a `❯` pointer. The previous 2 log lines show dimmed.
- **Phase box** (single border):
  - Header: `**Title**  <icon> done/total · model · N failed`.
  - The border is coloured "permission" (the accent) for a phase whose `kind` is a child workflow.
  - Between phases sits a dim `↓`.
  - A **collapsed** phase shows `✓ N done` plus only its running and failed rows. Verbose mode shows every row.
- **Agent row**: tree connector, then status icon, then label, then dim meta `agentType · model · 12k tok · 5 tools · 1m 2s`. If there is an error, ` — <error>` follows. While there is no meta yet the row reads `…running`.
- **Status icons**:
  - `✓` done (success colour)
  - `✗` failed (error colour)
  - a **dim dot** for running agents and phases (since CL 2.1.280; it replaced `⟳`)
- **No phases at all**: the block is flat, `N agents · M done · K failed`, followed by the last 8 rows and `└─ · · · +N more`.
- **Per-agent fields behind the UI**: `cached` (journal hit on resume) and `blocked` (classifier denial with error) exist, as do `fallbackModel`, `isolation`, `queuedAt`, `promptPreview` and `resultPreview`. See 5.4.

### 3.5 Background row under the prompt

```
  ● deep-research ▰▰⠋▱ · Verifying (2/4) · 7/12 agents · 4m 10s · 1.2M tok · ↓ to view
```
- Since CL 2.1.281 the row shows the name, a progress bar, the agent count (on wide terminals), elapsed time, total tokens and the large-workflow warning.
- **Progress bar** (`cli:Se`): **4 cells**. Filled cells are green. **One cell is an animated spinner** at 80 ms per frame. The rest are dim.
- **Phase text** (`cli:So`): the phase title turned into a gerund (`Verify` becomes `Verifying`), then `(2/4)` for the phase index. Two parallel phases show as `A & B`, and more as `A +2`.

### 3.6 `/workflows`

`/workflows` lists runs. With a single run, it opens that run directly. List rows lead with a status icon and elapsed time (CL 2.1.281).

```
 ─ find-flaky-tests ──────────────────────────────── 7/12 agents · 4m 10s · running
   Find flaky tests and propose fixes
 ┌ Phases ──────────┐ ┌ Fix ───────────────────────────────────────────────────┐
 │   1 Scan     2/2 ✓│ │ ❯ · auth.spec.ts     general-purpose · opus  1m 2s 12k  │
 │ ❯ 2 Fix      3/7  │ │   · cart.spec.ts     …running                           │
 │   3 Verify   0/7  │ │   ✗ search.spec.ts   stalled on all 6 attempts          │
 └──────────────────┘ │   ✓ login.spec.ts    done  48s  9k                       │
                      └────────────────────────────────────────────────────────┘
 ↑/↓ move · enter/→ open · esc/← back · j/k scroll · f filter · p pause · x stop · r restart · s save
```
- **Header** (`cli:dTt`): a rule line, the **bold name in the accent ("permission") colour**, and dim subtext (meta.description, or the usage-limit reset time). On the right: `3/12 agents · <elapsed> · done|stopped|paused|failed`.
- **Phase list rows** (`cli:cKr`, width 17): `❯ 1 Title  3/5`, or `✓`/`✗` when the phase is finished.
- **Agent detail** (Enter on an agent row) shows:
  - the prompt
  - recent tool calls, each marked running / failed / done (CL 2.1.265)
  - the result, with JSON pretty-printed and foldable (CL 2.1.259)
  - **the agent's own task list**
  - per-agent token usage
- **Keys**:
  - `f` cycles a status filter (CL 2.1.186).
  - `p` pauses or resumes the run.
  - `x` stops one agent or the whole run.
  - `r` restarts a running agent.
  - `s` saves the script as a named workflow.
- CL 2.1.202 removed per-row tool counts from the agent list, added a time column and shortened model names.

### 3.7 States worth designing for

| state | how it shows |
|---|---|
| queued | Waiting for a concurrency slot. `queuedAt` is set but `startedAt` is not. |
| running | Dim dot and live meta. `lastProgressAt` drives stall detection. |
| done | `✓` and the result preview. |
| cached | A journal hit on resume. The agent is not rerun. |
| failed | `✗` plus ` — <error>`. Errors include `agent stalled on all 6 attempts`. |
| retry / stalled | The label gains a suffix `(retry 1)`. The detail shows `attempt 2 (stalled)`. Up to 5 restarts (`stallMs`, `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS`). |
| blocked | The safety classifier denied it. The error is shown. |
| skipped | The Person skipped it mid-run. agent() resolves `null`. |
| paused | The Person pressed `p`. The model is told "…was paused by the user… The user can resume it from /workflows." |
| usage-limit wait | Since v2.1.271 the run pauses at the plan limit. The header shows the reset time. The log reads `Usage limit reset. Re-running N waiting agents.` |
| stopped | `x`. The run can be relaunched with `resumeFromRunId`. |

**Resume rules**: completed agents are cached. The first agent whose prompt changed reruns, along with everything after it. A failed agent reruns, along with everything after it.

### 3.8 Ultracode

- **What it is**: "Dynamic workflows on every task, at any effort level" (`acp:session-ultracode.js`). When ultracode is on, the system prompt tells Claude to "author and run a workflow for every substantive task by default… token cost is not a constraint". This is often several workflows in sequence, one per phase (understand, design, implement, review), and Claude stays in the loop between them.
- **Turning it on**:
  - `/effort ultracode`. In the `/effort` slider, `Tab` toggles it.
  - `claude --effort ultracode`, which also sets xhigh.
  - The **keyword** `ultracode` typed in a prompt. It is **highlighted violet**. It had a purple shimmer in CL 2.1.178, which became plain styling in CL 2.1.282. `Alt+W` or Backspace dismisses the highlight. You can turn it off with "Ultracode keyword trigger" in `/config`. Only human-typed prompts trigger it.
  - It became its own toggle in CL 2.1.284. VS Code shows an Ultracode switch under Effort, and the model pill reads `· Ultracode`.
- **Effects**: no Large-workflow warning, no concurrency cap, and no first-launch approval prompt in auto mode.
- `workflowSizeGuideline` (`sdk.d.ts:7589-7595`) sets the size the model aims for: unrestricted, small (<5), medium (<10, the default) or large (<50). The `Running in background` line names the size.
- **Disable** with `disableWorkflows` or `CLAUDE_CODE_DISABLE_WORKFLOWS`.

---

## 4. Other surfaces

### 4.1 VS Code extension (`docs:vs-code`)

- **Agent map**:
  - A **pill in the prompt box**, `● 2 agents`. The dot shows working, or waiting for permission.
  - Clicking it opens a **tree under the main agent** with status, elapsed time and token count. Background shells and monitors are listed below it.
  - Clicking a sub-agent shows its prompt, its tool calls and a read-only transcript, with a **Stop** button.
  - `/tasks` opens the map.
- **Focus view**: live progress rows for running sub-agents under a tool-call group (CL 2.1.269). Background sub-agents get one status line under the Agent card (CL 2.1.304).
- The Agent card is labelled `Spawned by the main agent`.
- Stop or Esc ends only the turn; background agents live on (CL 2.1.286).

```
 ┌──────────────────────────────────────────────┐
 │ Ask Claude…                                  │
 │                                              │
 │ [● 2 agents]  [opus · high · Ultracode]   ⏎  │
 └──────────────────────────────────────────────┘
        │ click
        ▼
 main
  ├─ ● auth-review     running   2m 14s  31.2k
  │   └─ ● Explore     running     48s   9.8k
  └─ ◐ release-notes   waiting for permission
 Background
  ▸ npm test --watch   shell     12m
```

### 4.2 Claude Desktop, Code tab (`docs:desktop`)

- **Panes**: the Code tab has chat, diff, browser, terminal, file, plan, tasks and **subagent** panes.
- **Background tasks pane** (from the title bar ⋮ menu): lists sub-agents, background shells and **workflows**. Clicking an entry shows its output in the subagent pane, or lets you stop it. Workflow progress lives here too.
- **Session details rail**: a column of cards.
- Workflow approval is a card with Once / Always / Deny. Agent teams are not supported.

### 4.3 Web and mobile (`claude.ai/code`, Remote Control)

- Sub-agent and workflow progress sync across surfaces. Any device sees the running sub-agents and workflows and can stop them (`docs:remote-control:14,162`).
- Remote Control clients get a **workflow agent grid** (CL 2.1.212).
- **Foreground** sub-agent tool calls stream live. **Background** ones send status only (CL 2.1.251).

### 4.4 Claude Projects (`docs:claude-projects`)

- A **coordinator** conversation plus **threads** (cloud sessions).
- **Overview pane**:
  - The Threads tab groups **Ready for review / Waiting on you / Working / Landing / Idle / Resolved**.
  - Other tabs: Library, Pull requests, Scheduled tasks.
- Thread cards appear inside the coordinator conversation. A dot on the Overview button signals news.
- This is "sub-agents as visible, durable threads", the closest analogue to Banda Threads.

---

## 5. Data

### 5.1 The message stream (Agent SDK 0.3.312)

- **Attribution**: every message produced inside a sub-agent carries `parent_tool_use_id`. That is the `tool_use` id of the Agent call that spawned it; it is null on the main thread.
  - `SDKAssistantMessage` (`sdk.d.ts:3700-3750`) also carries `agent_id`, `subagent_type`, `task_description` and `timestamp`. `agent_id` **equals the `task_id` of that agent's task events** and is stable across resume.
  - User messages carry `agent_id` too (`sdk.d.ts:6645-6653`). `SessionMessage` has `parent_agent_id` (`6790-6808`). Peer messages have `senderTaskId` (`5621`).
- **`forwardSubagentText`** (`sdk.d.ts:1916-1919`): "By default, only tool_use/tool_result blocks from subagents are emitted (enough for a heartbeat counter)". Turn it on to get the sub-agent's text and thinking too. The CLI flag is `--forward-subagent-text`.
- **`agentProgressSummaries`** (`sdk.d.ts:2126-2133`): forks a summariser about every 30 s and puts a present-tense line on `task_progress.summary`. This is the panel's summary column.

### 5.2 Task lifecycle events (system messages)

| subtype | key fields | file:line |
|---|---|---|
| `task_started` | `task_id, run_id, tool_use_id, description, subagent_type, is_backgrounded, spawn_depth (1 = top-level), parent_task_id, task_type, workflow_name, prompt, skip_transcript, ambient` | `sdk.d.ts:6373-6417` |
| `task_progress` | `task_id, run_id, tool_use_id, description, subagent_type, usage{total_tokens, tool_uses, duration_ms}, last_tool_name, summary` (+ hidden `workflow_progress`, `usage_limit_wait`) | `sdk.d.ts:6344-6370` |
| `task_updated` | patch: `status pending\|running\|completed\|failed\|killed\|paused, description, end_time, total_paused_ms, error, is_backgrounded` | `sdk.d.ts:6418-6439` |
| `task_notification` | `task_id, run_id, tool_use_id, status completed\|failed\|stopped, reason?:'worker_restart', output_file, summary, usage, resource_links, skip_transcript, ambient` (+ hidden `workflow_progress`, `workflow_progress_omitted`, `handback`, `handback_report`, `result`) | `sdk.d.ts:6308-6340` |
| `background_tasks_changed` | **level signal, REPLACE semantics**: `tasks[{task_id, run_id, task_type, subagent_type ('main-session' for a backgrounded main), description, parent_task_id, ambient}]` | `sdk.d.ts:3803-3836` |
| `tool_progress` | `tool_use_id, tool_name, parent_tool_use_id, elapsed_time_seconds, task_id, heartbeat, subagent_type, subagent_retry{agent_id, attempt, max_retries…}` | `sdk.d.ts:6455-6475` |

- `parent_task_id` and `spawn_depth` give the **tree**.
- `ambient` marks system work, which belongs in the "System tasks" row.
- `skip_transcript` marks tasks that should not render in the transcript.

### 5.3 Controls

- `Query.stopTask(taskId)` and `Query.backgroundTasks(toolUseId?)` (`sdk.d.ts:3306-3322`). The second is the Ctrl+B equivalent.
- `supportedAgents()` (`3098`) returns `AgentInfo[]` (`111-124`).
- `BackgroundTaskSummary` (`140-172`): `{id, type 'shell'|'subagent'|'monitor'|'workflow', status, description, command, agent_type, server, tool, name}`.
- `perTaskStopAffordance` (`4757`) tells the CLI that the client can stop single tasks.
- `getSubagentMessages` and `listSubagents` (`953/1176`) read the transcripts on disk.
- `AgentDefinition` (`36-109`) defines agents in code. It has the same fields as the frontmatter, plus `observer` and `observerMessage`.

### 5.4 Workflow progress records (hidden in the public d.ts, present in the CLI)

`task_progress.workflow_progress` carries items of three kinds:
- `workflow_agent`: `{index, label, phaseIndex, phaseTitle, agentType, isolation 'worktree'|'remote', model, fallbackModel, state start|progress|done|error, queuedAt, startedAt, lastProgressAt, promptPreview, resultPreview, cached, blocked, error, agentId, tokens, toolCalls, durationMs}`
- `workflow_phase`: `{index, title, kind}`. A `kind` for child workflows gets the accent border.
- `workflow_log`: `{message}`

Phase status (not-started / running / done / failed) is derived from these. `meta.phases` entries are matched to `phase()` titles. `WorkflowOutput.transcriptDir` holds the per-agent transcripts.

### 5.5 Hooks

`HOOK_EVENTS` is at `sdk.d.ts:983`.
- `SubagentStart {agent_id, agent_type}`.
- `SubagentStop {stop_hook_active, agent_id, agent_transcript_path, agent_type, last_assistant_message, background_tasks[], session_crons[]}` (`sdk.d.ts:10016-10055`). Returning `additionalContext` keeps the sub-agent going.
- Every hook input has `agent_id` and `agent_type` when it fires inside a sub-agent (`BaseHookInput`, `183-191`).
- Team hooks: `TeammateIdle`, `TaskCreated`, `TaskCompleted`.

### 5.6 On disk

- `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl` plus `agent-{agentId}.meta.json`. Compaction writes a `compact_boundary` into the same transcript.
- Banda's tests already expect transcripts under the subpath `subagents/agent-a1` (`platform/harnesses/adapters/src/sessions.test.ts:38`).
- Team state lives under `~/.claude/teams/` and `~/.claude/tasks/` (1.11).

### 5.7 The ids, side by side

| id | where it comes from | used for |
|---|---|---|
| `tool_use.id` of the Agent call | assistant message | `parent_tool_use_id` on child messages, `tool_use_id` on task events |
| `agentId` / `agent_id` / `task_id` | tool result, messages, task events | SendMessage `to`, stopTask, transcript filename |
| `run_id` | task events | distinguishes one resumed run from another |
| `parent_task_id`, `spawn_depth` | `task_started` | the tree |
| `runId`, `taskId` (workflow) | `WorkflowOutput` | `resumeFromRunId`, stop |
| `name` | Agent input (teams on) | @-mentions, SendMessage, panel label |

### 5.8 Usage and cost

- The result's `usage` covers the main loop only. `modelUsage` **includes sub-agents and Workflow agents** (`sdk.d.ts:5961-5965`).
- Per-agent usage arrives in `task_progress.usage` and `task_notification.usage`.
- `maxBudgetUsd` caps a query. Hitting it gives `Budget limit reached` and `error_max_budget_usd`.
- The workflow `budget` global is a turn-level output-token target (3.2).

### 5.9 ACP: claude-agent-acp 0.99.1, which Banda uses

Banda pins it at `platform/harnesses/adapters/package.json:14`.

There are **three behaviours**, chosen by client capability (`acp:README.md:39-112`, `acp:dist/acp-subagents.js:4-15`):

1. **No capability: Banda today.** Banda's engine does not declare `subagents` (`docs/research/2026-10-31-acp-adapters.md:84`).
   - Agent and Task stay **ordinary tool calls**. The sub-agent's own tool calls are **flattened into the root session**, each stamped `_meta.claudeCode.parentToolUseId = <Agent tool_use id>` (`acp:dist/acp-agent.js:566-574`).
   - The sub-agent's text is forwarded too, "like upstream", unless it is stripped (`2836-2845`, `599-606`).
   - **The turn is held open**: the prompt response waits (`Turn.deferredSettle`) while background sub-agents run (`1226-1234`, `345-351`). Only AIR v1 clients with `backgroundSubagents` end the turn early.
2. **RFD child sessions**: the client declares `clientCapabilities.subagents: {}`, or uses ACP v2 (`acp:dist/native-subagents.js:1275-1518`).
   - The parent gets `session/update {sessionUpdate:"subagent_update", sessionId:<child>, title, description, capabilities:{cancel:{}}, state:{state:"running"}}`.
     - `title` = name ?? description ?? role. `description` = subagent_type (`rfdLabels`, `1510-1518`).
     - Later states are `requires_action` (permission) and `idle` with `stopReason end_turn|cancelled|error` (+ `error`) (`rfdEndState`, `1482-1503`).
   - **The launch tool call is replaced by session messages**: the prompt is published as `session_message {messageId, senderSessionId, recipientSessionId, content}` in **both** transcripts (`publishPrompt`, `1357-1380`). The foreground answer comes back as the child's `session_message` to the parent (`${launchId}:reply`, `1429-1445`).
   - SendMessage resume becomes a `session_message` into the child. `SubagentHandback` is handled (`1416`).
   - `session/cancel` on the **parent** stops foreground children only. `session/cancel` with the **child id** calls `Query.stopTask`.
3. **AIR form** (`nativeSubagentSessions`): `subagent_spawned` and `subagent_state_update` (completed | failed | cancelled | disconnected).
   - **Async tasks** (shells, monitors, workflows) are reported **only** to AIR clients that declare `asyncTasks`:
     - `async_task_spawned {asyncTaskId, name, taskType, description, showInTranscript, canStop, outputFilePath, toolCallId}`
     - `async_task_progress {summary, lastToolName, usage{totalTokens, toolUses, durationMs}}`
     - `async_task_state_update (running|paused|completed|failed|stopped)`
   - The types are in `acp:dist/acp-subagents.d.ts` and `acp:dist/async-tasks.js:5-7`. `friendlyTaskType` maps `local_bash`→shell, `local_workflow`→workflow, `local_monitor`/mcp→monitor (`870-877`).

**What this means for Banda**:
- Sub-agents: declaring `subagents` gets Banda child sessions with clean state transitions for free.
- Workflows: phases and per-agent rows are **not** reported over ACP in any form. AIR async tasks carry only a summary and usage. To draw the workflow tree, Banda would need one of:
  - the SDK's `task_progress.workflow_progress` through a direct SDK path or an adapter extension
  - reading the per-agent transcripts in `transcriptDir`
  - parsing `<task-notification>`
- The adapter can stop background workflows on cancel (`stopBackgroundWorkflows`, `acp-agent.js:6415-6430`, `9484`).

---

## 6. What this suggests for Banda (inputs for the mocks, not decisions)

1. **Sub-agent = child Thread, shown nested.** Claude Code's best ideas are the **tree with a path back to main**, `(+N)` descendants, and "open a row and talk to that agent". Banda already has Threads, Panes and a sidebar. A sub-agent could be a child Thread under its parent in the sidebar, and open as a Pane beside the parent (like the Desktop subagent pane), with the composer reading `Message @name…`. In data terms that is ACP `subagent_update` plus child `sessionId`.
2. **An always-visible "agents strip" near the composer.** This is like the panel under the prompt and the VS Code `2 agents` pill. It needs `main` first, then rows with a live one-line summary, elapsed time and a token counter that animates while receiving. Finished rows leave quietly and failed rows stay. Banda's calm design suits the "success disappears, failure lingers" rule.
3. **Inline card in the Thread.** It shows the agent type in its colour, the description, the last 3 tool rows, `+N more`, and then `Done (14 tool uses · 23.1k tokens · 1m 12s)`. For parallel spawns, one grouped card with a tree. Use `toolStats` (lines added and removed, files read) for a richer finished state than the terminal can draw.
4. **Workflows as a canvas of phase boxes.** Each box has a header (`✓ 3/7 · model · 1 failed`) and rows with label, type, model, tokens, tools and time. A narrator line from `log()` sits on top. A 4-cell progress bar and gerund phase text go in a compact strip. A GUI can do better than the terminal: a real grid of agents (as Remote Control's agent grid does), click-through to the agent's transcript, and per-agent retry, skip and restart.
5. **Group by what the Person must do.** Use agent view's Needs input / Working / Ready for review / Completed and Projects' Waiting on you / Landing. This matches the Working / Settled sidebar and the planned status marks.
6. **Design every state.** Queued, running, cached, retry/stalled, blocked, skipped, paused, usage-limit wait (with reset time), stopped and failed are all real in the data.
7. **What to avoid**:
   - Hiding all sub-agent work behind a "Done" line with no way in. The terminal needs Ctrl+O for that.
   - Status that only lives in a 30 s footer hint.
   - Showing internal ids. The model is told explicitly not to mention `agentId`.
   - A shimmer or animated keyword highlight. Claude Code itself removed it (CL 2.1.282).

---

## 7. Sources

- Docs (raw markdown at `https://code.claude.com/docs/en/<page>.md`): `sub-agents`, `agent-teams`, `workflows`, `agents`, `agent-view`, `interactive-mode`, `vs-code`, `desktop`, `claude-projects`, `remote-control`, `tools-reference`, `agent-sdk/subagents`.
- CHANGELOG: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md. The versions cited inline are 2.1.152 through 2.1.319.
- Agent SDK typings: `sdk.d.ts` and `sdk-tools.d.ts` in `@anthropic-ai/claude-agent-sdk@0.3.312` (path in the header).
- ACP adapter: `README.md`, `dist/acp-agent.js`, `dist/native-subagents.js`, `dist/acp-subagents.js(.d.ts)`, `dist/async-tasks.js`, `dist/task-notifications.js` and `dist/session-ultracode.js` in `@agentclientprotocol/claude-agent-acp@0.99.1`.
- CLI source: the installed `claude` binary, v2.1.321. The Agent renderers (`renderToolUseProgressMessage`, `renderGroupedToolUse`, `vZs`) and the agent panel (`due/cue/pue/z$e/MY`) were read here. So were the workflow progress chunk (`aKr/ae/we/be/Se/uKr/dTt/cKr/Me`) and the model-facing Workflow tool description.
- Banda: `docs/adr/0003-claude-code-and-codex-in-a-thread.md:185`, `docs/research/2026-10-31-acp-adapters.md:84` and `platform/harnesses/adapters/src/sessions.test.ts:38`.

---

## Fact check

Independent check done 2026-11-10 against primary sources: the docs pages `sub-agents.md` and `workflows.md` (raw, downloaded), `CHANGELOG.md` (raw, main), the SDK typings (`sdk.d.ts` and `sdk-tools.d.ts`, 0.3.312), the adapter's `README.md`, `dist/acp-agent.js` and `dist/native-subagents.js` (0.99.1), the CLI 2.1.321 binary (via `strings`; the plain-JS chunks only, since some chunks are Bun bytecode), and Banda `main` at 26feb9be.

| # | Claim | Verdict | Evidence / correction |
|---|---|---|---|
| 1 | Sub-agents default to background **and fork mode (inherit full conversation)**; terminal since 2.1.232, everywhere since 2.1.302; `CLAUDE_CODE_FORK_SUBAGENT=0` lets Claude wait | **corrected** | Background by default and the version numbers are right (CL 2.1.232, CL 2.1.302, `docs:sub-agents` "Turn fork mode off"). "Fork mode on" does **not** mean every sub-agent is a fork. It means Claude *may* call `subagent_type:"fork"`, and in interactive, VS Code and desktop sessions it cannot wait for a sub-agent. `Explore`, `general-purpose` and custom types still start fresh. In `claude -p` and the SDK, Claude can still wait on its own judgment. Since 2.1.302, a sub-agent's *own* (nested) Agent calls run in the **foreground** by default in `-p`, the SDK, desktop and VS Code. `CLAUDE_CODE_FORK_SUBAGENT=0` is the documented way to let Claude wait (it needs a restart). Section 0's "Foreground is the exception: Claude passes `run_in_background:false`" holds only in `-p` and the SDK. |
| 2 | Agent output union (completed / async_launched / remote_launched); render from `tool_use_result` | **confirmed** | `sdk-tools.d.ts:102-208` and `sdk.d.ts:6568-6573`. `agentType` is optional. `toolStats` also has `otherToolCount` and optional `frameCount`. `async_launched` also carries `resolvedModel` and `modelsUsed`. |
| 3 | Every sub-agent message carries `parent_tool_use_id` and `agent_id`; `agent_id` = task_id; `task_started` has `spawn_depth` and `parent_task_id` | **corrected** (minor) | `agent_id` is on `SDKAssistantMessage` (`sdk.d.ts:3742`) and `SDKUserMessage` (`6647`), and its doc says it equals the task events' `task_id`. **`stream_event` (partial) messages carry only `parent_tool_use_id`, not `agent_id`** (`5753-5763`). `tool_progress` carries `task_id`. `spawn_depth` is set only on `local_agent` tasks. `parent_task_id` is **absent** when the launcher is the main thread, a teammate, or **an agent inside a workflow** (`6400-6403`). So `parent_task_id` gives the sub-agent tree, but not the workflow tree. |
| 4 | `background_tasks_changed` is a level signal with REPLACE semantics | **confirmed** | `sdk.d.ts:3803-3836`. Each entry also has `description`. The signal is per process: nothing is sent at startup, so reset to empty when the CLI process restarts; a re-`initialize` gets a snapshot. It lists **live background** tasks only, not foreground ones. |
| 5 | Agent card: last 3 rows + `+N more tool uses`; `Done (…)`; `Backgrounded agent (↓ to manage · ctrl+o to expand)`; grouped `Running 3 Explore agents…` with `├─`/`└─` | **corrected** | `NP=3` and the `Done (${n} tool uses · ${tokens} tokens · ${dur})` format are confirmed (`k$`, `vZs`). **The overflow line is `… +9 tool uses (ctrl+o to expand)`**: the `ob` component calls `OB()`, which returns `` `… +${n} ${plural}` `` plus the expand hint. The string "more tool uses" does not exist in the 2.1.321 bundle. `Backgrounded agent` (or `Fetching in background`) plus a dim `(↓ to manage · ctrl+o to expand)` is confirmed. The group header is confirmed. Its finished form is `**3** Explore agents finished` when all agents share a type. **When the header names the shared type, each row drops it** (`hideType`) and shows the bold `name ?? description` (plus a dim `: description` when there is a name), so the row is `├─ Auth middleware · 5 tool uses · 12.3k tokens`, not `Explore (Auth middleware) …`. The tree glyphs `├ └ │` are confirmed. |
| 6 | Panel starts with `main`; rows: name/description, `(+N)`, AI summary, elapsed, `↓ tokens`, `N queued`; keys; success vanishes with `/tasks to see subagents`; failed stays 30 s | **corrected** (label) | The `main` row is confirmed (`due`: pointer + circle + " main"; `●` when viewed, which is `⏺` on macOS; `◯` otherwise). `(+N)` is confirmed (`lVt` → `` ` (+${n})` ``). **The label is the agent's registered name, else the agent *type*** (`OY()` → `agentType`, or the teammate's name), **not the description**. The description shows in the second column only when there is no AI `progress.summary`. Elapsed, `↓/↑ N tokens` (`↓` when `progress.lastActivity` is set), `N queued` in warning colour and a PR link are confirmed (`z$e`, `cue`). The keys are confirmed (`ch = {open:"enter", close:"x", collapse:"escape", select:[up,down], stopAll:"ctrl+x ctrl+k"}`), and the footer words are `select · view · stop|clear · collapse · stop all agents`. The lifecycle is confirmed by `docs:sub-agents` "Finished subagents in the panel and task list": success leaves at once, with the hint for 30 s; failed **or stopped** rows stay 30 s. The label width clamp is 4–28. |
| 7 | Workflow script API, concurrency `min(16, CPUs-2)`, 1,000 agents per run | **confirmed** | This is the model-facing description in the CLI string table (line containing `Script body hooks`) plus `docs:workflows` "Behavior and limits". One correction to the notes' table: in 2.1.321 the described `isolation` type is only `'worktree'` (the template constant is `r="'worktree'"`). `'remote'` exists on the Agent tool input, not in this description. `model` is dropped from the description when `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set. `budget.spent()` counts **output** tokens of the turn across the main loop and all workflows; `budget.total` is `null` with no target. |
| 8 | Progress renders as bordered phase boxes; header `Title <icon> done/total · model · N failed`; rows `label agentType · model · 12k tok · 5 tools · 1m 2s`; dim dot = running; 4-cell bar with spinner and gerund phase text | **corrected** | The box and row formats are exact (`we`, `K` in the `aKr` chunk). The border colour is `subtle`, or `permission` for `kind:"child"`. A dim `↓` sits between boxes. The narrator line is `❯ <latest log>` with the 2 previous lines dim *below* the tree. The status map (`hOe`) is `running` = `●`/`⏺` with no colour (dim), `success` = `✓` green, `error` = `✗` red. **But the phase boxes render only in verbose / transcript mode (Ctrl+O)**: the Workflow tool's progress renderer calls `WBo` only when `verbose \|\| isTranscriptMode`. **By default the transcript shows one line**: `● ⠿⠿⠋⠿ · 7/12 agents` (`uKr`), coloured success or error. The 4 cells are the braille `⠿` (`tUr`): filled ones green, one spinner cell at 80 ms, the rest dim. **The gerund phase text is dead code in 2.1.321**: `zBo()` always returns `null`, so `phaseText` is never set. `/workflows` uses other components, not the boxes. See the missed facts for the panel row. |
| 9 | `/workflows` keys and the agent detail | **confirmed** | `docs:workflows` "Watch the run": ↑/↓, Enter/→, Esc/←, j/k (scroll the detail), f, p, x (agent, or the whole run when focus is on it), r (restart a *running* agent), s. The detail shows the prompt, recent tool calls with state, the result and the agent's own task list. Enter expands it. CL 2.1.186 (f), 2.1.259 (pretty JSON, fold), 2.1.265 (call states, task list). The run header stats are `3/12 agents · 4m 10s` with ` · done`/` · stopped`/` · paused`/` · failed` (`YBo`). **A running run shows no status word**, so the `· running` in section 3.6's sketch is wrong. |
| 10 | Without `subagents`, sub-agent tool calls are flattened into the root session with `_meta.claudeCode.parentToolUseId`; the prompt response is held open while background sub-agents run | **confirmed** | `acp-agent.js:566-574` (`stampParentToolUseId`), `345-351` (`isHeldOpen`), `1225-1234` (`endsTurnsWithLiveSubagents`). Two nuances. (a) **The hold also applies to clients that declare `subagents`**: only an ACP v1 **AIR** client with `backgroundSubagents` ends turns early. (b) Sub-agent text: such a client gets the streamed text "like upstream". The consolidated text and thinking come only with the `subagent-transcript` meta capability or the `forwardSubagentText` option (`2836-2845`, `7264-7270`). |
| 11 | With `clientCapabilities.subagents`, each sub-agent is a child session: `subagent_update {sessionId, title, description, capabilities.cancel, state}`, `session_message` in both transcripts, `session/cancel` on the child id stops it | **confirmed**, with detail | `native-subagents.js:1275-1300` (announce), `1361-1414` (`publishPrompt`, `linkedSessionMessages`, which link the two views by `recipientMessageId`/`senderMessageId`), `1429-1445` (`launchReply`), `1482-1518` (`rfdEndState`, `rfdLabels`), and `README.md` "Subagent sessions". Corrections: **the foreground reply is a `session_message` in the parent's transcript only**; the child keeps its answer as its own agent message. A child that can't be observed gets `state:"unknown"`, and a worker-restart orphan gets `idle` with no stop reason. `description` is sent only when the subagent_type differs from the title. "A client cannot prompt or otherwise change a child": cancel is the only capability, and a replayed child gets none. ACP v2 clients get this without declaring anything. |
| 12 | Banda does not declare `subagents`; ADR 0003 plans child Threads | **confirmed** | `apps/agents/engine/src/acp.rs:356-369` (`shows()`) declares elicitation forms, session notices, boolean config options and the `terminal_output_delta` meta, and nothing for sub-agents. `platform/harnesses/engine/src/acp.rs:234` requests `ProtocolVersion::V1`, so the v2 baseline doesn't apply either. ADR 0003 line 185 reads "Later: subagents as child Threads". |

### Missed or worth adding

- **Banda ignores `parentToolUseId` today.** Nothing under `apps/` or `platform/` reads `_meta.claudeCode.parentToolUseId`, so a sub-agent's Read, Bash and Edit calls show up in the Thread as if the main Agent made them, mixed with its own. This is the first UX bug a sub-agent design has to fix, even before child sessions.
- **The Workflow tool call's own lines** (`ge`, `D` in the Workflow renderer chunk):
  - After launch: dim `Running in background · ` + `/workflows` (suggestion colour) + dim ` to monitor and save`, plus ` · medium size (/config …)` when a non-default size guideline is set.
  - When finished: `✓ Completed in 4m 10s · 12 agents · 1.2M tokens`, or `✗ Failed …` / `✗ Stopped …`.
  - Remote: `Running in cloud session · <url>`.
- **The panel's workflow row is not the 4-cell bar.** `cY`/`FU` in the panel chunk draw: pointer, `◯` (coloured success, error or warning; `⏸` when paused), name, a **pill progress bar** of width 20/12/8 (a `NN%` text fallback), then dim `7/12 · 4m 10s · ↓ 1.2M tokens`, plus the warning `⚠ Large workflow · /workflows to stop`. On a usage-limit pause the bar is replaced by `paused · <reset>` / `paused (usage limit)`. Segments drop as the terminal narrows (`U$e`). Enter opens the workflow detail.
- **Ultracode lifts the Agent-tool limit, not the workflow limit.** It turns off the *Agent-tool* concurrent-subagent limit (20) but not the per-workflow cap of 16 (`docs:workflows`, `docs:sub-agents` "Concurrent subagent limit"). Section 3.8's "no concurrency cap" overstates this.
- **`workflow_progress` reaches only SDK hosts.** It is real on the wire: the CLI's `task_progress` emitter sets `workflow_progress` (11 hits in the bundle). It is absent from the public `sdk.d.ts` (0 hits) and **never read by claude-agent-acp 0.99.1** (0 hits in `dist/*.js`). Over ACP, Banda cannot draw phases or per-agent rows without an adapter change or reading transcripts.
- **The state labels are designed for screen readers.** `hOe` gives every status an `ariaLabel` (`done:`, `failed:`, `running:`, `needs you:`). The agent-view icon set is `working`/`needsYou` (warning colour)/`idle` `◦`/`failed` `×`.
- **The data has a run id.** `run_id` is on every task event. A resumed task keeps `task_id` and gets a new `run_id`, and run ids sort by string order. Use it to drop late frames from an older run of the same agent.
- **Hide ambient tasks.** `skip_transcript` and `ambient` (on `task_started`, `task_notification` and `background_tasks_changed`) mark housekeeping tasks that hosts should hide from the transcript and from activity indicators.
