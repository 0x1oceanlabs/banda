---
status: accepted
date: 2026-11-01
---

# A Thread is a session, with no Agent to manage

The first Banda ran its Agents on a server: each had a name, an identity and Threads of its own, and Agents managed other Agents. This Banda runs everything on the Person's computer, as T3 Code and Herdr do, and neither of them has such an entity. A Person starts a session with Claude Code or Codex in a folder, and that is all.

On 2026-11-01 Roma decided to do the same: "the Agents concept from old Banda is not needed as an entity; there are just sessions on the computer, as in Herdr and T3."

**Decision.** Roma decided the points marked _decided_. On 2026-11-01 he accepted the rest as our defaults and asked to build; each stays his to change.

1. **A Thread is one session with a Harness in a Space** (_decided_).
   - Starting a Thread is all it takes. There is no Agent to create, name or configure first.
   - The Thread keeps the word T3 Code uses. Its Harness's own session is evidence inside it, as before (ADR 0002, decision 7).
   - The Harness is chosen when the Thread starts and stays with it. The model, effort, mode and plan change inside the Thread, as far as the Harness allows.

2. **A new Thread starts in the default Space, or in one picked from the list** (_decided_).
   - The composer of a new Thread shows its Space, its Harness and its model.
   - The default Space is set in the settings. On the first start it is a new `~/Banda/Default/`.
   - The list holds every Space and opens a folder as a new one.

3. **Defaults belong to the Harness.**
   - What a new Thread starts with is set per Harness entry, beside `harnesses.toml`: the model, the mode, plan and the Harness's options.
   - Full access stays the default mode.

4. **"Agent" is still the word for the AI at work in a Thread.**
   - Each Thread has its own Agent, and only one. The Agent has no name or settings of its own.
   - The kernel still names a Participant as a Person or an Agent. An Agent's ID comes with its Thread, so the kernel keeps naming no module.
   - When an Agent calls the MCP module, its session's token names its Thread.

5. **What goes.**
   - The Agents Pane, with its list and its form for a new Agent.
   - The per-Agent files, `.bandaso/agents/<name>.toml`.
   - An Agent's Threads that stay its own across a switch of Harness.
   - Existing Threads stay. Each keeps the Harness its Agent had, and moves over with its Space (ADR 0005, step 2).

**Consequences.**

- The sidebar lists Threads, each with its Harness and its Space (ADR 0005, decision 8).
- ADR 0003, decisions 9 and 10: the defaults that an Agent's file held belong to the Harness entry.
- The glossary's Agent and Thread change when this is built.
- If Rooms with several Agents and people come later (ADR 0001, decision 10), a named Agent may come back then, with its own ADR.
