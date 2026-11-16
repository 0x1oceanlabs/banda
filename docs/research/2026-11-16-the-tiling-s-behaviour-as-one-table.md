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
`useMoving.ts`, `Overview.tsx`; what the table of who decides says of
them is track 3's lead's, from his reading of #1850. One thing was run:
shape B below, beside `place`, over every test and trace of the crate
([the replay](#the-replay)).

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
| Which part of the Strip is on screen as the focus moves: the focused column fitted, or centred | **the window** | `layout.ts`, `Strip.tsx` (not read); niri's `center-focused-column`, the most felt default there |
| What the screen shows when its workspace goes | **the window** | `arrange.ts` `closingWorkspace`, `closableAt` |
| A Pane over the whole window, and back (zoom) | **the window** | the engine keeps sizes, the window the zoom |
| The next width or height a key steps a column to | the engine keeps the size, the window picks the step | `useSizing.ts`, `[columns]` `presets` |
| A narrow kind's column opens at the narrowest preset | the engine | `Facts::narrow` (#1761) |
| Tidying, only from the window in front | the window says whether to ask, the engine tidies | WS5a (#1729); "who is in front" is missing here too (#1727) |
| Arrange's Undo; a new Thread comes to the front | **the window** | #1342, #1336 |
| Solo | **the window**, each device for itself | `flow.ts` |
| An empty workspace at the bottom, tidying, Arrange by Project | the engine; the window copies it | `model.rs` `tidy`, `settle`, `standing` |
| A Pane in a window of its own | **the window** and main | the page keeps its place, main its window (`client/desktop/src/os-window/popped.ts`, #1824) |

Nine of eighteen are the window's alone. The engine holds no focus: it is
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

There are two shapes of it to choose between.

### Shape A: every case is a line

All thirteen cases are lines, in today's order, and the Person's file is
laid into a fixed place among them.

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

Eight things to ask for thirteen lines, and three of them
(`from-workspace`, `screen`, and "its Project owns a workspace" of case
4) are there for one or two lines each. It is the tree written down: a
Person will never change "what an Agent opens goes into its Thread's
Group".

### Shape B: laws in code, the table for what a Person may want otherwise

Some cases are laws, of an Agent's Pane and of the row. They outrank the
Person's lines and are not the Person's to reorder. They stay code in the
mechanism, each named and tested:

1. **An Agent's Pane.** What an Agent opens goes into its Thread's Group;
   in the row, with no Thread shown, last on its Project's workspace
   (cases 1 and 2).
2. **The row keeps a Project's Panes off another Project's workspace.** A
   line that would put a Pane there by the Pane in front gives way to the
   next (cases 3 and 12).
3. **An empty workspace no Project owns** takes what the Person opens with
   no Pane in front; in the row a Project that owns no workspace yet still
   gets its own (case 4; ADR 0134, decision 6).
4. **A place that cannot be made gives way to the next line:** beside a
   Pane, with none in front; into a Group, for a kind that leads one.
5. **Of no Project:** "its Project's workspace" is the top free one, and
   "first on its Project's workspace" is the workspace on screen (case
   10).

The table then asks three things, `kind`, `via` and `from`, and each Flow
has its own short set of defaults:

| The Flow free | It goes |
|---|---|
| a click, from a Thread or a Pane in a Group | into that Group |
| a key, from a Pane in a Group | right of the whole Group |
| from a Pane | right of it |
| else | last on the workspace on screen |

| The row | It goes |
|---|---|
| a click, from a Thread or a Pane in a Group | into that Group |
| a kind that stands on its Project's workspace (a Thread) | last on its Project's workspace |
| a key, from a Pane in a Group | right of the whole Group |
| from a Pane | right of it |
| else | first on its Project's workspace |

The Person's lines, `[rule.<app>.<kind>]` as today, go over these, under
the laws. So the Person's file is truly "on top" of Banda's defaults, and
a line for a kind does not move what an Agent opens.

| | Shape A | Shape B |
|---|---|---|
| Lines of defaults | 13 | 4 in free, 5 in the row |
| What a line asks | 8 things | 3: `kind`, `via`, `from` |
| Cases left as code | the row's refusal, as a rule gives way (in case 3) | five laws, which hold cases 1, 2, 4, 10 and 12 and part of 3 |
| The Person's file | at a fixed place in the order | over all defaults |
| Change to `tiling.toml` | new keys and an order | `[rule.<app>.<kind>]` gains `via` and `from` |

Track 3's lead picks B, and so does this page: it is the smaller change
on the road there is, and what stays code is what no Person would edit.

What a line says is the same in both:

| A line says | Its values |
|---|---|
| `opens` | `beside`, `below`, `group`, `beside-group`, `project`, `project-start`, `here` |
| `width` | a preset's name |
| `focus`, `follow` | `true`, `false`: whether it takes the focus, and whether the screen goes to it. **Not in the first step**: see what the table cannot hold |

## The replay

Shape B was written as a test-only reader beside `place`, and every
placing the crate's tests and traces make was run through both (branch
`test/placing-table-replay`, `f7701cce`, not to merge; no product code
changed).

- **298 placings, the same `Place` each time:** 96 in `placing.rs`'s and
  the model's tests, 111 in the twenty golden traces
  (`tests/traces.rs`), 91 in `tests/workspaces.rs`. No test and no trace
  was changed.
- **The replay bites.** With the "owns a workspace" exception of law 3
  taken out, it fails. With a click into a Group made to give way on
  another Project's workspace, as a rule does, it fails: a click is held
  to today's behaviour there.
- **One order no test holds.** In the row, the line for a kind that
  stands on its Project's workspace is over the line for a key from a
  Group: a new Thread asked by a key from a Thread's Group goes last on
  its Project's workspace, not right of the Group. With the two lines
  swapped every test and trace still passes. It needs a test before the
  table replaces the tree.

Shape A was not replayed: it is the tree line for line, so it would pass
by construction, and it is not the pick.

## What did not fit cleanly

In shape A three things did not fit a plain table: the Person's rule is
not "on top" but third in the order, under what an Agent opens; case 4
asks once whether the Pane's Project owns a workspace; and a rule gives
way where the row would refuse it. The first and the third are one fact:
those cases are laws, not policy. Shape B takes all three out of the
table, as laws 1, 2 and 3.

In shape B, by the replay, nothing was rewritten. What it leaves open:

1. **Law 3's exception** (a Project that owns no workspace) is one branch
   kept for one case. It stays, or the exception goes: Roma's to say, with
   the ADR.
2. **A click is not held by law 2** as a key and a rule are: a click in a
   Thread that stands on another Project's workspace opens into its Group
   there. A test holds that today, so the replay keeps it. It is a law
   with one exception, to name in the ADR.

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

Answered, 2026-11-16:

- **The file's form: TOML.** `tiling.toml` as it is, no Lua.
- **The focus after a close:** the one a Person can predict, as this page
  recommends: the focus goes back to what had it before. The ADR says
  the rule in full.
- **The order of work:** one predictable behaviour for every Pane first,
  what a Person changes in the file after it.

Open:

1. **The two Flows.** Free and the row as two sets of defaults of one
   table (recommended, and `flow` is a key of the file already), or one
   Flow. Solo is a view of the row, each device's own, and not a third
   set.
2. **The Person's rule and an Agent's Pane:** does the Person's line for
   a kind hold for what an Agent opens too. Shape B says no: law 1 is
   over the table.

## The order, if Roma takes it

1. This page, with the replay.
2. An ADR, on the replay's result.
3. The table in the engine for `opens` and `width`, where the engine
   decides already: `place` becomes the laws, then the first line that
   holds, and the tree goes in the same PR.
4. A trial of T1, for its cost.
5. The focus and the screen as the module's rule, `focus` and `follow`
   in the table: only with the answer on T1, as the rule must run in the
   window.

Track 3's WS5b waits for the ADR, and its WS7d for the answer on T1.
