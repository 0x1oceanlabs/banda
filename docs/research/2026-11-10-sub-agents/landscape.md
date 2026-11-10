# Sub-agents and workflows: how other products show them

Research for Banda's sub-agent and "ultracode"/workflow UI, written 2026-11-10 before the
HTML mockups. Topic: the landscape. How other products show sub-agents, parallel agents and
multi-agent orchestration, what the Person sees, what data sits behind it, and which patterns
Banda should take or avoid.

Sources: T3 Code source (github.com/pingdotgg/t3code, commit `337c5858`, 2026-11-05), OpenCode source
(`anomalyco/opencode@dev` through the GitHub API), Claude Code docs (code.claude.com, current for
2.1.32x), the Claude Agent SDK 0.3.312 types in Banda's `node_modules`, and official docs,
changelogs and blogs for each other product. Secondary sources are marked as such. Every claim
names its source. Where a source does not describe the UI, these notes say so and do not guess.

---

## 0. Summary

Every product that ships sub-agents has settled on the same shape. In the **parent's
transcript**, a delegation is **one row per child**: the agent's icon with a status dot, the
task title, one live line (progress while it runs, the result when it ends), elapsed time, and a
chevron that opens the child. A **fan-out collapses into one summary row**, for example
`Kicked off 5 subagents · 3 working · 2 done`. Near the **composer**, a **live strip** shows the
background work that is running now. Claude Code shows it as the task panel below the input,
OpenCode as the "Background activity" row above the composer, Codex IDE as active sub-agents
above the composer, and T3 as the `ThreadNow` lines at the end of the timeline. **Opening a
child** shows the same chat view, with the composer swapped for a status bar and a way back to
the parent. A **question or approval** from a child is raised in the parent and names the
child. Children **never become top-level rows** in the main list. They show as a count or as
satellites, and the parent's state takes on the child's state when the child needs the Person.

Workflows (a script fanning out to dozens of agents in phases) get one more surface, a
**phases × agents board**. Claude Code has the `/workflows` view, T3 has `WorkflowOpeningBlock`,
and Factory has Mission Control. Each phase has a title and a `settled/total` count. Each agent
row has a status, label, elapsed time and tokens, and you can drill into an agent's prompt,
tool calls and result. The Person can pause, stop, restart one agent, filter by status, and
save the script.

The failures are just as consistent:
- **Opaque delegation.** The Person cannot see the brief or the result (Claude Code issue
  #66646, Cursor forum, Amp: "You can't guide subagents directly", Roo's critique).
- **Walls of nested logs** in the parent transcript.
- **Children flooding the main list.**
- **Per-sub-task approvals.**
- **A parent status that says "done" while children still run** (Warp says outright that the
  parent's status "reflects only its work").
- **Spend nobody sees** while it grows (Cursor 3 users report about 3x token spend).

Banda's own rules already point the same way: ADR 0098 #23–24 (sub-agents get no cards, children
sit under their parent with ↳) and ADR 0099 (sub-agents shown as satellites around the Mark).
What Banda still lacks is everything **inside the Thread**: the delegation row, the fan-out
group, the live strip, the child view, attention routing, and a workflow board that fits as a
**Pane** in the Thread's Group.

---

## 1. Product by product

### 1.1 T3 Code (pingdotgg/t3code, local source): the most complete design in the field

T3 has two kinds of child:

- **provider-native sub-agents**, which are Claude's Task/Agent tool and Codex's sub-agents
  mapped into T3 threads;
- **app-owned delegated tasks**, started through T3's own MCP tool `delegate_task`, which can
  run on any provider, in a worktree, or on another machine.

Both are `OrchestrationV2Subagent` records. Each record points to a child thread
(`packages/contracts/src/orchestrationV2.ts:884-923`).

**Data model** (`orchestrationV2.ts:801-923`):
- `OrchestrationV2Subagent` has these fields:
  - `id`, `threadId` (the parent), `runId` (the parent turn), `parentNodeId`
  - `origin: provider_native | app_owned`, `createdBy`
  - `driver`, `providerInstanceId`, `childThreadId | null`, `remoteChild?`
  - `prompt`, `title`, `model`, `modelSelection?`
  - `completionWake: always | settled_only`
  - `status: idle | pending | running | waiting | completed | failed | cancelled | interrupted`
  - `progress?` (a one-line live string), `workflow?`, `result`
  - `startedAt`, `completedAt`, `updatedAt`
- `OrchestrationV2SubagentWorkflow` has `name?`, `runHandles {runId, transcriptDir,
  scriptPath}`, `phases[] {index, title}` (append-only: "phases discovered at runtime join when
  they start"), `agents[]`, `totalTokens`, `toolCalls` and `durationMs`.
- Each workflow agent has `index`, `label`, `agentId?`, `childThreadId?`,
  `state: queued | running | completed | failed`, `phaseIndex?`, `phaseTitle?`, `model?`,
  `effort?`, `speed?`, `attempt?`, `totalTokens?`, `toolCalls?`, `durationMs?`, `queuedAt?`,
  `startedAt?`, `completedAt?`, `prompt?` and `result?`.
- Thread lineage is `parentThreadId`, `relationshipToParent: fork | subagent`, `rootThreadId`
  and `sideChat?`. `isListedThreadLineage` returns false for sub-agents and side chats:
  **"Subagents and side chats live inside their parent's view, never in thread lists."**
  (`orchestrationV2.ts:155-164`)

**Where Claude workflow data comes from**
(`apps/server/src/orchestration-v2/Adapters/claudeWorkflowProgress.ts`):
- Claude Code's SDK stream carries `workflow_progress` entries on task frames. Entries of type
  `workflow_phase` carry `{index, title}`. Entries of type `workflow_agent` carry `{index, label,
  state: queued|start|done|error, agentId, phaseIndex, phaseTitle, model, attempt, tokens,
  toolCalls, durationMs, queuedAt, startedAt, lastProgressAt, promptPreview, resultPreview}`.
  The background-launch acknowledgement (`taskType: "local_workflow"`) is the only frame that
  carries `runId`, `transcriptDir` and `scriptPath`.
- T3 merges snapshots by agent index:
  - a restarted attempt (higher `attempt`) replaces the old one;
  - a regression (done going back to running) is ignored.
- The SDK's public types (Banda `node_modules/.../claude-agent-sdk/sdk.d.ts:6304-6420`) give
  the generic task events:
  - `task_started {task_id, run_id, tool_use_id, description, subagent_type, is_backgrounded,
    spawn_depth, parent_task_id, task_type, workflow_name, prompt, skip_transcript, ambient}`
  - `task_progress {usage{total_tokens, tool_uses, duration_ms}, last_tool_name, summary}`.
    The `summary` field is "a one-line status for the task's row".
  - `task_notification {status completed|failed|stopped, summary, output_file, usage}`
  - `background_tasks_changed`, a level signal: the full set of live tasks.

**What the Person sees in the parent's chat:**

1. **One delegation row**, `SubagentTimelineLink` (`apps/web/src/components/chat/V2LifecycleRow.tsx:396-544`).
   - A 24px round avatar with the provider logo. A **2px status dot** sits in a corner of the
     avatar: info-blue for Queued, Running or Waiting, grey for "Idle · resumable", green for
     Completed, red for Failed, and dim for Stopped (`STATUS_VISUALS`, l.170-182).
   - Title. For a remote child, it is followed by "on ‹machine›".
   - One detail line. While running it shows `progress`, and once settled it shows `result`.
     The text is flattened to plain words and paths are middle-truncated. A generic "Child task
     ended with status…" is suppressed (l.195).
   - When there is detail, a status word on the right, then the elapsed time in tabular figures.
   - A chevron when the child can be opened.
   - The whole row is a button that opens the child thread.
2. **Hover card**, `SubagentTooltipContent` (`SubagentTooltipContent.tsx`). It shows:
   - model, effort and speed icon;
   - a status icon and word with elapsed time;
   - **Branch / Worktree / Project only when they differ from the parent's**
     (`subagentDisplay.ts:51-112`);
   - a 280-character preview of progress or result, with a terminal icon.
3. **Fan-out group**, `V2SubagentGroup` (`TimelineV2EventRow.tsx:53-160`). Several sub-agents
   from one turn collapse into one collapsible row:
   - **stacked avatars, up to 3**, then a `+N` chip;
   - a title `N subagents`;
   - a subtitle `summarizeSubagentStatuses`, for example `3 working · 1 done · 1 failed`,
     coloured info while active and red if any failed;
   - group elapsed time and a chevron.
   - When everything has settled, the row dims to **opacity 55%**. It is full strength while
     anything is live or the row is expanded.
   - Expanded, it shows the member rows inside a thin bordered card.
   - The summary copy is "Kicked off 5 subagents" while live and "Ran 5 subagents" afterwards
     (`subagentDisplay.ts:12-23`).
4. **Result coming back**. A child's completion lands in the parent as a notification row that
   reuses the same link. It shows "Finished", "Failed", "Stopped" or "Updated", plus a timestamp
   (`V2LifecycleRow.tsx:330-394`). An app-owned task wakes the parent: the MCP result tells the
   agent "Completion wakes this thread, so end your turn. Do not wait on it or poll it."
   (`orchestratorMcp.ts:200`).
5. **"Now" lines at the end of the timeline**, `ThreadNow` (`ThreadNow.tsx`,
   `ThreadActivityBanners.tsx`):
   - **attention** first, in info colour and announced:
     - "Subagent waiting", followed by the waiting children's titles as links;
     - an action "Open approval" or "Open question" (l.34-72).
   - **background work**:
     - "Running · ‹label›" for a single child, otherwise "‹newest›: ‹its progress›";
     - a ticking elapsed time, an "Open" action and a Stop action (l.156-240).
6. **Child approvals in the parent's composer**, `ChildThreadApprovals`. A card reads
   "Approval needed from ‹child title›", shows the command or detail in a monospace pre, then
   the approve and deny actions. If the process has died, it says "Provider process is gone.
   Interrupt or restart the child thread to respond."
7. **Workflow block**, `WorkflowOpeningBlock` (`WorkflowOpeningBlock.tsx`). This is the
   coordinator thread's opening.
   - Header: a workflow icon, the eyebrow "Workflow started", the workflow name (h3), and the
     description.
   - On the right, `12 agents · 4 working · 8 done` (`subagentRuntime.ts:383-424`).
   - Then **one section per phase**: a small heading with the phase title and
     `settledCount/members` in tabular figures, then member rows (avatar with status dot,
     label, a one-line prompt or result, elapsed time, chevron).
   - Last, **the script itself**. It is folded to 11rem with a fade mask
     (`linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)`) and has a
     "Show full script" / "Show less" button.
   - Phases are merged from what the script declared and what members report: "the declared
     plan lags the members" (`subagentRuntime.ts:251`).
8. **Child view**. A provider-native child thread swaps its composer for `ProviderSubagentBar`:
   - the provider icon, the model and the effort;
   - the live status with ticking time;
   - the muted words "**Runs on its own**";
   - a ghost button "↖ **Open parent**".

   Its dialog "Subagent work" says "Read only. These subagents cannot take messages."
   (`NativeChildWorkDialog.tsx:44`). The user docs say: "Subagent threads started by the agent
   can't take messages; message the parent thread instead. When such a subagent needs an
   approval or an answer, the parent thread asks for it." (`docs/user/thread-sidebar.md:272`)
9. **Details panel → "Lineage"** (`ThreadRelationshipsControl.tsx`). The right-hand thread
   details card lists related threads in groups:
   - parent ("Parent agent", ↖ icon);
   - active sub-agents, each with **Stop subagent**;
   - workflows, through `ThreadLineageWorkflowRow`: phase rows "running/done/failed/stopped"
     with their own elapsed time, expanding to members;
   - "**Previous agents**", collapsed, with a count and "N failed".

   It also has "Merge back to source conversation" for forks. Lists page 6 at a time, then
   "Show 12 more".
10. **Sidebar.** Sub-agent threads have no row. When a sub-agent is open, the sidebar
    highlights its nearest listed ancestor (`Sidebar.logic.ts:570-588`). The parent's status
    takes the child's request: `pendingSubagentRequest === "approval" | "user_input"` turns the
    parent's row into "approval" or "input" (l.862-866). A thread with live sub-agents moves to
    the collapsed **Working** section, and returns to the top "when it finishes, fails, or needs
    an approval or answer" (`thread-sidebar.md:136-142`). Stop on a thread stops its sub-agents
    too (l.270).
11. **Mobile pill** (`threadSubagents.ts:95-117`, used in `apps/mobile/.../ThreadDetailScreen.tsx:483`)
    shows `2/5` (live of total, read out as "2 of 5 agents working") or `3 done`. It stays
    available until a later turn replaces it. Workflows always stay available.

**`delegate_task` (MCP)** (`orchestratorMcp.ts:166-243`).
- Input: `task`, `title`, `role` (implementation | research | review | design | test |
  general), `target {providerInstanceId, model, options, environmentId}`, `isolation: shared |
  worktree`, `mode: async (default) | wait`, `timeoutMs`, `runtimeMode` and `interactionMode`.
- Result: `taskId`, `childThreadId`, `status`, `workState`, `latestTerminalSummary`,
  `hasPendingQuestion`, `pendingApproval` and `waitTimedOut`.
- The child gets "only the supplied task prompt … Parent conversation history is not copied"
  (`docs/orchestration-v2/orchestrator-mcp-server.md`).

Verdict: steal nearly all of it. T3 is the reference for rows, groups, the "now" line, the child
view and attention routing. Its weak spot is density: the right panel holds lineage, side chats,
workflows, PRs and servers all together.

### 1.2 Claude Code (CLI, Desktop, agent view): the source of Banda's richest data

**Sub-agents in the session.**
- The main thread shows a **collapsed one-line summary** per Agent call, e.g.
  `Done (10 tool uses · 45.6k tokens · 2m 2s)` (issue #66646).
- Regression report #66646: between 2.1.161 and 2.1.170 neither the brief nor the result could
  be expanded. A 15,587-character plan the user had to choose from was never shown. This is a
  lesson: the brief and the result must always be one click away.
- Issue #53867: collapsed sub-agent panels in the Code UI ran their loop **5–10x slower** until
  the user expanded them. A UI must never throttle the work it shows.

**Agent panel (agent teams)**
([code.claude.com/docs/en/agent-teams](https://code.claude.com/docs/en/agent-teams)).
- Teammates and sub-agents are listed "in the agent panel below the prompt input".
- Keys:
  - ↑/↓ select;
  - Enter opens the teammate's transcript, and you type to message it;
  - Esc clears the selection, or interrupts the viewed teammate's turn;
  - `x` stops;
  - Ctrl+T toggles the task list.
- **Idle rows hide 30 s after the whole panel goes idle.** More than three idle teammates
  collapse into one row, for example `2 idle agents`. Working, failed and currently viewed
  teammates always keep their own rows.
- Split-pane mode puts each teammate in its own tmux or iTerm2 pane.
- Teammate permission prompts surface in the lead session.
- When a teammate finishes, "it automatically notifies the lead and includes its final answer".

**Dynamic workflows** ([code.claude.com/docs/en/workflows](https://code.claude.com/docs/en/workflows)).
- **The script** uses `agent()`, `parallel()`, `pipeline()` and `phase(title)`. It groups agents
  under a title in the progress view, and `log()` shows a message above the phases.
- **Approval before the run.** The prompt lists the planned phases, with the choices
  "Yes, run it / Yes, and don't ask again for ‹name› in ‹path› / View raw script / No".
  Ctrl+G opens the script in an editor.
  - In Desktop: "an approval card shows the workflow name, the phase list, and a token-usage
    caution, with **Once**, **Always**, and **Deny** actions. The progress view appears in the
    Background tasks side pane."
- **Live:** "a one-line progress summary appears [in the task panel below the input box] while
  the run is going". ↓ focuses it and Enter expands it.
  - A **`Large workflow` warning** appears on that line when a run schedules more than 25
    agents or projects more than 1.5M tokens.
  - While waiting on a usage limit, the line and the header show when the limit resets.
- **`/workflows` progress view.**
  - "each phase with its agent counts". Drilling in shows the agents of a phase, then one
    agent's detail: its prompt, its recent tool calls (each with its state) and its result,
    plus the agent's own task list.
  - Keys: ↑/↓, Enter/→ drill in, Esc/← back, `f` filter by status, `p` pause/resume,
    `x` stop the agent or the whole run, `r` restart an agent, `s` save the script as a command.
  - "The `/workflows` view shows each agent's token usage as the run progresses."
  - A stalled agent restarts automatically. Its name gets `(retry 1)` and its detail says
    `attempt 2 (stalled)`.
- **Limits:** 16 concurrent agents by default, 1,000 per run, 4,096 items per `parallel()`.
- **Results:** "you get one report at the end instead of a turn-by-turn transcript".

**Agent view (`claude agents`)**
([code.claude.com/docs/en/agent-view](https://code.claude.com/docs/en/agent-view)).
- One screen for many **sessions**, with groups `Pinned`, `Ready for review`, `Needs input`,
  `Working` and `Completed`.
- Each row shows an icon, a name, the latest status or question, an age, and a PR label
  `#1234` coloured by checks.
- Icons:
  - Working: animated `✽`;
  - Needs input: yellow;
  - Idle: dimmed;
  - Completed: green;
  - Failed: red;
  - Stopped: grey;
  - `∙` means the process exited and a reply restarts it.
- Space opens a **peek panel** that shows "waiting 3m". You can type a reply there and `/stop`.
- The footer of a normal session shows `← 2 agents` while sessions wait on you, and
  `← 2 done` after they finish.
- **"Subagents and teammates a session spawns aren't listed as separate rows."**
  Tab on an empty input browses all sub-agents.

Verdict: the data source to model on. Two UI ideas are worth borrowing: the phases-then-agents
drill-down with single-letter actions, and hiding and collapsing idle agents. Do not copy the
collapsed-line-only rendering.

### 1.3 Codex (CLI, IDE, app)

[learn.chatgpt.com/docs/agent-configuration/subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)

- **CLI:** `/subagents` inspects running agent threads and switches between them. "Approval
  requests can come from inactive agent threads. The approval overlay shows the source thread
  label, and pressing `o` opens that thread."
- **IDE:** "active subagents appear above the composer. Expanding the panel shows status and
  lets you stop all active subagents or open a thread."
- **Desktop app:** a read-only "Subagents" view with **Active** and **Done** lists. Selecting a
  done agent shows its details and result. The empty state reads "No active subagents".
- Results: "Subagents return summaries rather than raw intermediate output". Codex waits for
  all of them, then gives a consolidated answer.
- The Codex app (Feb 2026, macOS) has threads per project, a worktree per task, and a review
  pane. These details come from secondary sources, because openai.com returned 403.

Verdict: steal the approval-with-source-label pattern and the one-key jump to the asking agent.

### 1.4 OpenCode: child sessions you step into

Sources: [opencode.ai/docs/agents](https://opencode.ai/docs/agents/) and
`anomalyco/opencode@dev` source.

- Sub-agents run "with fresh context in foreground or background child sessions".
  `hidden: true` keeps internal agents out of the lists. `color` gives an agent its UI colour.
- **Family navigation keys:** `session_child_first` (default `<leader>+Down`) enters the first
  child, `session_child_cycle` (Right) moves to the next sibling, and `session_parent` (Up)
  goes back. Only Leader+Down is on the current official page; the rest come from older docs
  and secondary sources.
- **Desktop/web (source):**
  - **Timeline row per child.** A subagent tool row shows the agent name as title (e.g.
    "Explore") and the task description as subtitle (e.g. "Map the timeline grouping rules").
    A running row shimmers (`TextShimmer`). Story file
    `packages/session-ui/src/tools/subagent-row-variants.stories.tsx`: "Design alternatives
    for child-Session rows without the old agent square". They removed the coloured agent
    square.
  - **Background activity strip:** a setting "Show running subagents and shells above the
    composer", which can sit left, centre, right or be hidden. The summary reads
    `{{n}} subagents · {{n}} shells`, with sections "Subagents" and "Shells", and the action
    "Interrupt subagent" (`packages/app/src/runtime/i18n/en.ts:658-679, 995-1000`).
  - **Child composer slot = `SubagentBar`** (`packages/app/src/session/composer/subagent-bar.tsx`).
    The comment explains: "A subagent session takes no prompts, so its composer slot is one
    quiet status line … the run's state and duration, the agent, model and variant, and the
    way back." Its contents:
    - a status glyph: spinner, check, circle-x or outline-x;
    - `Running · 1m 12s · Explore · anthropic / sonnet`;
    - a ghost button "**Main session** [esc]".
    - The timeline fades out under it.
  - **Timeline density presets:**
    - Everything;
    - Detailed: "Show subagents separately and group other activity";
    - Compact: "Show subagents separately. Group other activity with details collapsed";
    - Quiet: "Show subagents separately and group edits. Hide other activity";
    - Messages only.

    Sub-agents stay visible as their own rows in every preset except Messages only.
- **TUI:** a composer "Subagents" tab lists the session family. Ctrl+A switches between active
  and inactive. There is "interrupt", and Enter navigates. The empty state reads
  "No active subagents" (`packages/tui/src/routes/session/composer/subagents-tab.tsx`).

Verdict: steal the child status bar, the background strip, and the rule that sub-agents stay
visible in every density.

### 1.5 Cursor (2.0 to 3.x)

- **2.0** (Oct 2025, [changelog](https://cursor.com/changelog/2-0)): "a sidebar for your agents
  and plans". "Run up to eight agents in parallel on a single prompt", each "in its own
  isolated copy of your codebase" (a worktree or a remote machine).
- **2.4** (Jan 2026, [changelog](https://cursor.com/changelog/2-4)): sub-agents "run in parallel,
  use their own context". The defaults cover codebase research, terminal and parallel streams.
  The docs say only that "The subagent task card shows which model ran"
  ([docs/subagents](https://cursor.com/docs/subagents)). Background sub-agents write output to
  `~/.cursor/subagents/`, and the parent reads those files to check progress.
- **2.5:** async sub-agents can spawn their own sub-agents, one level deep. Forum feedback
  ([thread](https://forum.cursor.com/t/cursor-2-5-async-subagents/152125)):
  - "asking a question seems to cancel all running subagents";
  - users "don't know what happens under the hood";
  - "the parent agent didn't verify the subagents' work".
- **3.0** (Apr 2026, [changelog](https://cursor.com/changelog/3-0),
  [blog](https://cursor.com/blog/cursor-3)): the **Agents Window**, a full-screen workspace
  where "All local and cloud agents appear in the sidebar". That includes agents started from
  mobile, web, Slack, GitHub and Linear.
  - Agents can be handed off between local and cloud.
  - `/in-cloud` hands a task to a cloud sub-agent, and `/autopilot` does the same for a PR.
  - `/best-of-n` "runs the same task in parallel across multiple models, each in its own
    isolated worktree".
  - A diffs view lets you stage, commit and manage PRs.
- **3.1** ([changelog](https://cursor.com/changelog/3-1)): **tiled layout**. "Split your current
  view into panes to run and manage several agents in parallel", you can "drag agents into
  tiles", and you can expand a pane to focus one conversation. The layout persists.
- Criticism (dev.to, secondary): parallel agents cost about 3x, and "six agents with two
  duplicating work" is easy to end up with. "A UX pattern, not a free productivity win."

Verdict: tiling agents is right for Banda, which already tiles Panes. Opaque sub-agent cards are
the thing to avoid.

### 1.6 Amp (Sourcegraph)

[ampcode.com/docs/models-and-subagents](https://ampcode.com/docs/models-and-subagents),
[ampcode.com/docs/threads](https://ampcode.com/docs/threads)

- Named sub-agents: **Task** ("end to end and reports back", can edit), **Read Thread**, and the
  plugins **Oracle** (advises, never edits), **Librarian** (clones outside repos into /tmp) and
  **Finder**.
- "You can't guide subagents directly." The main agent "receives only the subagent's final
  summary".
- A follow-up task to an existing sub-agent "appears as its own subagent step in the thread".
  If the sub-agent is still running, the new task arrives as steering.
- Child threads (Agent to Agent): archiving a parent offers "**Archive N Threads**". Archiving a
  parent alone leaves its children, which "move to the top level of the sidebar".
- The sidebar groups threads by project. "Inactive Last 72h" is collapsed.
- Cost is "what the thread has cost so far", shown in the More Actions menu.
- Commits carry an `Amp-Thread-ID` trailer.
- The docs do not describe how the sub-agent step is drawn.

Verdict: steal named, role-typed helpers (Oracle and Librarian read as characters) and the
commit-to-thread trailer. Avoid children falling to the top level when their parent is
archived.

### 1.7 Zed

- Sub-agents arrived in Mar 2026 (0.227) through a `spawn_agent` tool.
- PR #46188 "Render subagents in thread" draws a **collapsed card with label and chevron,
  styled like terminal tool calls**, with expand and collapse.
- PR #50478 "Show full subagent output if no concurrent tool calls": a lone sub-agent shows in
  full, and concurrent ones stay as cards.
- ACP meta key `subagent_session_info {session_id, message_start_index, …}` links a tool call
  to the child session.
- **Parallel Agents** (Apr 2026, [blog](https://zed.dev/blog/parallel-agents)): a **Threads
  Sidebar** docked left next to the Agent Panel. Threads are "grouped by project", with quick
  stop, archive and new. "Isolate worktrees, when you want to, and decide per thread."
- **Terminal Threads** (May 2026): a `claude`/`codex` terminal becomes "a managed thread in your
  sidebar".

Verdict: the "full when alone, card when concurrent" rule is worth stealing.

### 1.8 Conductor (parallel Claude Code/Codex in workspaces)

[conductor.build/docs](https://www.conductor.build/docs/)

- "Each task gets its own workspace, branch, files, terminal, diff, and review path."
- Flow: ⌘⇧N new workspace (from a branch, PR, GitHub or Linear issue) → chat → Run → ⌘⇧D
  **Diff Viewer**. Inline comments there "become composer attachments you can send back to the
  agent".
- A **Checks tab** covers git status, CI, deployments, comments and todos. ⌘⇧P opens a PR.
- Archive "to keep the sidebar focused", and restore from the History pane.
- Several agents can share one workspace and branch.
- The docs do not describe sidebar status icons.

Verdict: steal the comments-in-diff that go back to the agent, and the per-workspace review
path. It is a model for worktree children.

### 1.9 Warp

[docs.warp.dev/agents/using-agents/managing-agents](https://docs.warp.dev/agents/using-agents/managing-agents)

- The **Agent Management Panel** lists local conversations and cloud runs, with Personal and
  All tabs. Filters cover source, day, creator and status.
- Statuses: **Working**, **Blocked** ("waiting on user input or a required step"),
  **Failed/Errored**, **Success**, **Canceled**.
- **Orchestration pill bar:** "An orchestration pill bar appears above the agent view header,
  with one pill per child showing a live status badge. Clicking a child pill switches the pane
  to that child. Clicking the parent pill, or the breadcrumb shown while viewing a child,
  returns you to the parent."
- "Local children don't appear as separate rows in the Agent Management Panel list." Cloud
  children do appear as rows. In the Oz web app they are grouped under the parent, on a
  **Sub-agents** tab.
- Caveat: **"The parent's own status reflects only its work."** You have to check each child.

Verdict: steal the pill bar plus breadcrumb. Avoid the parent status that ignores children.

### 1.10 GitHub Copilot: Agent HQ / Mission Control

[docs.github.com/.../manage-agents](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/manage-agents)

- An **agents panel** "from any page on GitHub", plus github.com/copilot ("Pick up where you
  left off", View all). The repo has an "Agents" tab.
- A session view shows the log and an overview, with **"progress, token usage, and session
  length"**. A steering box sits below the log, and a message "applies after its current tool
  call finishes". **Stop session**. Archive (sessions cannot be deleted). Commits link to the
  session log.
- Agent HQ (Oct 2025 to Feb 2026, press): one issue can be assigned to Copilot, Claude, Codex,
  or several of them to compare. Steering is not available for third-party agents.

Verdict: borrow steering that queues until the current tool call ends, and the commit to
session link. Mission Control is a list of sessions, not of sub-agents.

### 1.11 VS Code agents

[code.visualstudio.com/docs/copilot/agents/overview](https://code.visualstudio.com/docs/copilot/agents/overview)

- Chat view for the current workspace, plus an **Agents window** "across projects". Session
  types are local, cloud and cloud automations.
- Claude and Codex are selectable harnesses.
- Sessions continue between Chat and the Agents window, and across clients.
- "A Git worktree keeps changes separate but isn't a security boundary."
- The docs do not describe how sub-agents are rendered.

### 1.12 Devin: managed Devins

[docs.devin.ai/.../advanced-capabilities](https://docs.devin.ai/work-with-devin/advanced-capabilities),
[blog](https://cognition.com/blog/devin-can-now-manage-devins)

- A coordinator session splits work across child Devins, each in its own VM.
- It can track ACUs per child, send follow-ups, put children to sleep or terminate them, and
  "is woken automatically" when they finish.
- **Approval of the proposed batch** is possible by turning off "Auto-approve child sessions".
- "Each managed Devin has its own session link, so you can inspect its work or message it
  directly."
- Children often open one PR each ("Open a separate PR for each").
- The docs describe no visual layout.

Verdict: take the per-child compute meter and approving a batch of children (not each one).

### 1.13 Google Jules, Antigravity, Gemini CLI

- **Jules** (secondary sources): a left task bar with parallel tasks. The plan is shown before
  coding, and plans can auto-approve. A mini-diff expands to a full diff. A PR comes at the
  end.
- **Antigravity**:
  - The original **Agent Manager**, "mission control for spawning, orchestrating, and
    observing multiple agents across multiple workspaces in parallel" (Google, via the
    codelab and press).
  - An **Inbox** of agent messages across workspaces. In secondary sources, a blue dot means a
    step is done and a bell means review is needed.
  - Artifacts include a Task List, Implementation Plan (with Proceed), Walkthrough,
    screenshots and browser recordings. They are reviewable and commentable in an
    **Auxiliary Pane**.
  - 2.0 (codelab): projects in a left nav with conversations under them.
- **Gemini CLI**
  ([geminicli.com/docs/core/subagents](https://geminicli.com/docs/core/subagents/)):
  `@codebase_investigator` etc. at the start of a prompt "injects a system note that nudges the
  primary model". Sub-agents "**cannot** call other subagents". The docs do not describe the
  display.

Verdict: from Antigravity, take artifacts as review objects (plan, walkthrough, recordings) and
an inbox that crosses workspaces. Banda's sidebar already plays the inbox role (ADR 0098).

### 1.14 Factory: Missions / Mission Control

[docs.factory.com/missions/running-app](https://docs.factory.com/missions/running-app.md)

- A **top bar**: overall elapsed time and **credits used**.
- A **left sidebar**: "all active and completed workers". Selecting one opens its terminal
  output, reasoning and finished sub-tasks.
- A **main view**: the active **milestone**. You can drill into a feature to see its
  **validation criteria and commits**.
- A **right sidebar**: a live progress log, plus **model dropdowns for Orchestrator, Worker and
  Validator**.
- "Intervene & Redirect": pause the orchestrator, ask it to re-plan, resume.
- "Mission Control tab lists past missions and their state". A mission can run on a remote
  "Droid Computer".

Verdict: borrow role-based model choice (orchestrator, worker, validator), validation criteria
per unit, and pause and re-plan. The three-column dashboard is heavy for a chat-first app.

### 1.15 Roo Code / Kilo: Orchestrator (Boomerang)

[roocodeinc.github.io/Roo-Code/features/boomerang-tasks](https://roocodeinc.github.io/Roo-Code/features/boomerang-tasks)

- The parent "pauses, and the new subtask begins in a different, specialized mode".
- **"By default, you must approve the creation and completion of each subtask."**
- "Only this summary returns to the parent" (`attempt_completion.result`).
- Roo's own blog title: "Boomerang Task Orchestration Hides Context, and That Confuses Users".
- A GitHub issue asks for "a visible, reliable control to return to the parent task".
  Navigation was one-way (secondary).

Verdict: avoid per-sub-task approvals and one-way navigation.

### 1.16 Graph and trace views: LangGraph Studio, Langfuse, CrewAI, swarm dashboards

- **LangGraph Studio** ([docs](https://docs.langchain.com/langsmith/use-studio)):
  - Graph mode against Chat mode. A thread dropdown, Interrupt before or after a node, then
    Continue.
  - **"Edit node state" then Fork**, and **"Re-run from here"**.
  - A detail slider. Pretty and JSON views.
- **Langfuse agent graph** ([docs](https://langfuse.com/docs/observability/features/agent-graphs)):
  - A Graph tab beside Tree and Timeline.
  - Aggregated mode folds repeats into `retrieve_docs (3/3)` and draws loops as cycles.
  - Expanded mode unrolls every call into a DAG, which "naturally produce[s] more nodes".
- **CrewAI AMP traces:** an **execution timeline** showing "when each task started and ended,
  helping you identify bottlenecks or parallel execution patterns". It also lists tasks and
  agents with status, timing and estimated cost.
- **Swarm dashboards** (disler's claude-code-hooks multi-agent observability and similar,
  secondary): hook events streamed into a web dashboard with **one swim lane per agent**, an
  event timeline and tool-use charts.
- **Vibe Kanban** (now sunsetting, community maintained): a To Do → In Progress → Review → Done
  board, a worktree per card, review and merge in one UI.

Verdict:
- Graphs suit debugging a fixed pipeline, not glancing at agents doing work. A
  **timeline/Gantt strip** (CrewAI, swim lanes) is the one graph-like view that reads at a
  glance for parallel work. Use it inside a workflow's detail, not as the main view.
- A kanban of agents is too heavy. Banda's sidebar sections already work like columns.

---

## 2. Comparison grid

| Product | Where children live | Status shown as | Nesting | Person steps in | Results back | Attention | Cost |
|---|---|---|---|---|---|---|---|
| T3 Code | row per child in parent chat; group row; Lineage panel; no sidebar rows | avatar + status dot; word; ticking elapsed; `3 working · 2 done` | parent ↔ child threads; workflow → phases → agents | open child; Stop subagent; stop parent stops all; answer child approvals in parent | notification row "Finished"; wakes parent | "Subagent waiting" line + Open approval; parent sidebar row takes child request | tokens per workflow agent in data; not prominent |
| Claude Code | one-line in transcript; agent panel under input; task panel; `/workflows`; Desktop Background tasks pane | animated/yellow/dim/green/red/grey; counts per phase | lead → teammates; workflow → phase → agent | ↑↓ Enter to view & message; x stop; p pause; r restart | final report; teammate idle note with answer | prompts in lead; footer `← 2 agents` | tokens per agent; Large workflow warning |
| Codex | `/subagents`; IDE above composer; app Active/Done | Active / Done | parent → agents | open thread; stop all (IDE) | consolidated summary | approval overlay names source thread, `o` opens | n/d |
| OpenCode | timeline row; activity strip above composer; Subagents tab | spinner/check/x; Running/Done/Failed/Interrupted | session family | step in (Leader+Down), Esc back; interrupt | summary to parent | n/d | n/d |
| Cursor 3 | Agents Window sidebar; tiles; sub-agent task card | n/d (docs) | 2 levels | tile, drag, focus; cloud ↔ local | final message | n/d | Max-mode spend |
| Warp | management panel; pill bar per child | Working/Blocked/Failed/Success/Canceled | parent → children (local in pills, cloud as rows) | click pill; breadcrumb back | n/d | Blocked | credits page |
| Factory | Mission Control: workers / milestone / log | per worker, per milestone | orchestrator → workers → validators | pause, re-plan, resume | validation per feature | n/d | credits in top bar |
| Devin | child sessions | n/d | coordinator → children | message, sleep, terminate | PR per child; coordinator compiles | coordinator woken | ACU per child |
| Amp | sub-agent step in thread; child threads in sidebar | n/d | main → Task/Oracle/Librarian | can't guide sub-agents | final summary only | n/d | thread cost in menu |
| Roo | task hierarchy | n/d | orchestrator → subtasks | approve each create/complete | summary only | approvals | n/d |

(n/d = not described in primary sources.)

---

## 3. The patterns worth taking (best first)

Each pattern lists what the Person sees, then the data it needs.

1. **One delegation row per child in the parent Thread.** (T3, OpenCode, Zed, Cursor)
   - **Sees:**
     - the Harness logo in a small round avatar, with a status dot;
     - the title (a short task name, not the prompt);
     - one live line: progress while running, the result's first line when done;
     - a status word only when it is not plainly "done", and elapsed time;
     - a chevron. Clicking opens the child.
   - **Hover:** model and effort, branch or worktree *only if different*, and a
     280-character preview.
   - **Data:** `task_started{task_id, tool_use_id, description, subagent_type, parent_task_id,
     spawn_depth}`, `task_progress{summary, last_tool_name, usage}`,
     `task_notification{status, summary, usage}`.

2. **A fan-out collapses into one group row.** (T3, Claude teammates)
   - **Sees:** up to 3 stacked avatars and `+N`; `5 sub-agents`; `3 working · 1 done ·
     1 failed`; group elapsed time; a chevron.
   - It is bright while live and dims to about 55% once settled. Expanded, it shows the member
     rows in a thin card.
   - The copy changes tense: "Kicked off" while live, "Ran" afterwards.

3. **A live "now" strip by the composer.** Four products converged on this: Claude task panel,
   OpenCode Background activity, Codex IDE, T3 ThreadNow.
   - **Sees:** one quiet line, `Running · Explore auth module · 1m 12s`, or with many agents
     `3 sub-agents · 1 shell`, plus the newest progress `Reviewer: reading routes.ts`.
   - Actions: Open, Stop.
   - It expands into a short list. It survives scrolling up, while the delegation row stays
     where it happened.

4. **Attention routed to the parent, naming the child.** (T3, Codex, Claude teams)
   - A child's question or approval appears in the parent:
     - in the parent's composer area as "Approval needed from ‹child›", with the command and
       Allow/Deny;
     - as a line "Sub-agent waiting · ‹child›" with "Open question".
   - Codex's overlay label plus `o` to jump.
   - In the sidebar, the parent's card goes to Your turn and line 3 names the child. ADR 0098
     #24 already moves a Banda child Thread itself to Your turn.
   - Never require opening the child to approve.

5. **The child view reuses the Thread view. The composer becomes a status bar.**
   (T3 ProviderSubagentBar, OpenCode SubagentBar)
   - **Sees:** the child's full transcript.
   - In the composer slot:
     `◌ Running · 1m 12s · Explore · Sonnet 4.6 · Runs on its own · [↖ Parent  Esc]`.
   - When the Harness allows talking to a child (Claude teammates, Codex `send_input`, Banda
     MCP children), the composer is real and the bar becomes a header.
   - Say plainly when a child cannot take messages.

6. **Family navigation with keys and a breadcrumb or pill bar.** (OpenCode, Warp, Claude)
   - Pills above the Thread header, one per child with a live badge, plus the parent pill.
   - Keys: parent ↑, first child ↓, siblings ←/→, Esc back.
   - Banda can bind these in keys.toml and show the pills in the Pane header.

7. **A workflow as a phases × agents board.** (Claude `/workflows`, T3, Factory)
   - **Sees:**
     - header: the workflow name and description, then `24 agents · 6 working · 18 done`, a
       token total, elapsed time, and Pause/Stop;
     - **phase sections**, each with a title and `settled/total`, showing running, done,
       failed or not started;
     - agent rows (status dot, label, one line, elapsed, tokens);
     - drilling into an agent shows its prompt, recent tool calls with their states, and its
       result. The agent can be restarted or stopped.
   - The script is folded under a fade with "Show full script". A `log()` message goes above
     the phases.
   - Filter by status. Save as a command.
   - Retries show as `(retry 1)` / `attempt 2 (stalled)`. A usage-limit wait shows its reset
     time.
   - This belongs in a **Pane** (tileable, poppable). The parent Thread holds only a compact
     card linking to it.

8. **Approve the plan once, before the fan-out.** (Claude workflow card, Devin batch approval)
   - **Sees:** a card with the workflow name, the list of phases, an agent and token estimate
     plus a caution, and **Once / Always / Deny**, with View script.
   - Never ask per sub-agent. Roo shows what happens when you do.

9. **A small, fixed status vocabulary with consistent colour.** (Claude agent view, Warp, T3)
   - Use six or seven states:
     - Queued;
     - Working (animated);
     - Needs you (yellow/amber);
     - Idle · can resume (dim);
     - Done (green);
     - Failed (red);
     - Stopped (grey).
   - Use the same glyph everywhere: row, pill, satellite and sidebar line.

10. **Hide the idle, fold the many.** (Claude agent panel, T3 Previous agents, Amp Inactive
    72h, Claude agent view `… 6 more`)
    - Idle and settled children leave live views after a pause. More than 3 idle children
      fold into `N idle agents`. Settled agents go into a collapsed "Previous agents".
      Working, failed and viewed children always keep their own row.

11. **A count pill: `2/5` live of total, or `5 done`.** (T3 mobile, Warp pills, ADR 0099
    satellites)
    - It goes in the Thread or Pane header and on the sidebar card's line 2, e.g.
      "3 sub-agents at work", which ADR 0098 already has.
    - Banda's Mark already shows up to 3 satellites.

12. **Results come back as an event that wakes the parent.** (T3 notification row and
    "Completion wakes this thread", Devin coordinator woken, Claude teammate idle note)
    - **Sees:** a row "↩ Reviewer finished · 14:02". It is the same link as the delegation
      row and shows the result's first line.
    - The brief and the full result are **always** one click away. Claude #66646 shows what
      happens when they are not.

13. **Cost made visible without nagging.** (Claude per-agent tokens and Large workflow
    warning, Factory credits, Devin ACU per child, GitHub token usage plus session length,
    Amp cost in menu)
    - Tokens per agent in detail views. A run total on the workflow card.
    - One amber warning when a run passes N agents or M tokens.
    - Banda's usage limits (ADR 0043) can show "this run used 18% of your 5-hour window".

14. **Isolation is a badge, and merging is an explicit step.** (T3 branch or worktree on
    hover when different, Conductor workspace = branch + diff + checks, Cursor best-of-n,
    T3 "Merge back")
    - A child in its own worktree shows a branch chip. Its result card offers **Review
      diff**, **Merge into parent**, **Open PR** or **Discard**.
    - Diff comments go back to that child (Conductor).

15. **Stop cascades, and per-child stop exists.** (T3, Claude `x`)
    - Stop on the parent stops its children, and the UI says so.
    - Each child row and pill has its own Stop.

16. **The detail view always shows the brief and recent tool calls, and is lazy.**
    (Claude /workflows agent detail, T3 NativeChildWorkDialog "Loads only while open")
    - Render and subscribe only when open.
    - Never let a collapsed view slow the agent (Claude #53867).

Smaller ideas:
- Show a sub-agent's output in full when it is the only one (Zed #50478).
- Name helpers as characters (Amp Oracle, Librarian).
- Put a commit trailer that links back to the Thread (`Amp-Thread-ID`).
- Steering queued until the current tool call ends (GitHub).
- Role-based models for orchestrator, worker and validator (Factory).
- A timeline/Gantt strip per workflow run (CrewAI, swim lanes).

---

## 4. Anti-patterns

1. **Opaque delegation.** Only "Done (10 tool uses · 45.6k tokens · 2m 2s)", with no brief and
   no result. Claude #66646, Cursor users who "don't know what happens under the hood", and
   Roo's "hides context, and that confuses users".
2. **Walls of nested logs.** Streaming every child's tool calls into the parent transcript.
   Every product that does it well shows **one line per child** and a link. Zed only shows
   everything when there is a single child.
3. **Children as first-class rows in the main list.** It floods the inbox and breaks "whose
   turn is it". Warp and Claude agent view both refuse local children as rows, and T3 hides
   them. Amp's archive leaves orphans at the top level.
4. **A parent status that ignores children.** Warp: "The parent's own status reflects only its
   work." A parent must look busy, or "waiting on N sub-agents", while children work.
5. **Approvals per sub-task**, and permission prompts that bubble up with no source.
   Roo makes you approve every create and complete. Claude's teams docs list "Too many
   permission prompts". Always name the asker.
6. **Navigation that only goes one way.** You can enter a child but not get back (Roo). Back
   must be one key and one button, always visible.
7. **Fake chat on read-only children.** A composer that silently does nothing. Say "Runs on its
   own · message the parent" (T3, OpenCode).
8. **Questions that kill workers** (Cursor 2.5: "asking a question seems to cancel all running
   subagents"). Asking the Person must not cancel siblings.
9. **Graph canvases as the main view.** Expanded DAGs blow up in size (Langfuse). Graphs are for
   debugging, not for glancing.
10. **Heavy dashboards for small fan-outs.** A three-column Mission Control for 3 helpers. Scale
    the surface to the work: a row for 1 child, a group row for 2–10, a Pane board for a
    workflow.
11. **Spend nobody sees.** Spawning is frictionless and spend multiplies (Cursor 3, about 3x).
    No total, no warning.
12. **Ticking everything.** Many live timers and spinners in lists. Banda's sidebar rule is
    "Nothing ticks" (ADR 0098). Keep ticking to the open Thread's live strip and the board.
13. **A UI that throttles the work it shows** (Claude #53867). Rendering must be decoupled
    from execution.
14. **Kanban of agents** (Vibe Kanban, now sunsetting). The ceremony is too heavy for agent
    work. Banda's sidebar sections already work like columns.

---

## 5. What this means for Banda

- **Already decided:**
  - ADR 0098 #23: "A Harness's sub-agents have no cards". Their Agent's Mark shows them and
    line 2 counts them, e.g. "3 sub-agents at work".
  - ADR 0098 #24: a Thread another Agent started through Banda (ADR 0019 MCP) is a **child**.
    It sits under its parent with ↳ in Working, and goes to Your turn itself when it asks or
    fails, with line 3 "↳ ‹parent›".
  - ADR 0099 #3: "Sub-agents are satellites" around the Mark, up to three.
  - `ListedThread.subagents` is a count.
  - The landscape agrees with all of this.
- **Open inside the Thread** (where Banda has nothing yet; Banda's adapters only persist
  sub-agent transcripts, in `platform/harnesses/adapters/src/sessions.ts`):
  1. a delegation row and a fan-out group row in the Thread Pane (patterns 1–2);
  2. a live strip above the composer (pattern 3);
  3. attention routing with the asker's name (pattern 4);
  4. a child view in the same Thread Pane, with the composer → status bar and Parent/Esc
     (patterns 5–6);
  5. a **Workflow Pane**: phases × agents, opened from a compact card in the Thread and placed
     in the Thread's **Group**, as MCP-opened Panes already are (pattern 7);
  6. approve-once card (pattern 8), status vocabulary (pattern 9), cost (pattern 13).
- **Banda's advantage:** tiling. Cursor 3.1 had to *add* tiles, and Claude needs tmux for split
  panes. In Banda, "open child beside parent" and "pop the workflow board out" come free as
  Panes in the Thread's Group. Keep it optional: the default is still one Thread view with
  rows.
- **Two kinds of child, one look.** Harness-native sub-agents (Claude Task/Agent, Codex
  spawn_agent, Claude workflows) are read-only and run on their own. Banda children (Threads
  started through MCP) are full Threads that take messages. Use the same row, pill and status
  vocabulary for both. Only the composer differs, as in T3 with `origin: provider_native |
  app_owned`.
- **Ids to carry end to end:**
  - `task_id` (stable across resumes) and `run_id` (per run);
  - `tool_use_id` (links the row to the Agent tool call);
  - `parent_task_id` and `spawn_depth` (nesting);
  - `task_type` (`local_agent` / `local_bash` / `local_workflow` / `mcp_task`) and
    `workflow_name`;
  - for workflows: per-agent `index`, `phaseIndex`, `phaseTitle`, `attempt` and
    `agentId`/child transcript;
  - for Banda children: `child Thread id` and `parent Thread id`.

---

## 6. Sources

Local:
- T3 Code (github.com/pingdotgg/t3code) @ `337c5858`. Files cited inline:
  `packages/contracts/src/orchestrationV2.ts`, `packages/contracts/src/orchestratorMcp.ts`,
  `packages/client-runtime/src/state/{subagentDisplay,threadSubagents,subagentRuntime}.ts`,
  `apps/server/src/orchestration-v2/Adapters/claudeWorkflowProgress.ts`,
  `apps/web/src/components/chat/{V2LifecycleRow,TimelineV2EventRow,WorkflowOpeningBlock,ThreadLineageWorkflowRow,ThreadRelationshipsControl,SubagentTooltipContent,ProviderSubagentBar,ChildThreadApprovals,NativeChildWorkDialog,ThreadNow,ThreadActivityBanners}.tsx`,
  `apps/web/src/components/Sidebar.logic.ts`, `docs/user/thread-sidebar.md`,
  `docs/orchestration-v2/orchestrator-mcp-server.md`.
- Claude Agent SDK 0.3.312 `sdk.d.ts:6304-6420` (task_started, task_progress, task_notification).
- Banda `docs/adr/0098-*.md` (#23–24), `docs/adr/0099-*.md` (#3, `subagents` field), `GLOSSARY.md` (Mark).

Web (primary unless noted):
- Claude Code: https://code.claude.com/docs/en/workflows, https://code.claude.com/docs/en/agent-teams, https://code.claude.com/docs/en/agent-view, issues https://github.com/anthropics/claude-code/issues/66646 and /53867
- Codex: https://learn.chatgpt.com/docs/agent-configuration/subagents
- OpenCode: https://opencode.ai/docs/agents/ ; source github.com/anomalyco/opencode (dev): `packages/app/src/session/composer/subagent-bar.tsx`, `packages/tui/src/routes/session/composer/subagents-tab.tsx`, `packages/session-ui/src/tools/subagent-row-variants.stories.tsx`, `packages/app/src/runtime/i18n/en.ts`
- Cursor: https://cursor.com/changelog/2-0, /2-4, /3-0, /3-1, https://cursor.com/blog/cursor-3, https://cursor.com/docs/subagents, https://cursor.com/docs/agent/agents-window, forum https://forum.cursor.com/t/cursor-2-5-async-subagents/152125, dev.to review (secondary) https://dev.to/gabrielanhaia/cursor-3-glass-replaced-composer-with-an-agents-window-1pcg
- Amp: https://ampcode.com/docs/models-and-subagents, https://ampcode.com/docs/threads
- Zed: https://zed.dev/blog/parallel-agents, PRs github.com/zed-industries/zed/pull/46188 and /50478
- Conductor: https://www.conductor.build/docs/, /docs/concepts/workflow, /docs/concepts/parallel-agents
- Warp: https://docs.warp.dev/agents/using-agents/managing-agents
- GitHub: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/manage-agents ; Agent HQ press (secondary)
- VS Code: https://code.visualstudio.com/docs/copilot/agents/overview
- Devin: https://docs.devin.ai/work-with-devin/advanced-capabilities, https://cognition.com/blog/devin-can-now-manage-devins
- Factory: https://docs.factory.com/missions/running-app.md
- Antigravity: https://codelabs.developers.google.com/getting-started-google-antigravity (+ secondary for Inbox)
- Gemini CLI: https://geminicli.com/docs/core/subagents/
- Roo Code: https://roocodeinc.github.io/Roo-Code/features/boomerang-tasks
- LangGraph Studio: https://docs.langchain.com/langsmith/use-studio ; Langfuse: https://langfuse.com/docs/observability/features/agent-graphs ; CrewAI traces: https://docs.crewai.com/en/enterprise/features/traces (via search)
- Jules, Vibe Kanban, disler observability, Antigravity Inbox: secondary only, marked as such above.
