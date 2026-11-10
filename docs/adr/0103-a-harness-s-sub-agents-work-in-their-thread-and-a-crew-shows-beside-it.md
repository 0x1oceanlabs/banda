---
status: accepted
date: 2026-11-10
---

# A Harness's sub-agents work in their Thread, and a Crew shows beside it

_It amends ADR 0003 (its "Later" and decision 6's idle release), ADR 0031
(Ultracode's label), ADR 0058 (decisions 4–6 and 8), ADR 0089
(decision 8, the phone) and ADR 0099 (decisions 2, 3 and 11), and gives
ADR 0098, decision 24, its field. Amended before step 1, it also amends
ADR 0027 (decisions 1, 3 and 4), ADR 0073 (decision 9) and ADR 0078
(decisions 4 and 5). The look is the design reference's,
[`docs/design/README.md`](../design/README.md). Code is cited from main
at `bec527a3`; the research read `26feb9be`. The amendments of
2026-11-10, made before step 1, cite main at `1464393e` and step 0's
[`recordings.md`](../research/2026-11-10-sub-agents/recordings.md)._

_Amended 2026-11-10, during step 1, by Roma's calls 11 and 12: Banda
shows a Harness's sub-agents and Crews, and the Harness manages them.
Banda stops none of them and starts no Crew. Decisions 15, 19, 21–24 and
31 and the Plan say what goes._

Roma, on 2026-11-10 (translated), over the mocks: "First, very good work
on the design of the windows and how Banda looks overall — let's describe
this visual style and save it as a reference. I really liked how we
designed the windows and the other elements. You did very good work; I
propose we simply follow all your recommendations." The visual style is
the design reference, in a PR of its own. This ADR takes the
recommendations for sub-agents and Crews.

The evidence is in
[`docs/research/2026-11-10-sub-agents/`](../research/2026-11-10-sub-agents/README.md):
how Claude Code and Codex run and show their sub-agents
(`claude-code.md`, `codex.md`), how other products do it
(`landscape.md`), how it fits Banda (`banda-arch.md`, §3–4) and what was
missing before the mocks (`gaps.md`). The mocks follow one brief and one
scenario, a Thread "Move sidebar settings to sidebar.toml" with three
sub-agents and the Crew `audit-routes`:

- [`00-hero.html`](../research/2026-11-10-sub-agents/mocks/00-hero.html):
  the whole window, the satellite's grammar, the ten questions;
- [`01-thread.html`](../research/2026-11-10-sub-agents/mocks/01-thread.html):
  sub-agents in the Thread;
- [`02-crew-in-thread.html`](../research/2026-11-10-sub-agents/mocks/02-crew-in-thread.html):
  a Crew in the Thread, its start, the composer;
- [`03-crew-pane.html`](../research/2026-11-10-sub-agents/mocks/03-crew-pane.html):
  the Crew Pane;
- [`04-subagent-pane.html`](../research/2026-11-10-sub-agents/mocks/04-subagent-pane.html):
  a sub-agent opened beside;
- [`05-sidebar.html`](../research/2026-11-10-sub-agents/mocks/05-sidebar.html):
  the sidebar, the Mark, the bar and notifications.

![The window: the sidebar, a Thread with three sub-agents, a Crew card and a sub-agent's Question docked on the composer, and the Crew Pane beside it in the Thread's Group](../design/shots/window.jpg)

## Where it stands

- **Banda declares no sub-agents.** `shows()`
  (`apps/agents/engine/src/acp.rs:356-370`) declares forms, notices,
  boolean options and the terminal's output; no
  `clientCapabilities.subagents`. The crate has the types only behind
  `unstable_subagents`, and `Cargo.toml:13` turns on only
  `unstable_session_fork`. So both adapters fall back to their old form.
- **Claude's sub-agents flatten into the parent's work.** An Agent call
  comes as a `think` call titled with the task, drawn with the brain
  (`apps/agents/pane/src/entries/parts/ToolCall.tsx:200`). Every call the
  child makes comes on the parent's session with
  `_meta.claudeCode.parentToolUseId`, which `acp/said.rs` drops, so the
  work line counts it as the parent's (`did`,
  `apps/agents/pane/src/thread/timeline.ts:296`). The child's own words
  never come: its report is the Agent call's result, which shows Claude
  Code's internal `<tools-used-before-summary>` tag as text. The feared
  stray replies, a child's text written as the parent's, are not real:
  step 0's recordings show none.
- **Codex shows its sub-agents as their start, the wait and their end**:
  "Start subagent read_a", "wait" and "Complete subagent" rows, with none
  of the child's work or report. That is its newer multi-agent mode; the
  older one's `spawnAgent` row is a wrench with the tool's name
  (`ToolCall.tsx:202`). A child's approval
  comes as the parent's own Question, with no sign of who asks.
- **A Claude workflow is invisible until it ends.** The Workflow call is
  a "Workflow" row that ends at once. The turn ends, the Mark shows Done
  while up to 16 agents work, and nothing shows until "‹Agent› went on by
  itself." (`apps/agents/engine/src/between.rs:183`). A workflow agent's
  Question opens that turn early, naming no agent, and its call stays
  Pending for good. The composer
  already offers Ultracode, in the mode menu with the Harness's other
  options (`apps/agents/pane/src/composer/picker.ts:1-4`,
  `picker.test.ts:40`), so a Person can start one today.
- **The effort has no colour.** The model picker draws it lighter, in
  words (`apps/agents/pane/src/composer/ModelPicker.tsx:94`; ADR 0058,
  decisions 1 and 8). ADR 0031's magenta for the top level is not drawn,
  and no token holds it.
- **A child's Question would be refused.** `Routes::of`
  (`acp/routes.rs:29`) knows only the Thread's own sessions, so a
  permission request from a child session is answered `Cancelled`
  (`acp.rs:255-259`), and a form too (`acp.rs:297`).
- **A long workflow can lose its process.** A Harness's process is let go
  after 30 minutes with no turn
  (`platform/harnesses/engine/src/hosts.rs:31`), and nothing keeps it
  while a workflow runs between turns.
- **Nothing counts sub-agents.** ADR 0099, decision 11, names a
  `ListedThread.subagents` that is not there yet (`ListedThread` is at
  `apps/agents/engine/src/model.rs:793`), and nothing could fill it.
- **The words are taken.** GLOSSARY's Workflow is ADR 0082's steps
  across Apps, and Task is reserved as `task@1`.

## Decision

### The words

1. **A sub-agent is a Harness's helper inside its Thread**: Claude
   Code's Agent and Task tools, Codex's `spawn_agent`.
   - It is part of its Thread's Agent, with no name, settings or pass of
     its own: ADR 0006 holds, one Agent per Thread. Its label is the
     Harness's ("Reviewer", "Explore").
   - What it asks of Banda runs under its Thread's pass, through the same
     session: a Visual it shows lands in the Thread, and a Pane it opens
     joins the Thread's Group (ADR 0065, decision 7).
   - On screen: "sub-agent", "sub-agents". Never "subagent" or "task".
2. **A Crew is the sub-agents one Thread set to work together in
   phases.** It is what Claude Code calls a workflow; Ultracode makes
   Claude start one for every big task. Workflow and Task keep their
   meaning. The Harness's own name for it is the Crew's title: "Crew ·
   audit-routes". A **phase** is one step of a Crew, as its script names
   it: "Scan", "Fix", "Verify". (Roma's call 1.)
3. **The states are Banda's words**: Working, Asks, Done, Failed,
   Stopped, Queued (a Crew's agent waits for a slot) and Lost (stopped
   when Banda restarted), with "attempt 2" and "from last run" after
   them. The parent is named by its Harness: "Claude", "Codex".
   - _Amended 2026-11-10, before step 1:_ Lost is a sub-agent cut off
     from Banda: a restart, its Harness stopping, or Banda letting go of
     its process. Its row says which, in a turn's own words where there
     are some:
     - "Stopped when Banda restarted.";
     - "‹Harness› stopped while it worked.", as a turn whose process
       ended says it (`apps/agents/engine/src/acp/session.rs:283-288`);
     - "Stopped when you changed the Project's trust." and "Stopped when
       ‹Harness›'s account changed." (decision 11);
     - "Stopped when the Thread moved to ‹entry›." (decision 11);
     - "‹Harness› cannot say how it goes.", for the RFD's `unknown`.

     Reason: one wording, the restart's, is wrong for a crash, for a
     process Banda let go, or for a move. A state the Harness says later
     undoes Lost, as the RFD's `unknown` ends neither the work nor the
     session
     (`agent-client-protocol-schema-1.13.0/src/v1/client.rs:1196-1200`).
     When Banda cut a lane off, the `idle` with `cancelled` that the
     Harness sends after it changes nothing.

### Where a sub-agent is kept

4. **A sub-agent is a lane of its Thread**: a record and its own slice of
   the Thread's Body, kept by the Thread's host and read when it is
   opened (`banda-arch.md`, option B).
   - Not an entry in the parent's Body: every reader of a Thread's
     entries would have to learn to skip it, and a Crew is thousands.
   - Not a Thread of its own: a Thread takes messages and has turns, a
     queue, settings, Later and Archive. A sub-agent has none of them,
     and lives and ends in its parent's session.
   - Banda's `SubagentId` is its identity; the Harness's child session is
     evidence (ADR 0002, decision 7). A child the Harness resumes
     (Claude's SendMessage) goes on in the same lane.
5. **A Thread another Agent started through Banda stays a Thread**
   (ADR 0019): a child with ↳ under its parent (ADR 0098, decision 24).
   `ListedThread.parent` names the Thread whose Agent started it, the
   field decision 24 needs.
6. **Data first, then the client core, then the views.** The engine keeps
   lanes and Crews and says them as facts. Pure `thread/subagents.ts` and
   `crew.ts` in the Threads App place and word them, the same for every
   client (ADR 0089, decision 1). The views read those.

### What the engine does

7. **It declares sub-agents and routes a child before anything else.**
   - `unstable_subagents` in `Cargo.toml`, `subagents: {}` in `shows()`.
   - A `subagent_update` maps the child's session to its Thread before
     any of the child's traffic, so its Question and its forms reach the
     Thread and are not cancelled.
   - A replayed child is matched by its session and not written twice.
   - With the declaration, Claude sends no call for an Agent launch. A
     lane takes its place in the turn when its `subagent_update` comes,
     and is tied to its launch by the tool use id that keys its
     `session_message` and the raw `task_started`.
   - _Amended 2026-11-10, before step 1:_
     - **The declaration is a switch in the engine until the window draws
       sub-agents.** `shows()` declares `subagents: {}` only when the
       agents engine was built with `Agents::declaring_subagents()`, and
       the engine turns that on when `BANDA_SUBAGENTS=1` is set, in any
       build. Off, the `initialize` frame is today's, byte for byte
       (`apps/agents/engine/src/acp.rs:355-369`). Step 1's ON, after the
       rows, deletes the switch, and Banda always declares. Reason: with
       the declaration Claude sends no Agent call at all
       (`recordings.md:259`), so a Dev that declared before the rows and
       Stop would show less than today. Each PR merges on its own green
       `ci`, and the switch lets routing, lanes, stops and rows merge
       dark, each alone, with today's tests as the proof. A key in
       `harnesses.toml` or `agents.toml` would be settings for a switch
       that lives a few days.
     - **Step 1 stores no launch tie.** A lane's anchor is written where
       its `subagent_update` comes, which is where it started; a child
       Claude resumes is found by its session. Nothing in step 1 reads
       the tool use id. Step 4, which reads the raw frames, adds a
       column if it needs one, after the others
       (`apps/agents/engine/src/store.rs:16`).
     - **A child is taken only from a session Banda listens to**: a
       Thread's session whose lanes Banda hears, or a child it has
       already. Anything else is heard by nobody, as a load's replay is
       today (`apps/agents/engine/src/acp/opening.rs:267-269`), and a
       Question from such a child is answered `Cancelled`, as now
       (`acp.rs:255-259`). A Thread keeps one lane per child session: a
       child announced again, resumed, or replayed after a load goes on
       in its lane, with no second row, anchor or start fact. Reason: a
       load answers before Banda listens for lanes, so its replay maps
       nothing. A child mapped from a replay would get its later updates
       for a lane nobody hears, and its Question would be cancelled.
     - **A child's commands and usage are not its Thread's.** Its
       `available_commands_update` and `usage_update` are dropped, as
       the commands and the usage a Thread shows are its own session's
       (`apps/agents/engine/src/acp.rs:205-236`).
8. **It keeps lanes and says what they do.**
   - A table, `agents_subagents`, holds a lane: its Thread and turn, its
     parent lane, its Crew and phase; its title, role and model; its
     state, why it ended, whether it can be stopped, whether it runs in
     the background; when it started and ended; its prompt and report;
     how many calls it made and how many failed; the Harness's child
     session.
   - A lane's entries are kept as the Thread's are, in `agents_items`
     with a `sub` column. `agents.thread` leaves them out;
     `agents.subagent` answers them.
   - Facts: `subagent.started`, `subagent.changed`, at most once a second
     (ADR 0099, decision 11), and `subagent.ended`; `crew.started`,
     `crew.progressed` and `crew.ended`.
   - What a lane says between turns updates the lane. It never opens a
     turn of the Agent's own (`between.rs`).
   - _Amended 2026-11-10, before step 1:_
     - **A lane keeps no counts and nothing of what it does now.** The
       table holds no calls, failures or "doing". `subagent.changed` is
       written at once, in the row's own transaction, only when the
       lane's state, title, role, model, Stop, why it ended, prompt or
       report changes, and it carries only what changed. What the
       Harness clears with the RFD's `null`, a title, a description or
       the capabilities, it names as cleared, and the row and the
       Pane's fold clear it; a state cleared changes nothing, as it
       says no state
       (`agent-client-protocol-schema-1.13.0/src/v1/client.rs:946-1000`).
       An update that changes nothing writes nothing, so there is no
       once-a-second throttle. A row's now and its counts come from the
       lane's own entries (decision 15). Reason: ADR 0099's step 2 (#1196, branch
       `feat/agents-doing`) keeps what a Thread does in memory only, "It
       is no fact, since at ten Agents a fact a second would be some
       36,000 rows an hour in the log" (its
       `apps/agents/engine/src/doing.rs:1-12`), and a Thread has several
       lanes. Its stream `agents.doing` stays the parent's: a lane's
       words move only the Thread's `stepped`, at most once a second, so
       ADR 0099's "stuck" still counts them.
     - **Codex's updates write what changed.** Codex sends
       `{title, capabilities: {}}`, then `running` twice, then `cancel`
       (`recordings.md:255`): one start and one change, for its Stop. A
       lane announced with no state starts Running, as Codex says
       `running` a few milliseconds later; the RFD leaves a state never
       given unconfirmed
       (`agent-client-protocol-schema-1.13.0/src/v1/client.rs:990-995`).
     - **A lane's entries go under its Thread.** Their facts have the
       Thread as subject and name the lane by `sub`; the Pane's fold
       keeps them out of the Thread's entries, but for the two below.
       Reason: pulls finds an Agent's
       `gh pr create` by the event's subject
       (`apps/pulls/engine/src/heard.rs:91-104`), and the checkpoints
       compare a Thread's fold with its view by subject
       (`apps/agents/engine/tests/agents.rs:278-311`).
     - **A lane's Question is an entry of its Thread, not of its lane.**
       In the store it has no `sub`; its body's `sub` names the lane that
       asks, and its turn is the lane's launch turn. So `agents.thread`, the
       dock and `ListedThread.asking` see it as they are
       (`apps/agents/engine/src/store.rs:1443-1447`, `:1469-1490`), and
       the Thread asks (decision 13). Its turn's end does not close it,
       as it closes a turn's own (`writer.rs:192`, `store.rs:1459-1466`):
       it closes when its lane ends or is Lost.
     - **Except its edits.** `agents.thread` leaves a lane's entries out
       but for its calls that edit, delete or move a file, by the kind
       each starts with, failed or not. They come as `ThreadView.edits`,
       and what they changed is counted as a turn's own calls are: a
       call with a diff in it that did not fail, by `files_of`
       (`apps/agents/engine/src/changes.rs:107-135`). _Amended at step
       1, E1a:_ the set was a lane's calls with a diff that did not fail,
       whatever their kind. A call's kind is set as it starts
       (`apps/agents/engine/src/transcript.rs:499-548`), but its diff can
       come later: Claude sends an edit's diff only in an update after its
       start (`apps/agents/engine/tests/recordings/claude-edit.jsonl`), and
       `tool.changed` names only the item. So a window that cut a lane's
       call as it started could not keep a set chosen by its diff, and
       its fold would differ from the view. A diff in a lane's call of
       another kind is not counted, where the Agent's own would be: a
       known gap. A sub-agent's file changes count in its launch
       turn wherever a turn's changes are counted: the Thread's changes
       card, `agents.changes`, the Diff's Turn and Files' turn paths, by
       one merge, in `changes.rs` and `changes.ts`. When a lane ends
       after its turn, git takes that turn's `after` checkpoint again
       while it is still the Thread's latest. Two gaps are known: what a
       lane edits after the next turn has begun is in that turn's
       `before` too, so its Diff shows it; and a lane that ends Lost as
       Banda restarts takes into the `after` what the Person changed
       since. The work line still counts the parent's own work (ADR
       0058, decision 4). Reason: the card is worked out in the Pane
       from the Thread's items
       (`apps/agents/pane/src/thread/timeline.ts:165-185`) and the Diff's
       Turn in the engine (`apps/agents/engine/src/changes.rs:67-110`);
       both must see the same edits.
     - **Files pulses each worker's file** (ADR 0073, decision 9): the
       turn's and each sub-agent's. A sub-agent's goes only as it ends,
       and the turn's end clears only the turn's. Reason: one touch per
       Thread, as today (`apps/agents/engine/src/touching.rs:120-136`,
       `:190-194`), would let a sub-agent's end clear the parent's
       file, and three at work would show as one.
     - **The report** is the lane's last `:reply` that is not a launch
       receipt ("Async agent launched…"), its tools tag cut; with none,
       its own last reply on its own session. It is written as the lane
       goes idle; a `:reply` after that changes it only when its words
       differ. Only the first brief is its prompt; Claude's later
       messages to it wait for step 2's "Claude wrote". Reason: a
       background lane sends no `:reply`, or the receipt only
       (`recordings.md:241-248`), and Codex sends none (`:260`).
     - **A lane's writes do not move its Thread.** A Thread moves, and
       comes out of Archive, on a message and a turn's end, as every
       window's list moves it
       (`apps/agents/pane/src/list/list.ts:109-142`, `:250-257`). A
       Visual a sub-agent shows after its turn lands in its launch turn
       with no touch of the Thread, which `agent_item` gives an Agent's
       own (`apps/agents/engine/src/lib.rs:1624-1647`). Reason: an
       engine that moved it on a lane's write would disagree with the
       windows on the order and on what is archived
       (`apps/agents/engine/src/rules/archive.rs:24-30`), and a
       sub-agent's work stays inside its Thread (decision 29).
9. **Crews come from Claude's raw SDK frames.**
   - The engine asks for them with `_meta.claudeCode.emitRawSDKMessages`
     on `session/new` and `session/load`, and reads them as
     `_claude/sdkMessage`: `task_started`, `task_progress` with its
     `workflow_progress` (phases; agents with their state, model,
     attempt, tokens, calls, times, prompt and result), `task_updated`,
     `task_notification` and `background_tasks_changed`.
   - The Workflow call's input gives the script's `meta` (name,
     description, phases) before any progress comes.
   - `workflow_progress` is not documented. It is read tolerantly: a
     frame Banda cannot read leaves the Crew as it was.
10. **The contract, in short** (Rust in `model.rs`, TypeScript
    generated):
    - `Subagent`: id, turn, parent, crew, phase, title, role, model,
      state, why, can_stop, background, started, ended, prompt, report,
      calls, failed, doing. `SubagentState`: Running, Asks, Done,
      Stopped, Failed, Queued and Lost, said in decision 3's words; the
      RFD's `unknown` is Lost.
    - `Crew`: id, turn, title, description, phases, agents, state,
      started, ended, tokens. `Phase`: index, title. `CrewAgent`: index,
      label, phase, state, model, attempt, tokens, calls, took, prompt,
      result, lane.
    - `Body` gains two anchors, `subagent` and `crew`. `ThreadView` gains
      `subagents` and `crews`. `Question` gains `sub`, who asks.
    - `ListedThread` gains `subagents`, `crew` and `parent`, as step 0's
      recordings settled them:
      - `subagents`: `working`, the direct ones that run or ask (the grey
        satellites); `failed`, those that failed since the turn began (the
        red one); `only`, the label of the one at work when it is one
        ("Waiting on Explore").
      - `crew`: `title`, `phase`, `done` and `of`, what line 2 says ("Crew
        audit-routes · Fix 4/7"); `of` grows as the script calls agents.
      - A list's `Asking` gains `asker`: the lane's label, or "Crew
        ‹title›" for a workflow agent's Question.
    - Methods: `agents.subagent` and `agents.crew` (Read),
      `agents.stop_subagent` (Write).
    - _Amended 2026-11-10, before step 1:_
      - **Step 1's `Subagent` has no `doing`, `calls` or `failed`**
        (decision 8): id, turn, parent, title, role, model, state, why,
        can_stop, started, ended, prompt, report. `crew`, `phase` and
        `background` come with step 4's raw frames, which change
        `session/new` and so every Claude replay
        (`tools/fake-agent/src/replay.rs:166-184`).
      - `ThreadView.subagents` holds every lane, with its parent, in the
        order the lanes started. It is optional and left out when
        empty, so a window and an engine from before read the same JSON.
        `ThreadView.edits` comes beside it (decision 8). `Question.sub`
        names the lane that asks, and `subagent.ended` names its launch
        turn, which git reads as a turn's end
        (`apps/git/engine/src/checkpoint.rs:222-224`). A lane's end ends
        its Stop too: the store and the Pane's fold of `subagent.ended`
        both clear its `can_stop` and its stopping mark (decision 24), so
        facts after a view still give the engine's next view
        (`apps/agents/pane/src/thread/checkpoints.test.ts:32-41`). A
        checkpoint ends a lane that could be stopped.
      - **An entry of a kind a window does not know is left out of its
        Thread**: no row, not work, not found, not copied, with one
        warning in `window.log`. It comes before any entry of a new kind.
        Reason: today an unknown kind breaks the Pane
        (`apps/agents/pane/src/entries/index.tsx:34`,
        `entries/kinds.ts:31`, `:34`, `thread/findIn.ts:11-28`, `:37`),
        which then says "This Pane could not show what it keeps"
        (`client/web/src/tiling/PaneFrame.tsx:576`). Facts cannot bring an
        unknown kind, as a fact of a kind the window does not know changes
        nothing (`sdk/contract/src/agents.ts:136-147`); only a view can.
        Two things are accepted. A window built before this still breaks
        on a Thread with a sub-agent, so the declaration waits until
        Roma's machines run a Banda that has it (Plan, step 1). A window
        that has it, but not the fold of lanes, draws a lane's calls as
        the parent's until it reads the Thread again.
      - A handoff to another Harness leaves a sub-agent out: its anchor,
        and a Question whose body names `sub`, as it leaves thoughts,
        notices and pages out (ADR 0078, decision 5;
        `apps/agents/engine/src/handoff.rs:131-178`): the parent's own
        reply after it says what it found. Its `line()` loses its
        catch-all arm (`:178`), so each new kind is decided there.
      - `ListedThread`'s `subagents`, `crew` and `parent` stay step 3's.
        `Asking.asker` moves into step 1, its last PR, for the
        notification "Reviewer asks · ‹Thread›" (decision 33). It is
        agreed first with the sidebar session, as it changes that
        session's files. The asker's label is kept with the Question as
        it asks, so the dock, the list and the notification name it
        alike, even after the lane is renamed.
      - _Amended 2026-11-10, with ADR 0098's step 14:_ `ListedThread.parent`
        came earlier, with that step's S14a, as decision 5 says it.
11. **A Harness's process with sub-agents at work is not idle.**
    `Connection::idle_since` is none while a lane works or asks, or while
    `background_tasks_changed` says background work goes on. The
    30-minute release (ADR 0003, decision 6) waits for it.
    - _Amended 2026-11-10, before step 1:_
      - In step 1 a lane at work holds what a running turn holds: its
        session, held weakly as what listens between turns holds it
        (`docs/architecture.md:1321-1322`;
        `apps/agents/engine/src/between.rs:56-63`), a hold on its
        process, which keeps `idle_since` none
        (`platform/harnesses/engine/src/hosts.rs:52-79`), and the
        machine awake (`apps/agents/engine/src/live.rs:354-360`; ADR
        0097). `background_tasks_changed` comes with step 4's raw frames.
        Reason: `Held` counts only the host's activity (`hosts.rs:52-60`),
        and the Hosts slot is what keeps the process. So a lane keeps an
        idle process from being let go, but never keeps alive one Banda
        took out of its slot (`Hosts::let_go` and `stale`,
        `hosts.rs:237-257`), as the next bullet needs.
      - **A lane never keeps alive a process Banda has let go.**
        - A Project removed: Banda cancels its lanes at work and lets
          them go with its turns (`live.rs:261-273`). A folder move is
          refused while a lane works, as while a turn runs or waits
          (`apps/agents/engine/src/lib.rs:1500-1511`).
        - The Project's trust or a Harness's account changed: the lanes
          of a process Banda let go stop holding it, so it lives only as
          long as its running turn, as today
          (`platform/harnesses/engine/src/hosts.rs:238-249`). Banda notes
          the cut, as it lets the process go, only on its lanes still at
          work then, and those end Lost with it (decision 3).
        - A Thread moved to another entry (ADR 0078): `agents.switch`
          and `agents.go_on` are not refused while lanes work. The lanes
          go on where they began until the Thread's next turn starts on
          the new entry. Banda then cancels them and closes the old
          session, before the new process opens it
          (`apps/agents/engine/src/effects.rs:577-580`), and they end
          Lost.

        Reason: the next turn opens the session in a new process, so a
        lane kept in the old one would make two processes hold one
        Thread; and an old process would keep the Person's GitHub token
        and SSH agent after its Project lost their trust
        (`live.rs:200-203`). A move is not refused, as fork is, because
        it only says where the next turn runs, and refusing it would
        stop `agents.go_on` out of a usage limit.

### The satellite

12. **One small unit stands for a sub-agent everywhere: the satellite,
    whose shape is its state.** (Roma's call 2.)
    - It is the Mark's grammar with no eyes and no motion of its own: a
      square is calm, a circle works, a triangle needs the Person, an
      octagon failed. It is not a mark, as a sub-agent has none (ADR
      0099, decision 3, holds).

      | State | Shape | Colour |
      |---|---|---|
      | Working | circle | the text at 45% |
      | Asks | triangle | `--attention` |
      | Failed | octagon | `--destructive` |
      | Done | square | the text at 70%; green is the Thread's |
      | Stopped | square, outlined | the text at 38% |
      | Queued | circle, dashed | the text at 32%; Crews only |
      | Lost | square, faint, with a gap | the text at 30% |

    - 8 px in a Crew's strip, 10 px at a row's start, 12 px in a Pane's
      header and its status bar, as the design reference's kit has them.
      The shapes read in greyscale.
    - A change of state blends in 0.45 s, a change of shape leaps in
      0.6 s, as the Mark's do (ADR 0099, decision 4).
    - It is the Mark's orbit, a row's glyph, a dot of a Crew's strip and
      the icon of a sub-agent's Pane.
13. **On the Mark, only a failed sub-agent takes colour**: a red octagon
    at 48 px, a red dot at 16 px, while its Thread works. At 16 px the
    dot is 3 px and is not dimmed with its row. The rest stay grey, as
    ADR 0099 has them, circles at 48 px. No orange satellite: a sub-agent
    that asks makes the Thread itself ask. (Roma's call 4.)

![The satellite's grammar: each state at 8, 10 and 12 px, larger, and without colour](../design/shots/satellites.jpg)

### Where it shows, by how much there is

14. **The surface scales with the work.**

    | How many | In the Thread | Beside it |
    |---|---|---|
    | One sub-agent | a row where it started | its Pane, on demand |
    | 2–6 from one message | a group row, its members under it | the same |
    | A Crew, of any size | a Crew card | the Crew Pane, in the Thread's Group |

    Never a wall of nested logs in the parent, a card per sub-agent in
    the sidebar (ADR 0098, decision 23), or a parent that looks done
    while its sub-agents work.
    - _Amended 2026-11-10, before step 1:_ step 1 has a gap in the last,
      while sub-agents outlive their turn; decision 19 names it.
15. **A sub-agent's row** has the work line's left edge: the satellite,
    the title, the role and the model when it differs from the parent's
    ("Explore · Haiku"), what it does now or how it ended, and its time.
    - Working is grey and says what it does ("Reading auth.ts"); Asks
      takes colour on its triangle and time only; Done shows its
      report's first line and its duration; Failed, why; Stopped, "Stopped
      by you" when the Person did.
    - A click opens it in place, with nothing above it moving: the brief
      (two lines, more), its work as one work line, its report as quoted
      prose that fades when long, and Open beside and Stop while they
      apply. The pointer shows them at the row's right instead of the
      time.
    - A group row says "3 sub-agents · 2 working · 1 asks"; once all are
      done it folds into one line, "Ran 3 sub-agents · 2m 40s", at 55%,
      and opens on a click.
    - _Amended 2026-11-10, before step 1:_
      - **What a row says it does now is the window's memory.** As the
        Pane follows the Thread's facts, it keeps each lane's latest
        entry beside the Thread's state, where the checkpoints do not
        compare it, as it keeps why Banda kept the Thread Supervised
        (`apps/agents/pane/src/thread/live-thread.ts:20-36`). One pure
        `nowOf` in `thread/subagents.ts` words it: the running call
        ("Reading settings.ts"), "Thinking", the open Question's title,
        or the state word while nothing came yet. A read forgets it: just
        after one, a Working row shows its state word and its time until
        the lane does its next thing. Reason: it needs no engine read and
        no field in the contract, and no fact a second (decision 8).
      - **A closed row draws no count**, as the mock's rows have none
        (`docs/research/2026-11-10-sub-agents/mocks/01-thread.html:509-528`).
        Opened in place, a row reads `agents.subagent`, follows that
        lane's facts, and counts its work line from the lane's own
        entries, as a turn's is counted
        (`apps/agents/pane/src/thread/timeline.ts:296-345`).
      - **Open beside comes in step 2**, with the sub-agent's Pane. In
        step 1 an open row offers Stop alone.
    - _Amended 2026-11-10, during step 1 (Roma's call 11):_ a row has no Stop, and no row says
      "Stopped by you". A stopped sub-agent says "Stopped", with the
      Harness's reason when it gives one. In step 1 an open row offers
      nothing; step 2 adds Open beside.
16. **The Thread shows one level.** A sub-agent's own sub-agents are
    "(+2)" on its row; its Pane goes deeper (decision 21).
    - _Amended 2026-11-10, before step 1:_ "(+2)" counts the row's
      direct sub-agents, whatever their state, in brackets as written
      here. Reason: its Pane shows its own sub-agents one level at a
      time (decision 21), so the count is what opening it shows; and
      `ThreadView.subagents` names each lane's parent, so the Pane
      counts with no read.
17. **A sub-agent's label is its role, unless the role is Claude's
    default `general-purpose`; then it is its title** ("Explore", "Read
    a.txt one line"). A Codex sub-agent without a name is named by its
    number among its siblings and its prompt's first words, faded: "Agent 2 · Map the
    auth…". Codex has no Crews.
    - _Amended 2026-11-10, before step 1:_ a Codex sub-agent's label is
      its title as Codex gives it, from the name its parent gave it:
      "Read a" (`recordings.md:256`). When the title is Codex's own
      fallback, "Agent" or "Agent ‹8 characters of its id›", Banda
      names it by its number among its siblings, in the order they
      started: "Agent 2". No prompt words follow. Reason: Codex sends a
      child no brief Banda sees (`recordings.md:259`), and its fallback
      titles repeat or show the Harness's id, which never shows
      (decision 25; `recordings.md:511-515`).
18. **A Crew's card is the one thing a Crew puts in the Thread**, where
    Claude started it.
    - Its head: three satellites, "Crew · audit-routes" and its
      description. Its strip: each phase's name and its agents' dots,
      the current phase bright, past ones with ✓, future ones faint; a
      phase of more than 24 dots becomes a thin bar of shares and its
      count, so the strip stays one line at 500 agents. Under it, one
      quiet line of what the script last logged. Its foot: "12 agents · 6
      working · 4 done · 2 failed", the failed number alone in red, the
      time, and Open (`Enter`).
    - A dot's tooltip names its agent and its state; a click opens it in
      the Crew Pane.
    - Finished: "12 agents · 3 phases · 2 failed · 14m". Lost: "Stopped
      when Banda restarted · 7 of 12 done" and Ask Claude to go on
      (decision 26). After a relaunch, the dots from the last run are
      dimmer.
19. **The live line names them** (ADR 0058, decision 5): "Working for
    45s · 3 sub-agents at work", "· Waiting on Explore", "· Crew
    audit-routes · Fix 4/7".
    - **Work that outlives the turn keeps the Thread Working**, its mark
      grey with satellites, and its live line at the Thread's end, with
      no clock: "Crew audit-routes is at work · Fix 4/7 · Claude goes on
      when it ends", or "Reviewer is at work · Claude goes on when it
      ends". The composer is free and steers.
    - When it ends, a line "↩ Crew audit-routes finished · 14m · Claude
      went on by itself", then Claude's reply. A background sub-agent
      ends the same way: "↩ Reviewer finished".
    - _Amended 2026-11-10, before step 1:_
      - **While sub-agents outlive their turn, the composer is free and
        a message starts a new turn**, which the Harness takes while its
        sub-agents work on. The composer says what it says on an idle
        Thread, and its Stop stays (decision 24). Reason: no turn runs,
        so none takes a steer
        (`apps/agents/engine/src/rules/moves.rs:192-194`), and no prompt
        is open to steer into.
      - **In step 1 only the Thread Pane keeps the Thread Working.** Its
        rows, its live line at the Thread's end and its Stop say the work
        goes on. The sidebar, the Mark and the bar's counts read
        `ListedThread.latest`, the turn that ended
        (`apps/agents/engine/src/model.rs:858-861`;
        `apps/agents/pane/src/list/marks.ts:16`;
        `apps/agents/engine/src/counts.rs:1-11`), so they say Done, and
        the notification sounds done, as it follows the mark
        (`client/ui/src/status.ts:122-126`). Archive takes the Thread
        while they work, as it asks only whether a turn works
        (`apps/agents/engine/src/rules/archive.rs:8-22`). An update does
        not wait for those sub-agents (ADR 0072, decision 3;
        `client/web/src/calls/stores.ts:285-290`), which then end Lost.
        Step 3's `ListedThread.subagents` closes the gap. Reason it can
        wait: it is rare. Both Harnesses hold their turn while their
        sub-agents work, as step 0 recorded. Claude holds the prompt
        until a background sub-agent ends, and replies after it in the
        same turn (`recordings.md:311-321`). Codex's parent waits on its
        children with `wait` calls in its turn (`recordings.md:276-280`,
        `:341-343`). A sub-agent outlives its turn only when the turn
        ends without waiting for it: when Banda stops the turn to give way
        to a message, say, or a Codex parent is told not to wait. A Crew,
        which always does, is step 4's, with a field of its own.
      - **"↩ Reviewer finished" comes in step 4**, with the Crew's line.
        In step 1 a sub-agent that ends after its turn says so on its
        row, and what Claude then says is its "went on by itself" turn
        (`apps/agents/engine/src/between.rs:183`). Reason: no recording
        shows one, so its words have nothing to be tried on.
    - _Amended 2026-11-10, during step 1 (Roma's call 11):_ no Stop stays after the turn
      (decision 24). While sub-agents outlive their turn, the rows and the
      live line say the work goes on, and the composer is an idle
      Thread's.
      - **Codex's `wait` stays the parent's own call**, neither hidden
        nor marked: its `receiverThreadIds` are empty
        (`recordings.md:276-280`). The live line puts the sub-agents'
        words before it.
20. **One clock ticks per surface**: the live line, and the Crew Pane's
    header. Rows show a duration that does not tick. **Tokens show only
    in the Crew Pane and an agent's detail.** (Roma's calls 5 and 6.)

![A Crew outlives Claude's turn: the Thread stays Working with its live line, then "Crew audit-routes finished" and Claude's reply](../research/2026-11-10-sub-agents/crew-after-the-turn.jpg)

### Beside the Thread

21. **A sub-agent opens beside as a Pane, `agents.subagent`**, in the
    Thread's Group (ADR 0065, decision 7): the Thread's view, read only.
    - Its header: its satellite, its name and "sub-agent of ‹Thread›"; a
      breadcrumb when it is deeper, "Move sidebar settings › Reviewer ›
      Explore". A click on a crumb or `Esc` goes one level up.
    - Its brief is the parent's bubble, "Claude asked" ("Reviewer asked"
      for a nested one); a later message from Claude, "Claude wrote".
      Then its work and replies, as any Thread's.
    - The composer's place holds a status bar of the composer's shape,
      with no text box: "Working · Explore · Haiku · Runs on its own",
      Ask Claude about it, and Stop while it can.
      _Amended 2026-11-10, during step 1 (Roma's call 11):_ no Stop. Ask Claude about it
      stays: it is a message to the Thread's Agent, which manages its
      sub-agents.
    - A Group holds one sub-agent Pane: Open beside on another changes
      what it shows, and its row stays lit while it shows it. Its own
      sub-agents are rows in it, one level, and open in the same Pane.
    - Where there is no room for a Group (a narrow window, the Drawer, a
      phone), it is a screen on top, with a way back; a nested one is
      one more screen, in place of the breadcrumb. On a phone it goes on
      the stack as a Thread's screen does, since it is its Thread's view:
      ADR 0089, decision 8, would only name it and open it on a wide
      screen.
22. **A Crew opens beside as the Crew Pane, `agents.crew`**, last in the
    Deck right of the Thread.
    - **It opens by itself once**, when the Crew starts; closed, it stays
      closed for that Crew. (Roma's call 7.)
    - Its header: "Crew · audit-routes", "from ‹Thread›", Stop while it
      works, and a menu with View script and Copy result. A finished Crew
      keeps its Pane open, its clock stopped.
      _Amended 2026-11-10, during step 1 (Roma's call 11):_ no Stop. To stop a Crew, the
      Person tells Claude, which runs it.
    - Its body: one line of counts with the clock and the tokens, a
      filter (All, Working, Asks, Failed), the script's last log line,
      the strip, then the phases.
    - **Phases are columns when the Pane is wide (760 px and more), and
      bands when it is narrow; a Timeline is a tab beside them.**
      (Roma's call 8.) In columns, a pipeline's agents keep their row
      from phase to phase. In bands, done agents fold into "✓ 38 done"
      and queued ones into "6 waiting for a slot"; working, asking and
      failed ones always show.
    - An agent's detail: its label, phase, state, model, attempt, tokens
      and time; its brief, its work, its result (JSON folded with a
      fade).

### What the Person can do

23. **Stop one sub-agent**: Claude's, and Codex's while it works, when
    the Harness lets it (`capabilities.cancel`). It sends
    `session/cancel` with the child's session; the parent's turn goes on.
    A Crew's agents cannot be stopped one by one, and an agent's detail
    shows no button for it.
    - _Amended 2026-11-10, before step 1:_ only the Person, or the
      Thread's own Agent, stops a sub-agent: `agents.stop_subagent`
      refuses another Thread's Agent, as `agents.switch` refuses Agents
      (`apps/agents/engine/src/lib.rs:1250-1256`). "Stopped by you" is
      written only when the Person asked; stopped by its Thread's Agent,
      or by its parent as Claude stops its foreground children, a
      sub-agent ends Stopped with no reason, not Failed. Reason: another
      Thread's Agent cannot see these sub-agents, and only the Person's
      gesture acts as the Person (ADR 0083). After one Codex sub-agent
      is stopped, Banda tells its parent (Open questions).
    - _Amended 2026-11-10, during step 1 (Roma's call 11):_ **dropped.** Banda stops no
      sub-agent: no `agents.stop_subagent`, and no Stop on a row, in a
      sub-agent's Pane or in the Crew Pane. Reason: the Harness already
      manages its sub-agents, as Claude Code and Codex do on their own;
      Banda shows them.
24. **The Thread's Stop stops its sub-agents and its Crew too, and says
    so**: "You stopped Claude, 2 sub-agents and Crew audit-routes". Its
    tooltip says it before. (Roma's call 10.)
    - It cancels the turn, then each lane at work with its own
      `session/cancel`: a background sub-agent outlives the parent's
      cancel once Banda declares sub-agents. A `session/cancel` with no
      prompt open stops a Crew, as step 0 recorded.
    - _Amended 2026-11-10, before step 1:_
      - **Stop stays after the turn.** It is offered on the Thread's
        latest turn while a direct sub-agent works, even once that turn
        has ended. It then stops the sub-agents, and the turn keeps the
        state it ended in. A nested sub-agent at work alone gives no
        Stop, though fork and rewind wait for it (Open questions).
        Reason: `can` is per turn and the composer already stops a turn
        (`apps/agents/pane/src/composer/Composer.tsx:484-492`), so one
        command and one rule stay
        (`apps/agents/engine/src/rules.rs:241-258`); the Pane works `can`
        out again after each fact, and learns the sub-agents' part of it
        (`apps/agents/pane/src/thread/state.ts:161-219`). Nested work
        goes with direct work, as a Claude sub-agent's end waits for its
        own (`recordings.md:300-309`).
      - **The turn first, then each sub-agent, whatever the turn did
        meanwhile.** The Stop marks each sub-agent at work as stopping,
        with who asked, in its own transaction. Its effect cancels the
        turn only while the turn still runs, then each marked sub-agent
        still at work, in the order they started. Reason: today the
        effect does nothing once its turn has ended
        (`apps/agents/engine/src/effects.rs:153-168`), so a turn that
        ended between the Stop and its effect would leave its
        sub-agents at work.
      - **A sub-agent with no `cancel` is left to its Thread's
        `session/cancel`**: the turn's while it runs; once the turn has
        ended, one the effect sends with no prompt open, as that stops a
        Crew (step 0). So the Stop after the turn counts only the
        sub-agents it can reach: the direct ones at work, by their own
        `cancel` or by this one. Reason: one left at work would keep
        fork, rewind and a folder move refused, and its process held,
        for good. The fake agent tests it: a sub-agent with no `cancel`,
        stopped after its turn, ends Stopped.
      - **Whose Stop stops them.** The Person's and the Thread's own
        Agent's. Another Thread's Agent stops the turn, as today, and
        no sub-agent. Banda's own stop, to give way to a message, stops
        none (`apps/agents/engine/src/rules/moves.rs:202-203`): it marks
        the turn only, and the effect cancels only the sub-agents a Stop
        marked. A sub-agent's mark clears as it ends and as a later turn
        resumes it, in the store and in the fold, so no later stop
        cancels it for an old Stop. A test stops a sub-agent, has the
        fake agent resume it, then gives way to a message: it still
        works.
      - **After the turn, the rows say it.** The turn's own words stay
        as it ended; each sub-agent stopped says "Stopped by you" on
        its row.
    - _Amended 2026-11-10, during step 1 (Roma's call 11):_ **dropped.** The Thread's Stop is
      today's: it stops the turn, and the Harness decides what becomes of
      its sub-agents and its Crew. With the declaration, Claude holds its
      turn while a background sub-agent works (`recordings.md:311-321`),
      so that Stop reaches them through Claude. No Stop is offered after
      the turn, and Stop's words stay today's. Call 10 gives way to call 11.
      - What Banda still does to a sub-agent comes from what it holds,
        the Harness's process and session, not from steering the
        sub-agent. A sub-agent's Question is the Harness's, answered as
        the Person chooses (decision 28). When Banda ends a process or a
        session itself (a restart, the Harness stopping, a trust or
        account change, a move, a Project removed), the sub-agents at
        work in it end Lost (decision 11).
25. **No message goes to a sub-agent directly**: ACP lets a client only
    cancel a child. **Ask Claude about it** focuses the parent's
    composer with a chip of the sub-agent's satellite and name; the
    message steers the running turn, or starts one (GLOSSARY, Steering),
    and reaches Claude as "(about sub-agent 'Reviewer')". Claude's
    SendMessage shows as a work row, "Messaged Reviewer". The Harness's
    agent id never shows. For Codex: Ask Codex about it.
26. **No pause, restart or skip of a Crew's agents.** A Lost Crew, or
    agents failed at a usage limit ("Failed · Usage limit · ask Claude
    to go on after 15:00"), get one action, **Ask Claude to go on**,
    which sends Claude a ready message to go on from the last run.
27. **A sub-agent's changes in its own worktree** get a card in its Pane,
    "Left changes on ‹branch› · +120 −14", with Review (the Diff Pane on
    that branch), Ask Claude to merge and Discard, and its row a chip
    "worktree · from main". **Later**: ACP does not say the branch, and
    the engine must learn it first. (Roma's call 9.)

### When a sub-agent asks or fails

28. **A sub-agent's Question docks on the parent's composer and names who
    asks** (ADR 0058, decision 6): "Reviewer asks · 2m", the command in
    mono, the answers with their keys.
    - Its row turns to a triangle; the Thread's card goes to Your turn,
      line 2 "Asks · Reviewer: allow pnpm vitest sidebar?".
    - An answer that holds for the session says so under the answers:
      "Allow for this Thread" covers Claude and all its sub-agents.
    - _Amended 2026-11-10, before step 1:_
      - **A message says no only to the Agent's own Question.** The dock
        shows the Agent's own open Question before a sub-agent's. With
        only a sub-agent's docked, a message goes to the parent and the
        Question stays open, and the composer reads "Answer above, or
        write to ‹Harness›". Reason: today a message first says no to
        whatever Question is docked
        (`apps/agents/pane/src/thread/session.ts:390-391`), so a word to
        Claude would quietly answer Reviewer "no".
      - **A sub-agent's Question is answered by the Thread's mode when
        it comes**, made Supervised where the fence does not keep Full
        access, as a turn's start makes it
        (`apps/agents/engine/src/full_access.rs:50-66`); the parent's
        own keep their turn's mode
        (`apps/agents/engine/src/transcript.rs:350`). A Harness with
        modes of its own, as Claude Code and Codex, still answers by them.
        Reason: a sub-agent can ask after its turn ended, and a Person who
        has since chosen Supervised must not have the sub-agent's tools
        allowed under the old mode.
      - It closes as its sub-agent ends or is Lost, not with its turn
        (decision 8). The Thread draws no "Waiting for you" line for it:
        its row says what it asks.
      - A sub-agent's Question that comes after its turn has ended is
        heard through the lane's hold on its session (decision 11), as
        no turn runs to hear it, and its answer goes back on that
        connection.
      - In step 1 the Thread asks, as `ListedThread.asking` lists the
        Question, so the card goes to Your turn. Line 2's "Asks ·
        Reviewer: …" is step 3's.
29. **A sub-agent's failure stays inside the Thread**: its row and its
    red satellite (decision 13). The parent's card does not move; the
    parent goes on and calls when it ends. (Roma's call 3.)
30. **The Question to start a Crew** is Claude's own permission request
    for its Workflow call, as it comes under Supervised and Auto-accept
    edits. Banda builds it from the script's `meta`: "Claude wants to
    start a Crew", its title and description, its phases ("1 Scan · 2 Fix
    · 3 Verify"), a note "Up to 16 sub-agents at once · uses your limits
    faster", and 1 Start ⏎, 2 View script, `Esc` No. While it waits the
    Thread shows only its live line, "Waiting for you", with no card yet.
    Under Full access nothing asks: the card comes at once.

### The composer, the sidebar, the bar

31. **Ultracode and Ultra are in the top effort's magenta**, the one
    colour the effort takes: a new token, `--effort-top`, the design
    reference's, as ADR 0031 had the top level. The rest of the effort
    stays lighter text (ADR 0058, decision 8).
    - Claude's Ultracode moves from the mode menu into the model picker,
      a switch at any effort: "Claude starts a Crew for every big task.
      Uses your limits faster." On, the label reads "Opus 5.5 Ultracode".
      _Amended 2026-11-10, during step 1 (Roma's call 12):_ dropped.
      Ultracode stays where the Harness offers it today, in the mode
      menu, and Banda adds no button or switch to start a Crew: the Person
      starts one as in Claude Code. What holds is showing it: the label
      names Ultracode in the top effort's magenta.
    - Codex's Ultra is its slider's last stop, with one line on what it
      costs; the label reads "GPT-5.5 Ultra".
    - While background sub-agents run, the composer says "Steer this
      thread…" and steers.
      _Amended 2026-11-10, before step 1:_ only while a turn runs. While
      sub-agents outlive their turn, the composer is free and a message
      starts a new turn (decision 19).
32. **The sidebar draws no sub-agent** (ADR 0098, decision 23, holds).
    Line 2 of a working card counts the direct ones: "3 sub-agents at
    work", "Waiting on Explore", "Crew audit-routes · Fix 4/7". A
    one-line working row shows its line 2 as a tooltip on hover; the row
    does not grow (ADR 0098, decision 9).
33. **Notifications**: "Reviewer asks · ‹Thread›" and "Crew audit-routes
    finished · 2 failed". A failed sub-agent makes no sound, and a
    finished Crew no sound of its own: Claude's reply after it sounds
    done.
34. **The bar has nothing new.** Its logo shows the loudest Thread (ADR
    0099, decision 9), with its satellites when that one works with
    sub-agents.

## What it amends

- **ADR 0003**: "Later: subagents as child Threads" becomes lanes
  (decision 4). Decision 6's release after 30 minutes waits for lanes and
  Crews at work (decision 11).
- **ADR 0006**: holds. A Harness's sub-agents are part of the Thread's
  Agent.
- **ADR 0019**: a Harness's sub-agents are not its children.
  `ListedThread.parent` comes; a Crew of Banda's own comes later, on
  `send`.
- **ADR 0027, decisions 1, 3 and 4** (amended 2026-11-10, before step
  1): a rewind takes the sub-agents of its turns with it, a fork copies
  them, and neither runs while a sub-agent works (Open questions).
- **ADR 0031**: the label names Ultracode in the top effort's magenta
  (decision 31). Amended 2026-11-10, during step 1: Ultracode stays in
  the mode menu (Roma's call 12).
- **ADR 0058, decisions 4–6**: the work line counts the parent's work
  only, the live line names sub-agents and outlives the turn while they
  work, and a docked Question names who asks. **Decision 8**: the
  effort's top level, Ultracode and Ultra, takes `--effort-top`.
- **ADR 0065, decision 7**: the sub-agent Pane and the Crew Pane open in
  the Thread's Group.
- **ADR 0073, decision 9** (amended 2026-11-10, before step 1): Files
  pulses the file each worker of a Thread works on, its turn and each of
  its sub-agents, and a sub-agent's file goes only as it ends. Follow
  follows the Thread's latest.
- **ADR 0078, decisions 4 and 5** (amended 2026-11-10, before step 1):
  a move is not refused while sub-agents work; they go on where they
  began until the next turn starts on the new entry, then end Lost
  (decision 11). A handoff leaves sub-agents out (decision 10).
- **ADR 0087, decision 6**: the Threads App gains the Pane kinds
  `agents.subagent` and `agents.crew`, and no Item.
- **ADR 0089, decision 8**: on a phone a sub-agent opens as a screen on
  the stack, read only, as a Thread does (decision 21).
- **ADR 0091**: the entries `subagent` and `crew`, and the group row's
  line, each one file and one row, as its decision 8 says.
- **ADR 0098**: decision 8's line 2 gains its words; decision 23 holds;
  decision 24 gets `parent`.
- **ADR 0099, decisions 2–3**: a satellite is its sub-agent's shape, and
  only a failed one takes colour (decisions 12–13 here). **Decision 11**:
  `subagents` counts the direct ones that work or ask, with the failed
  ones and the one label in it, and `crew` beside it (decision 10).
  Amended 2026-11-10, before step 1: `doing` stays the parent turn's, and
  a sub-agent's words move only `stepped`, at most once a second
  (decision 8).
- **GLOSSARY**: **Sub-agent** and **Crew** (with its phases) are new; the
  Mark's entry says a failed sub-agent's satellite is red. Entry gains the
  sub-agent row and the Crew card when they are built.
- **`docs/architecture.md`**: the agents section says how sub-agents
  come and are kept, as step 1 lands.

## Plan

Vertical slices, each its own PR or PRs. Each is tried in the window
before its PR, and with one real Claude Code and one real Codex run once
it is in.

0. **Record first.** Paid recordings, as ADR 0003, decision 13, allows:
   Claude's Agent in the foreground, three in parallel, one in the
   background, one nested, a small Workflow; Codex's spawn. Each with the
   capability and without it. They confirm or refute the "stray replies"
   (Where it stands): if real, they are fixed at once, before lanes, by
   routing or dropping what is stamped `parentToolUseId`.
   - Done on 2026-11-10: the stray replies are not real, so nothing was
     fixed. What came is in
     `docs/research/2026-11-10-sub-agents/recordings.md`, with replay
     tests beside the edit recordings. It settled decision 10's list
     fields and three open questions.
1. **Sub-agents in the Thread** (decisions 1, 3–8, 10–12, 14–17, 19,
   23–24, 28–29): the capability, the routing, lanes and their facts,
   `agents.subagent`, `agents.stop_subagent`, the Thread's Stop, the host
   kept while lanes work; the rows, the group row, the live line's words,
   the docked asker and its notification.
   - _Amended 2026-11-10, before step 1:_ decision 5's
     `ListedThread.parent` is step 3's, as that step says. Step 1 is
     these PRs, listed in the order they land; each waits only for the
     ones it builds on, so S0, F0 and E0 may land side by side, and ON
     waits as its item says. Each merges alone, with no stacks: the next
     is built ahead, but rebased onto the merged main before
     `gh pr merge --auto --rebase --match-head-commit` is armed with its
     new head. Those nobody sees arm at once. W1, ON, W2 and W3 arm only
     after Roma has seen their pictures: W1's, W2's and W3's from a trial
     that declares sub-agents, ON's from the real runs.
     1. **#1196**, ADR 0099's step 2, is the sidebar session's and landed
        first (main bb74ac98, 2026-11-10). E1a to E1c start from main
        after it.
     2. **S0**: this amendment, as AGENTS.md wants the ADR changed before
        code that departs from it.
     3. **F0**: an entry of a kind the window does not know is left out
        of the Thread (decision 10). It is filtered once, where a view's
        entries enter the Pane
        (`apps/agents/pane/src/thread/state.ts:70-86`), and handoff's
        `line()` loses its catch-all. Nothing shows differently, since
        every kind is known today, so it needs no pictures.
     4. **E0** (#1182): a turn ends where its answer comes. The engine
        sends a prompt with the protocol's ordered callback, so what the
        Harness says after its answer goes between turns; the listener
        for between turns starts before the prompt; the fake agent says
        what follows an answer only after writing it, and the replay's
        100 ms pause goes (`tools/fake-agent/src/replay.rs:102-112`).
        Reason: today the turn's route ends in a task of its own
        (`apps/agents/engine/src/acp/session.rs:279-291`), so what comes
        right after `end_turn` can land in the turn that ended
        (`recordings.md:126-130`). Lanes need that order.
     5. **E1a**: the contract, the migration, the store's readers and the
        Pane's fold, with nothing that writes a lane yet: `Question.sub`,
        `ThreadView.subagents` and `edits`; every reader of a Thread's
        entries leaving a lane's out but for its Questions and edits, the
        turns a handoff reads too (`apps/agents/engine/src/store.rs:1091-1104`);
        rewind and fork taking lanes; `can` refusing fork and rewind
        while a sub-agent works. The migration
        is reviewed as final, since an engine does not open a database
        with more steps than it knows (`kernel/src/store.rs:935-937`,
        `:966-971`), and a later change comes after it
        (`apps/agents/engine/src/store.rs:16`).
     6. **E1b**: the switch (decision 7), `unstable_subagents`
        (`Cargo.toml:13`) and the fake agent's sub-agents. The fake reads
        `clientCapabilities.subagents` as it reads the rest
        (`tools/fake-agent/src/main.rs:1318-1331`): declared, it speaks as
        the adapters do with the declaration; not, as they do without.
     7. **E1c**: routing, lanes, the host kept and let go, Lost, reports,
        Files' touch per sub-agent and `stepped`. Dark: with the switch
        off, no `subagent_update` comes.
     8. **E2**: the stops. `agents.stop_subagent`, the Thread's Stop after
        the turn, `can` in the engine and the Pane, the composer's Stop,
        the Codex steer. Dark.
     9. **E3**: a sub-agent that ends after its turn. Git takes that
        turn's `after` again, and the Diff and Files read again on
        `subagent.ended` (decision 8;
        `apps/git/engine/src/checkpoint.rs:28-34`). Dark.
     10. **R**: the paid recording through Banda with the switch on, and
         its replay tests. Its recorder waits for the sub-agents to end
         too, and its replays run in a test world that declares
         sub-agents, as the switch does; ON drops that with the switch.
         What it shows wrong goes to issues, not into R.
     11. **W1**: the satellite, `thread/subagents.ts`, the row, the group
         row, a row opened in place with Stop, the row's now (decision
         15), Find, and Files' Follow. Dark on Dev. It is tried with
         `BANDA_SUBAGENTS=1 scripts/try.sh --hidden --detach`, and its
         end-to-end tests open their window with that variable. One of
         them shows that a Pane a sub-agent opens joins the Thread's
         Group (decision 1).
     12. **ON**: Banda declares sub-agents. It deletes the switch and adds
         no logic, so reverting it is the way back. It is armed once W1
         and R are on main, a Dev that has F0 runs on both of Roma's
         machines (the Mac updates by hand through the brew tap), as one
         machine's window reads the other's engine, and one real Claude
         Code run and one real Codex run have been shown to Roma.
     13. **W2**: the live line's words and Stop's words.
     14. **W3**: the docked asker, `Asking.asker` and the notification,
         agreed first with the sidebar session, whose files these are.

     ON comes after W1 and not after W3, because W2 and W3 only add
     words. With the declaration, Claude holds its turn while a
     background sub-agent works (`recordings.md:311-321`), so the Thread
     does not look Done while it does; a sub-agent's Question already
     docks, without its name; and Roma gets real rows to try sooner. ON
     cannot come sooner: with the declaration Claude sends no Agent call
     (`recordings.md:259`), so without the rows nothing shows a
     sub-agent, and without routing its Question is answered `Cancelled`
     (`recordings.md:296-298`). From E1a to R the tests as they are pass
     with the switch off, which proves each dark PR. After ON, the Part A replays still pin an adapter that
     ignores the declaration, since a replay lets `initialize` differ
     (`tools/fake-agent/src/replay.rs:10`, `:168`).
   - _Amended 2026-11-10, during step 1 (Roma's calls 11 and 12):_ S0,
     F0, E0, E1a and E1b are on main. The rest lands in this order:
     1. **E1c**, as above.
     2. **W1** without Stop: the satellite, the rows, the group row, a row
        opened in place, the row's now, Find and Files' Follow.
     3. **ON**, with R in it: the paid recording through Banda and its
        replay tests land with the declaration. ON is armed once W1 is on
        main, a Dev that has F0 runs on both of Roma's machines, and one
        real Claude Code run and one real Codex run have been shown to
        Roma.
     4. **W2**: the live line's words, without Stop's.
     5. **W3**, as above.

     E2 is dropped with decisions 23 and 24. E3 leaves step 1 for issue
     #1326, with #1281: both Harnesses wait for their sub-agents before
     they end a turn, so a sub-agent's edit after its turn is rare.
     Reason: Roma wants sub-agents to try sooner, and they show without
     Banda stopping them.
2. **A sub-agent opened beside** (decisions 21, 25): its Pane, the status
   bar, Ask Claude about it, the breadcrumb, the screen on top.
3. **The sidebar and the Mark** (decisions 13, 28, 32, 34):
   `ListedThread.subagents` and `parent`, `Asking.asker`; the satellites
   and line 2's words for sub-agents.
   - It is split with ADR 0099's steps, agreed between the two sessions
     on 2026-11-10: the Mark's looks, `doing`, `stepped`, `compacting`,
     `limit_until` and the window following them are ADR 0099's steps
     1–3. This step adds the fields above, the red satellite on top of
     0099's looks, and the words. The card keeps an optional
     `subagents` that reads nothing until this step fills it, in
     decision 10's shape.
   - _Amended 2026-11-10, before step 1:_ `Asking.asker` comes earlier,
     in step 1's W3, for the notification. This step also ends step 1's
     gap: while sub-agents outlive their turn, the list, the Mark, the
     bar and the sound say Done until `ListedThread.subagents` comes
     (decision 19).
   - _Amended 2026-11-10, with ADR 0098's step 14:_ `ListedThread.parent`
     came with ADR 0098's S14a, so this step adds `subagents` only.
4. **A Crew in the Thread** (decisions 2, 9, 18–20, 26, 33): the raw SDK
   frames into Crews, `agents.crew`, `ListedThread.crew` and line 2's
   Crew words, the card, the live line after the turn, the host kept
   while a Crew works, Lost and Ask Claude to go on. An update waits for
   a Crew at work as it waits for a turn, since its Thread works (ADR
   0072, decision 3).
   - _Amended 2026-11-10, before step 1:_ it also takes "↩ Reviewer
     finished" (decision 19) and `Subagent`'s `crew`, `phase` and
     `background` (decision 10).
5. **The Crew Pane** (decision 22): columns, bands, the Timeline, an
   agent's detail.
6. **The Crew's start and the composer** (decisions 30–31): the
   Question built from `meta`; Ultracode and Ultra.
   - _Amended 2026-11-10, during step 1 (Roma's call 12):_ no button
     starts a Crew. This step shows Claude's own Question to start one,
     and Ultracode's and Ultra's magenta.

Later: a worktree's changes (decision 27); Save as command in the Crew
Pane's menu, the script copied to `.claude/workflows/`; Crews of Banda's
own over `send`, as the Threads App's table of runs (ADR 0082, decision
8), the first candidate for `task@1`.

## Roma's calls

On 2026-11-10, over the mocks, Roma took every recommendation. The ten
questions, each as recommended:

1. The word: **Crew** (decision 2).
2. A satellite is a mini-shape by state, everywhere (decision 12).
3. A sub-agent's failure stays inside the Thread; the parent's card does
   not move (decision 29).
4. On the Mark only a failed sub-agent takes colour: red, an octagon at
   48 px, a dot at 16 px; no orange satellite (decision 13).
5. One ticking clock per surface: the live line and the Crew Pane's
   header; rows' durations stay still (decision 20).
6. Tokens only in the Crew Pane and an agent's detail (decision 20).
7. The Crew Pane opens by itself once, in the Thread's Group, and stays
   closed for that Crew once closed (decision 22).
8. The Crew Pane: phase columns when wide, bands when narrow, the
   Timeline a tab (decision 22).
9. A worktree sub-agent's changes: Review, Ask Claude to merge, Discard;
   later, after the engine learns the branch (decision 27).
10. The Thread's Stop stops its sub-agents and its Crew, and says so
    (decision 24). It gave way to call 11.

And the mocks' other picks: a finished group folds to one line; no card
while a Crew waits to start; "Opus 5.5 Ultracode", the shorter label; one
action for a Lost Crew; one sub-agent Pane per Group; the chip with the
satellite; "Claude wrote" for the parent's later messages; a screen on
top on a phone; a finished Crew without a sound of its own; line 2 as a
tooltip on a one-line working row.

On 2026-11-10, during step 1 (translated):

11. "Look, Claude already manages the agents without us. We don't need
    to manage them; the Agent does that already." Then: "For sub-agents
    we do as Claude does: we show them, but we don't manage them. The
    Harness does the managing." Banda shows sub-agents and Crews and
    stops none of them (decisions 15, 19, 21–24).
12. Ultracode: "I start it as usual, without special buttons"
    (decision 31).

## Open questions

- **Answered by step 0** (2026-11-10):
  - _Who asks inside a Crew_: nobody is named, with the declaration too.
    Such a Question names the Crew; with two Crews at work it cannot tell
    which.
  - _How Stop reaches a Crew_: a `session/cancel` with no prompt open
    stops it once Banda declares sub-agents; no patch is needed.
  - _An agent's work in the Crew Pane_: the agents' transcripts reach
    Banda's session store, so an agent's detail can show its work.
- **Answered before step 1** (2026-11-10):
  - _Lanes under rewind_ (ADR 0027, decision 1): they go with their
    launch turn. A rewind deletes their rows and entries with the turn's
    own, and the Pane's fold of `thread.rewound` drops them too. A
    nested lane goes with its parent's. Reason: the session goes back to
    before them, so they never happened in it
    (`apps/agents/engine/src/store.rs:1357-1389`;
    `apps/agents/pane/src/thread/state.ts:346-363`).
  - _Lanes under fork_ (ADR 0027, decision 3): a fork copies the lanes
    of the turns it copies, with their entries, under new ids and
    without their child sessions. The copied anchors and Questions name
    the copies. A lane's Question goes with its lane, though the store
    keeps it as a Thread's entry (decision 8): the copy of the turns'
    entries leaves out, and does not end at, an entry whose body names
    `sub` (`store.rs:1276-1278`), and the lane's copy brings it. Reason:
    the fork keeps what the helpers did, as it keeps the rest of the
    history; its session cannot reach the children; and
    without the lanes the copied anchors would name nothing, since a
    fork copies a body as it is (`store.rs:1286-1289`).
  - _Neither while a sub-agent works_ (ADR 0027, decision 4): fork and
    rewind are refused while any lane of the Thread runs or asks, as
    while a turn runs (`apps/agents/engine/src/lib.rs:1843-1847`,
    `:1869-1873`), and the Pane's `can` says so. Reason: a fork's
    `session/fork`, or a rewind's delete, would act on a child that is
    still sending on a live session.
  - _Lanes in Find_: Find matches a row's label, its role, and how it
    ended, the report's first line or why, read from the lane's record.
    It never reads a lane's entries, even in a row opened in place, nor
    a row's now, which changes as the sub-agent works. Reason: Find reads
    the Thread's entries (`apps/agents/pane/src/thread/findIn.ts:11-28`),
    which hold no lane's, and keeps each entry's words by the entry
    (`:32-41`). An anchor stays the same entry while its lane changes, so
    a row's words come from the lane's record.
  - _Lanes in Copy as Markdown_: it copies what is drawn, with no lane
    code: a row as its words, a row opened in place as its brief, its
    work and its report. Reason: it reads the selection back from the
    page (`client/ui/src/lib/markdown-copy.ts:1-6`;
    `apps/agents/pane/src/thread/Thread.tsx:395`).
  - _Stopping one Codex sub-agent_: Banda tells its parent once, as a
    steer, best effort. When the Person stops a direct sub-agent that had
    no brief, which is Codex's shape, and the parent's turn runs and
    takes a steer, the stop's own effect steers it and writes a notice
    in that turn: "Banda told Codex that ‹label› was stopped." Otherwise
    it does nothing, and the stop is done either way. Reason: a Codex
    parent never learns of the stop and waits on the child, 90 s at a
    time, until it is itself stopped (`recordings.md:341-346`), while a
    Claude parent learns it from its child's failed call (`:330-334`).
    The steer is no effect of its own: a restart abandons every agents
    effect and cuts the parent's turn short with its process
    (`apps/agents/engine/src/lib.rs:1478-1482`, `:1526-1529`), so it
    would have nothing to steer. It goes by that shape, not by the
    Harness's id, so the fake agent can test it.
    _Dropped 2026-11-10 with decision 23 (Roma's call 11)._
- **A Crew's open calls.** A workflow agent's call that asked never ends,
  even after its Crew stops. Step 4 decides whether the engine ends a
  Crew's open calls when the Crew ends.
