---
status: accepted
date: 2026-11-14
---

# A Thread's Group holds what its Thread opens, and the Person's keys open beside it

_It changes ADR 0102, decisions 3 and 4, extends ADR 0065, decision 7, and
settles the first two of the three choices WS2 left open (#1655). It stays
inside ADR 0110: where a Pane opens is one rule, in `placing.rs`._

Roma, on 2026-11-14 (translated), asked whether `Alt+D` pressed in a
Thread should join its Group as what its Agent opens does: "I don't always
want to open in the Group. By default the Group is the place where the
Agent opens windows, and the windows I open with a click from the chat.
If I open a terminal or Files or something else, it is logical not to put
it in the Group." And then: "the Project's own Group should go, it is not
needed", and "it matters that all this logic is in one place, not smeared
over different places."

It serves principle 3 of [the window](../window.md) (the engine decides)
and its principle 1 (one thing, one place).

**Where it stands** (main at `2007aef4`).

- In the row, a Pane the Person opens by a key from inside a Group joins
  that Group (ADR 0102, decision 3.2). In the Flow `free` it opens right
  of the Pane in front, outside the Group. So `Alt+D` in a Thread lands in
  its Group or not by the Flow.
- What the Person opens for a Project and not from a Group goes into the
  Project's own Group, first on its workspace (ADR 0102, decisions 3.3
  and 4). It has a handle with the Project's name and a tag, and solo
  fills the screen with it.
- The engine knows who opens a Pane (`By::Person`, `By::Agent`) and the
  Pane it is opened from, but not whether the Person clicked in that Pane
  or pressed a key over it: both arrive as `from`.
- `banda files .` typed in a terminal sends no `from`, so it lands as from
  nowhere, though `Alt+E` in the same terminal would land beside it.
- The rule is written once, in
  `platform/workspaces/engine/src/placing.rs`. The window keeps a copy in
  `client/web/src/tiling/arrangement.ts` to draw ahead of the engine, held
  to it by the golden traces until T1 runs the engine's code there (ADR
  0088, decision 11). Beside it, `client/web/src/tiling/opening.ts` still
  names a place itself in a few cases (`startingHere`).

## Decision

1. **A Thread's Group holds what its Thread opens.** Into it go:
   - what its Agent opens (ADR 0065, decision 7, as now);
   - what the Person opens with a click in the Thread's Pane: a path, a
     link, a Diff, a page, a sub-agent;
   - what the Person opens with a click in a Pane already in the Group:
     a file in Files the Agent opened, a file in its Diff.

   A Group is the Agent's work, and what follows from it stays with it.

2. **What the Person opens by a key, the Banda menu, the sidebar or
   `banda` opens beside, never into a Group.** It is a column of its own:
   - from a Pane in a Group: right of the Group, on its workspace;
   - otherwise as the Flow says, as now: in `free`, right of the Pane in
     front; in the row, on its Project's workspace (decision 3).

   This holds in every Flow, so `Alt+D` in a Thread lands in the same
   place in `free` and in the row. To put such a Pane into a Group, the
   Person drags it in (ADR 0065, decision 5). A rule in `tiling.toml` that
   says `opens = "group"` is the Person's own and still wins (ADR 0127,
   decision 4).

3. **There is no Project's own Group.** A Pane the Person opens for a
   Project, from no Pane or from another workspace, opens in the row as a
   column of its own where the own Group stood: on its Project's
   workspace, right of the columns in no Group at its start, and the
   window goes there. Its handle, its name tag and the commands for it go.
   An arrangement saved with an own Group reads it as columns in no Group,
   in their order. Solo fills the screen with a column in no Group as it
   does now (ADR 0102, decision 8).
   _Built_ in step 2 (#1785): the place `start` (`{"to": "own"}` still
   reads as it) puts the column right of the columns in no Group at the
   workspace's start; the store reads a kept own Group as columns in none.
   From a column in no Group on its Project's workspace, a Pane opens right
   of it, not at the start: so `Alt+N` twice in a Thread puts the second
   right of the first, both right of the Group. The start is for no Pane
   in front and for one on another Project's workspace.

4. **`banda` says the Pane it runs in.** A terminal gives what runs in it
   its Pane's ID in `BANDA_PANE`, and `banda` sends it as `from` when it
   opens a Pane. So `banda files .` typed in a terminal lands where
   `Alt+E` in that terminal would. `banda` run by an Agent opens as its
   Agent's, by its pass (decision 1), whatever `BANDA_PANE` says.

5. **The rule is in one place.** `placing.rs` alone decides where a Pane
   with no place goes, by who opens it, how and from what. A caller says
   only what happened:
   - `by`: the Person or an Agent, as now;
   - `from`: the Pane it is opened from, as now;
   - `via`: new, `click` when the Person clicked in `from`, `key` for a
     key, a menu, the sidebar or `banda`.

   The window names no place for a new Pane, except where the Person puts
   it by hand: a drop, "Open beside", a pick. `startingHere` and the other
   places `opening.ts` names go into the engine's rule. The window's copy
   in `arrangement.ts` changes only after the engine's and its traces,
   and goes with T1.

6. **A new Thread asked for on an empty free workspace opens there.**
   _Added 2026-11-14._ Roma, asked whether the buttons' way or
   `Alt+Enter`'s should stay (#1655, case 3), answered: "here". On an
   empty workspace no Project owns, the buttons and `Alt+Enter` both open
   the new Thread on it, and the screen stays. The engine places it, by
   the workspace on screen (`on`), and the window's `startingHere` goes.
   It answers ADR 0110's open question for an empty free workspace; one
   that holds Panes keeps today's way until a case asks for another.

## Consequences

- One sentence says where a Pane opens: what its Thread opens goes into
  its Group, the rest beside, where the Flow puts it. It is the same in
  `free` and in the row, from a key, a menu, the sidebar or `banda`.
- The row loses a kind of Group, and the window a handle, a tag and the
  code behind them (`own` in `model.rs`, `arrangement.ts`, `opening.ts`
  and the Pane menu).
- A Person who opened terminals into a Thread's Group by a key now gets
  them beside it, and drags one in when they want it there.
- `By` stays two cases: a click in a Thread counts as the Person's, and
  only `via` tells it from a key.

## Changed here

- **ADR 0102, decision 3.2:** a Pane opened by a key from inside a Group
  no longer joins it; only what the Thread opens does (decision 1).
- **ADR 0102, decisions 3.3 and 4:** the Project's own Group goes
  (decision 3).
- **ADR 0065, decision 7:** a Thread's Group also takes what the Person
  opens with a click in it (decision 1).
- **GLOSSARY:** "Project's own Group" goes; "Group" says what joins it.

## Steps

Each step is a PR that names this ADR and track 3, slice WS2.

1. **The rule.** `placing.rs` takes `via` and places by decisions 1, 2
   and 5. The window sends `via` and names no place of its own; its copy
   follows the traces.
   _Roma tries:_ in a Thread, a path clicked in the chat opens in its
   Group, `Alt+D` and `Alt+E` open right of the Group, in `free` and in
   the row alike.
2. **No own Group.** It goes from the model, the page and the Pane menu,
   and a saved one reads as plain columns.
   _Roma tries:_ a terminal opened from the sidebar for a Project opens as
   a plain column at its workspace's start, with no handle; an old
   arrangement opens with the same columns.
3. **`banda` from a terminal.** `BANDA_PANE` and `from`.
   _Roma tries:_ `banda files .` in a terminal beside a Thread opens Files
   where `Alt+E` would.
4. **A new Thread here.** Decision 6.
   _Roma tries:_ on an empty free workspace, `Alt+Enter` opens the new
   Thread on it, as its button does.
