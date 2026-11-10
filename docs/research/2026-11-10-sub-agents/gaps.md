# Gaps before the sub-agent and workflow mockups

- **Date:** 2026-11-10. This is a completeness check on the research step.
- **What I read:** `claude-code.md`, `codex.md`, `landscape.md`, `banda-arch.md` and `banda-look.md`
  (now [`docs/design/README.md`](../../design/README.md)), plus the kit (`kit.css`, `mark.js`,
  `icons.js`, `demo.html`; now in `docs/design/kit/`).
- **What I looked up to fill gaps:** six targeted checks, all against primary sources. No paid
  session was run.
  1. claude-agent-acp 0.99.1: the held-open turn and steering (`dist/acp-agent.js`).
  2. claude-agent-acp: how the Workflow call and `task_notification` reach a plain client, and
     whether worktree data does (`dist/tool-calls/*`, `dist/native-subagents.js`).
  3. codex-acp 2.5.0: child session ids and per-child token usage (`dist/index.js`).
  4. `code.claude.com/docs/en/workflows.md`: SDK-host behaviour, stop and resume, usage limits,
     cost.
  5. `code.claude.com/docs/en/sub-agents.md`: worktree isolation, permissions, depth, messaging.
  6. `code.claude.com/docs/en/worktrees.md`: where sub-agent worktrees live, their base branch,
     cleanup, and merging.
  I also ran local greps of Banda (`apps/agents/engine/src/{effects.rs,acp/options.rs}` and
  `apps/agents/pane/src/composer/picker.test.ts`).
- **Paths:** `C` = `node_modules/.pnpm/@agentclientprotocol+claude-agent-acp@0.99.1*/…/dist` and
  `X` = `node_modules/.pnpm/@agentclientprotocol+codex-acp@2.5.0_patch_hash=f1188fd*/…/dist/index.js`,
  both under the repo root.

---

## 0. The short version

The five notes cover the products and the protocol well. They leave the designer without
answers in four areas.

1. **One state table.** The notes give four different status sets. Seven real states have no
   Banda word or look yet: queued, retrying, cached, skipped, lost, spawn failed, and done but
   resumable.
2. **What the Person can actually do in Banda.** The notes borrow controls Banda cannot reach
   over ACP: messaging a sub-agent, pause, restart, skip, save, the usage-limit wait, and the
   Claude-made approval card. Section 3 has the control matrix.
3. **Life after the turn.** Several things are only now pinned down:
   - Background sub-agents hold the turn open, but the Person can still talk (the steer
     hand-off).
   - Workflows do not hold the turn, so the Mark goes Done while agents work.
   - If the process exits, the run stops.
   - Worktree changes are never merged back by anyone.
4. **Scale and colour rules.** The notes give no numbers for 1 vs 5 vs 50 vs 500 agents. Three
   borrowed patterns break Banda's colour and "nothing ticks" rules: amber warnings, per-agent
   colours and ticking rows.

---

## 1. Contradictions between the notes

| # | Topic | One note says | Another says | Take |
|---|---|---|---|---|
| 1 | **Where a sub-agent lives** | claude-code §6.1: "a child Thread under its parent in the sidebar … composer reading `Message @name…`" | banda-arch option B: a **lane** of the Thread, no sidebar card. ADR 0098 d23 agrees, and Roma approved it on 2026-11-09 | **Lanes.** Draw no sidebar row per sub-agent. Only Banda child Threads (ADR 0019, `send`) get ↳ cards. |
| 2 | **Messaging a sub-agent** | claude-code §1.8 and §6.1: open the row and type to the agent. landscape p5: "When the Harness allows talking to a child … the composer is real" | banda-arch §2.1 and codex §4.4.6: the RFD lets a client **only cancel** a child, not prompt it. codex-acp throws "Subagent sessions do not permit client-initiated mutations" | **No direct composer in a lane.** Talking goes through the parent (§2.4). The CLI's "type into its transcript" is a CLI feature that ACP does not carry. |
| 3 | **Ticking** | claude-code §6.2: a token counter "that animates". landscape p3 and T3: ticking elapsed time per row | banda-look rule 8: "Nothing ticks". Yet its own live line, "Working for 6m 12s", ticks, and landscape anti-pattern 12 allows ticks "in the open Thread's live strip and the board" | **Needs Roma.** Proposal: **one** ticking clock per surface, namely the Thread's live line and the Crew Pane header. Rows show a static duration, set when the agent ends or refreshed at most once a minute. No live token counters in rows. |
| 4 | **Warning colour** | landscape p13: "One amber warning when a run passes N agents or M tokens" | banda-look rule 2: orange (`--attention`) means asks, and only asks. `--woke` yellow means woke | Show the warning in **fg with a `triangle-alert` icon**, not amber. Colour stays for whose turn it is. |
| 5 | **Status words** | claude-code: running/done/failed/stopped/paused/queued/cached/blocked/skipped. Codex desktop: Waiting/Working/Done/Failed. landscape p9: Queued/Working/Needs you/Idle·can resume/Done/Failed/Stopped | banda-arch `SubagentState`: Running/Asks/Done/Stopped/Failed/Unknown. The sidebar's words are Asks/Done/Failed/Woke | §2.2 gives one table. Banda's words win: **Asks**, not "Needs you" or "Waiting". |
| 6 | **Does a child's failure colour the parent?** | Codex 0.166 (#57315): "A subagent failure ends its work without asking the user to act". landscape p4 bubbles only *needs-you* | ADR 0098 d24: a Banda child **Thread** goes to Your turn when it fails. The kit's per-state satellites draw a red dot | **Asks bubbles, failure does not.** A failed lane shows red only inside the Thread (its tag, and a red satellite if Roma takes the extension). The parent's card keeps its own state. d24 stays as it is for child Threads. Put this to Roma. |
| 7 | **Codex child session id** | codex.md §4.4 step 3: "The child sessionId equals the Codex thread id" | banda-arch §2.3: `<root>:subagent:<thread>` | **banda-arch is right.** Standard mode registers through `SubagentAssociations.sessionId` = `` `${enc(root)}:subagent:${enc(thread)}` `` (X `:35671-35673`, `:36046`). |
| 8 | **Inline workflow boxes** | claude-code §3.4 draws phase boxes in the transcript | claude-code fact check #8: boxes show **only** in verbose/Ctrl+O. By default the transcript shows one line, `● ⠿⠿⠋⠿ · 7/12 agents` | Treat the boxes as a Pane design, not the inline default. The Thread gets one compact card (landscape p7 agrees). |
| 9 | **Usage-limit wait state** | claude-code §3.7 and landscape p7 design "paused · resets 15:00" | docs:workflows, "When a run hits your usage limit": the pause happens only in an interactive claude.ai session. "A run doesn't pause in … the Agent SDK". Banda is an SDK host | **In Banda the affected agents fail.** The Thread's mark already has `doing: limit`. Design a "failed: usage limit" row with "Ask to relaunch after 15:00". No paused-for-limit state. |
| 10 | **"Approve the plan once" card** | landscape p8 and claude-code §3.3: a card with phases, a token projection, and Once/Always/Deny | docs:workflows: in the SDK, Claude's prompt is **never** shown. The Workflow call goes through normal permission evaluation. Banda modes (`acp/options.rs:36-41`): Supervised = `default`, AcceptEdits = `acceptEdits`, Auto = `auto`, FullAccess = `bypassPermissions` | Under **Full access** there is no approval at all, so the first thing the Person sees is a running Crew. Under Supervised and AcceptEdits it is an ordinary ACP permission request for tool "Workflow". Banda must build its own card (§2.3). It has no token projection. |
| 11 | **Workflow controls** | claude-code §3.6 and landscape p7: pause, restart one agent, skip, filter, save | Over ACP only `session/cancel` exists. Workflow agents are **not** RFD children (banda-arch §2.2) | Draw only what Banda can do (§3). Filter is client-side and fine. Save is feasible by copying `scriptPath`. Pause, restart and skip are not possible. |
| 12 | **Agent colours** | claude-code §1.3: frontmatter `color` tints the agent type. OpenCode also has `color` | banda-look rule 2: no colour except state | **Ignore Harness agent colours.** Identity comes from words and a role icon (§2.11). |
| 13 | **The word** | claude-code and the docs: "workflow". banda-arch proposes "Crew" | GLOSSARY: Workflow = ADR 0082 and Task = `task@1`, both taken | Mocks need one placeholder. Proposal: **show the Harness's word in titles** ("Workflow · audit-routes") and keep **Crew** as Banda's internal noun until Roma picks. Ask Roma first. |

---

## 2. Gaps, with what I found

### 2.1 Scale: how 1, 3, 12, 50 and 500 agents look

None of the notes gives thresholds. The numbers from the sources:

| | Claude Agent tool | Claude workflow | Codex V1 (default) | Codex V2 |
|---|---|---|---|---|
| Running at once | 20 (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`). With ultracode on the limit is not enforced | **16 per run**, fewer with fewer CPUs (1–256 via env). Excess calls **queue** | 6 threads | 4 threads including the root, so 3 children |
| Total | n/a | **1,000 agents per run**; 4,096 items per `parallel()`/`pipeline()` | n/a | n/a |
| Size Claude aims for | n/a | `workflowSizeGuideline`: small <5, **medium <10 (default)**, large <50. **Pro defaults to small** | n/a | n/a |
| Warning | n/a | `Large workflow` at >25 agents or >1.5M projected tokens. Not shown with ultracode | n/a | n/a |

Sources: docs:workflows "Behavior and limits", "Cost", "Set a size guideline"; docs:sub-agents
"Concurrent subagent limit"; codex.md §1.2.

**The designer needs to draw these:**

- **Steps by size.** A proposal that extends landscape anti-pattern 10:
  - 1 lane: one row.
  - 2–6 lanes from one message: a group row with up to 3 member rows visible, then "+N".
  - Any workflow: one Crew card in the Thread plus the Crew Pane.
- **Crew card at 50 agents.** The phase strip still fits on one line. Counts read
  `12 working · 30 done · 2 failed · 6 queued`. No agent rows on the card.
- **Crew Pane at 50 and at 500 agents.**
  - Done rows fold into "✓ 38 done" per phase.
  - Running, failed and asking rows always show.
  - **Queued** shows as one count line ("6 waiting for a slot"), not 6 rows.
  - The pane needs a filter (all · working · failed · asks) and a scroll position that survives
    updates.
- **The Mark at 16 running agents.** It shows 3 satellites, the cap. Sidebar line 2 has to say
  how many there really are, e.g. "Workflow audit-routes · 2/3 · 16 at work" (wording to pick).
- **Labels.** Workflow agent `label`s are often paths or test names
  (`src/routes/billing/invoices.ts`). They need a fade from the start of the path, since the
  file name is what matters.

### 2.2 One state table

Every state that is real in the data, mapped to one Banda look. This is a proposal for the
mocks.

| Banda word | Comes from | Look (row) | Mark satellite | Notes |
|---|---|---|---|---|
| **Queued** | workflow `state: queued` (`queuedAt` set, `startedAt` not) | grey, no icon motion, "waiting for a slot" | none | Workflows only. Banda's RFD lanes are never queued. |
| **Working** | RFD `running`; workflow `start`/`progress`; Codex `running`/`pending_init` | grey, shimmering text, "· ‹last action›" | grey dot | ADR 0099: working is grey. |
| **Asks** | RFD `requires_action`; any permission or elicitation carrying the child's session id | orange tag "Asks", docked question names the asker | orange dot (extension) | Bubbles to the parent's card (Asks). |
| **Done** | RFD `idle` + `end_turn`; workflow `done`; Codex `completed` | muted, ✓ only on hover? (to pick), first line of the report | leaves the orbit | Claude: **a Done lane can be resumed** by the parent's SendMessage. The same lane goes Working again as a 2nd "delegation" (banda-arch §2.2). Explore and Plan are one-shot and cannot. |
| **Failed** | RFD `idle` + `error`/`refusal`/`max_*`; workflow `error`; Codex `errored`/`not_found`; spawn refused (`Concurrent subagent limit reached`, Codex "Agent spawn failed") | red tag "Failed" + reason (`agent stalled on all 6 attempts`) | red dot (extension) | Does **not** colour the parent's card (contradiction 6). |
| **Stopped** | RFD `idle` + `cancelled`; Codex `interrupted`/`shutdown` | muted "Stopped", plus "by you" when the Person stopped it | leaves | Claude: an agent the Person stopped "doesn't auto-resume", and the parent's messages to it are refused (docs:sub-agents). In a workflow, stopping one agent **counts as failed** for resume. |
| **Retrying** (modifier) | workflow `attempt > 1` / stalled | Working + "attempt 2" | grey | Up to 5 restarts. "Files the stalled attempt already changed stay changed" (docs:workflows). |
| **From last run** (modifier) | workflow `cached` | Done, dimmer, "from last run" | none | Only after a relaunch. |
| **Blocked** | workflow `blocked` (the classifier denied it) | Failed tag + "blocked by auto mode" | red | Auto mode only. |
| **Skipped** | workflow agent resolved `null` (stopped mid-run) | Stopped | none | |
| **Lost** | RFD `unknown`; codex replay "disconnected"; the Harness process died | muted "Lost · Banda restarted" | none | A run does not survive its process (§2.5). |

What the table still needs from the designer:

- the **glyph per state** at 15 px in a row (lucide: `loader-circle`, `circle-check`, `circle-x`,
  `circle-slash`, `clock`, `rotate-ccw` are all in the kit);
- the **transition motion** (a row moving from Working to Done should not jump in the list);
- the **group summary rule**: what counts as "settled" in `3 working · 1 done · 1 failed`.

### 2.3 What the Person can do, per path (the control matrix)

| Action | Claude sub-agent (RFD lane) | Claude workflow (Crew) | Codex sub-agent (RFD lane) | Banda child Thread |
|---|---|---|---|---|
| Stop one | ✓ `session/cancel(child)` → `Query.stopTask`. The parent's turn goes on | ✗ per agent. The adapter's `stopBackgroundWorkflows` stops whole workflows after a cancel, but only with `perTaskStopAffordance` (C `acp-agent.js:6415-6430`) | ✓ only while the child runs a turn (`capabilities.cancel` toggles) | ✓ `agents.stop` |
| Stop all | Thread Stop + cancel every lane (banda-arch §2.4.7) | same, plus the workflow task | same | its own turn only |
| Pause / resume | ✗ | ✗ (CLI `p` only) | ✗ | ✗ |
| Restart one / skip one | ✗ | ✗ (CLI `r`/`x` only) | ✗ | n/a |
| Relaunch a stopped or failed run | n/a | **Ask the parent**: Claude relaunches with `resumeFromRunId`. Completed agents come back cached. "If agents from the stopped run haven't exited yet, Claude Code refuses the relaunch" | n/a | n/a |
| Message it | ✗ directly. Ask the parent (SendMessage) | ✗. The docs say: "No mid-run user input" | ✗. Ask the parent (`send_input`/`followup_task`) | ✓ its own composer |
| Answer its question | ✓ in the parent's dock, carrying the child's id | ✓ workflow agents' permission prompts pause the run (docs). **Attribution over ACP is unverified** | ✓ with the capability (without it, re-attributed to the root) | ✓ its own card |
| Save as a command | n/a | ✓ possible for Banda: copy `scriptPath` to `.claude/workflows/` (Banda's own act, not the Harness's) | n/a | n/a |
| Approve before start | n/a | an ordinary permission request "Workflow" (Supervised/AcceptEdits). **None** under Full access | n/a | n/a |

**Finding (lookup 2).** The Workflow call reaches a plain client **with `rawInput`**, script
included (C `tool-calls/renderer.js:117-121,156`; `GenericReporter` title "Workflow",
`reporters/interaction.js:158-180`). The script must start with a pure-literal
`export const meta = {name, description, phases[{title, detail, model?}]}`. Banda can parse it
for:
- the **approval card**: name, description and the phase list, with no token projection;
- the **Crew card's phase strip**, before any progress data exists.

Banda drops `rawInput` today (banda-arch §1.1).

### 2.4 How the Person "talks to" a sub-agent

Over ACP the only route is through the parent Agent. The mocks need to show it on purpose,
not as a disabled box. The material:

- **Claude.** The parent continues a sub-agent with `SendMessage {to: agentId|name, message,
  summary}`. A message to a finished agent resumes it in the background. Explore and Plan have
  no agent id and cannot be resumed (claude-code §1.2, §1.8).
- **Codex.** The parent uses `send_input` (V1; `interrupt: true` redirects now) or
  `send_message`/`followup_task` (V2). The desktop app tells the Person "Ask parent to resume
  sub-agent to continue conversation" (codex §3.2).
- **What to design** (proposal):
  - In the lane view, the composer slot is a status bar: "Runs on its own · ‹state› · ‹model› ·
    **Ask ‹parent Agent› about it**". The action focuses the parent's composer with a chip
    `@reviewer` already in it.
  - The chip goes out as plain words the parent model understands, e.g. "(about sub-agent
    'reviewer')". Banda never shows `agentId`; Claude is told "internal ID – do not mention to
    user".
  - The Person's message is a **steer** into the running turn. Banda has steering
    (`effects.rs:9,47,425`).
  - Show the outcome: a "Messaged reviewer" row from the parent, like Codex's "Sent input to
    Robie".
- **Steering a running sub-agent.** Claude queues SendMessage for a busy agent (the CLI shows
  "N queued"). Codex V1 can interrupt. Neither state reaches Banda as data. Show only what the
  parent says.

### 2.5 Work that outlives the turn

**Lookup 1. A held turn does not block the Person.**
- The adapter holds a turn open while its *background sub-agents* run (`isHeldOpen`, C
  `acp-agent.js:345-351`).
- When the Person sends a message, the steer supersedes the hold: "A turn already held for
  background subagents has a recorded outcome the steer supersedes … the steer resumes it"
  (`:2723-2733`). A queued command also settles the held turn: "the user moving on outranks the
  hold" (`:3160-3180`).
- **For the design:** while sub-agents run in the background, the Thread is Working (grey, with
  satellites) and the composer stays usable. A message is steered in, not queued with a dashed
  line.

**Workflows are the hard case.**
- **The turn is not held** (banda-arch §1.4). The Thread's turn ends and its Mark goes Done or
  idle while up to 16 agents work. The Person sees "nothing until … went on by itself".
  landscape anti-pattern 4 ("parent says done while children run") is exactly this.
- The engine must keep the Thread **Working** from `background_tasks_changed` (raw SDK frames,
  banda-arch §2.5a). The mocks need this state on the sidebar: a working row whose turn is over
  and whose crew is not ("Workflow audit-routes · 2/3"), with the composer free.
- **When the Crew ends,** Claude wakes on its own. The `<task-notification>` is a hidden
  user-role message; the adapter strips it on replay (C `acp-agent.js:748-757`). Banda opens a
  turn "‹Agent› went on by itself.", and the report is that turn's reply. The mocks need the
  "↩ audit-routes finished" row followed by the reply.

**Death and resume** (lookup 4, docs:workflows):
- "If you background your session or exit Claude Code while a workflow run is in progress, the
  run doesn't continue on its own." It resumes only when Claude relaunches it, replaying from
  saved results.
- For Banda this means:
  - **Banda quitting or restarting** stops a Crew. So does the Harness host being released,
    which happens after 30 min idle (banda-arch §1.4 risk).
  - A **"Lost"** state plus an action "Ask to relaunch" that sends a prompt.
  - On relaunch, completed agents show "from last run". A failed agent and **every agent after
    it** run again, even completed ones.
- ADR 0049 ("the engine outlives the window") helps only if the Harness process lives in the
  engine, not the window. Check where it lives before promising "closing the window keeps the
  Crew".

### 2.6 Nesting depth

| | Depth |
|---|---|
| Claude sub-agents | "up to three layers below the main conversation" by default. At the limit the Agent tool is withheld except `fork`. `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (docs:sub-agents). Since 2.1.302, nested Agent calls run in the **foreground** in SDK hosts (claude-code fact check #1) |
| Claude workflows | A workflow may run **one** child workflow (`workflow()`), whose agents group under its name. Sub-agents cannot call Workflow. `parent_task_id` is absent for agents inside a workflow (claude-code fact check #3), so the workflow tree comes from `workflow_progress`, not the task tree |
| Codex V1 | `max_depth = 1`: children cannot spawn |
| Codex V2 | Paths `/root/a/b`, depth unbounded by default |
| ACP | A grandchild is announced on its parent child's stream. Replay announces ancestors first |

**The designer must decide:**
- how deep rows indent in the Thread (proposal: one level, then `(+N)` on the row, as in
  Claude's panel);
- the **breadcrumb** in a lane view: "‹Thread› › reviewer › Explore", with Esc going one level
  up;
- what the Mark counts: running lanes at any depth, or only direct ones.

### 2.7 Worktrees and merging back (lookups 5 and 6)

- **Base.** A sub-agent with `isolation: worktree` gets a temporary worktree "branched by default
  from your **default branch** rather than the parent session's `HEAD`", unless
  `worktree.baseRef: "head"` is set. **A worktree sub-agent does not see the parent's uncommitted
  or unpushed work** (docs:worktrees "Choose the base branch"). That is a surprise worth showing
  ("from main") on the row.
- **Where.** Under `.claude/worktrees/` (the `--worktree` session branch is `worktree-<name>`;
  sub-agent naming is undocumented). A `git worktree lock` is held while the agent runs.
- **After.** The worktree is removed if the agent made no changes. "A worktree with changes stays
  on disk until the periodic sweep" (`cleanupPeriodDays`). **Nothing merges it back**:
  - no doc describes a merge step;
  - the Agent result carries `worktreePath` and `worktreeBranch`, for the parent model to act on;
  - workflows with `isolation: 'worktree'` behave the same way.
- **Over ACP, Banda gets none of it.** claude-agent-acp 0.99.1 has **0 occurrences** of
  `worktreePath`/`worktreeBranch` in `dist/`, and its RFD announce sends no `cwd`
  (`native-subagents.js`). The RFD has a `cwd` patch field, but this adapter doesn't fill it.
  Codex V1 children share the parent's cwd, and their turn diffs are folded into the root turn's
  file-change report (banda-arch §2.3).
- **The designer needs:**
  - a branch chip on a lane row, *only when known*;
  - a finished-lane state "Left changes on ‹branch› · **Review** (Banda's Diff Pane on that
    branch) · **Ask to merge** (a prompt to the parent) · **Discard**";
  - an engine way to know, through raw SDK `tool_use_result` frames or a `git worktree list`
    scan of `.claude/worktrees/`. Flag it as engine work.
- **Shared-checkout edits.** Without isolation, every lane edits the same files. Banda's
  changed-files card ("Edited 2 files · Review") and the work line would mix the parent's edits
  with the lanes'. **Attribution** ("by reviewer") needs a design decision. The data exists
  per lane: the RFD child stream carries its edit tool calls.

### 2.8 Cost and tokens

**What exists:**

| | Per agent | Per run or Thread |
|---|---|---|
| Claude, over the RFD | **no usage in the states the adapter sends** (no `usage` set in `native-subagents.js`). Calls and time can be counted from the child stream | the parent's `usage_update`. The SDK's `modelUsage` includes sub-agents and workflow agents (claude-code §5.8) |
| Claude, raw SDK frames | `task_progress.usage {total_tokens, tool_uses, duration_ms}`; workflow agent `tokens` | workflow total |
| Codex, over the RFD | likely a `usage_update` on the child session: `thread/tokenUsage/updated` → `createUsageUpdate`, routed by `notificationSessionId` (X `:37456`, `:35327-35330`). _Inferred_; record it | |
| The Person's plan | ADR 0043: the limits ring, weekly or 5-hour share, read from Claude's token | |

**Missing decisions:**
- **Whether Banda shows tokens at all.** The look has no token numbers anywhere today; the bar
  shows a ring only. Proposal: tokens appear **only** in the Crew Pane (per agent, and the run
  total) and in a lane's detail. The Thread's Crew card shows agents and time. An optional line
  reads "used 18% of your 5-hour window", computed by Banda from two ring readings.
- **Banda's own "Large" warning.** Claude's warning is not sent to SDK hosts, so Banda must
  compute its own: more than 25 agents (or the size guideline's count), or a projected token
  total over 1.5M. The projection is not available, so use agents spawned × average per agent.
  It is shown in fg with `triangle-alert` (contradiction 4).
- **Ultracode copy.** The docs say "each request uses more tokens and takes longer … reaches a
  session or weekly limit sooner". Codex Ultra: "highest usage", and "Use Ultra with Full
  access?" asks for confirmation. Show it once, where the switch is turned on.

### 2.9 Results coming back

- **Foreground Claude lane (RFD).** The report is a `session_message` from child to parent,
  shown in the parent's transcript only (claude-code fact check #11).
- **Background lane.** It ends with `task_notification`. The adapter calls `finishTask`
  (C `acp-agent.js:4696-4725`), and the lane goes idle. The parent model reads the result in a
  later turn.
- **Crew.** The report is the parent's next reply. Results can be large JSON (`schema` agents),
  and the CLI pretty-prints and folds them.
- **The designer needs:**
  - the "↩ ‹name› finished" row that links to the anchor (landscape p12);
  - a report longer than a screen (fold with a fade, landscape p7);
  - a JSON result.
  The brief and the result must always be one click away (Claude #66646).

### 2.10 Claude vs Codex, as the Person would notice

| | Claude Code | Codex |
|---|---|---|
| Name over ACP | `name ?? description ?? subagent_type` ("Explore", "code-reviewer", or the 3–5-word description) | **V1: none**. Announced with only `description` = the whole spawn prompt, so the title falls back to "Agent" (X `:36040-36050`). V2: the path's last segment ("code_mapper"). **The scientist nicknames never reach Banda** (codex fact check) |
| Role | `subagent_type` in `description` when it differs | not sent |
| Depth | 3 | V1: 1 |
| Concurrency | 20 Agent / 16 per workflow | V1: 6, V2: 3 children |
| Scripted fan-out | Workflows (phases, hundreds of agents) | **none**. Ultra = proactive fan-out, **only under V2**. V1 is the default, so Ultra changes nothing there (codex fact check #5) |
| Finished child | idle, resumable by SendMessage | V1: stays open, counting toward the limit, until `close_agent`. Closed = cannot be revived by the Person |
| Child edits | own tool calls in the lane | also folded into the root turn's diff report |
| The top-effort switch | **Ultracode**: a boolean config option. In Banda it lands among the model picker's other options (`picker.test.ts:56-60`) | **Ultra**: an effort level on the effort slider |

**The designer needs:**
- **A Banda naming fallback for Codex V1.** Proposal: the first 3–5 words of the prompt, faded,
  plus a number for siblings ("Agent 2 · Map the auth…").
- **A decision on effort.** Does the magenta top-effort colour mark both Ultracode and Ultra?

### 2.11 Identity: how one sub-agent looks

The notes describe the rows but not the **glyph**.
- T3 uses the provider-logo avatar with a status dot. That doesn't work in Banda: every lane of
  a Claude Thread is Claude, so the emblem says nothing.
- The Mark is per Thread ("the only thing that moves on its own"), so 16 animated mini-marks
  would break the calm.
- **Proposal to mock:**
  - a 15 px **role icon** in muted text: `search` for Explore, `list-checks` for Plan, `bot` for
    general, `git-fork` for a fork, `split` for a Crew;
  - a **state glyph** at the row's end (§2.2);
  - the model shown **only when it differs** from the parent's (T3's "only when different" rule,
    applied to model and worktree).

### 2.12 Attention and notifications

- **Who asks.** With the capability, Claude and Codex child requests carry the child's session
  id, so the docked block can read "**reviewer** asks: Allow `pnpm test`?".
- **Today:**
  - Claude child permissions are attributed to the launch call, so the name is derivable.
  - Codex child approvals are re-attributed to the root, with no sign of the child.
  - **Workflow agents' permission prompts:** the docs say they pause the run, but attribution
    over ACP is **unknown**, since workflow agents are not RFD children. Record it before
    designing "audit agent 7 asks…".
- **Session-wide grants.** A grant that lasts beyond one call ("for the session") applies to the
  **whole session**, main conversation included (docs:sub-agents). The dock's choices should say
  so when a lane asks.
- **Esc on a lane's prompt** denies that one call without stopping the lane (docs:sub-agents).
- **Notifications and sounds** (ADRs 0009, 0011, 0048) need copy for:
  - a lane that asks while the Person is elsewhere ("‹Thread›: reviewer asks…");
  - a Crew that finishes after the turn ended.
  - Decide whether a lane's or an agent's failure makes a sound. Proposal: no.

### 2.13 History, reload and Thread tools

The mocks should show a Thread reopened a day later:
- anchors in their final state;
- the Crew card with its totals;
- lanes loaded on demand.

**Open:**
- **Rewind.** What happens to lanes after a rewind to before a launch? (ADR 0027)
- **Fork.** Do lanes copy to the fork?
- **Find, minimap, copy as Markdown.** Do they include lane text? (banda-arch option B lists
  these readers.)
- **Visuals and Panes from a sub-agent.** They land in the parent Thread and its Group
  (banda-arch §3.2). Should they say "from reviewer"?

### 2.14 Smaller things the notes skip

- **Empty and first-time states.**
  - First Crew ever: a one-line explainer?
  - "No sub-agents" in the Crew Pane's lane list.
- **Keyboard.** landscape p6 proposes parent ↑ / child ↓ / siblings ←→ / Esc. These need
  keys.toml names and must not clash with the existing Alt+arrows (ADR 0025 tiling).
- **Phone and drawer** (ADR 0089 d8): a lane opens as a pushed screen, and so does a Crew.
- **Screen readers.** Every state glyph needs a word (Claude does this: `hOe` aria labels).
- **The "stray replies" bug.** Today a sub-agent's streamed text may appear as the parent's own
  reply (banda-arch §1.2, _inferred_), and child tool calls are counted in the parent's work
  line. The mocks should show the fixed behaviour, and step 0 must record it first.
- **Remote isolation.** Claude `isolation: "remote"` returns `remote_launched` with a
  `sessionUrl`. It needs a row "Cloud agent · open ↗", or a decision to leave it out.

---

## 3. The mock checklist

These are the screens and states the first mock set should cover. Each item lists only what
the data can drive.

1. **Thread, one lane**: Working (live action), Asks (docked, naming the asker), Done (report
   first line, opened: brief + folded work + report), Failed (reason), Stopped by you.
2. **Thread, a group of 3–6 lanes** from one message: live, then settled and dimmed. One lane
   asks while the others work.
3. **Thread, Crew card**:
   - before start (approval under Supervised, built from `meta`);
   - running (phase strip, counts, queued);
   - finished with 2 failed;
   - Lost after a restart, with "Ask to relaunch";
   - relaunched with "from last run".
4. **Crew Pane** in the Thread's Group, at 12 agents and at 50 agents (folded done, filter,
   retrying agent, usage-limit failure). An agent's detail: prompt, recent calls, result (JSON
   folded), tokens.
5. **Lane view**: the Thread view read-only, a breadcrumb, the status bar with "Ask ‹parent›
   about it", and a nested grandchild `(+2)`.
6. **Composer**: the steer while background lanes run (no dashed queue), the `@reviewer` chip,
   and the Ultracode switch with its usage note.
7. **Sidebar**:
   - the working row with satellites and line 2 for lanes ("3 sub-agents at work") and for a
     Crew whose turn is over;
   - the parent card in Your turn because a lane asks;
   - a parent that stays working while a lane failed.
8. **Worktree lane finished with changes**: branch chip, Review / Ask to merge / Discard.
9. **Codex**: the V1 child named by its prompt; the same rows; no Crew.
10. **Both themes, glass on and off** (banda-look §6).

---

## 4. Questions for Roma (beyond banda-arch's five)

1. **Ticking.** Is one clock per surface allowed (the Thread's live line and the Crew Pane
   header), with static durations on rows?
2. **Failure.** Does a lane's or a Crew agent's failure stay inside the Thread, with the parent's
   card unchanged (Codex's rule)?
3. **Per-state satellites.** The orange, red and green satellite dots are a kit extension. Adopt
   them?
4. **Tokens.** Crew Pane and lane detail only, or also on the Crew card? Is "% of your window"
   wanted?
5. **Talking to a sub-agent.** Is "Ask ‹parent› about it", with a mention chip, the right
   affordance, given that a direct message is impossible over ACP?
6. **Worktree lanes.** Should Banda offer Review, Ask to merge and Discard itself, which is new
   engine work to learn the branch, or just tell the Person what the parent reports?
7. **Workflow approval under Full access.** Is no approval acceptable, or should Banda add its
   own pause before a Crew larger than N agents?

---

## 5. Sources for this file

- Adapter code (local, read only):
  - C `acp-agent.js:345-351, 748-757, 2715-2733, 3150-3185, 4696-4740`;
  - C `tool-calls/renderer.js:101-164`, `tool-calls/reporters/interaction.js:150-185`;
  - grep of C `dist/` for `worktreePath|worktreeBranch` (0 hits) and of `native-subagents.js` for
    `cwd` and `usage`;
  - X `index.js:35325-35330, 35666-35680, 36046, 37180-37200, 37450-37475`.
- Banda (local): `apps/agents/engine/src/effects.rs:9,47,67-86,425`,
  `apps/agents/engine/src/acp/options.rs:34-41`,
  `apps/agents/pane/src/composer/picker.test.ts:33-60`.
- Docs, fetched 2026-11-10:
  - https://code.claude.com/docs/en/workflows.md: "Behavior and limits", "Resume after you leave
    the session", "When a run hits your usage limit", "When an agent stalls and restarts",
    "Cost", "Set a size guideline", "Approve the plan before it runs";
  - https://code.claude.com/docs/en/sub-agents.md: isolation, permission modes, background
    prompts, depth, messaging, `color`;
  - https://code.claude.com/docs/en/worktrees.md: "Isolate subagents with worktrees", "Choose the
    base branch", "Clean up subagent and background-session worktrees".
- The five notes and the kit in this folder, cited by section.
