# The Tiling's behaviour as one table

Research, 2026-11-16. It is evidence for a decision, not the decision: an
ADR follows if Roma takes the idea.

Roma, 2026-11-16, after the four steps of
[ADR 0134](../adr/0134-a-thread-s-group-holds-what-its-thread-opens-and-the-person-s-keys-open-beside-it.md):
no more fixing one Pane's behaviour at a time. He asks for the behaviour
of every Pane in one place, one logic a Person can predict, as niri's and
Hyprland's, with what is Banda's own; a good default; a file to change it.
The design first, then the code.

It serves rules 1 and 2 of [the window](../window.md) (each thing in one
place, the engine decides) and principle 9 of
[what we build](../what-we-build.md).

**Source and limits.** `main` at `5291a5b6`. Read whole: `placing.rs`,
the head of `tiling.rs`, `arrange.ts`, `opening.ts`, the head of
`flow.ts`, the names of the tests of `model.rs` and of the traces. Not
read: how `model.rs` tidies and arranges line by line, `Popped.tsx`,
`useMoving.ts`, `Overview.tsx`. Nothing here was run: the table below was
made by reading, and the traces were not replayed over it.

## What is wrong today

The module is one already: `platform/workspaces`, and where a Pane opens
is one function, `placing::place` (ADR 0110). Three things still make
each change a bug hunt:

1. **The rule is a tree of cases.** `place` branches on who opens, how,
   from what, the Flow, whose workspace it is, the kind of Pane and
   whether the workspace is empty. Each decision of Roma's adds a branch:
   ADR 0134 added three.
2. **The code is written twice.** The engine's model is Rust, some 5,900
   lines. The window draws ahead of the engine with a copy of it in
   TypeScript, function for function (`arrangement.ts`, 1,617 lines, with
   `model.ts` and `arrange.ts`). The golden traces hold the two together.
   A change to the rule is made twice.
3. **Placing is one behaviour of several, and the others are not in the
   module.** The table below says who decides each today.

## Who decides what today

| Behaviour | Decides | Where |
|---|---|---|
| Where a Pane with no place opens | the engine; the window copies it to draw ahead | `placing.rs` `place`; `arrangement.ts` |
| How wide its new column is | the engine | `placing.rs` `Facts::width`, `tiling.toml` |
| Whether a Pane shown already gets the focus instead of a second one | **the window** | `opening.ts` `placed` |
| A place the Person names (a drop, "Open beside", a pick) | the window names it, the engine does or refuses it | `opening.ts`, `useMoving.ts` |
| Which move the row refuses | the engine; the window copies it for the toast | `placing.rs` `refuses`; `arrange.ts` `refusable` |
| Whether a new Pane takes the focus | **the window** | `unheard.ts` `predict`: it wants the Pane its own command opens, unless `focus: false` |
| Whether the screen goes to a new Pane's workspace | **the window** | `arrange.ts` `aim`: the screen goes where the wanted Pane is |
| What takes the focus after a close | **the window** | `arrange.ts` `held`: after a Pane in a stack, the next; after a column, the one before |
| Solo | **the window**, each device for itself | `flow.ts` |
| An empty workspace at the bottom, tidying, Arrange by Project | the engine; the window copies it | `model.rs` `tidy`, `settle`, `standing` |
| A Pane in a window of its own | **the window** | `Popped.tsx` (not read) |

Five of eleven are the window's alone. The engine holds no focus: it is
told the Pane in front as a fact of each call, and it does not know which
device is in front (#1727).

## Where a Pane opens today, case by case

`place` as it runs, in its own order. The first case that holds decides.
The tests are `placing.rs`'s; the traces are in
`platform/workspaces/traces/`.

| # | Who | From | And | It goes | Held by |
|---|---|---|---|---|---|
| 1 | an Agent | any | a workspace shows its Thread; the Pane's kind leads no Group | into its Thread's Group | `what_an_agent_opens_goes_by_its_thread…`, trace 06 |
| 2 | an Agent | any | the row | last on its Project's workspace; of no Project, on the top free one | `a_thread_and_what_an_agent_opens_go_on_their_projects_workspace`, trace 16 |
| 3 | any | a Pane | the Person's rule for the kind says `beside`, `below` or `group`; not, in the row, from another Project's workspace | where the rule says, by the Pane in front | `a_rule_places_a_pane…`, `a_rule_gives_way…`, trace 19 |
| 4 | the Person | no Pane | the workspace on screen is empty and no Project's; and the Flow is free, or the Pane is of no Project, or its Project owns a workspace already | on the workspace on screen | `on_an_empty_free_workspace_on_screen…` |
| 5 | the Person, a click | a Thread, or a Pane in a Group | | into that Group | `a_click_in_a_thread_or_its_group…`, trace 20 |
| 6 | the Person, a key | a Pane in a Group | not from another Project's workspace; not a kind the row sends home | right of the whole Group | `a_key_from_a_thread_or_its_group…`, trace 20 |
| 7 | any | any | the row; the kind stands on its Project's workspace (a Thread) | last on its Project's workspace; of no Project, on the top free one | `a_key_from_a_group_on_another_projects_workspace_goes_home…`, trace 16 |
| 8 | any | a Pane | the Flow free | right of it | `in_the_flow_free_a_pane_goes_right…`, trace 15 |
| 9 | any | no Pane | the Flow free | last on the workspace on screen | `with_no_pane_in_front_the_flow_free_takes_the_workspace_on_screen`, trace 15 |
| 10 | any | no Pane | the row; of no Project | last on the workspace on screen | `of_no_project_with_no_pane_in_front…` |
| 11 | any | no Pane | the row | first on its Project's workspace, right of its columns in no Group | `with_nothing_in_front_a_pane_goes_first…`, trace 13 |
| 12 | any | a Pane on another Project's workspace | the row | as 11 | trace 16 |
| 13 | any | a Pane | the row | right of it | `on_a_free_workspace…`, `in_the_row_a_key_twice…`, trace 16 |

Beside `place`: a Pane opened in place of another (`instead`) takes that
Pane's place, or goes by the table when the row would not have it there
(`moves_away`, trace 17). With no Pane in front, no workspace on screen
and the Flow free, `place` names no place, and the model puts the Pane on
the bottom workspace (ADR 0102, decision 3).

## The idea

**The mechanism stays code, the policy becomes data.**

- The mechanism: workspaces, columns, Groups, "put a column there", the
  checks that keep an arrangement whole, and what the row refuses. It is
  `model.rs`, and it does not change.
- The policy: an ordered table, "what holds → where it goes". Banda's
  defaults are such a table, kept in the binary as the same text the
  Person's file is. `tiling.toml` already has `[rule.<app>.<kind>]` with
  `width` and `opens`: the table widens that, it is no new layer.

**One rule first, as niri's:** a new Pane opens right of the one in front,
on the workspace on screen, and no other Pane moves or changes size.
What is Banda's own is a few lines over it: what an Agent opens goes into
its Thread's Group; a click in a Thread opens into its Group; in the row a
Project's Pane goes to its Project's workspace.

**A closed list of what a line may ask and say.** No expressions and no
conditions in a value: a small language in the table would be a third
copy of the logic.

| A line asks | Its values |
|---|---|
| `kind` | an App's kind of Pane |
| `by` | `person`, `agent` |
| `via` | `click`, `key` |
| `from` | `none`, `pane`, `group` (a Thread, or a Pane in a Group) |
| `flow` | `free`, `row` |
| `project` | `one`, `none` |
| `from-workspace` | `own`, `other`, `free` |
| `screen` | `empty-free` |

| A line says | Its values |
|---|---|
| `opens` | `beside`, `below`, `group`, `beside-group`, `thread-group`, `project`, `project-start`, `here` |
| `width` | a preset's name |
| `focus` | `true`, `false` |
| `follow` | `true`, `false`: whether the screen goes to it |

The thirteen cases above become thirteen lines of it, in the same order.
`thread-group`, `beside-group`, `project-start` and `here` are places
`placing.rs` has today (`agents_place`, right of a Group's last column,
`Place::Start`, `here`).

## What did not fit cleanly

By reading, every case is a line. Three need something a plain table does
not give:

1. **The Person's rule is not "on top".** Today it stands third: under
   what an Agent opens (cases 1 and 2), over the rest. A file laid simply
   over the defaults would send an Agent's terminal where
   `[rule.terminal.terminal]` says, which is not today's behaviour. Either
   the Person's lines take a fixed place in the order, or the order is the
   Person's to see and change.
2. **Case 4 asks whether the Pane's Project owns a workspace yet.** It is
   asked once, for one exception (ADR 0134, decision 6: in the row a
   Project with no workspace still gets its own). It needs a value of its
   own, or the exception goes.
3. **A rule gives way** with no Pane in front and, in the row, from
   another Project's workspace (case 3). That is the mechanism's law, "a
   rule never puts a Pane where the row would refuse it": it stays code,
   and a line that names such a place falls to the next.

Not tried: whether the traces replay unchanged. Until they do, "it fits"
is a reading, not a result.

## What the table cannot hold

- **The view stays the device's.** The workspace on screen, each
  workspace's focused column and each column's shown Pane are each
  device's own (ADR 0025, decision 1), and the engine does not know the
  device in front until SE7 (#1727). So the engine cannot move a screen.
  What can go to the module is the rule as a pure function: the
  arrangement before and after, the view before, give the view after. The
  window runs it on its own view. That needs the module's code in the
  window, which is the next point.
- **One copy needs the model in the window.** ADR 0088 (decision 11) says
  the model compiled to WebAssembly replaces `arrangement.ts` (T1). It is
  not in track 3's plan, and its cost is not measured. The crate today
  depends on the kernel (IDs, `Refusal`, `Wall`), on `banda-look`
  (columns, the file's reader), and on `rusqlite`, `toml`, `schemars`
  and `async-trait`. The model and the rule would have to be a leaf crate
  beside what stores and serves them.
- **A table moved to the window as a second reader** would be the same
  double as today. Without T1 the table still halves the work (the lines
  are read by both copies, written once), and the reader is written twice.

## What must hold, if it is built

Agreed with track 3's lead, 2026-11-16:

1. **It replaces the tree.** `place` becomes "the first line that holds",
   and the branches go in the PR that brings the table. The defaults are
   the same text as the Person's file, with no code for "no line held".
2. **The lists are closed, and a check holds them.**
3. **The traces and `placing.rs`'s tests pass unchanged.** What had to be
   rewritten goes in the list of what did not fit.

## What is Roma's to say

1. **The two Flows.** Free and the row as two sets of defaults of one
   table (recommended, and `flow` is a key of the file already), or one
   Flow.
2. **The file's form.** On 2026-11-13 Roma leaned to Lua for the Tiling's
   file. A closed table fits TOML as it is. If Lua is meant, the form is
   decided before the ADR.
3. **The focus after a close.** Today: after a Pane in a stack, the next;
   after a column, the one before. niri, as recalled and not checked
   here, gives the focus back to the column that had it before when the
   closed one was opened last. Which one is Banda's.
4. **The Person's rule and an Agent's Pane** (the first point of what did
   not fit): does the Person's line for a kind hold for what an Agent
   opens too.

## The order, if Roma takes it

This page → an ADR → a trial of T1 for its cost → the table in the engine
→ the focus and the screen as the module's rule. Track 3's WS5b waits for
the ADR, and its WS7d for the answer on T1.
