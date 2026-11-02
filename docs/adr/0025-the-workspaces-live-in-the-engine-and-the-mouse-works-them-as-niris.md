---
status: accepted
date: 2026-11-02
---

# The workspaces live in the engine, and the mouse works them as niri's

ADR 0005 decided that the workspaces live in the engine (decision 3), so
that the CLI and Agents change them like any other module's data, and
that the windows behave as in niri (decisions 5 and 7). The Strip, its
columns, their widths, tabs, the overview and the keys are built. The
workspaces were the window's: `localStorage`, out of the Agents' reach
(they moved to the engine on 2026-11-02, decisions 1 and 2). And the
mouse only clicks and swipes.

Roma, on 2026-11-02, after a list of what is left of niri and tiling:
"let's think the UX through well", then "I'd also like dragging windows
and working with the mouse; how does niri do it? maybe a dnd library".
On the list, Roma decided:

- No Split. The Strip is the one layout.
- Heights as in niri: `Alt+Shift+R` steps the Pane's height.
- Zoom as niri's fullscreen, on its key.
- The drawer on `` Alt+` ``.
- The workspaces move into the engine first: "it is the foundation".
- No hot corner for now.

**What niri does with the mouse** (its wiki, *Gestures*):

- `Mod` and the left button drag a window. An insert hint shows where it
  lands: a new column between two, or in a column. Nothing else moves
  until it is dropped. Against the screen's edge, the view scrolls; held
  over a window, it activates it; in the overview, held over a workspace,
  it goes there.
- `Mod` and the right button resize: sideways the column's width, up and
  down the window's height. A double click on a left or right edge makes
  the column the whole screen wide; on a top or bottom edge it gives the
  window its automatic height back.
- `Mod` and the middle button, or the wheel, drag the view: sideways the
  columns, up and down the workspaces.
- A touchpad: three fingers sideways move the view, up and down switch
  the workspace; four fingers open the overview.
- A hot corner, the screen's top left, opens the overview.

## Decision

1. **The workspaces are the engine's, as a module of this machine.**
   - **A second scope beside the Space.** Every module method today runs
     in a Space, and the kernel keeps one store and one event log per
     Space. The workspaces hold Panes of every Space, so they belong to
     no Space. The kernel gets one more scope, **this machine**: a store
     in the engine's state folder with its own receipts, event log and
     outbox, and the same command path. A module says it is the
     machine's (`Module::scope`, _built_ 2026-11-02); its methods then
     name no Space. `welcome` names the machine's ID, which the window
     follows and streams by as it does a Space's. The store is the engine
     state folder's `machine/`.
   - **The `workspaces` module** is the first module of the machine. It
     keeps the workspaces in order, each a Strip of columns, each column
     its Panes, stacked or as tabs, with its width and their heights.
     A Pane is its kind, its args and its Space, as the window keeps it
     now. A Pane of a Space on another machine sits there like any other
     (ADR 0005, decision 7).
   - **What it accepts.** A read of the whole arrangement at the log's
     sequence, then the window follows its events, as a Pane follows a
     view. Commands: open a Pane at a place, close one, move one to a
     place, size a column or a Pane, show a column stacked or as tabs,
     take the window's arrangement once (decision 2). A place is a
     workspace, a column and an index in it, or beside a Pane. _Built_
     2026-11-02 in `modules/workspaces/engine`: `workspaces.list`, and
     the commands `open` (at a place or `instead` of a Pane), `close`,
     `update`, `move_pane`, `move_column`, `size`, `maximize`, `display`,
     `tidy` (every empty workspace goes but the one looked at and the
     last) and `take` (once, over what the engine has). An event holds the
     whole arrangement after it, or for `updated` only the Pane's new
     args, the change made most; a command that changes nothing says
     nothing. The window draws them next. The log keeps every event, so
     the machine's log grows with each change; it may want cutting later.
   - **Commands carry what was decided.** What depends on the look stays
     the window's: the presets, `alone`, `min`, `display`. So `Alt+R`
     works out the next width in the window and sends it, `"1/2"`, and
     the CLI and an Agent send a width too. The engine's rules are the
     ones that hold whatever the look: one empty workspace at the bottom,
     a column with no Pane goes, a Pane is shown once.
   - **The window keeps the view.** The focus, where each Strip is
     scrolled, the overview and the zoom (decision 4) are what the Person
     looks at, not the arrangement (ADR 0005, decision 3: "Focus stays
     with the window."). An empty workspace in the middle goes when the
     Person leaves it, so the window says so as it leaves. _Built_
     2026-11-02 (`app/web/src/workspaces/arrange.ts`): the view holds
     IDs, each with where it stood, so a neighbour takes the place of
     one that went; it stays in the window's storage.
   - **The window draws what the engine says.** A key, a drag and an
     Agent all end in the same command, and the window draws the event
     that comes back. The engine runs on this machine, so the event is
     there before the next frame. A drag or a resize draws its own hint
     while the pointer moves and sends one command when it lets go.
     _Built_ 2026-11-02 for the keys: `model.ts` still works out where
     a key puts a Pane, and what that changes becomes one command. The
     window sends one at a time; each answers with the log's place of
     its event, and the next waits until the window draws past it, so
     quick keys land as pressed. A Pane opened or moved takes the focus
     once its event is drawn.
   - **An Agent arranges its own Space's Panes, and calmly** (ADR 0005,
     decision 4; ADR 0019). Behind the Space wall it sees only the Panes
     of its pass's Space, and opens, moves and closes only those (ADR
     0029: its Person may let it see the other Spaces' Panes, and it then
     opens its own beside them; it moves and closes only those it
     opened). It
     reads them through its tools, never the machine's log, whose events
     hold every Space's Panes. What
     it opens never takes the focus and carries a mark until the Person
     looks. Its tools are `methods!` lines marked `tool`, as the agents
     module's are.
   - **The CLI** reaches the same methods: `banda call workspaces.…`
     and `banda follow`.

2. **The window's arrangement moves over once.** When the engine has no
   workspaces and the window's storage has some, the window sends them
   in one command, and stops keeping them. The window's storage keeps the
   view: the focus and the sidebar.

3. **The Strip is the one layout; the Split goes.** ADR 0005 decision 5
   kept a tree of splits, close to Hyprland's dwindle, behind `Alt+V`.
   Columns, stacks, tabs and the zoom do what it would, and a second
   layout would double every rule. `Alt+V` is free.

4. **The keys, as niri's** (ADR 0005, decision 10):

   | Keys | Action | niri |
   |---|---|---|
   | `Alt+Shift+R` | the Pane's next height in its column, round | `Mod+Shift+R` |
   | `Alt+Ctrl+R` | every Pane of the column as high as the others | `Mod+Ctrl+R` |
   | `Alt+Ctrl+↑`, `Alt+Ctrl+↓` | the Pane a step lower or higher | |
   | `Alt+Ctrl+F` | the column as wide as the room left on the screen | `Mod+Ctrl+F` |
   | `Alt+Shift+F` | zoom: the Pane over the whole window, and back | `Mod+Shift+F` |
   | `Alt+C` | the column in the middle of the screen | `Mod+C` |
   | `Alt+Home`, `Alt+End` | the first or the last column | `Mod+Home`, `Mod+End` |
   | `Alt+Shift+Home`, `Alt+Shift+End` | the column moved to the first or the last place | `Mod+Ctrl+Home`, `Mod+Ctrl+End` |
   | `` Alt+` `` | the drawer (decision 8) | |

   - **Heights.** The Panes of a column share its height evenly until
     one gets a height of its own; then the others share what is left.
     `[columns] heights = ["1/3", "1/2", "2/3"]` in `look.toml` are the
     steps, beside `presets`.
   - **`Alt+Shift+R` was the previous width**; now it is the height, as
     niri's is. `Alt+Ctrl+←` steps the width back.
   - **The zoom** is niri's fullscreen-window, in the window: the Pane
     fills it with no gaps, the sidebar hides, the bar stays with the
     numbers and the calls. Its header says it is zoomed, and a click
     there, or the key again, brings it back. `Alt+F` stays the column
     the whole screen wide, with its neighbours a scroll away. It takes
     `Alt+Z`'s place in ADR 0005.
   - **`Alt+N`, then a letter** needs no chords. `Alt+N` opens the
     launcher, and the launcher takes letters: `T` a terminal, `B` a
     browser, `H` the Harnesses; with `Shift`, one more beside the one
     shown. Each button shows its letter.

5. **The mouse, as niri's, with one grammar.**
   - **Moving a Pane.** `Alt` and the left button anywhere on it, or its
     header with no key held, as a tab in a browser. While it moves:
     - it lifts and follows the pointer, and an insert hint, in the focus
       colour, shows where it lands: a column's edge makes a new column
       on that side, its middle puts it in the column's stack, a row of
       tabs makes it a tab. Nothing else moves until it lands, so the
       tiles stay calm (ADR 0005, decision 4);
     - against the Strip's edge, the Strip scrolls;
     - over a workspace's number in the bar, held a moment, that
       workspace shows; let go there, the Pane goes to it;
     - `Esc` puts it back.
   - **Sizing.** The gap between two columns, dragged, sizes the column
     on its left; the gap between two Panes of a column, their heights.
     `Alt` and the right button size the Pane under the pointer from
     anywhere: sideways the width, up and down the height. Near a preset
     the size holds a moment, so the steps are easy to hit. A double
     click on a gap between columns makes the column the whole screen
     wide, and back; between Panes, the heights even again.
   - **The view.** `Alt` and the middle button drag the Strip sideways
     and the workspaces up and down. The wheel stays as it is (the
     architecture's swipes): `Alt` and the wheel go a workspace up or
     down, a sideways swipe or `Shift` and the wheel scroll the Strip.
   - **A program's own mouse.** A terminal selects a block with `Alt`
     held. As with the keys (ADR 0005, decision 10), `Ctrl+Alt` and the
     button go to the program, as `Alt` alone would.
   - **A browser's page** takes the pointer from the window. While a
     Pane moves or sizes, every page shows a still picture of itself, so
     the pointer stays the window's.
   - **The touchpad's three and four fingers are the desktop's.**
     Hyprland takes them before any window does; the window hears two
     fingers, and reads them as niri does already. A Person who wants the
     overview on four fingers binds it in Hyprland to the window's socket
     (`banda menu`'s, ADR 0017).
   - **No hot corner for now.** Banda's top left is the sidebar's
     button, clicked often, and a window not on the whole screen has no
     corner to push against.

6. **The drag is Banda's own, not a library's.** dnd-kit fits lists whose
   targets are elements; HTML's drag and drop, which Atlassian's library
   builds on, cannot draw the moving Pane and loses the pointer over a
   page or a terminal's canvas. Banda's targets are places in its own
   arrangement: a gap, an edge, a row of tabs, a number in the bar, a
   gap between workspaces in the overview, drawn at a scale. So:
   - the pointer is the window's from a 4 px move until it lets go
     (`setPointerCapture`);
   - where it would land is one pure function of the arrangement as the
     window lays it out (`places`) and the pointer, tested on its own;
   - letting go sends the same command as `Alt+Shift+Arrows`;
   - the motion is the look's (`[motion.move]`, ADR 0007), not a
     library's.
   A list that only reorders, such as a column's tabs, may take a
   library later.

7. **The overview** (`Alt+O`) takes the same drag: a Pane dropped between
   two workspaces makes a new one there, and against the overview's top
   or bottom it scrolls. The arrows pick a Pane, `Enter` goes to it, and
   `Alt+Shift+Arrows` move it. Typing finds Panes by their title. It
   draws the columns as the workspace does, with `[columns] min`.

8. **The drawer** (ADR 0005, decision 7) is on `` Alt+` ``, as a terminal
   that drops down is; `Alt+S` settles a Thread now (ADR 0008). A Thread
   in the default Space drops from the top over the workspace; `Esc` or
   the key again lifts it, and it stays as it was. Its pin makes it a
   column of the current workspace. `[drawer] height` and
   `[drawer] harness` in `look.toml`.

9. **A Pane in its own window** (ADR 0005, decision 5): its header's menu
   and `pane.pop-out`. Its place keeps a thin stand-in, "in its own
   window", which focuses that window when clicked. Closing that window
   brings the Pane back to its place; `Alt+W` closes the Pane. So no work
   is lost by closing a window.

10. **A narrow window hides the sidebar.** When the window is narrower
    than the sidebar and one column `min` wide, the sidebar hides, and
    `Alt+A` shows it over the Strip, as it floats already (ADR 0023,
    decision 4).

**Consequences.**

- ADR 0005 changes: decision 3 is built by this ADR; decision 5 loses the
  Split and `Alt+V`; decision 10's table takes decision 4's keys, the
  zoom on `Alt+Shift+F` rather than `Alt+Z`, and the drawer on
  `` Alt+` `` rather than `Alt+S`.
- The kernel gets the machine's scope, and `docs/architecture.md` says
  where it lives: the workspaces leave "the window's storage" for the
  engine's state folder.
- The workspace model's rules move from `app/web/src/workspaces/model.ts`
  to the module's engine crate, with their tests. The window keeps what
  needs the look and the view: the widths drawn, the steps, the focus,
  the scroll.
- `GLOSSARY.md` gets the zoom and the drawer when they are built.
- The order of work, each step its own PR:
  1. the machine's scope in the kernel;
  2. the `workspaces` module: the arrangement, its commands and events,
     the window drawing them, and the move from the window's storage;
  3. an Agent's tools on its own Space's Panes, and the others' when its
     Person lets it (ADR 0029);
  4. the keys: heights, the zoom, `Alt+Ctrl+F`, `Alt+C`, Home and End,
     the launcher's letters;
  5. the mouse's sizing: the gaps, `Alt` and the right button, the
     double click, the steps;
  6. the mouse's moving: the insert hint, the Strip's edge, the bar's
     numbers, the pages' still pictures;
  7. the overview: the drag, the arrows, typing;
  8. the drawer, a Pane in its own window, the narrow window.
