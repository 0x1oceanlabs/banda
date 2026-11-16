---
status: accepted
date: 2026-11-16
---

# Every Pane behaves by the same laws and one short table

_It carries on ADR 0110 (where a Pane opens is one rule) and ADR 0127,
decision 4 (the Tiling's file), and keeps ADR 0134's and ADR 0102's
behaviour as it is. It adds the rules ADR 0110 did not hold: the focus,
the screen and what a close leaves._

Roma, on 2026-11-16 (translated): "I would put the behaviour of windows
in one place: one predictable logic for all windows, as niri and
Hyprland have, with what is our own; a good UX by default; a file to
customise it. Not fight one window at a time and fix bugs." And, the same
day: "There will be not only our applications but the users' apps. This
has to be done well once, and after that all goes smoothly." Both Flows
stay, the file stays TOML, and the predictable behaviour for every Pane
comes before what a Person changes in the file. Of the sheet below, read
in Russian the same day: "it looks good and logical."

It serves rules 1 and 2 of [the window](../window.md) (each thing in one
place, the engine decides) and principle 9 of
[what we build](../what-we-build.md).

**Where it stands.**
[The research](../research/2026-11-16-the-tiling-s-behaviour-as-one-table.md)
has it whole (`main` at `5291a5b6`):

- Where a Pane opens is one function, `placing::place`, a tree of thirteen
  cases. Each decision adds a branch.
- Of eighteen behaviours, nine are decided in the window alone: whether a
  new Pane takes the focus, whether the screen goes to it, what takes the
  focus after a close, which part of the Strip shows.
- The code is written twice, in the engine and in the window, held
  together by traces.
- Shape B of the research, five laws and a table of four or five lines,
  gave the same place as the tree for all 298 placings of the crate's
  tests and traces, with none changed.

## Decision

1. **One sheet for every Pane, of any App.** How a Pane behaves is this
   ADR's laws and table, the same for Banda's own Apps and for one from
   elsewhere. No rule in code names an App's kind. A kind says what it is
   by what `PaneKind` declares already: it stands on its Project's
   workspace (`home`), it leads a Group (`grouped`), it is a list beside
   other Panes (`narrow`), and what makes two Panes of it the same one
   (`identity`). A kind that declares nothing behaves by the first rule
   below, and that is a good default.

2. **The first rule.** A new Pane opens right of the Pane in front, on
   the workspace on screen. It takes the focus. No other Pane changes its
   size or its order.

3. **The laws.** They hold over every line of the table, and are code in
   the mechanism, each named and tested.
   1. **An Agent's Pane.** What an Agent opens goes into its Thread's
      Group; in the row, with no Thread shown, last on its Project's
      workspace. It takes no focus and moves no screen.
   2. **The Person's eyes.** The focus and the screen follow what the
      Person did, and nothing else: no Agent, no program and no other
      device moves them.
   3. **The row's workspaces.** In the row a Pane does not go, by the
      Pane in front, onto a workspace another Project owns: the line
      gives way to the next. A click in a Thread that stands there still
      opens into its Group, as today.
   4. **An empty free workspace** on screen takes what the Person opens
      with no Pane in front; in the row a Project that owns no workspace
      yet still gets its own (ADR 0134, decision 6).
   5. **A place that cannot be made gives way:** beside a Pane, with none
      in front, or one that has gone since.
   6. **Of no Project:** "its Project's workspace" is the top free one,
      and "first on its Project's workspace" the workspace on screen.
   7. **One Pane of a thing.** A Pane shown already, as its kind's
      `identity` says, gets the focus, and no second one opens, unless
      the Person asks for it again.

4. **The table.** What is not a law is a line: what holds, and where the
   Pane goes. A line asks `kind`, `via` (`click`, `key`) and `from`
   (`pane`, `group`: a Thread, or a Pane in a Group), and says `opens`
   and `width`. The first line that holds, and whose place can be made,
   decides. Each Flow has its own defaults:

   | The Flow `free` | `opens` |
   |---|---|
   | a click, from a Group | `group`: into that Group |
   | a key, from a Group | `beside-group`: right of the whole Group |
   | from a Pane | `beside`: right of it |
   | else | `here`: last on the workspace on screen |

   | The row | `opens` |
   |---|---|
   | a click, from a Group | `group` |
   | a kind that stands on its Project's workspace | `project`: last there |
   | a key, from a Group | `beside-group` |
   | from a Pane | `beside` |
   | else | `project-start`: first on its Project's workspace |

   The lists of what a line asks and says are closed, and a check holds
   them. A value is a word of the list: no expression and no condition.

5. **Whose line wins.** The laws; then the Person's lines in
   `tiling.toml`; then the kind's own, as its App declares (`home` is its
   `opens = "project"`, `narrow` its narrowest `width`); then Banda's
   defaults above. So an App from elsewhere sets its Pane's default in the
   same words the Person overrides it with.

6. **The file.** `tiling.toml` stays TOML. `[rule.<app>.<kind>]` keeps
   `width` and `opens`, and `opens` gains `beside-group`, `project-start`
   and `here`. A rule may ask how and from what, in tables under it:

   ```toml
   [rule.terminal.terminal]
   width = "1/3"

   [[rule.terminal.terminal.when]]   # a click, from a Group
   via = "click"
   from = "group"
   opens = "below"
   ```

   Banda's defaults are lines of the same kind, kept in the binary.
   _Built_ in steps 1 and 2 (#1853 and the PR of step 2): a rule's lines
   are an array of `when` tables, read in order before the rule's own
   `opens`, as an order is what they have. A line with a wrong word is
   named by `banda settings check` and left out whole: with the word
   alone left out it would hold for more than was meant. `project` and
   `project-start` give way in the Flow `free`, where no Project owns a
   workspace. Banda's own lines stay a constant beside the laws
   (`placing::FREE`, `ROW`), read by the same code as the Person's: two
   of their words, a kind that stands on its Project's workspace and a
   line the row's law does not hold, are not the Person's to write.

7. **After a close.** The focus goes back to the Pane that had it before
   the closed one, while that Pane still stands on the same workspace.
   Else: in a stack, to the Pane that takes its place; else to the column
   on the left. The screen stays on its workspace. A workspace that goes
   leaves the screen on the one that takes its place.

8. **What shows as the focus moves.** The Strip scrolls by the least that
   shows the focused column whole, and a Group's first column where it
   fits, as today; `center` of the look stays the Person's choice.

9. **Where the rules live.** `platform/workspaces` holds all of it.
   - The laws and the table that say where a Pane opens and how wide:
     in the engine, `placing.rs`. `place` becomes the laws, then the
     first line that holds, and the tree goes in the same PR.
   - The focus and the screen (laws 1 and 2, decisions 7 and 8) are each
     device's view, and the engine does not know the device in front
     (ADR 0025, decision 1; #1727). Their rule is one pure function of
     the module: the arrangement before and after, the view before and
     what the Person did give the view after. The window runs it on its
     own view. Until the module's code runs in the window (ADR 0088,
     decision 11), that function is the window's, in one file, with the
     module's tests of it as traces.

## Consequences

- One page says how any Pane behaves, and an App's author reads the same
  page as the Person.
- A decision of Roma's on placing becomes a line, or a law with its test,
  not a branch.
- The Person's file is over Banda's defaults and under the laws: a line
  for a kind does not move what an Agent opens.
- The window keeps the view, and loses the choice of what the view does:
  `held`, `aim` and what sets `want` become one function with one list of
  cases.
- The focus after a close changes for the Person: it goes back to where
  it was, where today it goes to the next Pane or the column before.
- Two copies of the model stay until ADR 0088's step: this ADR halves
  what a change costs and does not end the copy.

## Changed here

- **ADR 0110, decision 3:** the rule is laws and a table, not one
  function's branches.
- **ADR 0127, decision 4:** a rule in `tiling.toml` may ask `via` and
  `from`, and `opens` has three more places.
- **ADR 0025, decision 1:** the view stays the window's; what a change
  does to it is the module's rule.

## Not decided here

- Whether the model runs in the window as WebAssembly, and what that
  costs (ADR 0088, decision 11). Step 3 measures it.
- `focus` and `follow` as words of a line, for a Person who wants a kind
  to open without the focus. They wait for the rule to run in the window.
- A floating Pane, and a Pane in a window of its own, beyond what they
  do today.

## Steps

Each step is a PR that names this ADR and track 3.

1. **The table places.** `place` is the laws and the table; the tree
   goes. A test holds the order of the row's lines the traces do not (a
   key from a Group, for a kind that stands on its Project's workspace).
   Nothing a Person sees changes.
   _Roma tries:_ a day of work as before, in both Flows.
2. **The file asks how and from what.** `via`, `from` and the three
   places in `tiling.toml`, its schema and Settings → Tiling.
   _Roma tries:_ a line that sends a terminal clicked from a Thread under
   it; a line for a kind does not move what an Agent opens.
3. **A trial of the model in the window**, for its cost: a report, no
   product change.
4. **The view's rule.** One function for the focus and the screen, with
   decisions 7 and 8 and laws 1, 2 and 7; `held`, `aim` and `want` go.
   _Roma tries:_ open three Panes and close them one by one: the focus
   walks back the way it came; an Agent opens a Pane while Roma types,
   and nothing moves.
5. **An App from elsewhere.** A kind that declares nothing opens by the
   first rule; one that declares `home` or `narrow` gets its line.
   _Roma tries:_ a Pane of a test App opens beside the one in front, and
   a line in `tiling.toml` moves it.
