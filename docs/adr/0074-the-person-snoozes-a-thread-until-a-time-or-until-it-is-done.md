---
status: accepted
date: 2026-11-06
---

# The Person snoozes a Thread until a time, or until it is done

Roma runs about ten Agents at once and works from the Inbox (ADR 0065).
Some Threads are for later: a reply to read tomorrow, a review after lunch,
an Agent that will work for an hour. Today they stay in the list beside the
Threads that call. Archive (ADR 0069) puts a Thread away only until
something new happens in it, and the Person cannot say when it comes back.

T3 Code snoozes a Thread until a time, and Roma likes how it works.
`docs/research/2026-11-06-t3-code-snooze.md` reads it from T3 Code's own
code. The short version:

- The server keeps the snooze, so every client and the Agent's tool see it.
- Presets, and a dialog for any other time.
- A Thread that calls the Person cannot be snoozed. A call wakes a snoozed
  Thread early. A turn that ends does not.
- A section "Snoozed" in the sidebar, a line in the Thread, a toast with
  Undo.
- A Thread can be snoozed until its usage limit resets.

We made a mockup with Roma on 2026-11-05 (`snooze-v1.html`, in his
`~/Banda/artifacts/snooze/`). It shows the current window beside the
proposal, and a clock that can be run forward to watch Threads wake.

Roma, on 2026-11-06, on the five open points: "1 закрывать", "2 можно
отдельной snooze", "3 да хорошо", "4 да хорошо", "5 хорошо". That is: a
snooze closes the Thread's Panes; the snooze is kept on its own, by the
engine, and does not wait for Archive to move there; "When it's done" is
in; an Agent may snooze its own Thread; waking on an event comes later, on
the same base.

## Decision

Roma decided the points marked _decided_ on 2026-11-06. The rest are our
defaults and stay his to change.

1. **A snooze puts a Thread away until a time, or until it is done.**
   - **Until a time** (_decided_): it comes back at that time, or earlier
     if something calls the Person (decision 3).
   - **Until it is done** (_decided_): for a Thread at work. It comes back
     when the turn that runs ends, however it ends. T3 Code has no such
     snooze. It suits a Person who runs many Agents: the one that will
     work for an hour leaves the list and comes back when it has
     something to show.
   - **Until a usage limit resets**: until a time, where the time is the
     reset time the Harness gave (decision 8).
   - Only `asking` stops a snooze: a Thread that asks cannot be snoozed,
     as it cannot be archived. A done, failed, idle or working Thread can.
     A failure before the snooze does not wake it. Only a new one does.

2. **The engine keeps it, apart from Archive** (_decided_).
   - The agents module keeps the snooze on the Thread, as T3 Code's server
     does: when it was snoozed, by whom, until when, or until done. It
     publishes the facts `thread.snoozed` and `thread.woke`, and its list
     (`ListedThread`) carries the snooze. So every window, every connected
     machine and every Agent sees the same snooze, and a Thread snoozed
     on one machine is snoozed on all of them.
   - It is the first of the Person's marks to leave the window. ADR 0005,
     decision 8, gave them all to the sidebar. Seen, pinned and archived
     stay there for now. Archive moves to the engine in its own step,
     later.
     _Changed on 2026-11-08, by ADR 0096:_ archive moves in its step 1a
     and seen in its step 1b, both onto the Thread beside the snooze.
   - The commands: `agents.snooze {thread, until | done}` and
     `agents.wake {thread}`, both `Write`. A snooze whose time has passed
     is refused, and so is a snooze of a Thread that asks.

3. **Whether it sleeps is worked out, and nothing has to fire.**
   - A snoozed Thread is awake again from the first of these:
     1. its time has come;
     2. it asks the Person: a Question waits;
     3. a turn failed after it was snoozed;
     4. the Person sent a message into it;
     5. for "until done": the turn that ran ended.
   - The engine writes `thread.woke` with its reason for 2 to 5, as it
     records those facts, and for the Person's `agents.wake`. The time
     needs no timer and no fact: the list says when, every reader compares
     it with now, and the moment it woke is that time.
   - "Woke" lasts until the Person opens the Thread, as a finished turn
     lasts until it is seen.
   - _Changed on 2026-11-09, as ADR 0096 holds._ What the Person saw of a
     Thread waking by itself is kept on its host, on the snooze, as
     `woke_seen`: `seen` once its Pane, focused in the window in front,
     is looked at, and `dismissed` once its "Woke at" line is dismissed
     (decision 7). It moves forward only, and `agents.see_woke` sets it,
     for a Person only. Each window kept both marks in its own storage
     before, so a Thread seen on one machine still said it woke on
     another, and the sidebar's mark and the Pane's line were apart.

4. **Snoozing closes the Thread's Panes** (_decided_).
   - As archiving does (ADR 0069, decision 4): every Pane that shows the
     Thread closes, with its Group (ADR 0065).
   - Opening a snoozed Thread from the shelf does not wake it. Its Pane
     opens as any Thread's does, with the line "Snoozed until Fri 9:00 ·
     11h left" and **Wake now** at its top.
   - Snoozing an archived Thread takes it out of Archive. Archiving a
     snoozed Thread ends its snooze.

5. **One picker, wherever a snooze starts.**
   - **Where**: `Alt+Z` on the focused Thread; a clock that shows when the
     pointer is over a sidebar row; "Snooze…" in the row's menu, in the
     Pane menu (ADR 0066) and in the Banda menu. The action is
     `thread.snooze`.
   - **What it holds**:
     1. a field to type a time in;
     2. the presets, each with the time it means;
     3. "When it's done", for a Thread at work;
     4. "When the limit resets", for one stopped at a usage limit.
   - On a snoozed Thread it also holds **Wake now**, first.
   - `↑` `↓` and Enter pick, Esc closes. On a Thread that asks, it only
     says why it cannot be snoozed.
   - **The field** takes what a Person would say, in English or Russian:
     - `45m`, `2h`, `3d`: a while from now.
     - `18`, `18:30`: today at that time, or tomorrow if it has passed.
     - `tomorrow 10`, `завтра 10`.
     - `fri`, `пт 14`, `friday at 9`: the next one, at 9:00 when no time
       is given.
     - `next week`: Monday at 9:00.
     What it means shows under it as it is typed ("Fri 10:00 · in 13h"),
     and Enter takes it. T3 Code's dialog for any other time is not
     needed.
   - **Undo**: a toast says "Snoozed until Fri 9:00", with Undo (ADR
     0048).

6. **The sidebar has a shelf "Snoozed".**
   - It sits above Archive, folded as Archive is. Its header counts the
     Threads in it and says when the next one wakes ("next 22:40").
   - Its rows are sorted by when they wake. In place of a row's age, the
     row says when it wakes and how long is left: "22:40 · 1h", "Fri
     9:00 · 12h", "when done". Its mark is dimmed.
   - The pointer over a snoozed row shows **Wake**.
   - A Thread that woke goes back to the list among the ones that call,
     after those that ask. Until the Person opens it, its row shows a
     clock: with the time it woke in place of its age, or before "done"
     or "asks" when that is its state.
   - The bar's counts (ADR 0035) leave snoozed Threads out, as they leave
     out archived ones. A snoozed Thread at work is not counted as
     working.

7. **Waking tells the Person.**
   - A toast: "‹title› woke", with Open. When something woke it early, the
     toast says what: "asks, woke early", "is done, woke".
   - When the window is not in front, the notifications module says it
     too, as it says a finished turn (ADR 0056).
   - The Thread's Pane shows a quiet line, "Woke at 22:40", with Dismiss,
     until the Person dismisses it or the next turn ends.

8. **A usage limit offers a snooze.**
   - A turn that stopped at a usage limit, with the time it resets
     (`Failure::UsageLimit { until }`), shows **Snooze until ‹time›** under
     "You can try again after ‹time›".
   - Beside it is a switch, **Go on by itself when it resets**: the engine
     tries the turn again at that time (`agents.retry`). If it is not
     running then, it tries as it starts.
   - This is the one part that needs the engine to act at a time.

9. **The presets are in `sidebar.toml`.**
   - `[snooze] presets = ["1h", "3h", "18:00", "tomorrow 9:00", "mon 9:00"]`,
     in the field's own words, up to eight. These five are T3 Code's
     defaults, and they are ours.
   - A preset whose time has passed today is left out. Two that fall on
     the same minute show once. They are shown in time order, named as
     T3 Code names them: "In 1 hour", "This evening", "Tomorrow", "Next
     week".
   - `banda look check` names a preset it cannot read, as it does any
     broken key (ADR 0008).

10. **An Agent snoozes its own Thread** (_decided_).
    - The agents module's tool `snooze` takes `until`, a time in the
      field's words or an instant, or `done`. It snoozes only the Agent's
      own Thread: "I'll look at CI again in 30 minutes" leaves the
      Person's list until then.
    - The CLI has it too: `banda thread snooze <thread> --until 30m`, and
      `banda thread wake <thread>`. The Banda skill says when an Agent
      should snooze: when it waits on something slow and has nothing for
      the Person meanwhile.
    - An Agent's snooze is a snooze like the Person's, and anything that
      calls the Person wakes it. It does not wake the Agent. It does not
      send a message or start a turn.
    - _Changed on 2026-11-06, as it was built._ The tool and the CLI say
      how long with `after` (`30m`, `2h`, `1d`) and a moment with
      `until`, in milliseconds since the epoch; with neither, a Thread at
      work sleeps until its turn ends, so an Agent's sleeps only until
      the turn it calls from ends. Words for a day (`fri 14`) stay the
      window's: the engine knows no Person's timezone, and an Agent can
      work the moment out itself. A snooze lasts a year at most: the
      field reads no longer while, and the engine takes no later `until`.
    - _Changed on 2026-11-07, as ADR 0083 holds._ The Agent snoozes as
      itself, under its pass: only its own Thread, never so that it goes
      on by itself (decision 8 is the Person's), and the CLI in its shell
      is walled to its Project under its pass, and fully once ADR 0083's
      fence (F0) lands. While its Person's snooze goes on by itself, the
      Agent neither snoozes nor wakes its Thread: either would undo it.
      `wake` is the Agent's tool too, its own Thread by default: a pass's
      scopes are its tools (ADR 0083, decision 2), so without it the
      CLI's `banda thread wake` would not be the Agent's; and waking only
      brings its Thread back into its Person's sight, which a snooze of a
      minute would do anyway. The Person's CLI snoozes and wakes any
      Thread.

11. **Later: waking on an event** (_decided_). A snooze "until the PR is
    merged" or "until CI passes" is "until done" with other events. It
    waits for the git module to publish them, and gets its own ADR.

## Consequences

- One snooze for every window, every machine and every Agent. A Thread
  snoozed in the evening is still snoozed in the morning, on any machine.
- The sidebar keeps a Person's marks in two places for a while: the
  snooze in the engine, the rest in the window. Archive's move to the
  engine is its own step.
- An Agent can take its Thread out of the Person's sight. Anything that
  needs the Person wakes it, and the Agent's own snooze shows as the
  Agent's in the Thread's line ("Snoozed by its Agent until 22:40").
- Nothing has to fire at a time to wake a Thread, so a sleeping laptop or
  a stopped engine wakes nothing late or twice. Only "Go on by itself"
  does, and it tries again on start.
- `Alt+Z` is taken. ADR 0025 moved the zoom to `Alt+Shift+F`, so it was
  free.

## Steps

1. **This ADR, its research and the GLOSSARY.**
2. **The engine**: the snooze on the Thread, `agents.snooze` and
   `agents.wake`, the facts, the list's field, the wake rules (decisions
   1–3).
3. **The window**: the picker with its field, `Alt+Z`, the row's clock
   and menus, the shelf, the woke row, the Panes closing, the bar's
   counts, the toasts and the notification (decisions 4–7).
4. **The Thread's Pane**: the "Snoozed" and "Woke" lines, the usage
   limit's snooze and "Go on by itself" (decisions 4, 7 and 8).
5. **The presets** in `sidebar.toml` (decision 9).
6. **An Agent's snooze**: the tool, the CLI and the Banda skill
   (decision 10).

Then waking on an event, with its own ADR.
