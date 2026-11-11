---
status: accepted
date: 2026-11-11
---

# A new Thread says whom it writes to and where, and the Message box says who and how

On 2026-11-11 Roma asked to rework the model picker, the switching of
Harnesses and accounts, and the new Thread's start screen. Much had
changed since they were drawn (ADR 0078, ADR 0093, ADR 0108), and none of
them had been looked at since. Roma wanted Banda's own design with good
UX, keeping the Message box as it looks and finishing it. Roma also asked
that the pickers take their data and give their changes back the UNIX
way, refactored as they are built.

The mocks are in
[`docs/research/2026-11-11-start-and-picker/mocks/`](../research/2026-11-11-start-and-picker/mocks/):
`01` the variants, `02` the chosen ones, `03` and `04` the live mock Roma
clicked through and accepted (start screen A, Message box D2).

This amends ADR 0031's decisions 3 and 6, with their 2026-11-03
amendments, and ADR 0078's placing of the moves under the effort slider.

## What is wrong today

- One trigger does three jobs. The model picker names the account by its
  emblem, the model and the effort. It also lists every Harness's models
  on a new Thread, and on a started one the accounts and Harnesses it may
  move to, under the slider.
- A new Thread says "Write to Claude" in the middle, and its Project sits
  in a bare row under the card. Whom it writes to is chosen in the model
  list, where nobody looks for an account.
- The model list is every model the Harness offers, a dozen for Claude
  Code, and it grows.
- The window works the choices out in many places: `Thread.tsx` builds
  the starts, the moves, the out account and the picked options, and
  hands them down as a dozen props.

## Decisions

1. **A new Thread is one phrase: "Write to [who] in [where]".** It stands
   in the middle of the empty Thread, with the Thread's emblem and
   Project sign in its two pickers. Under it, the Project's last three
   Threads and "All N", as the sidebar shows them. "No Project" shows no
   list. The Message box stays at the foot. The bare row under the card
   goes. When the first message is sent the phrase fades out, and the
   Thread is there, in the same Pane.

2. **"Who" is an account.** Its menu lists the accounts by Harness
   (`Claude Code`, `Codex`), each with its plan, default or fallback, and
   how full its fullest limit window is, or when it is back. Choosing an
   account of another Harness starts the Thread on that Harness. While
   the default is out, the new Thread is on the fallback (ADR 0093,
   decision 7), and a line under the phrase says why.

3. **On a new Thread "who" is chosen only in the phrase.** Each choice
   shows once: the Message box's row has no "who" until the Thread
   starts.

4. **A started Thread's row has "who" and "how".** On the right of the
   row, in this order: the mode's shield, "who", "how", and the send
   button.
   - "Who" is the account's emblem alone. Its name and plan show on
     hover. Past the account's warning threshold its use shows beside the
     emblem, in the warning colour.
   - Its menu puts the accounts of the Thread's Harness first: one click
     moves the Thread, and it goes on in the same session (ADR 0078,
     decision 4). Ctrl+Shift+↑ and ↓ still step through them.
   - Then the other Harnesses, under "Hand off to another agent". Picking
     one asks first, in a block docked above the Message box ("Hand this
     Thread to Codex?", Stay or Hand off), as ADR 0078's decision 5
     confirmation.

5. **"How" is the model, the effort and Fast mode.** The trigger names the
   model, then the effort, muted, its top level in `--effort-top`, and a
   bolt when Fast mode is on. A Harness that has said no models yet goes
   by its own name, and its menu says so.
   - The menu: "Model" and the models in the menu; "All models" with how
     many there are; the effort as a segmented control of the Harness's
     levels; Fast mode as a switch; and "Back to <Harness>'s defaults"
     when something differs.
   - The Thread's model, if it is not in the menu, stands first until
     the Thread changes it.

6. **A Harness has a menu of models, and a window of all of them.**
   - The menu holds the models the Person starred. With none starred, it
     holds the first three the Harness offers.
   - "All models" opens a window over the Pane, the Thread dimmed under
     it: the starred models, then the rest, in the Harness's order. A
     click chooses the model for this Thread. A quiet grey star on each
     row puts it in the menu or takes it out.
   - No search, and no key opens it. Arrows and Enter work in it, and Esc
     closes it, with no hints drawn.

7. **The menu is the machine's, per Harness, in `agents.toml`.**
   `[models]` names each Harness's menu by its ID:
   `claude = ["default", "opus", "sonnet"]`. The engine answers it with
   what a new Thread starts with (`agents.defaults`), the first three
   filled in when none are named. A star goes through one engine command
   on the Thread's machine, as ADR 0108's decision 1 has it for an
   account. The window never writes the file.

8. **The pickers take one answer and give back one change.**
   - In: one value per Thread, built by pure functions from what the
     engine said: the offer, the settings, the menu, the accounts and
     their limits. Out: one change at a time, `Settings` to configure, an
     account to move to or start on, a model to star.
   - A picker draws what it is given and says what was chosen. It works
     nothing out, and it does not branch on Claude Code or Codex.
   - The pure functions have plain tests. The components do not.

## Not decided

- Whether a new Thread on an account that is out waits for its reset and
  then starts. Until it does, an out account can be chosen, dimmed, with
  when it is back. Its first turn meets ADR 0078's limit card.
- The key that opens the "who" and "where" pickers.

## Consequences

- `ModelPicker` splits in two: a "who" picker, whose menu is the moves
  (`thread/moves.ts`) and the starts, and a "how" picker. `NewThreadBar`
  and the empty Thread's `Start` give way to the phrase.
- `agents.toml` gains `[models]`, its schema and its template. The engine
  gains the command that writes it, and `agents.defaults` answers the menu.
- ADR 0031's decision 6 no longer holds: the Harness is chosen with the
  account, not with the model.

## Build order

1. This ADR, with the mocks.
2. The engine: `[models]`, the answer in `agents.defaults`, and the
   command to star a model.
3. The pickers' data in and out (decision 8), as pure functions with
   tests. `ModelPicker` then draws from them, unchanged on screen.
4. "How": the menu of models, "All models", the effort as segments
   (decisions 5, 6).
5. "Who" in a started Thread's row, and the handoff block (decision 4).
6. The phrase and the recent Threads (decisions 1 to 3).
