---
status: proposed
date: 2026-11-07
---

# The Window holds the areas, the Tiling the Panes, Apps fill them, and Here is their context

_Proposed on 2026-11-07, to be accepted with ADR 0088 and ADR 0089. The
research behind it is `docs/research/2026-11-07-client-architecture.md`
(here "the research"); §11 there lists what Roma decides, with options.
ADR 0088 holds the motion and the Tile contract, ADR 0089 the client core
and the phone. Code is cited as `path:line` from main at `ed293406`._

Today one component does the window's work. `client/web/src/shell/Shell.tsx`
is 1571 lines: the tiling controller and its change queue (`:298-518`),
the key router (`:1104-1141`), the desktop bridges (`:807-829`, `:878`),
every list of every App in React state (`:382`), and the Thread verbs:
snooze, wake and archive by method name (`:594-648`). The bar's widgets
are given the window's private parts (`:1210`;
`client/web/src/bar/Widgets.tsx:20-40`). An App reaches the window through
`WindowApi` (`client/ui/src/module.ts:72-148`), sixteen members wide, and
some Apps keep it in a module variable
(`apps/browser/pane/src/threads.ts:22`, `apps/git/pane/src/ended.ts:12-21`).
The vision calls it a god object, with a target of 400 lines (vision
§9.2).

Roma asked on 2026-11-07 how to split it cleanly and flexibly, so that
desktop, web and phone fit: the window mixes window management, the bar
and the sidebar; Threads and the sidebar together manage Agents, with a
widget on the bar while the sidebar is closed; Apps will give bar widgets
too, and widgets depend on where the Person is. His proposal: a Shell
that owns the places, a Tiling that knows no App, Apps that contribute
surfaces, one Agents App with three surfaces, and Focus as the context,
read like `$PWD`. Earlier, on 2026-11-05, he asked for the tiling (his
«композер») and "the agents manager" to be parts with names and bounds of
their own, Unix-like, before the App SDK comes.

Five designs and three critiques were written for this, as working drafts;
the research keeps their conclusions and names each side it did not take.
The shape of the proposal holds. The words change, because "shell", "Focus" and "Overlay"
are taken. The Agents become an App and two platform parts, because ADR
0082 already walls an App's code to one Project. And most of the machinery
for Apps from elsewhere waits for the Tree renderer.

**Decision.**

1. **The client's screen is three kinds of program: the Window, the
   Tiling, and what fills the areas.**
   - **The Window** is Banda's program on one client screen: the desktop
     app's window, a browser tab, the phone's PWA, a popped-out Pane's
     window. It owns what its form has of the Bar, the Sidebar and the Top
     layer (a popped-out Pane's window has only the Top layer, ADR 0066
     d5), keeps Here, routes the keys and uses the device port. It names
     no App. It lives in `client/web/src/window/`, and its root component
     is 400 lines or fewer.
   - **The Tiling** (Roma's «композер») owns the middle: the arrangement
     on the home host, and on each client the tiling view, the Tiles and
     the motion. It takes actions and placements and gives each Pane a
     Tile and a Configure (ADR 0088). It knows Panes, never what they
     show. It lives in `client/web/src/tiling/` and `platform/workspaces`.
     It is optional: a phone in v1 and a popped-out Pane have none.
   - **Apps and platform parts fill the areas**: Panes in the middle,
     Widgets on the Bar, the sidebar list in the Sidebar, Items in
     Slots. Each names an action for every verb.
   - Nothing calls another program's function. The Window runs an
     action for whoever asks; that is all it does for an App.

2. **The Window has four areas: the Bar, the Sidebar, the Top layer, and
   the middle, which it gives to the Tiling.**
   - The Top layer holds the Banda menu, the launcher, the Drawer, Quick
     Look, dialogs, menus and toasts, one of each at a time, but toasts,
     which stack up to three (ADR 0011 d2). It is drawn through `TopLayer`
     (`client/ui/src/components/top-layer.tsx:8-10`).
   - The Drawer and Quick Look are not areas: they are parts of the Top
     layer that hold one Pane each, and give it a Configure as a Tile does
     (ADR 0088).
   - The Window draws the toasts in the Top layer (today its `<Toaster>`,
     `client/web/src/shell/Shell.tsx:1505`); the notifications part says
     what to tell.
   - An area is a role. Each device form (wide, narrow, phone) maps it
     (ADR 0089): on a phone the sidebar list is the home screen, the Bar
     a header, the Top layer bottom sheets.
   - The Window keeps its fixed edges as its own components: the Mark,
     update, look problems, the connection (ADR 0064 d3).

3. **A Pane names its Project and never reads Here to draw.**
   - Its args come from the arrangement, so it looks the same on every
     client and every device. Its header, toolbar and Pane menu act on
     its own args (ADR 0066 d6).
   - It names its subject, the one thing it shows, by Address (today
     `PaneKind.shows`, `client/ui/src/pane.ts:179`).
   - It obeys its Configure (ADR 0088).
   - `PaneProps` changes one step at a time: `composer` becomes Threads'
     own; `open`, `update`, `close` and `label` come from one stable
     handle per Tile; `engine` from the hosts router once H5 lands;
     `run` and `peek` stay. `PaneKind.closed()` goes when the host emits
     `pane.left@1` (vision E6).

4. **Here is the one context, one record per Window, like `$PWD`.**
   - Its v1 shape: `front`, `sidebar` (shown or not), `workspace`
     (`{id, project?}`, or none where there is no Tiling), `pane`
     (`{id, project, subject?}` or none) and `project` (the Pane's, else
     the workspace's, else home). A field is added when something reads
     it. The Pane's kind is left out, so no Widget branches on another
     App's kinds; the device's form is left out, so only the Window and
     the Tiling's view know it (ADR 0089 d7).
   - Only the Window writes it, folding in the Tiling's events, its own
     areas and the device port.
   - `get()` is always current, the Tiling's prediction included.
     Listeners are told once at the end of the input task, never inside
     the clock's read phase. Parts read it by selector, never as props:
     `useHere(select)` now, and as the fields a Tree Widget declares,
     given as args, at V2.
   - Every act runs with the Here of its gesture. An unset `project` or
     `pane` arg is filled from the gesture first, then from Here.
   - No host stores it. It reaches a host only as the args of a query or
     a command, and as presence (ADR 0082 d12). It names no host.
   - It replaces `WindowApi.focused`, `sight`, `watchSight`, `lists` and
     `watchLists` (`module.ts:99-120`), `WidgetProps.project`
     (`module.ts:366-372`), the counts' privileged props
     (`Widgets.tsx:20-40`) and Files' reading of Threads' rows
     (`apps/files/pane/src/index.ts:20-29`). The menu's `type Here`
     (`module.ts:330-339`), where the Banda menu looks, is renamed
     `MenuAt`, so two `Here` types never exist at once.
   - New Thread on an empty Project workspace starts in that Project.
     Today it starts in home (`Shell.tsx:1175`).

5. **The parts talk through five channels, and no others.**
   - **Here**, read by selector.
   - **Data**, from a host by query and follow, and the client's items,
     calls and marks stores.
   - **Acts**: a command to the App's own host part; an action by id
     with args, the App's own or the Window's, the Tiling's or a platform
     part's; another App only by an intent `verb@major`, once B8 lands
     (ADR 0082 d2, d7). The Person's keys, menus and the CLI run any
     action; an App's code does not run another App's.
   - **Slots**: Items an App puts in another App's thing (ADR 0082 d8).
   - **Facts**, between host parts only (ADR 0082 d5, d6).
   - Forbidden: module globals used as channels between Apps; a client
     `start()` daemon (it goes with E6, E8 and B8); reading another App's
     rows; the Window calling an App's methods by name; opening another
     App's Pane by its kind and args; running another App's action by its
     id (today `browser.open` from the terminal,
     `apps/terminal/pane/src/Servers.tsx:120`); any part receiving the
     Window's private parts. Today's cases are counted until B8c.
   - `client/web/src/architecture.test.ts` gains ratchets that only
     fall: a line ceiling on the Window, a list of App strings allowed in
     `window/` and `tiling/`, and a list of imports into `tiling/` from
     `window/`, `sidebar/`, `titles/` and `menu/`. The Window may import
     the Tiling; the Tiling never imports the Window (today
     `client/web/src/workspaces/PaneFrame.tsx:51` imports
     `../shell/attach`). The test computes their counts.

6. **The Agents are the Threads App and two platform parts, joined by
   `item@1`, `call@1`, item actions and `pane.pick`.**
   - **Threads** is an ordinary App: its Panes, `item@1` for each Thread
     and `call@1`, written with the change behind them, its item actions,
     its actions, its Sources, its `thread.details` Slot, its row in the
     Pane header's Slot (ADR 0062 d17), its settings.
   - **The sidebar list** (platform) owns the items projection, the list
     in the Sidebar, the counts widget, the one order (decision 8) and the
     Person's archive. It reads only `item@1`, `call@1`, the Projects and
     the Person's marks. "The Sidebar" is the area; "the sidebar list" is
     this part.
   - **calls** (platform) owns the Inbox and `calls.answer` (Alt+U). The
     notifications part tells the Person, as ADR 0056 has it, from the
     calls it holds and from sight, until E9 moves who is told into
     `platform/calls` on the host, as vision §9.2 merges them; its client
     part then keeps only delivery.
   - "Agents manager" is a product phrase for what the Person sees: the
     sidebar list, the counts and the Thread Panes. It is not a program.
     The Inbox keeps its meaning: every Call of every host, merged.
   - What the sidebar list shows does not change here. Its sections,
     shelves and presets stay as `sidebar.toml` arranges them; a new
     sidebar is a piece of work of its own (ADR 0079, out of scope). The Window reaches
     the list through one indirection, so another list can stand there
     later.
   - _For Roma:_ the alternative is one Agents App that owns the
     Sidebar's list. It amends ADR 0082 d6 and d15.

7. **One action goes to an Agent: `pane.pick{project, pane}`.**
   - `pane` is the Pane to open, its kind and args, as `item@1` carries
     it, not a Pane's id. A sidebar row, a row of the counts list, a
     toast's button, a push tap, Alt+U and the phone's Next all run it.
   - The Window answers it. It hands it to the Tiling where there is one,
     and to the phone's stack of screens where there is none (ADR 0089
     d8).
   - The Tiling goes to the workspace that shows that Pane and focuses
     it. When none shows it, it opens it, as ADR 0005 d8 asks, where the
     Flow says: a new column of the current workspace in Free, at the
     left of its Project's workspace in Row (ADR 0065 d8), filled in
     Solo.
   - It replaces the window's `picking` and `WindowApi.goTo`
     (`Shell.tsx:534-556`, `module.ts:123`).

8. **There is one order of what calls: the Person's sidebar
   arrangement.** The sidebar, the counts list and Alt+U share one pure
   `order()` (today `client/web/src/sidebar/order.ts:15-31`). The counts
   list stops sorting loudest first (`client/web/src/bar/tally.ts:60-77`).
   _For Roma_ (it changes what the Person sees).

9. **"On screen" is what the screen shows.** A Pane counts as on screen
   when at least half of its Tile shows inside the Strip's clip; in Solo,
   only the filled Group does. So an Agent that finishes scrolled out of
   view, or behind the Solo Group, gets its toast. Today any Pane of the
   current workspace counts (`client/web/src/calls/sight.ts:44-46`). The
   Tile states' prefetch margin (ADR 0088) never counts as sight. _For
   Roma_ (more toasts).

10. **The Flow splits by level.**
    - Free and Row are the Tiling's placement policy. The model applies
      it on the home host to every placement, the Person's own opens and
      `show.requested@1` alike, with one set of rules (ADR 0062 d17); the
      client only predicts the result (ADR 0088 d11).
    - Solo is each client's view. A focus move writes no `fill` (today
      `Shell.tsx:1179-1195`, `client/web/src/workspaces/groups.ts:78-91`).
      Alt+M inside Solo releases the Group in this view until the focus
      leaves it, and writes nothing; in Free and Row it still sends
      `fill`. Only an Agent's Group fills: one that some Item names as its
      owner (today `Listed.agent`), as today. The client's layout takes
      the filled Group from the view.
    - `workspaces.tidy`, which lets every empty workspace go but the one
      the Person looks at and the last (as niri does), is sent only by the
      device in front, so two devices never remove the empty workspace
      the other looks at.
    - `flow` is one setting, the Person's, kept on the home host, where
      the model reads it when it places. The client reads it through one
      accessor. It leaves `agents.toml` for the Tiling's own settings when
      `agents` becomes `threads` (T0), under ADR 0069's grace.

11. **One widget contract for everyone.**
    - `{id, about, Widget, compact?}`, with props `{engine, projects}`;
      the widget reads Here by selector.
    - It runs actions through `useRun()`, which runs an action by id with
      the Here of the click: from `@banda/ui` with B4f, from
      `@banda/core/react` after W0. It replaces `window.run` (today
      `platform/notifications/pane/src/Bell.tsx:57`,
      `platform/harnesses/pane/src/LimitsWidget.tsx:169`).
    - `compact: true` says it has a form that stays in a narrow Bar and
      in a phone's header (ADR 0089 d8). Without it, a widget is reached
      there by its action.
    - It draws nothing while it has nothing to say. A click runs an
      action or opens its own popover (ADR 0024 d3).
    - Only `look.toml [bar]` places it (ADR 0064). A widget's own
      settings stay the Person's: the counts keep `show = "closed" |
      "always" | "never"` (ADR 0035 d5).
    - No widget gets privileged props. `sidebar.counts` becomes the
      sidebar list's widget and keeps its id and its list.
      `workspaces.aside` and `workspaces.list` (the workspaces' numbers
      and the Group map, today drawn inside the Bar,
      `client/web/src/bar/Bar.tsx:381-403`, `client/web/src/bar/Map.tsx`)
      become the Tiling's, keeping their ids.

12. **Thread verbs leave the Window as item actions.**
    - An item action is an action that takes one Item. Item actions
      replace `Listing` (`module.ts:288-301`) and the window's `thread.*`
      actions (`client/web/src/shell/actions.ts:747-797`), keeping their
      ids: a Person's `keys.toml` names them. A kept id keeps its prefix
      even where its owner changes (`thread.unread` becomes the
      platform's; `thread.rename` stays Threads', whose App id is
      `agents`, later `threads`).
    - Threads owns rename, suggest a title, previous title, make a
      Project, snooze, wake and the snooze picker. The platform owns mark
      as unread (the Person's seen mark) and archive (the Person's
      archive mark, `sidebar.archive`).
    - Mark as unread needs no Thread knowledge. `item@1` carries `news`,
      an opaque key that changes when there is something new for the
      Person to see; for a Thread it is its last finished turn, which
      keys the seen mark today (`apps/agents/pane/src/seen.ts:12-14`,
      ADR 0077 d6). The seen mark keeps, per Address, the `news` the
      Person saw; the Item is unread while they differ. Mark as unread
      drops the mark; Mark as read sets it.
    - The Thread menu keeps its rows and their order
      (`client/web/src/titles/ThreadMenu.tsx:100-105`): the owner's naming
      rows, mark as unread, the owner's other rows, archive last.
    - The Drawer asks for `thread.new@1{place: "drawer"}` (the action
      `thread.new` until B8); the Banda menu's Thread rows become a
      Threads Source.

13. **First-party Apps keep `defineModule` as their manifest until V2.**
    - The generated `window.json` grows only where the host needs it.
    - The tiling's actions move to `platform/workspaces/window.json`, the
      name every part's generated manifest has, as ADR 0071 d2 foresaw
      when the window split. `client/web/window.json` stays the Window's
      own manifest: `sidebar.toggle`, `menu.open` and its other actions.
      Device-only actions name their capability and are hidden where it
      is missing.
    - Hand-written `app.toml` sections for Widgets and Panes, `when`
      rules as data, Panels from Apps and new Slots are designed at V2,
      from what the tracer App (V4) needs. `Action.when` stays a closure
      for Banda's own code; only two exist
      (`client/web/src/shell/actions.ts:753`, `:764`), and both leave with
      decision 12.

14. **The words.** GLOSSARY gains Window (redefined), Area, Top layer,
    Here, Action, Item and Item action (Tile and Configure come with ADR
    0088), and rewords Client, Pane, Sidebar, Widget, Bar, Tiling, Flow,
    Watch, Slot, Frame, Overlay, Workspace, Quick Look, Thread menu and
    Inbox. "The Sidebar" is the area and "the sidebar list" the platform
    part in it. Avoided: shell for the Window, Focus for Here, Overlay or
    Float for the Top layer, Desk for the middle, Surface or Contribution
    as an umbrella word, Panel until a second list exists, plugin, and
    "agents manager" as a program. In code, the `Place` value `here`
    becomes `instead`, as the host's contract already says
    (`client/web/src/workspaces/arrange.ts:368`). Strings that call Panes
    windows change (`client/web/src/sidebar/FlowMenu.tsx:27`, `:74`).

**Out of scope.**

- The new sidebar, "the Inbox and the Projects together" (ADR 0079).
- Panels from Apps, a Panel switcher, the sidebar as a Pane, docks on
  the right or bottom.
- Tree-drawn Widgets and Panes for Apps from elsewhere, and a Widget's
  scope across several hosts (H6).
- A name for ADR 0065's future "Focus" mode.

**Plan.** Each step its own PR; `scripts/check.sh` passes after each. The
ids are the research's §9, which says how they sit in the vision's §9.3.
A step that changes pixels shows Roma a before and after first.

1. This ADR, ADR 0088, ADR 0089, the GLOSSARY, `docs/sdk/guidelines.md`
   and the draft of the skill topic `apps` (`docs/sdk/skill-apps.md`),
   which ships only once an App from elsewhere can be installed (V4)
   (D0).
2. "Roma's day" in e2e: Solo, the Flow switch, snooze and wake with Undo,
   Alt+U across several calls with the Sidebar hidden, ten Agents in a
   Row, a key burst (C0).
3. Three small fixes: Here's Project (C1a); one order for the counts
   (C1b, decision 8); sight from what shows (C1c, decision 9).
4. A pure move: `shell/` to `window/`, `workspaces/` to `tiling/` (but
   `Drawer.tsx`, `Peek.tsx` and `Popped.tsx` to `window/`), the change
   queue moved verbatim into `tiling/useTiling.ts`, `here` to `instead`,
   the ratchets (B4a).
5. `window/keys.ts` and `window/device.ts` (B4b).
6. The items and calls stores; memo on `PaneFrame`, `Strip` and widgets;
   a stable action context (R1).
7. Here and `useHere`; the menu's `Here` renamed `MenuAt` (B4c).
8. Thread verbs as item actions (B4d); the sidebar list reads stores,
   and a Project's verbs become `projects.*` actions (B4e); one widget
   contract with `useRun` and `compact`, and the Tiling's widgets (B4f);
   `pane.pick` (B4g).
9. The `pane.header` and `thread.details` Slots (B4i); the Tiling reads
   no `Listed` (T-a); Solo as a view (T-b, with E6 on the host).
10. Actions by owner, and the Window at 400 lines or fewer (B4h).
11. `Listed` split into the Item, with `news`, and the owner's extras
    (B7a); the Person's marks behind one store (E8a); then, after the
    host's projection, the Watches go (E8b).
12. The client calls other Apps by intent, after B8 (B8c).

**Consequences.**

- The Window names no App, and the Tiling names no App and imports no
  Thread code. Their ratchets end empty.
- A Widget, a Pane and an act get their context the same way on every
  device, so the web client and the phone add adapters, not rules.
- Re-rendering the whole window on a key ends with Here and the stores
  outside React (ADR 0088 measures it).
- A phone and a desktop open at once stop fighting over `filled`.
- Done toasts reach Agents the Person cannot see, if Roma takes decision
  9.
- `sidebar.counts`, `sidebar.archive`, the action ids, the presets and
  `[bar]` keep working: nothing the Person wrote changes.
- `docs/architecture.md` changes as each step lands: the window's parts,
  and the order of calls (`:1132-1133`).

**Changes.**

- **ADR 0005, decision 8:** the sidebar list is a platform part that
  reads `item@1`, `call@1` and the Person's marks, not "its own module".
  "Like any Pane, it can pop out into its own window" goes. Seen and
  archived are the Person's marks (vision decision 13). A click on a
  Thread still goes where it shows, or opens it: `pane.pick` (decision
  7).
- **ADR 0011, decision 1:** "On screen" means at least half of the
  Pane's Tile shows inside the Strip's clip, and in Solo only the filled
  Group; no longer "its Pane is on the current workspace" (decision 9).
- **ADR 0024, decision 3:** a widget is an App's or a platform part's,
  and is given the engine and the Projects; it reads where the Person is
  from Here, not from "the focused Space" it is given (decisions 4 and
  11).
- **ADR 0035, decision 3:** the counts list follows the sidebar's order,
  not "the loudest comes first" (decision 8).
- **ADR 0062, decision 2:** "the shell (bar, sidebar, menu, overview)"
  becomes "the Window (the Bar, the Sidebar's area, the Top layer with
  the menu), the sidebar list, and the Tiling (overview)".
- **ADR 0062, decision 13:** Solo, like zoom, is the client's view
  (decision 10).
- **ADR 0065, decision 9:** the counts widget opens the same list as the
  sidebar, in the sidebar's order; its click is unchanged.
- **ADR 0071, decision 2:** `client/web/window.json` is no longer the
  tiling's manifest. The tiling's actions move to
  `platform/workspaces/window.json`, and `client/web/window.json` keeps
  the Window's own actions (decision 13).
- **ADR 0077, decision 5:** the window no longer finds the module by the
  first word of the thing's Pane kind and asks `Module.listed`. The
  Thread menu lists the item actions of the Item's owner, then the
  platform's (decision 12).
- **ADR 0077, decision 6:** the seen mark is no longer "one of the marks
  the window keeps". It is the platform's mark over the Item's `news`,
  one of the Person's marks (decision 12).
- **ADR 0082, decision 9:** `item@1` also carries `news`, an opaque key
  that changes when there is something new for the Person to see; the
  Pane it carries is the Pane to open, by kind and args (decisions 7 and
  12).
- **ADR 0079, decision 1:** Free and Row are the Tiling's placement
  policy; `flow` moves to the Tiling's settings with T0 (decision 10).
- **ADR 0079, decision 2:** Solo writes nothing when the focus moves;
  Alt+M inside Solo releases the Group in the client's view until the
  focus leaves it (decision 10).
- **ADR 0079, decision 3:** the Flow button runs the Tiling's action
  instead of writing `agents.toml` itself.
- **GLOSSARY:** Window, Client, Pane, Sidebar, Widget, Bar, Tiling, Flow,
  Watch, Slot, Frame, Overlay, Workspace, Quick Look, Thread menu and
  Inbox are reworded; Area, Top layer, Here, Action, Item and Item action
  are added (decision 14).
