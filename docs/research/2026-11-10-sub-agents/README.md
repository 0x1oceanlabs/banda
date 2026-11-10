# Sub-agents and Crews: the research and the mocks

Evidence for [ADR 0103](../../adr/0103-a-harness-s-sub-agents-work-in-their-thread-and-a-crew-shows-beside-it.md).
Date: 2026-11-10, read against main at `26feb9be`. The first five notes
ran no paid session: what no recording showed is marked _inferred_.
Step 0 of the ADR's plan then recorded it, in `recordings.md`. It is
evidence, not a decision.

## The notes

| Note | What it is |
|---|---|
| [`claude-code.md`](claude-code.md) | How Claude Code runs sub-agents (the Agent tool, background and nested ones, agent teams) and workflows (the Workflow tool, ultracode), and how the CLI and the desktop app show them. |
| [`codex.md`](codex.md) | How Codex runs its sub-agents (`spawn_agent`, multi-agent V1 and V2, Ultra), and how its CLI and desktop app show them. |
| [`landscape.md`](landscape.md) | How other products show sub-agents and parallel agents (T3 Code, OpenCode, Cursor, Amp, Zed, Conductor, Copilot, Devin, Factory and more): the patterns to take and those to avoid. |
| [`banda-arch.md`](banda-arch.md) | What Banda receives today and how it draws it; what ACP's Subagent Sessions RFD offers; three ways to keep a sub-agent (an entry, a lane, a child Thread) and the recommended one, lanes; the contract sketch, the engine pieces and the plan. |
| [`gaps.md`](gaps.md) | A check of the four notes before the mocks: where they disagree, one state table, what the Person can really do over ACP, work that outlives the turn, scale, depth, worktrees, tokens, and the questions put to Roma. |
| [`recordings.md`](recordings.md) | Step 0: what real Claude Code and Codex runs with sub-agents and a workflow sent, as Banda is today and with the sub-agents capability declared; the stray replies refuted, and the fields step 3 needs. Its recordings are in `apps/agents/engine/tests/recordings/` and [`acp-with-subagents/`](acp-with-subagents/). |

A sixth note, `banda-look.md`, on how Banda looks, became the design
reference, [`docs/design/README.md`](../../design/README.md), with its kit
in `docs/design/kit/`. The notes still cite it as banda-look.

## The mocks

Six HTML pages, one scenario on every page: the Thread "Move sidebar
settings to sidebar.toml" (Claude Code, Opus 5.5) with three sub-agents
(Map, Check tests, Reviewer) and the Crew `audit-routes` (Scan 2 · Fix 7 ·
Verify 3, twelve agents). The UI is in English; the notes around it are in
Russian, as Roma reads them. They draw with the design kit, so open them
from a checkout where `docs/design/kit/` is.

| Page | What it shows |
|---|---|
| [`mocks/00-hero.html`](mocks/00-hero.html) | The whole window live, a 40 s run, the idea, the satellite's grammar, where each thing lives by scale, and the ten questions with their picks. |
| [`mocks/01-thread.html`](mocks/01-thread.html) | Sub-agents in the Thread: one row, a group row, every state, a row opened in place, and what stays when they are done; today beside what will be. |
| [`mocks/02-crew-in-thread.html`](mocks/02-crew-in-thread.html) | A Crew in the Thread: the approval to start, the Crew card in every state (12, 50 and 500 agents, Lost), work that outlives the turn, Ultracode and Ultra in the composer. |
| [`mocks/03-crew-pane.html`](mocks/03-crew-pane.html) | The Crew Pane: phase columns, an agent's detail, the narrow Pane at 50 agents, the Timeline, the end and Lost. |
| [`mocks/04-subagent-pane.html`](mocks/04-subagent-pane.html) | A sub-agent opened beside: the status bar, Ask Claude about it, a nested sub-agent, a worktree's changes, Codex, the phone and the Drawer. |
| [`mocks/05-sidebar.html`](mocks/05-sidebar.html) | The sidebar, the Mark, the bar and the notifications: Your turn because a sub-agent asks, child Threads with ↳, satellites on the Mark. |

One frame, as JPEG, for the ADR: [`crew-after-the-turn.jpg`](crew-after-the-turn.jpg)
(page 02, C). The ADR's other two, the window and the satellites, are the
design reference's ([`../../design/shots/`](../../design/shots/)).

## Sources

- Banda's own code at `26feb9be`; the two recordings in
  `apps/agents/engine/tests/recordings/`, neither with sub-agent traffic.
- The adapters Banda pins: `@agentclientprotocol/claude-agent-acp` 0.99.1
  and `@agentclientprotocol/codex-acp` 2.5.0 (the patched copy), in
  `node_modules`; `@anthropic-ai/claude-agent-sdk` 0.3.312's types.
- The Rust crates `agent-client-protocol` 3.6.0 and
  `agent-client-protocol-schema` 1.13.0.
- ACP's Subagent Sessions RFD,
  https://agentclientprotocol.com/rfds/subagents, behind
  `unstable_subagents`, fetched 2026-11-10.
- Claude Code's docs (code.claude.com/docs/en/sub-agents, workflows,
  worktrees) and CHANGELOG; the CLI 2.1.321, read with `strings`.
- Codex's source (`openai/codex` at `caae161`), its CLI 0.167.0 and its
  desktop app's strings; its docs.
- T3 Code (github.com/pingdotgg/t3code) at `337c5858`, for precedent;
  OpenCode, Cursor and the others as `landscape.md` names them.
