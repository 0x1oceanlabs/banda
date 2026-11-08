---
status: accepted
date: 2026-11-01
---

# The Thread Pane reads as T3 Code's

Roma works with Agents in T3 Code every day and likes how its thread window
feels. On 2026-11-01 he asked for our Thread Pane to work the same way:
"подсмотреть как у них все сделано и скопировать, нужно сделать аналогично".
The evidence is [the research note](../research/2026-11-01-t3-code-thread-pane.md).

Our Thread Pane already does most of what T3 Code does: messages,
thoughts, tool calls, plans, Questions, the queue, steering, commands and
images. What differs is how it reads: T3 Code shows the reply in markdown,
folds the work into a line, and keeps the end of the conversation calm.

**Decision.** Roma decided the points marked _decided_ on 2026-11-01 and
asked to build all of it; the rest are our defaults and stay his to change.

1. **The timeline reads as T3 Code's** (_decided_).
   - The Agent's reply is prose without a bubble. The Person's message is a
     bubble on the right, clamped past 8 lines or 600 characters with "Show
     full message".
   - Hover shows Copy and the time.
   - Consecutive tool calls of a turn are one line naming what they did:
     "Ran 3 commands and edited 2 files". The line opens to the calls, and
     each call opens on its own.
   - While a turn runs: "Working for 12s" with a ticking timer, the latest
     tool call as one live line, or "Thinking".
   - A turn that ended folds its work into "Worked for 1m 05s" ("You
     stopped after 8s"); its last reply stays in view. A failed turn does
     not fold.
   - The rows come from the Thread's state through one pure function, as
     `rows` does today, so plain tests cover them.

2. **Markdown through Streamdown** (_decided_). `streamdown` renders replies
   and thoughts while they stream; `@streamdown/code` highlights code with
   Shiki, in the theme's light and dark. We write no markdown pipeline of
   our own. It lives in `@banda/ui` as one component, so other modules'
   Panes render markdown the same way.

3. **A turn's changed files, and the diff as its own Pane** (_decided_).
   - Under a turn's reply, a card lists the files its tool calls changed,
     with `+N −M`. It comes from the diffs the tool calls carry, not from
     git, so it works in any Space.
   - A file, or a tool call's diff, opens a **Diff Pane** beside the Thread
     in the Strip (ADR 0005), not a panel inside the Thread Pane. It shows
     one turn's changes, file by file.

4. **The engine says when a turn starts and ends.** `TurnView` gains
   `started` and `ended`, from the log's times, so "Working for" and
   "Worked for" need no guessing in the window.

5. **The Agent asks as in T3 Code.**
   - A Question with choices only is a row in the timeline: what it asks
     about, then its choices as buttons; the first that allows is the
     main one, "always" answers sit under More.
   - A Question with a form sits in a drawer on top of the composer, one
     field at a time; keys 1–9 pick, Previous, Next and Send.
   - While a Question waits, a message sent from the composer answers it
     with no and says why, as T3 Code does.

6. **Plan mode as in T3 Code.** A plan the Agent proposes is a card. When a
   turn in plan mode ends with one, the composer shows "Plan ready" and its
   button is **Implement** (plan mode off, and the plan sent to be carried
   out) or **Refine** once text is typed. Shift+Tab switches plan mode.
   Claude Code instead asks to leave plan mode, its plan in the request:
   that Question is the plan's card, the Harness's own answers under it.

7. **The composer as in T3 Code.**
   - While a turn runs, the button with text queues or steers, by the
     Person's setting; Mod+Enter does the other. With no text, it stops.
   - Alt+↑ brings the last queued message into the composer to edit.
     Built: Alt and the arrows move between Panes in Banda, so while a
     message waits, ↑ in an empty composer opens the last one to edit, in
     its place in the queue.
   - ↑ and ↓ walk the Thread's earlier messages; drafts are kept per
     Thread in the window's storage.
   - Model, effort and mode sit in the composer's footer and rest, faded,
     while it is not focused.

8. **Scrolling as in T3 Code.**
   _Amended by [ADR 0094](0094-a-thread-opens-where-what-the-person-has-not-seen-begins.md): a Thread shows where what the Person has not seen begins, and never moves what they are reading._
   - A sent message moves near the top and the reply grows below it; the
     timeline then follows the end until the Person scrolls up.
   - The button to the end says what waits there: "2 queued", "waiting
     for you".
   - Each Thread keeps its scroll place.
   - No virtualized list yet: it comes when a long Thread is slow
     (AGENTS.md: complexity on a user's request).

9. **Later, each when it is built.** Find in the Thread (Mod+F), a minimap
   of the Person's messages, `@` for files.
   Built: Mod+F finds by the key's place, marks the words with CSS
   highlights and opens a folded turn that holds them; the minimap marks
   each message the Person sent down the Thread's edge. `@` and a word asks the
   engine (`agents.files`) for the files in the Space's folder that hold
   it, the ones git keeps or would, or else what a walk finds; the one
   picked goes into the message as `@path`. Edit from here and fork need the
   Harness to rewind or fork a session; they wait for a check of what
   Claude Code and Codex offer through ACP.

10. **What we leave out.** T3 Code's git parts: the branch toolbar,
    worktrees, pull requests, reverting files.

**Build order.** One PR each: (1) messages and markdown, (2) work lines, the
live line and folds, with the turn's times, (3) changed files and the Diff
Pane, (4) Questions, (5) plan mode, (6) the composer, (7) scrolling,
(8) find, minimap and `@` files.

**Consequences.**

- `@banda/ui` gains `streamdown` and `@streamdown/code`, and a
  markdown component other modules can use.
- The agents module gains the Diff Pane.
- ADR 0003's rule that a tool call shows its diff stays: the diff now
  also opens in its own Pane.
