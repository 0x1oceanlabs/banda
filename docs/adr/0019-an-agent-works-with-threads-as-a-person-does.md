---
status: accepted
date: 2026-11-01
---

# An Agent works with Threads as a Person does

ADR 0005 (decision 14) made Banda's MCP server a module of its own: the
same program in another mode, `banda mcp`, on stdio, handed to every ACP
session, with a token that tells the engine which Thread's Agent calls.
ADR 0012 gave it the Banda skill to hand over. Neither was built.

Three notes read how others do it: T3 Code
(`docs/research/2026-11-01-t3-code-mcp.md`), the old Banda
(`2026-11-01-old-banda-mcp.md`) and herdr-core (`2026-11-01-herdr-core.md`).
They agree on the parts that work, and they warn about the rest:

- **What works.** A tool call is the same command the window sends, with
  the same checks. The server knows who calls from the session's token, so
  the model never says who it is. An Agent asks another by a deliberate
  call, never by its words. The answer comes back by itself and wakes the
  Agent that asked; nothing polls.
- **What costs.** T3 Code has 70 tools and its limits live only in the
  prompt. The old Banda made the model pass a `request_id` on every call,
  and lost answers when it did not. herdr-core lets any process call
  itself any Agent.

Roma asked for the simple version: "не хочется усложнять, чтобы всё
просто и чётко работало… мало кода, а не городить сложную систему".

**Decision.**

1. **`banda mcp` is a pipe.**
   - The agents module hands it to every ACP session it opens, as a stdio
     MCP server in `session/new` and `session/load`. Every ACP Harness
     takes that; no Harness file is written.
   - Its environment carries the session's token and where the engine is.
     It speaks MCP on stdio and the engine's API on the other side, and
     keeps nothing.
   - It needs four MCP messages: `initialize`, `tools/list`, `tools/call`
     and `ping`. They are written on `serde_json`, as the API's frames are,
     without an SDK.

2. **The token names a Thread's Agent in its Space.**
   - When the agents module opens a session it asks the kernel for a
     token. The kernel's `Identity` then names it as that Thread's Agent
     (ADR 0006), and as one that works only in that Thread's Space.
   - Tokens are kept in memory. They end with the engine; a session opened
     again gets a new one.
   - `access::decide` takes the Space a call is for. An Agent's call to
     another Space is refused there, in the kernel, whatever the method.
   - The Harness runs as the same user as the engine, so the token says
     who calls; it is not a wall against a program that wants to lie. The
     Thread's mode (ADR 0003) stays the wall for what the Agent runs.

3. **A tool is a method.**
   - A method in a module's `methods!` table (ADR 0014) marked `tool`
     becomes an MCP tool. Its name and words come from the table, its
     description from the method's `///`, and its input schema from its
     params, with `schemars`. There is no other way to make a tool, and
     nothing to keep in step.
   - A tool runs through the same dispatch and the same `access::decide`
     as the window's call. An Agent may read and write the Space's work,
     but never manage it nor decide for a Person (ADR 0002, decision 9):
     it cannot answer a Question its Person was asked.
   - A refused or malformed call answers as an MCP tool error with the
     engine's refusal: what was wrong, and that nothing was done. It never
     says "Banda is unavailable, try again" for a mistake in the call; the
     old Banda lost eleven hand-offs that way.
   - The skill's core is the server's MCP `instructions`, and each topic
     comes through the `skill` tool (ADR 0012). _Changed by ADR 0037,
     decision 7: the `instructions` are a brief that fits what Claude
     Code keeps, and the core comes through `skill` too._ The skill is a library the
     same program has, so `banda mcp` answers it itself, as `banda skill`
     does, without the engine.
   - The first four tools:

     | Tool | Method | What it does |
     |---|---|---|
     | `threads` | `agents.threads` | The Threads of this Space |
     | `read` | `agents.thread` | One Thread, as the window reads it |
     | `send` | `agents.send` | Writes into a Thread, or starts one on a Harness |
     | `skill` | none: `banda_skill::topic` | A topic of the Banda skill |

   - Other modules give their Agents tools the same way, by marking a
     method: the terminal and the browser, when they want them.

4. **Agents talk by writing to each other's Threads.**
   - An Agent in Thread A sends to Thread B. B gets a turn as if its
     Person had written, but the message says it is from A's Agent, so B
     knows it is not its Person's word.
   - When that turn ends, B's last reply goes back into A as a message
     from B's Agent, and A gets a turn to go on with it. The turn keeps
     who opened it (ADR 0018, plan step 2), so the engine knows where to
     send it. The model passes no ID.
   - A message into a Thread that runs waits in its queue, as a Person's
     does.
   - Three rules, in the agents module's rules, not in a prompt:
     - **No circle.** An Agent cannot send to a Thread that waits for its
       own answer (A asked B; B answers by ending its turn, not by sending
       to A).
     - **Not over a Person's Question.** An Agent cannot send to a Thread
       whose Agent waits for its Person's answer, so the words do not
       answer someone else's Question.
     - **Only its own Space** (decision 2).
   - Everything stays in sight: a Thread an Agent starts is in the sidebar
     like any other, and the Person can read and stop it.

5. **Not now.** Limits on depth or count, budgets, timers that wake an
   Agent later, stopping a whole chain at once, other Spaces, roles. The
   notes keep how others did them, if the use shows they are needed.
   (Other Spaces' Panes: an Agent sees them when its Person lets it, ADR
   0032.)

**Plan.** Each step is its own PR, and `scripts/check.sh` passes after
each.

1. The kernel's session tokens and the Space in `access::decide`. `tool`
   in `methods!`, with the schema of its params. `banda mcp`, handed to
   every ACP session, with the skill as its `instructions`. The tools
   `threads`, `read` and `skill`. A test runs `banda mcp` and calls them.
2. `send` as a tool, after ADR 0018's first two steps: the turn keeps who
   opened it, the answer goes back, and the three rules, each with a test.
3. The Thread Pane shows a message from another Thread's Agent with that
   Thread's name, which opens it. `docs/architecture.md` says how Agents
   reach Banda.

**Consequences.**

- An Agent can do what its Person does with Threads, and nothing more, by
  the same code path. A new tool is one word in a methods table.
- Agents can work as a team across Threads of a Space, and the Person sees
  every Thread they open.
- A loop between Agents that never asks the same Thread twice in a circle
  is not stopped by a rule; the Person sees it in the sidebar and stops
  it. The notes say this was enough in the old Banda; a limit can come
  later if it is not.
