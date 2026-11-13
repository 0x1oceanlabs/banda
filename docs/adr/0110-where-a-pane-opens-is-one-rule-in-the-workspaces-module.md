---
status: accepted
date: 2026-11-11
---

# Where a Pane opens is one rule, in the `workspaces` module

_It carries out ADR 0087 decision 10 (Free and Row are the Tiling's
placement policy, run in the engine) and ADR 0102 decisions 3 and 6 for
every caller. It stays inside ADR 0101 decisions 5 and 6, and names no new
module._

Roma, on 2026-11-11 (translated), after a run of the real window: "it
looks like a refactor area, to put this properly in the window composer",
and then: "we will have several machines, so check how it fits, and how
our UNIX should be organized".

The composer is the Tiling: `client/web/src/tiling` and its engine module
`platform/workspaces` (ADR 0087). What is wrong is not where it lives but
that one rule is written several times, and that callers differ:

| Rule | Window | Agent | CLI |
|---|---|---|---|
| Where a Pane opens | `placeFor`, `movesAway` | `agents_place`, `owned_place` | none |
| A move onto another Project's workspace | refused by `refusedTo` | not refused | not refused |
| The Flow | read in `Shell.tsx` | not known to the engine | not known |

So an Agent's Pane in the Flow `free` lands where the row would put it,
and an Agent or `banda` can move a Pane where the Person may not.

## Decision

1. **No new module.** `platform/workspaces` is the Tiling's engine. The
   arrangement stays the Host-scope `workspaces` module of the machine
   whose window shows it, never copied (ADR 0101, decision 5).
2. **Mechanism and policy are apart.** `model.rs` does what it is told and
   keeps the arrangement whole. A new `placing.rs` beside it decides: a
   pure function from the arrangement, the facts and what is asked, to a
   place or a refusal. Nothing else in the engine picks a place.
3. **A command says what is wanted, not where it goes.** The window sends
   the Pane to open and the Pane it is opened from. A `place` stays for
   when the Person named one: a drop, "Open beside", the Drawer.
4. **One rule for every caller.** The window, an Agent's `open_pane` and
   `banda` all come through `placing.rs`. `show.requested@1` and
   `workspaces.place` connect to the same rule when H6 builds them (ADR
   0101, decision 6).
5. **The engine computes from what it knows.** That is its arrangement,
   its machine's copy of the shared `flow` (ADR 0079), the Pane kinds, and
   its own machine's Projects.
6. **The window adds a fact only about another machine.** It adds only
   what that command needs and only about another machine's Projects, as
   `arrange.projects`, `leads` and `tidy.projects` do. About its own
   machine's Projects the engine does not take the window's word. Machines
   stay peers, and no engine asks another (ADR 0101).
7. **Away means the safe default.** With the other machine away, the
   window says nothing about it, and the engine takes the default that
   loses nothing: a workspace stays.
8. **Refusals are the engine's.** A move that `placing.rs` refuses is
   refused for every caller, with a code that names the workspace and its
   Project. The words stay the window's, which knows the names. The window
   still predicts a refusal, for the note over a workspace while a Pane is
   carried, and never decides one.
9. **The prediction follows.** `tiling/arrangement.ts` mirrors
   `placing.rs` and the golden traces in `platform/workspaces/traces/`
   hold the two together, until T1 runs the Rust in the window (ADR 0088,
   decision 11). A rule never lands in only one of them.
10. **What stays each window's.** Solo, widths and scroll are each
    client's view (ADR 0087, decision 10). `workspaces.tidy` comes only
    from the device in front. Keys, focus return and what lies over what
    are the Window's Top layer, which is not the Tiling.

## Order

Each step is its own PR, and the window keeps working after each.

1. `placing.rs` for where a Pane opens. `placeFor` and `movesAway` leave
   the window, and Arrange gathers a loose Pane already on its Project's
   workspace.
   _Built_ (step 1b): `workspaces.open` with no `place` is placed by
   `placing.rs` for every caller. The window sends the Pane it is opened
   from (`from`) and, for when none is in front, the workspace on screen
   (`on`): both say where the Person is, and neither is a place. It adds
   three facts the engine cannot know: `agents`, the window opens it for
   an Agent whose Thread no workspace shows; `moved`, with `instead`, it
   shows what that Pane showed in another Project, so the engine may have
   it open elsewhere while that Pane leaves, in one command; and
   `scratch`, its Project is of no Project, which the engine says itself
   of a Project it knows and takes only of one it does not (decision 6).
   `commands::apply` takes the engine's `Facts` (the Flow and the kinds
   that say `home`), the traces record them, and `tiling/arrangement.ts`
   replays them. A place stays in a command where
   its caller named one: a drop, a move, "Open beside", a Pane's `open`
   with a place, an Agent's Thread that a workspace shows (`beside`), and
   the buttons of an empty workspace no Project owns.
2. Refusals in the engine.
3. The Top layer in the Window: one stack, the keys, one focus return, so
   a Pane's inner field gets them back whichever layer closes.
4. Cleaning `arrange.ts`, `actions.ts` and `Shell.tsx`, and the Tiling
   driver into `client/core`.

## Consequences

- An Agent's Pane and a Pane `banda` opens land where the Person's would.
- A new client asks for a Pane and needs no placement of its own. Until
  T1, it needs the TS prediction to draw at once.
- A Pane of another machine's Project sits in the arrangement with
  `args.host` (ADR 0101, decision 5), and the rule treats it by the facts
  the window gave, or by the safe default.
- A kind's `home` is known in the engine, as `grouped` already is.

## Not decided here

- Whether `Alt+Enter` on a free workspace stays there or goes to the
  Project's workspace.
