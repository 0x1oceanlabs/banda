# How Agents talked to each other in the old Banda (bandad 0.3.x)

- **Date:** 2026-11-01.
- **For:** Roma, before he designs the new Banda's MCP module (ADR 0005, decision 14).
- **How:** read-only. I read code and docs in `~/code/bandad` at `1f737eb` (2026-10-19, "chore(protocol): tidy the text rule after review (3.3)"). I ran nothing and read no data, sessions or credentials.
- **Status:** research only. Nothing here is a Banda decision.
- **Paths** are relative to `~/code/bandad` unless marked. Line numbers are for that commit.

---

## 0. The short answer

The old Banda had **two different MCP servers**. Only one of them carried agent-to-agent talk.

1. **`banda mcp`** (Rust, `crates/banda/src/mcp/`). A local stdio server for Harnesses that a Person ran in Terminals of Banda Desktop. 21 tools: terminals, files, browser. **No agent-to-agent tools.** No caller identity at all.
2. **`banda_mcp.py`** (Python, `runner/banda_mcp.py`, 690 lines). The stdio server that every **Space Agent** got. Space Agents were Harness processes (Claude Code, Codex) driven over ACP by the runner, inside one Docker "workstation" per Space. This server is where `ask_agent`, `reply`, `ask_person`, `wake_me`, `read_agent`, `space_status` and the rest lived. **This is what the owner remembers.** It ran a team of 9–12 Agents (lead, builders, reviewer, arc) that built Banda itself on the "workbench" server (`docs/agents/team.md`).

What made it work was not the MCP layer. That layer was a thin, stateless relay. The good part was **Core's request model behind it**:

- every piece of work is a **request** with a **Person at the root**;
- `ask_agent` makes a child request in the callee's queue and **returns at once**;
- the callee's `reply` comes back to the caller as a **new request (a "result") that wakes it** and continues the caller's original request;
- a busy Agent takes new messages **into its running turn** (steering) instead of queueing;
- cycles are refused in code; Stop cascades down the chain; a big chain is announced, not blocked;
- everything shows in the Agent threads and on the Room card.

---

## 1. How MCP reached each Harness

### 1a. Space Agents (the agent-to-agent server)

- **Transport: stdio**, one Python process per ACP session.
- **Injected through ACP `session/new` / `session/load` / `session/resume`.** The runner passes `mcpServers: [{name: "banda", command: "/usr/bin/python3", args: ["/opt/banda-managed/banda_mcp.py"], env: [...]}]` (`runner/session.py:121-123`). The same call works for every ACP Harness. No Harness config file is written.
- **The env carries the identity**: `BANDA_ORIGIN`, `BANDA_AGENT_TOKEN` and, if needed, `BANDA_CA_FILE` (`runner/launch.py:43-47`). The Harness's own environment also gets the token (`launch.py:29-30`), but the shared Codex app-server never does (`launch.py:48-53`, `runner/quirks.py:42-54`).
- **The server holds nothing.** Each tool call is one HTTPS POST of `{"token", "request"}` to `BANDA_ORIGIN + /api/agent-tools` (or `/api/agent-questions` for `ask_person`) (`runner/banda_mcp.py:37-60`). HTTPS only, no redirects, 1 MiB response cap, 30 s timeout (`banda_mcp.py:21-49`).
- The edge (`crates/banda-api/src/identity_paths.rs:33-34, 201-235`) relays to `Core::agent_tool` (`crates/banda-core/src/agents/tool.rs:15`), which runs every tool **inside one Core write transaction**.
- **Per Harness differences** are data in `harnesses/catalog.json`: only the prefix the Harness gives Banda's tools (`mcp__banda__` for Claude Code at `catalog.json:24`, `mcp.banda.` for Codex at `:44`), its steering mode (`own_turn_only` / `may_start_turn`, `:27`, `:47`) and its permission dialect. The runner uses the prefix to spot Banda's tools in the stream (`runner/permissions/dialects.py:40-74`, `runner/transcript.py:261`).
- `initialize` answers protocol `2024-11-05` and **sends no `instructions`** (`banda_mcp.py:575-579`). All guidance came through the turn prompt (section 6).

### 1b. Desktop Terminals (local server, no agent-to-agent)

- `banda mcp` is the same binary in another mode, stdio, JSON-RPC (`crates/banda/src/mcp/mod.rs:1-6, 216-253`; `command_tree.rs:297`).
- Banda Desktop adds it to the Harness **command line** when it launches one in a Terminal: Claude gets `--mcp-config '{"mcpServers":{"banda":{"command":…,"args":["mcp"]}}}'`, Codex gets `-c mcp_servers.banda.command=… -c mcp_servers.banda.args=["mcp"]`, others (omp) start unchanged (`crates/banda-desktop/src/app.rs:2330-2362`). A per-Harness switch `mcp: true` sits in `desktop.json` (`crates/banda-desktop/src/config.rs:191-194`).
- It does send `instructions`, one sentence (`mcp/mod.rs:176`).

---

## 2. Identity: who is calling

- **One bearer token per Agent attachment.** When the runner attaches an Agent, Core makes 32 random bytes as hex and stores only its **SHA-256** in `agents.capability_digest` (`crates/banda-core/src/agents/runtime.rs:67-90`).
- **A fence ends it.** A new attachment, Stop, a settings change or a sign-in change bumps the Agent's `generation` and clears the digest (`runtime.rs:17-44`). A late heartbeat alone does not (`runtime.rs:213-216`).
- **Every tool call checks three things** (`runtime.rs:200-235`):
  1. the token's digest names an Agent;
  2. its Space is active and the Agent's desired state is Running;
  3. the Agent's heartbeat is fresh (60 s window, `store.rs:588`).
- **The token names the Agent, not the turn.** The model must pass `request_id` on almost every tool. Core then checks that the request is this Agent's, in this generation, still `active` or `waiting`, and that **its requester is still a Member of the Space** (`crates/banda-core/src/agents/request/access.rs:6-29`; `tool.rs:23-25, 341-365`).
- **Authority is the root Person's.** Every request carries the Person at the root of its chain as `requester`. Membership checks follow that Person at every hop. If the Person leaves, the chain's pending work is cancelled (ADR 0018, `docs/adr/0018-agents-ask-each-other.md:29-35`).
- **Scope: the Space.** `ask_agent` resolves the callee by username **within the caller's Space** (`chain.rs:381-389`). `read_room` only reads Rooms of the Space (`tool.rs:39`). Spaces are the only isolation wall (ADR 0021).
- **The local `banda mcp`** has no identity. It talks to the state root's local Services (Terminal mux, Files) and to the Browser Pane's DevTools socket, which only the state root's owner can open (CHANGELOG.md:1676-1679, 1731-1735). Whoever can run it is trusted. `terminal_report` takes the Terminal id as an argument (`mcp/terminal.rs:167-185`).

---

## 3. Tool list

### 3a. `banda_mcp.py` (Space Agents) — 19 visible tools (`runner/banda_mcp.py:133-211`)

**Agent-to-agent and Person communication (marked ★):**

| Tool | What it does |
|---|---|
| ★ `ask_agent(request_id, agent, text)` | Hand part of this request to another Agent of the Space by username. Returns at once with the new request id. The answer comes back later as a new turn. |
| ★ `reply(request_id, text, summary?)` | Publish the answer. For a Room request it posts in the Room. For an Agent-made request it **goes back to the caller**. Plain assistant text is not published. `summary` is a one-line "done" row (#1085). |
| ★ `ask_person(request_id, text, choices?)` | Ask a persistent Question that a Person answers. It shows in the Room or the Agent thread and the Inbox. The tool blocks and polls until answered, or until a new message wakes the turn. |
| ★ `wake_me(request_id, note, after \| at)` | Wake yourself later. A timer fires a turn with the note as its text. |
| ★ `read_agent(request_id, name, last?)` | A short tail of another Agent: state, current request, last entries one line each. Never thoughts or tool output. |
| ★ `search_history(request_id, query, agent?, limit?)` | Full-text search in your own or another Agent's history in Core. |
| ★ `space_status(request_id)` | The Space's work: Agents and state ages, open requests, **who waits on whom**, machine pressure, recent failures. |
| `read_room(room_id, after?)` | A page of a Room by name or id. |
| `space_goal(request_id)` | The Space's goal, set by People. |
| `list_agents(request_id)` | The Space's Agents: id, kind, name, role, Harness, state, followed events. |
| `create_agent(request_id, reason, name/instructions/harness/model \| agents[], person_asked?)` | Propose a new Agent (a Person's [Create] makes it), or create a team at once when the Person's own request asked for it. |
| `configure_agent(request_id, name, instructions?, model?, display_name?, follows?)` | Change another Agent for the Person whose request you serve; also sets which Space events it follows. |
| `pause_agent` / `resume_agent(request_id, name)` | Pause or resume another Agent for the Person. |
| `databases_list / _describe / _read / _change / _history` | Shared Space Databases (the team's "Plan" and "Work" boards). |

Retired but still callable for one release: `ask_room` (replaced by `ask_person`, `banda_mcp.py:203-209`). Core also has the internal tools `question` and `create_agents` (`tool.rs:124, 321`).

### 3b. `banda mcp` (local) — 21 tools, none for agent-to-agent

- `terminal_list, terminal_create, terminal_read, terminal_send, terminal_wait, terminal_kill, terminal_report` (`crates/banda/src/mcp/terminal.rs:202-255`).
- `files_list, files_stat, files_read, files_write, files_mkdir, files_rename, files_remove` (`mcp/files.rs:202-248`).
- `browser_pages, browser_navigate, browser_text, browser_eval, browser_screenshot, browser_click, browser_type` (`mcp/browser.rs:417-454`).
- `terminal_report` lets an Agent in a Terminal say "working / waiting / idle" so people see it. It is the only "talk back to Banda" tool here.

---

## 4. The agent-to-agent model

### Words

- **Room**: one stream of messages, no threads (ADR 0024). People, Agents and Sessions post into it.
- **Agent thread**: an Agent's one continuing context and its transcript, readable by every Member (ADR 0016).
- **Request**: one piece of work, admitted by a **Wakeup**. Five kinds: a Person's Mention in a Room, a direct request, an Agent-made request, a timer, a Space event (`GLOSSARY.md:79-81`; `request/admit.rs:4-96`).
- **Request chain**: a Person's request plus the Agent-made requests that grow from it. Each stores `parent_request` and `root_request` (`chain.rs:1-58`).

### Addressing

- **Only by a deliberate tool call**: `ask_agent(agent="reviewer_agent", text=…)` (`banda_mcp.py:151-154`).
- **An Agent's words wake no one.** An @mention by an Agent in a Room does not admit a request; only a Person's Mention does (`request/admit.rs:98-106`; ADR 0018 consequences, `0018-…md:99-102`). Agent-made requests and results **never post in a Room** (ADR 0024, `0024-…md:52`).
- The prompt lists the Space's other Agents by username on every turn (`runner/prompt.py:135-143`, `Work.space_agents`).

### Waking the receiver

- `ask_agent` → `chain::ask` admits a request of kind `agent` for the callee, keyed by `agent:<caller request>:<operation>` (`chain.rs:363-415`). It queues behind the callee's earlier work.
- **If the callee is idle**, the runner's next poll starts a turn. The prompt says: "Another Agent of your Space asked you this through ask_agent, for the Person named below. Answer with Banda's reply tool… your reply goes back to that Agent, not into a Room, and it is all that Agent receives of your work. Put longer output in /work, a pull request or an issue" (`prompt.py:117-121`). The context line names `asked_by` and `person` (`prompt.py:231-234`).
- **If the callee is busy**, the request is **offered into its running turn** at the next safe point (after the current tool result, before the next model call), through the adapter's `_session/steering` (ADR 0022, `0022-…md:30-55`). The steer is wrapped: "@lead_agent wrote while you work (request 7f3a…): … Address it as you continue; answer with reply naming that request if it asks something." (`prompt.py:204-205`). A message the turn does not take starts the next turn at once. Nothing is lost by construction.

### Replies routed back

- The callee calls `reply(request_id, text)`. Because the request's venue is `Agent`, Core stores the text in `agent_answers` instead of posting it (`tool.rs:89-96`; `chain.rs:419-445`).
- When the callee's request **ends** (finished, failed, stopped), `chain::settle` → `report` admits a **result** request for the caller, carrying the answer (or the reason it ended and who stopped it) and continuing the caller's original request (`chain.rs:466-552`).
- The caller wakes (new turn, or steered into a running turn). Its prompt says: "an Agent you asked through ask_agent is done, and what came of it is below. Carry on with that request where you left it." (`prompt.py:130-132, 259-264`). In that turn, `reply` goes to the **original** Room or caller (`chain.rs:188-196`).
- A caller turn that ends with open asks is **not** a failure: it ends `delegated`, and the result turn owes the reply (ADR 0018, `0018-…md:55-57`; `request/end.rs:94, 131, 149`).
- A turn that never calls `reply` gets its **last message** as the answer (#535, CHANGELOG.md:946-951). "No reply" is left for a turn with no text at all.
- An answer after Banda itself cut a request off still reaches the caller once, as a "late" result (#527; `chain.rs:494-505`; `request/access.rs:52-73`).
- A child that needs a Person asks in the **root's** Room, labelled "(for @caller)" (`tool.rs:200-206`).

### What the human saw

- **Room card** of the root request: the chain's requests indented by who asked, each with Agent, state, age and Watch: "→ @tester_agent · ● working · 2 min" and "◌ waiting on @tester_agent" (CHANGELOG.md:1369-1377; `crates/banda/src/ui/state.rs:449`).
- **Caller's thread**: the `ask_agent` call as "→ asks @tester_agent", then the result as "◀ @tester_agent answered: …", "failed: …" or "stopped by @roma" (`crates/banda/src/app/agent_thread.rs:1836-1869`). The runner records the agent and text of Banda's own `ask_agent` call into the transcript, redacted; other tools' inputs stay out (CHANGELOG.md:1349-1353).
- **Callee's thread**: the input as "▶ @coder_agent (for @roma): review PR #339" (ADR 0018, `0018-…md:90-93`).
- Transcripts are live and open to every Member (ADR 0016). `space_status` and `read_agent` give Agents the same picture.

### Timers and Space events (ADR 0025)

- The team "kept falling asleep": Agents ended turns saying "wake me when CI passes" and nobody did (`docs/records/2026-10-14-the-arcs-day-by-hand.md:9-21`).
- `wake_me` makes a timer wakeup. Space events (a request ended, an Agent failed, an Agent stalled with open work, machine overload) wake Agents that follow them, batched after 30 s of quiet or at most 5 min (`crates/banda-core/src/agents/events.rs:12-17`).
- An "arc" Agent (`@banda_arc`) used them to run 20-minute rounds: read `space_status`, nudge idle owners with `ask_agent`, send one proposal per round to the lead (`docs/agents/roles/arc.md`).

---

## 5. Guards

| Guard | Where | Code or prompt |
|---|---|---|
| **No cycles**: the callee must not be on the path from root to caller (self-ask, A→B→A). Refused at once as a tool error the caller reads: "@x is already working on this chain…" | `chain.rs:338-350, 390-393`; words at `banda_mcp.py:217-237`, `banda-api/src/identity_paths.rs:167-178` | **Code** |
| **Stop cascades**: Stop on a request cancels it and all open descendants in every queue; the caller hears who stopped it | ADR 0018 `:63-68`; test `crates/banda-core/tests/chains.rs:471, 508` | **Code** |
| **Grown chain = one notice, no refusal**: past 20 requests or 5 hops, Core posts once "@x handed out N tasks — here they are" with a Stop-everything | `chain.rs:80-132`; tests `chains.rs:1267, 1301, 1330` | **Code** (deliberately not a limit) |
| **No depth cap, no count cap, no budget.** "Harnesses limit by nesting and by subscription quota… Agents are not throttled." The quota shown on the Agent card is "the real brake". | ADR 0018 `:58-59, 74-75, 103-106` | Deliberate absence |
| **Agents' words wake no one**; events are state changes only; an events turn and the work it hands out feed no events back; two followers can't wake each other | `admit.rs:98-106`; `events.rs:1-5, 211-220`; tests `events.rs:181, 531` | **Code** |
| **Timers**: 60 s to 1 day; note ≤300 chars; same note replaces the pending one; ≤10 pending | `crates/banda-core/src/agents/timer.rs:10-16, 51-108` | **Code** |
| **Idempotent sends**: the MCP server hashes the tool name + all arguments as `operation_id`; Core answers a retry with what it already did; same key, different text is a Conflict | `banda_mcp.py:274-279`; `chain.rs:365-380, 419-445` | **Code** |
| **Creating Agents**: an Agent only *proposes*; a Person's [Create] makes it. Direct team creation only when the root is a Person's Room or direct request (`person_asked`) | `tool.rs:99-168`; `proposal.rs:430-453`; ADR 0020 | Code, but `person_asked` honesty "rests on the Agent's instructions and on that record" (ADR 0020 amendment) |
| **Changing Agents** (configure/pause/resume) only for a Person's own request; never pause yourself; never delete | `manage.rs:15-16, 43-125` | **Code** |
| **Questions**: only a Person answers; no timeout approves; an Agent never answers for a Person | ADR 0029 `:62`; Questions module | **Code** |
| **Permissions** (ADR 0029): actions inside the Space always allowed; outward and irreversible by trust level (New/Trusted/Autonomous); keys and access always ask. Banda's own MCP tools are classed *Inside* because Core authorizes each call itself | `runner/permissions/policy.py:100-103`; ADR 0029 | Code (runner classes, Core decides) |
| **Wrong arguments**: the server checks the schema and says what is wrong ("Nothing was sent."), instead of "unavailable, retry" | `banda_mcp.py:285-361` (#830) | **Code** |
| "Do not start autonomous model turns or other coding agents yourself" | `prompt.py:278` | **Prompt only** |
| Arc: no more often than every 10 min, one nudge per Agent per hour, one proposal message per round, never wake a paused Agent | `docs/agents/roles/arc.md` | **Prompt only** |
| Team rules: requests to Agents are questions, not work orders; the lead doesn't relay | `docs/agents/team.md` rules 1–4 | **Prompt only** |

Human approval was required for: creating an Agent (unless the Person asked), sign-ins, keys and token scopes, deleting Agents, raising trust, "Always" grants, and at the edge by trust level (merges, force push, releases). Room messages from Agents need no approval.

---

## 6. What the Agents were told, and how

- **No MCP `instructions` and no skill for Banda's tools.** Everything came in the **turn prompt** that the runner builds for every turn (`runner/prompt.py:218-284`):
  1. a Harness-switch handoff if any;
  2. "You are a persistent Banda Agent. Continue your one working context across Rooms.";
  3. **how to answer this kind of request** (Room: use `reply` with a summary; direct: answer in plain text; asked: `reply` goes back to the caller; result: carry on; timer/events: nobody wrote to you) (`prompt.py:39-132, 221-246`);
  4. how to ask a Person (`PERSON_QUESTIONS`, `prompt.py:45-50`);
  5. environment notes (`/work`, `BANDA_JSON=1`);
  6. **cooperation**: how `ask_agent` works, the list of other Agents, and the rules for `create_agent` and changing Agents (`prompt.py:135-152`);
  7. "Current specialization instructions:" — the Agent's own role text;
  8. a context JSON line (`request_id`, `person`, `asked_by`, `result_of`…) and the message itself.
- **Steers** get their own short wrappers by kind (`prompt.py:183-215`).
- **Tool descriptions** carry the key behaviour too: `ask_agent` "Returns at once; its answer comes back later as a new turn" (`banda_mcp.py:151-152`), `reply` "Ordinary assistant text is not published" (`:137`).
- **Role files** were the Agents' instructions, written by hand: `docs/agents/team.md`, `docs/agents/roles/*.md`, `docs/agents/integrator.md`, `docs/agents/workflow.md`. They tell each Agent who hands it work, whom it hands work to, and "Agents talk directly, with questions" (`team.md`, rule 4).
- `skills/banda-cli/SKILL.md` covers only the CLI's JSON envelope, not MCP.

---

## 7. Evidence: what worked, what broke

### Worked

- **Steering in real work** (`docs/records/2026-10-15-steer-on-0.2.16.md`): about 245 "@x wrote while you work" deliveries overnight, 23–46 an hour, each after a tool result. None cut a tool. Every result the lead received ended `finished`. Results were never duplicated.
- **The team rules**: "one issue, one Agent, start to finish"; "the lead doesn't relay"; "a request to another Agent is a question"; "tell @lead_agent 'PR #N is ready'" (`team.md`, `roles/agents.md`). Handoffs were reduced to short, direct `ask_agent` notes.
- **A worked coordination example** from Claude Code sessions (`docs/records/2026-10-12-coordination-example.md`) set the shape: one owner per area, results back to the requester as a structured result, permissions stay with the Person, a coordinator asks once with options.
- **Tests** pin the whole model: `crates/banda-core/tests/chains.rs` (answer comes back, delegated end, no cycles, stop cascades, chain answers to root Person, late reply, grown notices), `steer.rs` (delivered message joins the turn, untaken message starts the next turn once, Stop stops all taken), `timers.rs`, `events.rs` (two followers don't wake each other), `runner/tests/test_mcp.py` (retry is the same operation, cycle words, wrong-argument words).

### Broke, and how it changed course

| Problem | Fix |
|---|---|
| Messages and results **queued behind the current turn**: a lead's correction arrived after the stale answer; a coordinator saw results only after its turn ended; senders asked again (#522, #528, #536) | ADR 0022: steer every new request into the running turn (CHANGELOG.md:863-871) |
| Steering **interrupted running tools** ("my builds keep getting cut off") — Claude adapter used SDK priority `now` (#615) | Steer only at a safe point (0.2.14), then patch the adapter to priority `next` (#628) (CHANGELOG.md:810-814, 714-718) |
| **Agents fell asleep**: ended turns with "wake me when CI passes"; seven Agents idle for an hour | ADR 0025: `wake_me`, Space events, `space_status`, the arc |
| **Wrong argument names read as "Banda unavailable, retrying is safe"**: @agents_agent sent `username`/`message` instead of `agent`/`text` 11 times; none of those handoffs arrived (#830) | Schema check with fixable words, "Nothing was sent." (`banda_mcp.py:316-361`; CHANGELOG.md:415-420) |
| **Reply to the original request inside its result turn refused** ("the request has already ended"); a plan was lost (#832) | Core maps the original to its running continuation (`tool.rs:54-64`; `request/access.rs:31-50`) |
| A turn without `reply` failed the request and the Agent (#504) | Not a failure; the last message is the answer (#535) |
| Banda cut a request off; the Agent's later answer was lost (#527) | Late reply still reaches the Room or caller once |
| Room discussion threads became a second place to look | ADR 0024: one stream; agent-to-agent never posts in Rooms |
| An "arc" entity with special powers (ADR 0019) | Superseded the same day by ADR 0020: cooperation belongs to every Agent; later an `_arc` *kind* for naming only |
| `ask_room` mixed with legacy question paths | Replaced by `ask_person` on its own endpoint (#949, `changelog.d/retire-ask-room.md`) |
| Codex Agents stalled on **their own Banda tools** at the permission gate (#1215) | Banda's tools classed *Inside*: Core authorizes them (ADR 0029 amendment; `policy.py:100-103`) |
| A busy disk cut off groups of Agents (#647) | WAL, transient-error retries — infrastructure, but it hit agent talk hard |

Cost of the design: `banda_mcp.py` grew to 690 lines of defensive wording, older-Core fallbacks and Questions protocol checks. The prompt grew many special cases (timer, events, continued, created, forwarded, question answers). There is one contradiction in it: "Do not end your turn to wait… wait inside the turn" (`prompt.py:279`) next to "you may end your turn after asking" (`prompt.py:142`).

---

## 8. My view: what to carry into the new MCP module

1. **Agent-to-agent is a request, not a chat message.** `ask` creates work in the callee's own Thread with a parent link, returns at once, and the answer comes back as a new input that **wakes the caller** and continues its work. Never block a turn waiting for another Agent. This is the core of why it worked, and T3's `delegate_task` + `next` landed on the same shape.
2. **One Person at the root of every chain.** Every Agent-made request carries the root Person as requester; authority and Membership follow that Person at every hop. The new kernel's `Participant::Agent` should carry "on behalf of Person X" for MCP calls, or `access::decide` cannot tell a Person-asked change from an Agent's own idea (the old `asking_person` rule, `proposal.rs:430-453`).
3. **Words wake no one.** Only a deliberate tool call wakes another Agent. No waking from @mentions in text, no events from Agent words. This removed whole classes of loops for free.
4. **Enforce the cheap guards in the engine**: refuse cycles on the path, Stop cascades down the chain, idempotent sends keyed by (caller turn, operation), timer bounds. Do **not** add depth or count caps first; announce an unusual chain once where the Person looks, with Stop-everything. That matched how the team actually worked. Budget/quota visibility is the real brake.
5. **Steer into a busy Agent at a safe point.** A message for a working Agent joins its turn after the current tool result; one it doesn't take starts the next turn. Wrap it with who wrote and which request. This fixed the worst coordination failures (#522, #528, #615).
6. **The answer is explicit, with a sane fallback.** A `reply`-style tool sends the answer back; if the turn never calls it, use the last message (#535). A turn that delegated is not "no reply". Point longer output at files or PRs.
7. **Let the server, not the model, know the current request.** The old server made the model pass `request_id` every time, and #832 and #830 came from that and from argument names. In the new Banda the session token already names the Thread; let the engine resolve the running turn and accept an optional id only when an Agent works for several inputs at once.
8. **Errors the Agent can act on.** Validate arguments against the schema and say what to fix and that nothing was sent; say "safe to retry" only when it is (#830). Keep Core's refusals as plain sentences meant for the Agent.
9. **Give Agents wake-ups of their own and a view of the whole**: `wake_me`, followed state events, `space_status` with "who waits on whom", a read-only tail of another Agent (`read_agent`, never thoughts or tool output), and history search. Without these, Agents stop and nobody notices.
10. **Show everything where people already look.** Ask and result as one line each in both Threads ("→ asks @x", "◀ @x answered"), the chain under the root request, live transcripts. People trusted the team because they could watch it.

### Avoid

- Two MCP servers with different identities and transports. ADR 0005's one `banda mcp` on stdio, token → Thread, tools from module manifests, is already the cleaner form of the old Python bridge.
- Putting the "how to use Banda" text into a per-turn prompt with many special cases. Use MCP `instructions` plus a guide tool (ADR 0005 d.14), and keep per-input framing to a short header.
- Queueing results behind other work, and steering that interrupts tools.
- Error words that say "unavailable, retry" for a call that can never work.
- Special entities with extra powers (the arc). Make cooperation a capability of every Agent; a role is instructions.
- Prompt-only limits for anything that matters (the arc's nudge rate, "don't start other agents"). If it matters, put it in the engine.
