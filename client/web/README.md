# The page

`client/web`: the page every client draws. `window/` is the Window (the
Bar, the Sidebar, the Top layer), `tiling/` the Tiling (the workspaces,
the overview); beside them the actions and the Pane registry. Its rules
are [the window's six](../../docs/window.md).
[The architecture](../../docs/architecture.md#window) is the map this
page is one part of. A change to the page changes this page in the same
PR.

## What it does

- **A Pane** is a `PaneKind`: a kind, the module it needs, a title, an
  icon, optional start args, what its module lets go of when it leaves
  every workspace (`closed`), and a component. The component gets the
  engine, its Project, its args, whether it has the focus, `open`,
  `update`, and `close` for its own tile. `open` opens a Pane of the same
  Project unless it names another. A Pane's args are all its state; the
  workspaces keep them, each Pane with its Project.
- **A Pane reads a view, then follows.** `useLive` reads the view once,
  applies each event after its `at`, and reads again when the engine says
  so. Events that arrive within one frame render once.
- **The Window** (`client/web/src/window/`, its root `Shell.tsx`) puts the
  areas together: the Bar on top, the Sidebar docked on the left, the Top
  layer over them (the Banda menu, the Drawer, Quick Look, dialogs and
  toasts), and the middle, which it gives to the Tiling
  (`client/web/src/tiling/`): the workspaces, or the overview over them
  (ADR 0005, decisions 7–9; ADR 0087). A popped-out Pane's window is the
  Window's too (`window/Popped.tsx`). The Window routes the keys
  (`window/keys.ts`). What lies over what in the Top layer, which part
  an Esc takes away and where the keys go back as it goes is one stack,
  `window/top/` (ADR 0110, step 3). The Window reaches the desktop only
  through the device's desktop adapter, `boot/desktop.ts`, by
  `boot/index.ts`; at last the adapter is the only reader of
  `window.banda` (ADR 0089, decisions 2 and 11). What every client shares is `client/core` (`@banda/core`,
  and `@banda/core/react` for what reads it from React): Here and the
  store the Window keeps it in, the store read by selector, what an
  action runs with, the words the page and the desktop say to each
  other, and the machines the Window reaches (`KeptHosts`, with the
  machines a new Thread starts on), which take the names this device
  remembers from the Window. This machine is one of them, with the
  same rule while its engine is out of reach (ADR 0124). It has no DOM, reads no device and names
  no App (decision 1); an App or a platform part takes it only as
  `@banda/core/react`.
  The Window may import the Tiling; what the Tiling still imports of the
  Window, the architecture test lists, and the list only falls.
- **The workspaces** follow niri (`client/web/src/tiling/model.ts`); every
  change to them is a pure function.
  - They sit one under another, and there is always one empty workspace
    at the bottom; an empty one in the middle goes once the Person leaves
    it. Each one is a Strip: columns a third, half, two thirds or all of
    the screen wide, scrolling sideways, each holding Panes one above
    another. The focused column always comes fully into view.
  - A workspace holds Panes of any Projects; a Pane's header names its
    Project when the workspace mixes them.
  - Opening a Pane that is already shown goes to its workspace and focuses
    it. Opened with no place, a Pane takes the place of one of its kind on
    the opener's workspace, or a new column right of the opener.
    Ctrl-click (⌘ on a Mac) always opens a new column.
  - Every workspace stays drawn, so its Panes keep running; only the
    current one takes clicks and keys.
  - A touchpad's swipe is read as niri reads one (`tiling/swipe.ts`).
    Each swipe goes one way, picked as it starts. Up and down belongs to
    the Pane under the pointer, and the Strip never drifts sideways under
    it. A sideways swipe moves the Strip with the fingers. Where it ends,
    the column most in view takes the focus and comes whole into view.
    Over something that scrolls sideways itself, such as a wide table,
    the swipe is that Pane's unless Alt is held. With Alt held, the wheel
    is the window's, and one swipe up or down moves one workspace.
  - A Pane leaves when it closes or its place shows another Pane, or the
    same with other args; moving it to another column or workspace draws
    it again without that.
  - The workspaces live in the engine (ADR 0005, decision 3; ADR 0025):
    the `workspaces` module of this machine (`platform/workspaces/engine`)
    keeps the arrangement and its rules, and says each change in one
    event that holds it whole. The window keeps only the view, in its
    storage (`$BANDA_STATE/window` when that is set), and draws the two
    together (`tiling/arrange.ts`). Solo is part of that view, and so is
    the row `Alt+M` shows for a while: neither writes a file or the
    arrangement (ADR 0127, decision 3). An empty workspace the Person
    left goes by `workspaces.tidy`, which a window sends by itself only
    while it is in front, so a window behind never takes away the one
    the Person looks at on another device. A key works out its change with
    `model.ts` and sends it as one command; the window draws the event
    that comes back. Changes go one after another through one queue
    (`tiling/useTiling.ts`), each worked out from what the last one drew,
    so keys pressed quickly act as they would slowly. A Pane's new args
    are drawn at once and kept over the arrangement until their event is,
    since a Pane works out its next args from the ones it drew. What a
    window kept before moves over once (`tiling/store.ts`). A Pane an
    Agent opened is marked until the Person has it in focus; the window
    keeps which of them they have looked at (`banda.looked`).
- **One list of actions** (`client/web/src/window/actions.ts`) holds what the
  window does, each with a name, its key sheet section and a default key,
  by its physical place. Each is declared by its owner: an App's in its
  `defineModule`, the Tiling's in `client/web/src/tiling/actions.ts`,
  which take only what the Tiling's interface names (`Tiling`), and the
  Window's own beside the list. What opens, closes, picks and puts away a
  Pane is the Tiling's too (`client/web/src/tiling/opening.ts`): it says
  what is wanted and the engine places it. `window.json` copies each owner's for the
  engine, the Tiling's to `platform/workspaces/window.json`, and
  `banda keys` names the owner of each (ADR 0087, decision 13).
  Alt is the mod: Arrows focus, Shift+Arrows move, Ctrl+Left and Right
  step the width and Ctrl+Up and Down the Pane's height, Shift+R its next
  height, Ctrl+R even ones, Ctrl+F the room left, C the middle, Home and
  End the first and last column (with Shift, moved there), Shift+F the
  zoom, Return opens a new Thread, Shift+Return a new browser, N a new
  Pane (then a letter picks it), W closes, O the overview,
  PageUp and PageDown the workspace above or below, 1…9 go to one,
  Shift+1…9 move the Pane there, A shows or hides the sidebar. The window
  takes these keys before any Pane hears them; a terminal gets every other
  key, Ctrl+W among them. `keys.toml` binds and frees keys over them (ADR
  0005, decision 11); Ctrl+Alt+Shift+K (`keys.reset`) is no file's, and
  brings the window's own keys back until the file changes. The settings Pane's
  Keys section shows the file's lines, and opens the key sheet in the
  window for the rest. `runAction` runs each by its id, from a key, a
  menu, a widget, a Pane, and from outside the window: `banda act` and an
  Agent's `act` tool, through the engine (`window/asked.ts`; ADR 0127,
  decision 2).
- **The sidebar** lists every Thread of every Project, arranged as the
  Person's keys say (ADR 0008, as ADR 0098 amends it): grouped by Project
  or not at all; Your turn oldest or newest first; Open and the Working
  shelf in the Inbox or not; every card of three lines.
  `order.ts` is the one order, from the rows of `rows.ts`, laid out by
  `inbox.ts`. `banda look` resolves the keys from `sidebar.toml`
  (`platform/look/src/sidebar.rs`; a file that still names a preset, a
  card's lines or `group = "machine"` reads as one list of three-line
  cards, and is told so), and the view menu writes them into the file, keeping the Person's other keys and
  comments. The sidebar
  knows nothing of Threads: each module's Watch reports a `Listed` per
  row (its title, mark, times, what calls the Person, what it was last
  asked, and the Pane a click opens). A new Thread opens as a Thread
  Pane with no Thread yet; its first message starts one (ADR 0006).
  - Each Thread shows its Agent's Mark (ADR 0005, decision 8). The engine
    lists each Thread with its latest turn that began (when, and why it
    ended as it did), its Questions that wait (with their titles) and the
    start of its latest message; the list follows them from
    `message.posted`, `turn.started`, `turn.ended` and the `question.*`
    facts. The pane's rules (`marks.ts`) say what that
    means: a Question asks, a failed or interrupted turn failed, a turn
    that finished is done, a running one works, and anything else rests.
  - A turn that finished or failed settles once the Person has seen it: a
    Thread Pane with the focus marks its latest ended turn seen, in the
    window's storage (`seen.ts`). The engine never hears of it.
- **The bar's Mark** shows the loudest of what every Project calls the Person
  for, with how many things wait for them when more than one does. A
  module offers a `Watch` for this: a component the window draws for
  each Project while the engine runs the module, which shows nothing and
  reports a Mark state, a count and the Project's rows for the sidebar
  (`Report` in `client/ui/src/pane.ts`). The bar and the sidebar read the same
  report, so they never disagree, and the bar knows even while the sidebar
  is hidden. The window combines them (`client/web/src/bar`) and knows
  nothing of Threads.
- **Calls** (ADR 0011, ADR 0056). A row whose Mark is done, asking or
  failed calls the Person (`callsOf` in `client/ui/src/pane.ts`). The window
  knows what calls, for the Marks, the rings and `Alt+U`; and where the
  Person looks (`client/web/src/calls`). What calls has one order, the
  sidebar's as the Person arranged it (`order` in
  `client/web/src/sidebar/order.ts`): the sidebar list draws it, `Alt+U`
  walks it, and the bar's counts list follows it (ADR 0079, ADR 0087).
  The window knows nothing of Threads: a Pane kind's `shows` names the
  thing it shows, so the window knows when the Person looks at it (its
  Pane has the focus and the window is in front), sees it on screen, or
  is elsewhere.
  - The `notifications` module tells of it (`platform/notifications/pane`),
    from its `start`, asking the window only what it knows (`WindowApi`:
    `items`, `here`, `sight`, `look`, `projects`, `run`). It compares each
    list with the one before: what starts calling is news, what stops is
    taken back, and a Project's first list is what already was. A toast's
    button goes to its Thread by the Window's `pane.pick`, the one way to
    go to an Agent, which a sidebar row, the counts list and `Alt+U` run
    too (ADR 0087, decision 7).
  - It gathers the news for a tenth of a second and tells of each where
    the Person looks (`tell.ts`): nothing while they look at it; the sound
    when it is on screen; the sound and a toast when it is elsewhere in
    the window (Sonner's, `toast.tsx`, gone by itself after 5 to 12 s); the sound
    and a system notification when the window is behind (`system.ts`).
  - Another part tells the Person in plain data, by running
    `notifications.tell` with a `Told` (`told.ts`): a key, a kind, the
    words and buttons that are actions by id, and the Project and thing it
    is of, which name the Project and tell nothing while the thing is on
    screen. The Problems do (ADR 0039), and git when a run ends with no
    card of its Project in sight.
    A call's toast is one too (`toldOfCall`), so every notice told is
    data: the last five are kept in the window's storage (`recent.ts`),
    and the bell on the bar shows them again, across a restart.
  - A system notification is the desktop's, through the module's desktop
    part (`platform/notifications/desktop/src/notices.ts`):
    the module asks for it through `window.banda.notifications`, its bridge, with the mark
    still in its state as its icon (`stillMark`, drawn to a PNG), and the
    desktop shows it silent, takes it back once the Person sees the
    Thread, and says when they click it; the window comes to the front and
    goes there. More than two at once make one. While Omarchy's Do Not
    Disturb is on (`omarchy-shell notifications isDnd`), only the Marks
    change. On Windows, whose Do Not Disturb Banda cannot read, the
    notification carries Windows' own sound instead of Banda's, unless
    `[sound]` or what told it gives it none, so Do Not Disturb silences
    and holds it (ADR 0090, decision 7). The end-to-end tests run with a recorded desktop
    (`BANDA_DESKTOP=recorded`), so nothing reaches the screen.
  - Every step of this is the Person's to choose: `[notify]` in
    `look.toml` (`platform/look/src/notify.rs`) turns the system notifications to
    always or off and the toasts to always or off, drops the words, keeps
    no quiet but its own, or leaves done, asking or failed to the Marks.
    The window holds Banda's defaults till the look comes
    (`calls/settings.ts`).
  - A Thread Pane marks its turn seen only with the focus in the window in
    front, so a Thread that finishes behind another window calls.
- **Sounds** (ADR 0009). Of the news, the window plays the loudest, and
  for 1.5 s after plays only a louder one.
  - The sounds are made in code with Web Audio, in `client/ui/src/sound`: a
    few instruments (a bell, a marimba bar, a bubble, a string), five
    families that play the three calls on them, and the level of each
    sound, measured so done is the softest and asking the clearest in
    every family. Their noise is seeded, so a sound is the same every
    time.
  - What the Person chose is `[sound]` in `look.toml` (`platform/look/src/sound.rs`):
    the family, the volume, the room, and each call on, off or borrowed
    from another family. The page takes it with the look
    (`useLookSound`); until the first look comes, the defaults play.
    Electron lets the page play sound before the first click.
