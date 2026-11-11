# How others bound a turn and a chain of agents

- **Date:** 2026-11-11.
- **For:** Roma, before the ADR on the bounds of a turn and of a chain of
  Agents. ADR 0019 put them off (decision 5: "Limits on depth or count,
  budgets, ... stopping a whole chain at once").
- **How:** read-only, no paid session. Claude Code 2.1.322: its docs
  (`code.claude.com/docs/en/env-vars`, `agent-teams`,
  `cross-session-messaging`) and the names in the installed program.
  Codex: `openai/codex` at `87b7bdb`. The adapters Banda pins, as
  installed: `claude-agent-acp` 0.99.1, `codex-acp` 2.5.0. Gemini CLI,
  OpenAI Agents SDK, Pydantic AI, LangGraph and CrewAI: one source file
  each, on their main branches. Banda at `ffe8a816`.
- **Limits:** OpenCode, Cline, Roo, Cursor, OpenHands and A2A were not
  reached. `codex-acp` is one bundled file and was only searched. What a
  long tool sends over ACP while it runs, minute by minute, was not
  recorded. The last section is from general knowledge, not read again.
- **Status:** research. It is evidence, not a decision; ADR 0109 is.

Earlier notes already hold part of this, and are not repeated: old Banda's
chains ([`2026-11-01-old-banda-mcp.md`](2026-11-01-old-banda-mcp.md)),
T3 Code's ([`2026-11-01-t3-code-mcp.md`](2026-11-01-t3-code-mcp.md)),
herdr-core ([`2026-11-01-herdr-core.md`](2026-11-01-herdr-core.md)), and
how Claude Code and Codex run sub-agents
([`2026-11-10-sub-agents/`](2026-11-10-sub-agents/README.md)).

## In short

1. **Nobody bounds a whole turn by the clock. Everybody bounds silence.**
   Claude Code and Codex both close a model stream that says nothing for
   five minutes, and retry. A tool has its own timeout. A turn may run for
   hours as long as something moves.
2. **A cap on steps is no longer a default.** Claude Code, Codex and
   Gemini CLI have none unless asked. LangGraph raised its default from 25
   to 10007. Small defaults (10, 50) remain only in libraries.
3. **Depth and count are held in code, and the model is told what to do
   instead.** Claude Code: three levels, twenty at once. Codex: one level,
   six threads, and "Solve the task yourself."
4. **Loops between peers are throttled, not forbidden.** Claude Code's
   sessions drop repeats and limit a sender's rate. Gemini CLI counts the
   same call five times, then asks a model.
5. **Money is an opt-in cap per run, and nobody totals a chain.**
6. **Stop goes down, never sideways.** A parent stops its children. No
   product lets one peer stop another's work, and the Person has a "stop
   all".
7. **A message from an agent is marked as not the Person's**, and Claude
   Code holds one that would cross from a session that asks into a session
   that does not.

## One turn

| | Claude Code | Codex | Banda today |
|---|---|---|---|
| Whole turn, by the clock | none | none | none |
| Steps in a turn | `--max-turns`, `CLAUDE_CODE_MAX_TURNS`: off unless set; ends `error_max_turns` | none found | none |
| Money | `--max-budget-usd`: off unless set; ends `error_max_budget_usd` | none | none |
| A silent model stream | event and byte watchdogs, on by default; 5 minutes at least, 30 at most (`CLAUDE_STREAM_IDLE_TIMEOUT_MS`) | 300 s (`stream_idle_timeout_ms`), then 5 retries | not watched |
| A request that fails | 10 retries; with `CLAUDE_CODE_RETRY_WATCHDOG`, "for unattended sessions", without end, waiting out a usage limit | 4 retries | the Harness's |
| A shell command | 2 minutes, 10 at most, then it moves to the background | 10 s unless the model asks for more | the Harness's |
| An MCP tool call | about 28 hours in all; with no answer or progress, 30 minutes on stdio, 5 on the network; to the background after 2 | per server | `banda mcp` answers one call at a time |
| A sub-agent that stalls | 10 minutes (`CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS`) | waits of 10 s to 1 h, then the caller goes on | shown only (ADR 0103) |
| A loop in one turn | a guard on Stop hooks only (`stop_hook_active`) | none found | none |

- The 5-minute floor has a reason in Claude Code's own words: "to absorb
  extended thinking pauses and proxy buffering". A watchdog that fires
  sooner fires on healthy work.
- Gemini CLI is the one with loop detection in a turn: the same tool call
  5 times in a row, the same text 10 times, and past 30 turns in one
  prompt a model judges the last 20, and calls a loop at 0.9. It then
  asks the person, who may turn it off for the session.

## What reaches Banda through ACP

- `claude-agent-acp` takes `maxTurns` and `maxBudgetUsd` in
  `_meta.claudeCode.options` and ends such a turn with the stop reason
  `max_turn_requests` (`dist/acp-agent.js:408-418, 5517-5536`). Banda
  passes only `env` and `settingSources`
  (`apps/agents/engine/src/acp/opening.rs`), and already maps that stop
  reason (`acp/failure.rs:60-70`). Codex has no such option.
- The adapter bounds its own cancel: 30 s after `session/cancel` it ends
  the prompt as `cancelled` even when the SDK is stuck
  (`DEFAULT_FORCE_CANCEL_GRACE_MS`, `dist/acp-agent.js:81-90`). Banda has
  nothing above it: a Harness that does not answer at all keeps the turn
  running until the engine restarts. The code says so itself: "Starting a
  Harness and opening a session are bounded; a turn is not"
  (`apps/agents/engine/src/acp.rs:18-19`).
- A cancel does not end everything: "a background subagent can keep
  running after a cancel" (the same file, `cancelTurns`).

## A chain of agents

| | Claude Code | Codex | T3 Code | Old Banda | Banda today |
|---|---|---|---|---|---|
| Depth | 3 (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`) | 1 (`max_depth`) | in the prompt only | none | none |
| How many | 20 at once; the cap of 200 a session was removed in 2.1.224 | 6 threads, 4 in V2 with the root | 20 in one batch | a notice past 20 requests or 5 hops | none |
| Told to the model | an error from the Agent tool | "Agent depth limit reached. Solve the task yourself." | — | "@x is already working on this chain" | "Thread X waits for your answer" |
| A circle | teammates start no teammates | the tree has none | none | refused on the chain's path | refused while the chain is live |
| Back and forth | per sender: a rate limit, repeats dropped, 50 queued: "a message loop between two sessions therefore stops on its own" | — | none | "words wake no one" | none |
| Stop | `x` one, Ctrl+X Ctrl+K all background agents; a teammate is asked to shut down and may refuse | `close_agent` closes the subtree; `interrupt_agent` one | per thread | Stop cascades down the chain | per turn; the answer wakes the asker |
| Money for a chain | none; "token costs scale linearly" | none | none | the subscription's limit is "the real brake" | none |

### Claude Code's messages between sessions

It is the nearest thing to Banda's `send`: sessions the Person started,
writing to each other. It has been on by default since 2.1.224.

- An idle session starts a turn with the message; a busy one reads it
  between tool calls. It counts toward usage "like a prompt you type".
- The receiver is told the message "came from another session, not from
  you". It "can't approve anything", "can't change configuration", and
  commands in it do not run.
- **The wall between modes.** With nothing set, a session that skips
  permission prompts **holds** every message for the Person's approval,
  and takes one only from a sender that skips them too. A session that
  asks takes every message, but holds one from a sender that skips. The
  held message shows a dialog, Approve or Deny, and is dropped after five
  minutes. The setting is `crossSessionInbound`: accept, hold or refuse.
- A burst to one session is refused at the sender: "batch the rest into
  one message or wait".
- A wait has an end: a notice asked for when another session goes idle is
  dropped after 12 hours, "so it doesn't keep waiting".
- To another machine, `isolatePeerMachines` makes the Person approve each
  message before it leaves.
- Nothing lets one session stop another.

### Teams

Experimental, off by default, and not in SDK sessions, so not through
Banda's adapters today. Any teammate writes to any other. Only the lead
manages the team. There is "no hard limit on the number of teammates".
The docs' own warning is the one that matters here: "Letting a team run
unattended for too long increases the risk of wasted effort."

## The mechanisms, side by side

| Mechanism | Who | When it trips | It then |
|---|---|---|---|
| Silence watchdog | Claude Code, Codex | 5 minutes with no bytes | retries, then fails the request |
| Step cap | OpenAI Agents SDK (10), Pydantic AI (50) | the count | fails the run |
| Money cap | Claude Code (opt-in) | the sum | ends the turn |
| Depth cap | Claude Code (3), Codex (1) | a spawn too deep | refuses, and says so to the model |
| Count cap | Claude Code (20), Codex (6) | a spawn too many | refuses at once |
| Circle refused | old Banda, Banda | a write up the live chain | refuses, and says why |
| Repeats throttled | Claude Code, Gemini CLI | the same thing again | drops it, or asks the person |
| A model judges | Gemini CLI | past 30 turns | asks the person |
| A notice, no block | old Banda | 20 requests or 5 hops | one notice with "Stop everything" |
| Hold for the person | Claude Code | a message across modes | waits for Approve |
| Stop down the tree | Codex, old Banda | a stop of the parent | ends the children |
| Stop all | Claude Code | two key presses | ends every background agent |

## The same problem, solved before

From general knowledge, not read again for this note.

- **Temporal.** An activity has a heartbeat timeout apart from its total
  time: silence means dead. A child workflow says what happens when its
  parent closes: terminate, ask to cancel, or abandon.
- **Structured concurrency** (Trio, Go's `context`). Cancel flows down
  the tree. A child inherits its parent's deadline and can only shorten
  it.
- **systemd.** `WatchdogSec`: the service must ping. `TimeoutStopSec`:
  SIGTERM, a wait, then SIGKILL. `StartLimitBurst`: give up after too
  many restarts.
- **Networks.** IP's TTL, HTTP's `Max-Forwards`, mail's `Received`
  count: each hop carries a number that only goes down.
- **Tracing.** One id for the whole chain, a parent id on each part.

## What Banda took

[ADR 0109](../adr/0109-banda-sets-no-limits-on-agents-and-a-person-s-stop-always-ends.md)
took two things and refused the rest.

- **Taken: Stop must end.** The adapter gives up a cancel after 30 s.
  Banda adds the step after it, as systemd has: ask, wait, then end the
  turn in its own books and let go of the session.
- **Taken: silence is shown, not acted on.** ADR 0099 already draws a
  Mark as stuck after three minutes with no event.
- **Refused: every limit.** No cap on steps, depth, count or money, no
  hold that asks to go on, no approval of a message across modes. Banda
  is an adapter of Harnesses, and its Agents run for days; the Harness
  and the provider keep their own limits, and the fence is the wall.
