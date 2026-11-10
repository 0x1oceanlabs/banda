---
status: accepted
date: 2026-10-31
---

# Claude Code and Codex in a Thread

A Person works with Claude Code and Codex in a Thread. This ADR says how
the agents module reaches them, runs them and keeps what they say. It
follows T3 Code's design (github.com/pingdotgg/t3code, MIT, read at
`15fe2832`) wherever that design fits a Rust engine with modules. The
evidence is in two notes:
[how T3 Code reaches them](../research/2026-10-31-t3-code-harnesses.md) and
[what ACP and the two adapters give a Thread](../research/2026-10-31-acp-adapters.md).
Roma took each decision below on 2026-10-31.

It supersedes ADR 0002, decision 10, and changes ADR 0001, decision 7, and
ADR 0002, decision 9, as decision 9 below says.

**Decision.**

1. **One Harness port in our words, and ACP is the transport for both.**
   - The module reaches a Harness through one small interface:
     - open or resume a session;
     - send a message, or steer the running turn;
     - stop;
     - answer a Question;
     - set an option.
   - A stream of what the Harness said comes back.
   - ACP's words stay in the adapter.
   - Claude Code goes through `claude-agent-acp`, and Codex through
     `codex-acp`. Inside them run the same Agent SDK and the same
     `codex app-server` that T3 Code drives.
   - The reasons T3 Code gives for going native no longer hold for these
     two adapters:
     - steering is a shared extension;
     - a fork at a message is a shared extension;
     - both take HTTP MCP;
     - context usage is in the stable spec.
   - The one gap left is Codex's rate limits. A native Codex adapter in
     Rust comes later, behind the same port.

2. **Capabilities, each with a fallback.**
   - At start the engine declares what the window can do:
     - form Questions;
     - terminal sign-in;
     - boolean options;
     - notices and compaction;
     - streamed command output.
   - It reads what the Harness declares, steering among it: the adapters
     declare steering in their answer to `initialize`, and each message
     sent into a turn opts into it. A window shows a control only when
     the Harness has the capability.
   - Each missing capability has a fallback. For example, a session that
     cannot be resumed is opened fresh, and the Thread says so.
   - A capability that is declared but fails at runtime is a bug.

3. **The Person's own Claude Code and Codex.**
   - The adapters start at exact versions and use the CLIs the Person
     installed (`CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`). Banda bundles
     neither.
   - The engine reads each CLI's version and checks it against a supported
     range. The Thread warns when the version is outside it.
   - Banda is for developers first.

4. **People sign in themselves.**
   - When a Harness needs a sign-in, the Thread offers to open a terminal
     Pane (Ghostty) with the Harness's own command: `claude auth login` or
     `codex login`. When the command ends, the engine checks again.
     _Changed by ADR 0004: the Thread offers the ways the Harness declares
     in ACP, and Codex signs in by itself in the browser._
   - Tokens never pass through Banda, and Banda reads none of the
     Harness's credential files.
     _Changed by ADR 0043, decision 2: Banda reads Claude Code's access
     token for its limits, for that one request, and keeps it nowhere._
   - A second account is a second entry in the Harness list, with its own
     configuration folder.

5. **A session belongs to its Thread and outlives the process.**
   - The Thread's log is the history. The Harness's session ID is evidence
     (ADR 0002, decision 7).
   - After a restart, the next turn resumes the session. If the Harness
     cannot resume, the engine loads the session. If it can do neither, the
     engine opens a new session and the Thread says so.

6. **One adapter process per Space and Harness entry.**
   - Every Thread on that Harness in that Space is a session in one
     process. An Agent's settings are per session.
   - A second account is its own entry, so it gets its own process.
   - The agents module supervises these processes in Rust:
     - it starts one on the first turn, one start at a time;
     - each runs in its own process group and dies with the engine;
     - it is released after 30 minutes with no running turn and no open
       Question;
       _Amended 2026-11-10 by [ADR 0103](0103-a-harness-s-sub-agents-work-in-their-thread-and-a-crew-shows-beside-it.md):
       nor while a sub-agent or a Crew of its sessions is at work._
     - a crash ends the running turns with a failure that can be retried,
       and the queue waits;
     - the next turn starts the process again, after a growing pause if it
       keeps crashing.
   - A native Codex adapter later runs under the same key.

7. **Turns are ordered per Thread.**
   - The outbox key of `turn.start` is the Thread. Threads run in parallel,
     an Agent's own Threads too, as in T3 Code, Claude Code and Codex.

8. **Steering and the queue work as in T3 Code.**
   - A message sent while the Agent works goes into the running turn. Both
     adapters implement this natively: Claude through a priority input,
     and Codex through `turn/steer`.
   - A message can wait in the queue instead. The engine keeps the queue,
     and the Person can edit a queued message or send it now.
   - After a stop or a restart the queue waits for Continue.
   - A Harness that cannot steer gets an interrupt and a new turn with the
     message.

9. **Permission modes as in T3 Code.**
   - The modes are Supervised, Auto-accept edits, Auto and Full access,
     with Plan on its own. Full access is the default, and an Agent's file
     can change it.
     _Changed by ADR 0006, decision 3: the Harness entry holds the default._
   - For Claude Code and Codex, each mode becomes the Harness's own mode,
     and the Harness enforces it.
   - For any other ACP agent, the engine answers the agent's Questions by
     the Thread's mode, as T3 Code does.
   - A Question shows all of the Harness's options, its "always" answers
     too.
   - This replaces the last sentence of ADR 0001, decision 7, and the last
     sentence of ADR 0002, decision 9.

10. **Options come from the Harness.**
    - Models, effort and other options come from the Harness's session
      options.
    - An Agent's file holds its defaults, as text. The composer shows the
      choices.
      _Changed by ADR 0006, decision 3: the defaults belong to the Harness
      entry, as there are no Agents to configure._
    - There is no model list of our own.

11. **The log keeps everything the Harness says.**
    - That covers messages, thoughts and tool calls with their diffs and
      command output, plus plans, notices, usage and failures.
    - Text is written in pieces every 80 ms. The log is never rewritten, so
      whole-text copies would only swell it.
    - Command output has a limit only against a runaway command.
    - The Space moves to a server later together with its log, so the log
      must hold the whole Thread.

12. **A failure has a class and an action.**
    - The classes are: sign-in needed, usage limit with its reset time,
      Harness stopped, provider error, stopped by a Person.
    - The Thread says each in plain words and offers what to do: Sign in,
      Wait until 18:40, or Retry.

13. **Tests replay ACP.**
    - The engine and the adapter boundary are real, and the transport
      replays recorded ACP frames.
    - The fake agent learns each scenario.
    - Real Claude Code and Codex conversations may be recorded for tests:
      paid runs, allowed by Roma on 2026-10-31.

**Not taken from T3 Code.**

- **Native routes for Claude Code and Codex, for now:** ACP gives the same
  behaviour through the official adapters.
- **"Connect with ChatGPT":** T3 Code holds the tokens itself.
- **Its own model manifest for Claude:** the adapter sends the list.
- **Whole-text snapshots, and command output that is shown but not stored.**
- **One process per Thread for Claude.**

**Consequences.**

- `docs/architecture.md` changes with the code that changes behaviour:
  - the order of turns;
  - Questions and modes;
  - where Harnesses come from.
- The work goes in steps, one PR each, every one tested on the fake agent:
  1. Processes and sessions: the supervisor, turns per Thread, resume
     after a restart, idle release.
  2. Capabilities and failure classes.
  3. Modes, options and the full Question.
  4. Thread content: diffs, command output, plans, notices, commands,
     images.
  5. Steering and the queue.
  6. The terminal Pane on Ghostty, and sign-in.
  7. Usage and the CLI version check.
- Later: subagents as child Threads, edit-and-resend through a fork, and
  the native Codex adapter.
  _Amended 2026-11-10 by [ADR 0103](0103-a-harness-s-sub-agents-work-in-their-thread-and-a-crew-shows-beside-it.md):
  a Harness's sub-agents are not child Threads but lanes of their Thread._
