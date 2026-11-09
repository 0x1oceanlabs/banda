# The client's architecture: the Window, the Tiling, the Apps and one core

Research, 2026-11-07. It answers Roma's question of 2026-11-07: how to split the visual part of Banda cleanly, so that desktop, web and phone fit, windows and animations feel native, and Agents can later write Apps and platform parts by clear rules.

## 0. Status and sources

- **Status:** accepted by Roma on 2026-11-07, every recommendation in §11 with it. Nothing here is built yet. Three ADRs carry the decisions, accepted together (§11.13):
  - ADR 0087: the Window, the Tiling, what Apps show, Here, the Agents, the words;
  - ADR 0088: motion on the compositor, the Tile contract, budgets, prediction;
  - ADR 0089: one client core for desktop, web and phone.
  The rulebook for App and platform authors is `docs/sdk/guidelines.md`. Its digest for Agents is drafted in `docs/sdk/skill-apps.md`. It becomes the Banda skill's topic `apps` only once an App from elsewhere can be installed (V4), because every topic ships to every Person's Agents (`platform/skill/build.rs:1-3`).
- **Code** is cited as `path:line` from main at `ed293406`, after R0. S3 merged after it (`089cd164`, ADR 0086) and shifts a few of the cited lines. In `Shell.tsx`, `:1175` is now `:1193` and `:1210` is `:1228`. In `client/web/src/shell/actions.ts`, the actions from `calls.answer` on sit nine lines lower. The CSP in `client/desktop/src/main.ts` is at `:123`. Each step refreshes the lines it touches.
- **It builds on** the accepted vision (`docs/research/2026-11-06-architecture-vision.md`, here "the vision"), ADR 0062, ADR 0082, ADR 0080, and the window's ADRs: 0005, 0007, 0011, 0013, 0024, 0025, 0028, 0035, 0052, 0063, 0064, 0065, 0066, 0067, 0071, 0077, 0079.
- **Inputs written for this review:** five designs (the window and what Apps show; the client core; performance; the refactor; the SDK guidelines) and three critiques (simplicity, the Person's day, feasibility). They were working drafts and are not kept in the repository. Where they disagree, this document takes the simplest side that serves desktop, web and phone, and names the other side in one line, so each choice can be argued from here.
- **Measurements** come from headless runs of `client/desktop/e2e/motion.spec.ts` at DPR 1 and 1.6 on 2026-11-07. Their numbers, the commands that reproduce them and their limits are in `docs/research/2026-11-07-client-architecture/measurements.md`. Step P0 commits a baseline that the gates read.

**Decisions at a glance.** Each is argued in the section named and asked of Roma in §11.

| # | Decision | Recommended | ADR |
|---|---|---|---|
| 1 | The words | Window, Here, Top layer, Area; no umbrella word for what Apps show (§2) | 0087 |
| 2 | Threads and the sidebar | two programs: Threads is an App; the sidebar list and the Inbox are platform parts reading `item@1` and `call@1` (§6) | 0087 |
| 3 | The sidebar part's name | the sidebar list; Inbox stays the merged Calls (§6.1) | 0087 |
| 4 | Solo and the Flow | Solo is each client's view; Free and Row are placed on the home host (§6.5) | 0087 |
| 5 | Done toasts for Agents out of sight | yes: on screen means half a Tile shows (§6.6) | 0087 |
| 6 | The counts list's order | the sidebar's order, one order everywhere (§6.3) | 0087 |
| 7 | The phone in v1 | the sidebar list as home, Thread screens, no Tiling (§7.5) | 0089 |
| 8 | The column width | after a trace and a mockup in Electron; C unless `clip-path` is composited (§8.5) | 0088 |
| 9 | Working Group plates | rebuilt as layers on the compositor, through a mockup (§8.7) | 0088 |
| 10 | Prediction before WebAssembly | client-made ids and the TypeScript model's prediction now (§8.9) | 0088 |
| 11 | The desktop's device session | stays in Electron main (§7.2) | 0089 |
| 12 | How much to build for Apps from elsewhere | nothing manifest-first until V2 (§5.5) | 0087 |
| 13 | How many ADRs now | all three, together (§11.13) | all |

**What the Person would see change:** New Thread on an emptied Project workspace starts in that Project (a fix, §5.1); the counts list in the sidebar's order (decision 6); done toasts for Agents out of sight (decision 5). Everything else keeps its pixels, or changes only through a mockup (§6.7).

**Roma's first proposal, and what changed.** He proposed three programs: a Shell that owns the places (Bar, Sidebar dock, Overlay), a Tiling that knows no App, and Apps that contribute surfaces (Pane, Panel, Widget, Row or Card, Action). One Agents App would own a Thread's Pane, the sidebar's Panel and the counts Widget. Focus would be the context, read like `$PWD`. The shape holds: one program owns the places, the Tiling knows no App, Apps never call each other, and one context object is read by everyone. Six things change:

1. The program is called the **Window**, not the Shell. "Shell" is the program a terminal runs (`GLOSSARY.md:79`).
2. The context is called **Here**, not Focus. "Focus" already means the keyboard focus, the focused Pane and the `pane.focus-*` actions.
3. What floats over the tiles is the **Top layer**, not the Overlay. "Overlay" is the tiling's unsaved changes (`GLOSSARY.md:587`).
4. **The sidebar list is a platform part, not the Threads App's Panel.** "Agents manager" is two programs joined by a pipe: Threads speaks `item@1` and `call@1`, and the sidebar list and the Inbox read them from every App (§6).
5. **An Action is not something drawn,** and "Row" and "Card" become **Items** (`item@1`, Slots).
6. **Most of the machinery for Apps from elsewhere waits** for the Tree renderer (V2) and the tracer App (V4): App Panels, `when` rules as data, hand-written manifest sections.

## 1. The picture on one page

```
 device: keys · pointer · touch · in front / away · screen      hosts: query · follow · command · device request
        │                                                                   ▲      │
 ┌──────▼──────────────────────────────────────────────┐                    │      │
 │ WINDOW  (one per client screen; names no App)       │── Here (read-only) ──► Widgets, the sidebar, every act
 │ areas: Bar · Sidebar · Top layer · [middle→Tiling]  │
 │ key router · device port · popped-out windows       │
 └──┬──────────┬───────────────┬───────────────────────┘
    │ Bar      │ Sidebar       │ middle                       Top layer: Banda menu · launcher · Drawer ·
    ▼          ▼               ▼                                         Quick Look · dialogs · menus · toasts
 Widgets    the sidebar     TILING ── Tiles + Configure ──► Panes (an App's view; names its Project)
 (Apps' and (platform:      knows Panes, never what they show
  platform  item@1, marks,  arrangement on the home host;
  parts')   the one order)  view, Tiles and motion on each client
    ▲          ▲               ▲  (Marks by owner)
    └──────────┴───────────────┴──── client stores: items · calls (Inbox) · Person's marks ◄── item@1 · call@1 ◄── Apps' host parts
```

**The rules, in one place:**

1. **The Window owns the areas, Here and the keys,** names no App, and gives the middle to the Tiling.
2. **The Tiling owns where Panes are.** It takes actions and placements, gives Tiles and a Configure, and knows no App.
3. **Apps fill the areas** with Panes, Widgets and Items, and name an action for every verb. A Pane looks the same on every client.
4. **The parts talk through five channels only:** Here, data, acts, Slot Items, and facts on the host.
5. **Here is one read-only record per Window**, like `$PWD`. Only the Window writes it.
6. **Motion runs on the compositor, and content takes its size once per move** (ADR 0088).
7. **One client core** serves desktop, web and phone; only the Window knows the device's form (ADR 0089).

**Roma's three questions, answered in short:**

- *Threads and the sidebar: separate, or one Agents system?* Separate programs, one product. Threads is an ordinary App; the sidebar list and the Inbox are platform parts that read `item@1` and `call@1`. They are joined by those two languages, by Threads' item actions, and by one action, `pane.pick`, which the Window answers (§6).
- *How do contextual widgets communicate?* They read Here by selector and their own data from their host. A click runs an action through `useRun()`. They never talk to each other or to the Window's internals (§5).
- *Which words?* Window, Area, Top layer, Here, Tile, Configure, Action, Item, Item action, with an Avoid list (§2).

## 2. The words

These enter `GLOSSARY.md` with ADR 0087 and ADR 0088; ADR 0089 adds the phone's lines to Client, Area and the Bar. A word comes in only where some visible behaviour or some rule needs it. "The Sidebar" is the area; "the sidebar list" is the platform's list in it.

| Word | Meaning | Avoid |
|---|---|---|
| **Window** | Banda's program on one client screen: the desktop app's window, a browser tab, the phone's PWA, a popped-out Pane's window. It holds what its form has of the Bar, the Sidebar and the Top layer (a popped-out Pane's window has only the Top layer, ADR 0066 d5), gives the middle to the Tiling where there is one, keeps Here and routes the keys. It names no App. | shell (a terminal's program); "window" for a Pane |
| **Area** | One of the Window's regions: the Bar, the Sidebar, the Top layer, and the middle, which is the Tiling's. A device's form maps them (§4.1). | place (the code's `Place` is where a Pane opens); dock |
| **Top layer** | What sits over the tiles: the Banda menu, the launcher, the Drawer, Quick Look, dialogs, menus and toasts. One of each at a time, but toasts, which stack up to three (ADR 0011 d2). In code, `TopLayer` draws into the page's top (`client/ui/src/components/top-layer.tsx:8-10`). | overlay (the tiling's unsaved changes); float |
| **Here** | Where the Person is in one Window: the workspace, the Pane in focus, its Project and what it shows, whether the Sidebar shows, and whether the device is in front. Every Widget and act reads it; no host keeps it. | focus |
| **Tile** | The Tiling's box for one Pane on the screen: its rect, its clip and its state (shown, moving, hidden). The look's `tile` is its glass. | Pane (what an App draws in it) |
| **Configure** | What the Tiling tells a Pane: its settled size, its scale and its state. A Pane obeys it (ADR 0088). The word is Wayland's: a compositor sends a window a `configure` event with the size it is to take. | resize |
| **Action** | One thing the Person can do, by id, with a JSON Schema of its args. Keys, buttons, menus, widgets, the CLI and Agents run the same action (ADR 0005 d2, ADR 0071). | command (a request to an App) |
| **Item** | A thing an App lists, `item@1`: an Address, a title, a Mark, when it changed, what is new to see, its owner and the Pane to open. Slots hold Items too. A row is how the sidebar list draws an Item. | row, card, for what an App lists or puts in a Slot |
| **Item action** | An action that takes one Item, such as rename or snooze. The Thread menu lists the owner App's and then the platform's. | `Listing` (its code name before) |

**Words that change meaning:**

| Word | Was | Becomes |
|---|---|---|
| Window | "the desktop client" (`GLOSSARY.md:534`) | the program on any client screen |
| Pane | "one tile in a client" (`GLOSSARY.md:538`) | an App's view opened for one Project; it stands in a Tile, the Drawer, Quick Look or a window of its own |
| Sidebar | "the list of every Thread" (`GLOSSARY.md:654`) | the area at the left, the Sidebar; the platform's list that fills it is the sidebar list |
| Widget | "a module's item on the bar, or the window's own" (`GLOSSARY.md:698`) | a small view on the Bar, an App's or a platform part's |
| Tiling | the model on the home host and a copy in each client | the same, plus each client's view, Tiles and motion |
| Flow | "how an Agent's windows stand" | how an Agent's Panes stand; solo is each client's view |
| Watch | what a module draws to tell the window what calls | retiring: `item@1` and `call@1` take its place (E8) |

**Words kept out, and why:**

| Word | Why |
|---|---|
| shell | a terminal's program (`GLOSSARY.md:79`); ADR 0062 d2 and ADR 0052 d2 used it for the window, and ADR 0087 rewords d2 |
| Focus, for Here | the keyboard focus, the focused Pane, `pane.focus-*`, and ADR 0065's future mode |
| Overlay, Float | Overlay is taken (`GLOSSARY.md:587`); Top layer is the code's word |
| Desk, for the middle | ADR 0065 d9 avoids it: Roma's «стол» is a workspace; the look's glass `desk` stays the look's |
| Surface, Contribution | say "a Pane, a Widget or an Item"; ADR 0023 uses "surfaces" for the look's backgrounds |
| Panel | one list stands in the Sidebar in v1; the word comes with a second |
| plugin, extension | an App is an App; an Extension is Chrome's (`GLOSSARY.md:572`) |
| agents manager, as a program | a product phrase for the sidebar list, the Inbox and Threads together || Row, Card, for Slot contents | say Item; Card is ADR 0058's block, Row is a Flow |
| Frame, for an animation frame | the sandboxed iframe (`GLOSSARY.md:245`); say tick |
| composer, compositor | the Message box is the Thread's field; Roma's «композер» is the Tiling |
| chrome | Google's browser; say "the desktop's window parts" |

**Code names that follow.** The `Place` value `here` becomes `instead` (`client/ui/src/pane.ts:82`), as the host's contract already says (`client/web/src/workspaces/arrange.ts:368`). The menu's `type Here` (`client/ui/src/module.ts:330-339`: `engine`, `folder`, `entered`, `only`) is where the Banda menu looks, not Here: it is renamed `MenuAt` in B4c, so two `Here` types never exist at once. `WindowApi` (`module.ts:72-148`) splits into actions, data hooks and Here. Strings that say "window" for Panes change (`client/web/src/sidebar/FlowMenu.tsx:27`, `:74`; "Overview of every window" in `client/web/window.json`). Nothing else is renamed: `PaneFrame`, `sidebar.counts`, `sidebar.archive` and the presets keep their names.

## 3. The parts as programs

Callers: **P** is the Person by a gesture; **A** an Agent with a pass; **App** an App's own code; **H** a host by facts.

| Program | Lives in (now → target) | Owns | Input | Output | Who may call it |
|---|---|---|---|---|---|
| **Window** | `client/web/src/shell/` → `window/` | the Bar, the Sidebar, the Top layer; Here; the key router; popped-out windows | device events; the Tiling's events; `look.toml [bar]`, `sidebar.toml`; the module list | Here; what stands in its areas; actions sent to their owner | P by a gesture; any part by a Window action (`sidebar.toggle`, `menu.open`, `pane.pick`); never an App by function |
| **Tiling** | `client/web/src/workspaces/` → `tiling/`; the model in `platform/workspaces` | the arrangement (a Person document); the client's tiling view (workspace on screen, focus, scroll, overview, zoom, Solo); Tiles; motion | its actions (`pane.*`, `column.*`, `group.*`, `workspace.*`); `pane.pick`, handed on by the Window; placements (`show.*`); the middle's rect; look values as args; Marks by owner | Tiles and Configures; events to the Window; intents to the home host | the Window; any part by its actions; H by facts; A only through `show.*` |
| **sidebar list** (platform) | `client/web/src/sidebar/`, `platform/look/src/sidebar.rs:1-8`; later `platform/sidebar` | the items projection; how the list is arranged (`sidebar.toml`); the one order; archive | `item@1` from every Project on each host; the Person's marks; Here | the list; the `sidebar.counts` widget; `order(items)` | P through its list and widget |
| **calls** (platform) | `client/web/src/calls/` now; `platform/calls` with E8 and E9, which takes the rules of who is told from `platform/notifications` (vision §9.2) | the Inbox (`calls.inbox`, ADR 0082 d6); `calls.answer`; sight; who is told | `call@1` from every Project on each host; sight from Here and the Tiles | what to tell, delivered as toasts in the Top layer and as `notify` and `sound` through the device port | P by Alt+U or a toast; an App only speaks `call@1` |
| **Apps** | each App's host part; client views in `apps/*/pane` until Level 1 | their tables, commands, views, facts; their Panes, Widgets, item actions, Slot Items, Sources | their args; Here, in their Widgets; their own data | Trees, commands, facts, `item@1`, `call@1`, intents | P by their actions; other Apps by intent and Slot |
| **client core** | `client/core` since W0a1 (ADR 0089) | the Here store; the store read by selector; what an action runs with; the device port's words; the hosts store since W0a2; the items and calls stores with B7a and E8b, the action matcher with W1 | the hosts' protocol; device adapters | stores with selector hooks | the Window, the Tiling, platform parts, Apps' client views |
| **device port** | `client/web/src/boot/` (the device and its desktop adapter) and `client/core/src/device.ts` (its words), since W0a1; the bridge's table in `client/desktop/src/bridge.ts` | ADR 0082 d12's capabilities; screen facts; the desktop's window parts | the OS | capabilities | the Window; the host's device requests |

**Why the Window and the Tiling are two programs.** A phone in v1 has no Tiling: it shows the sidebar and Thread screens (§7.5). A popped-out Pane has no Tiling. The Drawer and Quick Look hold Panes outside the arrangement. So the Tiling is the middle's program, and an optional one. This is niri and waybar: the compositor knows no bar, and waybar's workspaces module reads the compositor's events. Today Banda's workspaces' numbers and the Group map are drawn inside the Bar (`client/web/src/bar/Bar.tsx:381-403`, `client/web/src/bar/Map.tsx`); B4f makes them the Tiling's Widget, keeping its id `workspaces.list` (`client/web/src/bar/placed.ts:11`).

**Why the Window owns the keys.** There is one matcher (ADR 0071 d1). A phone has no keys; it turns gestures into the same actions. No App may take another App's input.

**Why the sidebar list and calls are platform parts:** see §6.1.

**Calls and notifications.** This follows the vision's §9.2, which merges the Watches and the notifications' rules into `platform/calls`. The merge happens on the host: E8 works the Calls out there and E9 decides who is told. Until then the notifications part keeps telling the Person as ADR 0056 has it. After E9 its client part keeps only delivery: toasts in the Top layer, and `notify` and `sound` through the device port.

**What leaves `Shell.tsx`** (1571 lines; the vision's target is 400 or fewer, `§9.2`):

| From `client/web/src/shell/Shell.tsx` | Goes to |
|---|---|
| the tiling controller and its change queue, `:298-518` | `tiling/useTiling.ts`, the queue moved verbatim until prediction (§8.9) |
| the areas' state, `:348-383` and `:699-829` | `window/` |
| the key router, `:1104-1141`, and `handOn`, `:232-265` | `window/keys.ts` |
| `window.banda` uses: popped windows `:807-829`, `menu.listen` `:878`, `settings.set` `:1000`, `popped.asked` `:1319` | `window/device.ts`, then the device port |
| every list in React state, `:382` | the items and calls stores |
| the Project where New Thread starts, `:1175` | Here, with the workspace's Project as the fallback |
| Solo writing `fill` on focus moves, `:1179-1200` | Solo as each client's view (§6.5) |
| snooze, wake and archive, `:594-648`; the woke note `:1045-1065`; the menus `:1359-1365` | Threads' item actions; archive to the sidebar list (§6.4) |
| widgets given the Window's parts, `:1201-1215` (`window: parts` at `:1210`) | Widgets read Here (§4.3) |

## 4. What Apps show, and where

### 4.1 Areas, per form

| Area | What stands in it | Wide | Narrow (small window or tab) | Phone (PWA, v1) | Who arranges it |
|---|---|---|---|---|---|
| **Bar** | Widgets between the Mark at the left edge and the fixed right edge | three parts (ADR 0024 d1) | widgets marked `compact`; the rest are reached by their actions | a header: the Mark, the title of Here, at most two widgets marked `compact` | the Person, in `look.toml [bar]` (ADR 0064); Banda's defaults otherwise |
| **Sidebar** | the sidebar list | docked at the left, its width dragged (ADR 0067 d1) | floats over the middle (ADR 0025 d10, `client/web/src/shell/narrow.ts:8-23`) | the home screen | `sidebar.toml` and its presets (ADR 0008); whether it shows and its width are each device's view |
| **middle** | the Tiling's workspace on screen | the Strip | the Strip | one Thread screen at a time, with no Tiling | the Person's actions and the Flow |
| **Top layer** | Banda menu, launcher, Drawer, Quick Look, dialogs, menus, toasts, in a fixed stack | centred, or dropped from the top | the same | bottom sheets, full screen | the Window; one of each kind at a time, but toasts, which stack up to three (ADR 0011 d2) |

An App never sees the form: it is not in Here (§5.1). The catalogue's components adapt (a Table becomes a List on a phone), and only the Window and the Tiling's view know the form (§7.4).

### 4.2 Pane

A Pane is an App's view opened for one Project, with its args kept in the arrangement. It stands in a Tile, the Drawer, Quick Look or a window of its own. Today its contract is `PaneKind` and `PaneProps` (`client/ui/src/pane.ts:99-195`).

**Rules:**

- **A Pane names its Project and its subject**, the one thing it shows, by Address (today `PaneKind.shows`, `pane.ts:179`). It never names a host.
- **A Pane never reads Here to draw.** Its args come from the arrangement, so it looks the same on every client and every device. Its own header, toolbar and Pane menu act on its own args (ADR 0066 d6).
- **A Pane obeys its Configure** (ADR 0088): no drawing while hidden, no measuring or resizing while moving, one fit per settled size. It reads it through `useTile(select)` or `tileOf(element)`, never as props.
- **A Pane draws at any size from its minimum up**, and is the same Pane in every area.

**What changes in `PaneProps`** (`pane.ts:99-141`): `engine` comes from the hosts router (`sessionOf(project)`, H5); `composer` (`:133`) becomes Threads' own, resolved from the act's Here (§5.4); `open`, `update`, `close` and `label` come from one stable handle per Tile (§8.6); `run` and `peek` stay. In `PaneKind` (`pane.ts:143-195`), `closed()` goes when the host emits `pane.left@1` (E6). The other functions stay code until V2: file Panes need dynamic titles, and nothing outside Banda draws a Pane yet.

### 4.3 Widget

A Widget is a small view on the Bar, an App's or a platform part's: an icon, maybe words or a number, quiet while it has nothing to say (ADR 0024 d3).

**The contract, for everyone the same:**

- `{id, about, Widget, compact?}` in `defineModule` (`client/ui/src/module.ts:379-386`), with props `{engine, projects}`. It reads Here through `useHere(select)`, so it renders again only when its slice changes.
- `compact: true` says it has a form that stays in a narrow Bar and in a phone's header (§4.1). A widget without it is reached there by its action.
- It acts through `useRun()`, which runs an action by id with the Here of the click (since B4e the Window's Here as it runs, the Pane in focus; no widget on the Bar has a Tile of its own, so none needs another Tile's Here, and B4f built none): from `@banda/ui` (`hooks/use-run.ts`, in since B4e, where the sidebar list, the Thread menus and the machine label took it), from `@banda/core/react` after W0. With B4f it replaced `window.run` in the bell, the limits and the servers' widgets.
- It draws nothing while it has nothing to say.
- A click runs one action, or opens its own popover (ADR 0024 d3). A right click may open a menu of actions.
- Where it stands is only `look.toml [bar]` (ADR 0064). The Person's own settings for a widget stay settings: the counts keep `show = "closed" | "always" | "never"` (`client/web/src/sidebar/Counts.tsx`, ADR 0035 d5).

**What goes:** `WidgetProps.project` and `window` (`module.ts:366-372`), and the privileged `OwnProps` (`client/web/src/bar/Widgets.tsx:20-40`): `lists`, `sidebarShown`, `current`, `onOpen`, `aside`.

- `sidebar.counts` becomes the sidebar list's widget. It reads the items store, `here.sidebar` and `here.pane.subject`. A click still opens its list of who waits and who works (`Counts.tsx:91-139`), in the sidebar's order (§6.3). The id stays.
- `workspaces.aside` and `workspaces.list` (the numbers and the Group map, `Bar.tsx:381-403`, `Map.tsx`) become the Tiling's widgets.
- The fixed edges (the Mark, update, look problems, connection, `client/web/src/bar/Bar.tsx:160-198`) stay the Window's components. A widget that cannot move is not a Widget (ADR 0064 d3).

*Alternative weighed:* a Widget whose click may run only one action and whose visibility is a manifest rule `when = "!sidebar.shown"`. It loses the counts' dropdown (ADR 0065 d9) and the Person's `always`.

### 4.4 The sidebar list

The Sidebar shows the platform's list, the sidebar list. It reads only `item@1`, `call@1`, the Projects and the Person's marks. No App draws in the Sidebar in v1.

- **What it shows does not change here.** Sections, shelves and presets stay as `sidebar.toml` arranges them. A new sidebar ("the Inbox and the Projects together") is its own piece of work (ADR 0079, out of scope).
- **The Window reaches it through one indirection,** a component named by the Sidebar area, so another list can stand there later. The word Panel, App Panels, a Panel switcher and Panels as Panes are deferred.
- **Its header and foot stay as ADR 0067 set them.** "New Thread" asks for the intent `thread.new@1`, which Threads handles; until B8 it runs the action `thread.new`, counted by the App-strings ratchet (§5.3). The Flow button runs the Tiling's action `flow.pick` (today it writes `agents.toml` itself, `FlowMenu.tsx:78`). A Project's verbs (pin, locate, its settings, Add Project; today `onPin`, `onLocate`, `onProjectSettings`, `onAddProject`, `client/web/src/sidebar/Sidebar.tsx:93-140`) become `projects.*` actions.

### 4.5 Items, Slots, Actions, item actions

- **Item.** `item@1` (ADR 0082 d9): an Address, a title, a Mark, when it changed, its owner and the Pane to open, as its kind and args (not a Pane's id). It also carries `news`: an opaque key that changes when there is something new for the Person to see. For a Thread it is its last finished turn, which today keys the seen mark (`apps/agents/pane/src/seen.ts:12-14`). Until E8, `Listed` (`client/ui/src/pane.ts:229-274`) is split into the Item and the owner's extras (agent, harness, snooze, answers) by B7a, and the Watches report into the items store.
- **Slot.** A place in one App's thing that other Apps fill with Items (ADR 0082 d8). v1 Slots:
  - `thread.details`, today `threadDetails` (`module.ts:413`);
  - `pane.header`, where Threads' row shows a Thread's Mark (ADR 0062 d17). Then `PaneFrame` and `Overview` stop importing `ThreadMark` (`client/web/src/workspaces/PaneFrame.tsx:53`, `client/web/src/workspaces/Overview.tsx:21`).
- **Action.** As today (`module.ts:163-201`): id, title, section, keys, scope, args schema, `runsAsPerson`. `run` is bound by its owner. `when` stays a closure for Banda's own code until V2; only two exist (`client/web/src/shell/actions.ts:753`, `:764`), and both leave with the Thread verbs.
- **Item action.** An action that takes one Item. It replaces `Listing` (`module.ts:288-301`) and the window's `thread.*` actions (`client/web/src/shell/actions.ts:747-797`). The Thread menu keeps its rows and their order (`client/web/src/titles/ThreadMenu.tsx:100-105`): the owner's naming rows (Rename, Suggest a title, Previous title), the platform's Mark as unread, the owner's other rows (Make a Project, Snooze or Wake), and the platform's Archive last.

### 4.6 The Top layer

The Window owns it: one stack in a fixed order over every workspace, drawn through `TopLayer` (`top-layer.tsx:8-10`). A dialog or picker is part of the view that opens it.

- **The Drawer and Quick Look are not areas.** They are parts of the Top layer that hold one Pane each, and give it a Configure as a Tile does (ADR 0088 d4).
- **Toasts.** The Window draws them in the Top layer: its `<Toaster>` stands there today (`client/web/src/shell/Shell.tsx:1505`). The notifications part decides what to tell and posts it. Its bell widget shows the last toasts again in a toaster of its own in the Top layer (`platform/notifications/pane/src/Bell.tsx:105-113`).

## 5. Here, and how the parts talk

### 5.1 Here

```ts
// client/core/src/here.ts since W0a1, kept in a KeptHere (client/core/src/kept-here.ts) by client/web/src/window/here.tsx.
// The client's view (ADR 0062 d13, ADR 0082 d1): never a host's state.
export type Here = {
  front: boolean                                      // the Window has the OS focus
  sidebar: boolean                                    // the Sidebar shows
  workspace: { id: string; project?: ProjectId } | null   // null where there is no Tiling
  pane: { id: string; project: ProjectId; subject?: Address } | null
  project: ProjectId                                  // pane?.project ?? workspace?.project ?? home
}
export interface HereStore {
  get(): Here                                         // always current, the Tiling's prediction included
  subscribe(listener: () => void): () => void         // told once per input task, never inside a tick
}
export function useHere<T>(select: (here: Here) => T): T   // useSyncExternalStore with a selector
```

**Rules:**

- **Only the Window writes it.** It folds three sources: the Tiling's events, its own areas, and the device port.
- **`get()` is always current.** Two keys in one slow frame both act on the latest Here. Listeners are told once at the end of the input task, in a microtask, and never in the clock's read phase (`client/ui/src/lib/frames.ts:24-33`), where a React commit would force layouts. As B4c built it, every source of Here is the Window's state, so the Window tells them from its effect once it drew the change: for a key that is the same task; for what the engine says, a reader may draw a commit after the Window (`client/web/src/window/here.tsx`).
- **It is read by selector,** never passed down as props: by `useHere` now, and as the fields a Tree Widget declares, given as args, at V2. Re-rendering the whole Window from the key handler is what makes the 8–30 ms tasks measured in the workspace phase (`Shell.tsx:1109-1137`, §8.1).
- **No host stores it.** It reaches a host only as the args of a query or a command, and as presence (ADR 0082 d12). It has no host field: an Address names none (ADR 0082 d15).
- **Every act runs with the Here of its gesture.** An unset `project` or `pane` arg is filled from the gesture first (the row or Pane menu it came from), then from Here, like an environment variable.
- **A field is added when it has a reader.** The Top layer, the overview, zoom and a "recent subjects" list wait for theirs. So do two left out on purpose: the Pane's kind, which would invite a Widget to branch on another App's kinds (borders.5 in the guidelines), and the device's form, which only the Window and the Tiling's view may read (§7.4).

**What it fixes.** In an empty Project workspace, New Thread from the menu starts in home today: `focused(workspaces)?.project ?? home` (`Shell.tsx:1175`), and `focused()` returns nothing for an empty workspace (`client/web/src/workspaces/model.ts:122-126`). After the Person archives the last done Thread of Project X, New Thread lands in the wrong Project. `here.project` takes the workspace's Project.

**What it replaces:** `WindowApi.focused`, `sight`, `watchSight`, `lists` and `watchLists` (`module.ts:99-120`), by `useHere`, the calls part's `sightOf` and the stores (`sight` stays for the notifications part alone, which needs the Tiles measured to tell the Person, a counted case until E9 moves who is told to the host); `WidgetProps.project` (`module.ts:366-372`), and `WidgetProps.window` by `useRun()`; `OwnProps.sidebarShown` and `current` (`Widgets.tsx:20-32`); Files' `threadShown` (`apps/files/pane/src/index.ts:20-29`), by `useHere((h) => h.pane?.subject)`.

### 5.2 Channels

| Channel | Direction | Unix | In Banda |
|---|---|---|---|
| **Here** | Window → Widgets, the sidebar list, every act | `$PWD`, the environment | `useHere(select)` now; a Tree Widget gets the fields it declares as args at V2 |
| **Data** | host → a part | `read(2)` and inotify | query and follow (`client/ui/src/hooks/use-live.ts:46-80`); the items, calls and marks stores |
| **Act** | a part → the owner | exec by name | a command to its own host part; an action by id with args, its own App's or the Window's, the Tiling's or a platform part's; another App only by an intent `verb@major`, after B8 (`show.diff@1`, `thread.new@1`, `open.address@1`) |
| **Slot** | an App → another App's thing | a column a file manager asks a provider for | Items in `thread.details`, `pane.header` |
| **Fact** | an App's host part → another's | syslog | published facts and durable listeners (ADR 0082 d5, d6), on the host only |

### 5.3 Forbidden, with today's cases

| Forbidden | Today | Fixed by |
|---|---|---|
| module globals as channels between Apps | `askDetails`, `detailsShown` (`client/ui/src/components/thread-details.tsx:73-90`); `let shell` (`apps/browser/pane/src/threads.ts:22`); `keepWindow` (`apps/git/pane/src/ended.ts:12-21`) | B4d (done): Threads' own action `agents.thread.details{part}` replaces the global, and Git's run of it is a counted case; B8c: Git asks for `thread.details@1`, and handles replace `let shell` and `keepWindow`. B4d added one between Threads and the Window, the title field's store (`client/ui/src/lib/naming.ts`), counted until #861 |
| reading another App's rows | `threadShown` (`apps/files/pane/src/index.ts:20-29`); the browser's lists | B4c, B7a |
| the Window calling an App's methods by name | `agents.wake`, `agents.snooze` (`Shell.tsx:597`, `:606`) | B4d (done); `agents.threads` from the Projects settings stays, counted |
| opening another App's Pane by its kind and args | `terminal.terminal` (`apps/agents/pane/src/SignIn.tsx:220`), `git.diff` (`apps/agents/pane/src/session.ts:305`) | B8c, after intents (B8) |
| running another App's action by its id | `browser.open` from the terminal (`apps/terminal/pane/src/Servers.tsx:120`); Files' attach through `WindowApi.attach` (`module.ts:139`), which reaches Threads' Message box | B8c: `open.address@1`, and `thread.attach@1`, a new verb in `sdk/intents/` (as `thread.details@1` is) |
| client daemons | `start()` (`module.ts:426`) | E6, E8, B8 |
| a part getting the Window's private parts | `window: parts` (`Shell.tsx:1210`); `OwnProps` | B4f |

**Guard.** `client/web/src/architecture.test.ts` checks package imports only (`:41-90`). It gains three ratchets that only fall, as `STILL` and the mark `CEILING` do (`engine/src/modules.rs:32`):

- a line ceiling on the Window's root component;
- a list of App strings allowed in `window/` and `tiling/` (`"agents.`, `"thread.`, `AGENTS_FILE`), starting at today's count;
- a list of imports into `tiling/` from `window/`, `sidebar/`, `titles/` and `menu/`. The Window may import the Tiling; the Tiling never imports the Window or a Thread's code. Today `client/web/src/workspaces/PaneFrame.tsx:51` imports `../shell/attach`, and `:58` imports `../titles/Title`.

The counts are computed by the test, not written in the ADR.

### 5.4 Worked examples

1. **The counts while the Sidebar is hidden.** `sidebar.counts` reads `here.sidebar`, the Person's `show` setting, the items store and `here.pane.subject`. A click opens its list in the sidebar's order; a row runs `pane.pick`.
2. **Files attaches a file to a Thread.** It asks for the intent `thread.attach@1{chips}`, which Threads handles (today it calls `WindowApi.attach`, `module.ts:139`, a counted case until B8c). Threads resolves the target from the act's Here: the Thread in focus, or else the one that had the focus last in that Project (`client/web/src/shell/attach.ts:17-23`). It never crosses Projects.
3. **Git's Switch branch (Alt+Shift+G).** Today it calls Threads' module global `askDetails` (`apps/git/pane/src/index.ts:26-32`). B4d makes it Threads' own action, `agents.thread.details{part}`, which opens the Thread's details at the branch picker, so the picker stays where it is; Git's run of it is a counted case. B8c turns it into the intent `thread.details@1{part: "branch"}`. A later branch widget reads `here.project` and its own data.
4. **Alt+U.** The key router runs `calls.answer`. It takes the next Call in the sidebar's order (`client/web/src/calls/sight.ts:89-102`), then runs `pane.pick` (§6.2). An Agent's own Panes never need the client: the home host places `show.requested@1` (ADR 0082 d7, d15).

### 5.5 `when` rules as data: deferred

A grammar, a Rust parser and a TypeScript evaluator would serve two closures that leave with the Thread verbs. Widgets decide for themselves by reading Here and drawing nothing, as ADR 0024 asks. `when` as data comes with the first App whose code runs on its host and needs a scoped key (V2 and later).

## 6. The Agents: the Threads App, the sidebar and the Inbox

### 6.1 The decision

**Two kinds of program, joined by two languages.**

- **The Threads App** is an ordinary SDK App: its Panes (`agents.thread`, the Visual), `item@1` for each Thread and `call@1`, written in the same transaction as the change behind them; its item actions (rename, suggest a title, previous title, make a Project, snooze, wake); its actions (`thread.new`, `agents.composer.*`); its Sources (New Thread, Ask); its `thread.details` Slot and its `pane.header` row; its settings.
- **The sidebar list** (platform) owns the items projection, the list in the Sidebar, the counts widget, the one order, and the Person's archive. _Changed on 2026-11-08 by ADR 0096: a Thread's archive and seen are the Thread's, kept by its host; the sidebar list reads them from the list and sends the agents module's commands._
- **The platform's calls** own the Inbox and `calls.answer`; the notifications part tells the Person as ADR 0056 has it, until E9 moves who is told into `platform/calls` (§3).
- **`pane.pick`** is the one way to go to an Agent. The Window answers it and hands it to the Tiling, or on a phone to its stack of screens (§6.2).

"Agents manager" stays a product phrase for what the Person sees: the sidebar list, the counts and the Thread Panes. It is not a program or a package. The Inbox keeps its meaning, the merged Calls (`GLOSSARY.md:732`).

**Why not one Agents App.** ADR 0082 d6 walls an App's code to one Project, so a list across Projects and hosts (d15) cannot be an App's view without amending both. ADR 0082 d9 already makes the sidebar, the Inbox, the bar and push read only `item@1` and `call@1`: the browser's waits already fold onto Thread rows (`client/ui/src/pane.ts:251-255`), and pull requests and Web Apps can list themselves. The phone's home screen is the sidebar list whatever Apps are installed. Threads becomes the plain App ADR 0062 d2 asks for. The sidebar's rules are already platform code (`platform/look/src/sidebar.rs:1-8`).

*Alternative:* one Agents App that owns the Sidebar's list. It needs ADR 0082 d6 and d15 amended. The code in the plan barely changes either way.

*Alternative name:* "Inbox" for the sidebar part, with the `inbox` preset renamed (`platform/look/sidebars/inbox.toml`). It would give Inbox a third meaning; "sidebar list" needs no rename.

### 6.2 One way to go to an Agent: `pane.pick`

Today a pick goes through `picking` and `setReveal({how: "left"})` (`Shell.tsx:534-556`), and `WindowApi.goTo` (`module.ts:123`). A new action, `pane.pick{project, pane}`, does this one thing. `pane` is the Pane to open, its kind and args, as `item@1` carries it, not a Pane's id, so no round trip to an intent registry is needed. Every entry point runs it: a sidebar row, a row in the counts list, a toast's button, a push tap, Alt+U, the phone's Next.

- **The Window answers it.** It hands it to the Tiling where there is one, and to the phone's stack of screens where there is none (§7.5).
- **The Tiling goes to the workspace that shows that Pane and focuses it.** When none shows it, it opens it, as ADR 0005 d8 asks, where the Flow says: a new column of the current workspace in Free, at the left of its Project's workspace in Row (ADR 0065 d8), filled in Solo.

### 6.3 One order

Today two orders exist. The bar's list sorts loudest first (`client/web/src/bar/tally.ts:60-77`, ADR 0035 d3). Alt+U walks the sidebar's order (`client/web/src/sidebar/order.ts:15-31`, ADR 0079 d4). ADR 0065 d9 asks the counts to open "the same list as the Inbox".

**One order:** the Person's sidebar arrangement. `sidebarOrder` reads `currentLook()?.sidebar` (`order.ts:20`); it is the Person's, not a fixed ranking. The sidebar, the counts list and Alt+U share it. This amends ADR 0035 d3, and `docs/architecture.md:1132-1133` changes with it.

### 6.4 Where each Thread verb goes

| Verb | Today | Goes to |
|---|---|---|
| snooze, wake, the picker, the woke note | `Shell.tsx:594-625`, `:1359-1365`, `:1045-1065` | Threads' item actions; the picker asks for a time in the Top layer (`[unstable] client-pane`) |
| rename, suggest a title, previous title | `client/web/src/shell/actions.ts:747-772`; `Listing` (`module.ts:288`) | Threads' item actions |
| mark unread or read | `Listing.unread`; `apps/agents/pane/src/seen.ts:12` | the platform's item action over the Person's seen mark, which keeps per Address the Item's `news` the Person saw: unread while they differ; Mark as unread drops the mark, Mark as read sets it (§4.5). It needs no Thread knowledge |
| archive | `Shell.tsx:626-648`; `client/web/src/sidebar/archived.ts:18-19` | the sidebar list's item action over the archive mark; `sidebar.archive` stays |
| Alt+U | `Shell.tsx:557-567` | `calls.answer`, then `pane.pick` |
| the Flow switch | `FlowMenu.tsx:78` writes `agents.toml` | the Tiling's `flow.pick` |
| the Drawer's New Thread | `Shell.tsx:703-746` catches `open` | the intent `thread.new@1{place: "drawer"}` (the action `thread.new` until B8) |
| Thread rows in the Banda menu | `client/web/src/menu/menu.ts:29-38`, `:62-70` | a Threads Source |

_Changed on 2026-11-08 by ADR 0096:_ for a Thread, mark unread or read and archive call its host: `thread.unread` sends `agents.read` or `agents.unread`, and `sidebar.archive` sends `agents.archive` or `agents.unarchive`. The mark is the Thread's, not the Person's.

The Thread Pane reads its own Thread through its own queries and the `threads.live` stream, never through the items store.

### 6.5 Solo and the Flow

The Flow (ADR 0079) splits along ADR 0062 d13's three levels.

- **Free and Row are a placement policy:** where a Pane the Person or an Agent opens lands. The model applies it on the home host to every placement, the Person's own opens and `show.requested@1` alike, with one set of rules (ADR 0062 d17). The client only predicts the same result (§8.9).
- **Solo is each client's view.** No `workspaces.fill` is sent when the focus moves. Today it is (`Shell.tsx:1179-1195`, `client/web/src/workspaces/groups.ts:78-91`), and it would fight over `filled` (`platform/workspaces/engine/src/model.rs:60`) between a phone and a desktop.
- **Alt+M inside Solo** (`group.maximize`) releases the Group in this view until the focus leaves it, and writes nothing; in Free and Row it still sends `fill`. ADR 0079 d2's "Alt+M still gives the room back by hand" holds.
- **Only an Agent's Group fills:** one that some Item names as its owner (today `Listed.agent`, `groups.ts:90-93`). A fresh Thread with no Agent does not, as today.
- **The layout takes `filled` from the view:** it is part of the share math (`client/web/src/workspaces/model.ts:137-152`, with `filledAt` at `:171-174`), and `sized()` takes no view input today (`client/web/src/workspaces/layout.ts:90-98`).
- **`workspaces.tidy` is sent only by the device in front.** It lets every empty workspace go but the one the Person looks at and the last, as niri does (`platform/workspaces/engine/src/model.rs:798-800`; sent from `Shell.tsx:340-347`). Sent by two devices, each would remove the empty workspace the other looks at.
- **`flow` is the Person's setting, kept on the home host,** because the model reads it there when it places. It is read on the client through one accessor, `tiling/flow.ts`, instead of four readers (`Shell.tsx:1183`, `client/web/src/shell/actions.ts:631-640`, `FlowMenu.tsx:53`, `apps/agents/pane/src/ThreadPane.tsx:136`). It leaves `agents.toml` for the Tiling's own settings with T0, under ADR 0069's grace. Until settings come through the API (E4), there is one machine, and its `agents.toml` is the home host's.

### 6.6 Sight: done toasts for Agents out of sight

Today `sightOf` counts any column of the current workspace as on screen, scrolled out or not (`client/web/src/calls/sight.ts:44-46`), as ADR 0011 d1 defines it ("its Pane is on the current workspace"). With the default `window = "out-of-sight"` (`client/web/src/calls/settings.ts:10`), a toast shows only for `in-window` (`platform/notifications/pane/src/tell.ts:52-55`). In Row and Solo every Agent of a Project sits on its workspace. So when an Agent ends its turn scrolled out of view or behind the Solo Group, Roma hears the chime and gets no toast. Work moves through done (ADR 0079), so this is his main flow.

**Proposed:** a Tile counts as on screen only when at least half of it shows inside the Strip's clip; in Solo, only the filled Group. The prefetch margin of the Tile states (§8.4) is a separate measure and never counts as sight. It shows more toasts, merged by the joined toast (`platform/notifications/pane/src/teller.ts:112-128`). It amends ADR 0011 d1. It is a visible change, so Roma decides (§11.5).

### 6.7 What the Person would see change

- **A fix, now:** New Thread on an emptied Project workspace starts in that Project (§5.1).
- **Roma decides:** the counts list in the sidebar's order (§6.3, §11.6); done toasts for Agents out of sight (§6.6, §11.5).
- **Through a mockup:** column width, the overview's motion, working Group plates (§8).
- **Unchanged:** the Thread menu, the counts' click and `show = "always"`, Alt+M inside Solo. The Flow menu's strings say Panes, not windows.

## 7. One client core for desktop, web and phone

### 7.1 Packages

```
 apps/*/pane → apps/*/view   first-party client views until Level 1 ([unstable] client-pane)
        │ imports only @banda/core/react, @banda/kit, its own contract
┌───────▼───────────────────────────────────────────────────────────────────────┐
│ client/web   the Window (DOM): areas · key router · forms · the Tiling's view │
│              boot/desktop.ts │ boot/browser.ts → pick a device adapter        │
├─────────────────────────────┬─────────────────────────────────────────────────┤
│ @banda/kit (catalogue, web) │ client/core (no DOM, no App names, no disk)     │
│ shadcn · Banda's parts ·    │ Here · items, calls, marks stores (by host) ·   │
│ live components · tokens ·  │ action matcher · device port · later: hosts     │
│ clock and springs · later:  │ router (H5), tiling driver, Tree runtime (V2)   │
│ the web renderer (V2)       │                                                 │
├─────────────────────────────┴───────────────┬─────────────────────────────────┤
│ client/ghostty (WASM + canvas)              │ sdk/contract (Engine, types)    │
└─────────────────────────────────────────────┴─────────────────────────────────┘
 adapters:  desktop = preload → Electron main (device/<cap>, the window parts)
            browser = Web APIs + a Service Worker (the PWA)          native: later
```

- **The core decides what is where:** data, Here, acts, later the arrangement's prediction.
- **The kit decides how a thing draws.**
- **The Window decides which area a thing goes in, and in pixels.**
- **The adapters decide what the device can do.**

ADR 0089 holds each package's borders (decisions 1, 9 and 11). `sdk/contract`'s `Engine` (`sdk/contract/src/engine.ts:99`) stays one session to one host.

*Alternative weighed:* the kit's code under `client/kit`, since no code from outside Banda ever imports the React kit (vision rule 2). The vision's `sdk/kit` is kept; the package name `@banda/kit` is the same either way.

### 7.2 The device port

```ts
type Cap = "notify" | "sound" | "clipboard" | "pick_file" | "open_outside" | "webview" | "drag_out"  // ADR 0082 d12
interface Device {
  kind: "desktop" | "browser"
  caps: ReadonlySet<Cap>
  display: Store<{ scale: number; hz: number; insets: Insets; reducedMotion: boolean;
                   pointer: "fine" | "coarse"; keyboard: boolean; reservedKeys: readonly string[] }>
  presence: Store<"front" | "awake" | "away">
  storage: { get(key: string): string | null; set(key: string, value: string): void }  // conveniences only, wrapped
  notify?(notice: Notice): Promise<void>; sound?(name: string): void
  clipboard?: Clipboard; pickFile?(ask: PickFile): Promise<File[] | null>
  openOutside?(target: { url: string } | { path: string; host: HostId }): Promise<void>
  dragOut?(paths: readonly string[], host: HostId): void
  webview?: WebviewPort
  os?: OsWindow              // the desktop only: inset, material, accent, popped windows, update, menu socket
}
```

- `boot/index.ts` picks the adapter: `boot/desktop.ts` when `window.banda` is there, else `boot/browser.ts`. This ends the dead end at `client/web/src/main.tsx:59-64` ("Open Banda from its desktop app"); a tab with no paired host shows the pairing page (W2).
- A guard allows `window.banda` only in `boot/desktop.ts` and counts the rest down.
- **Main stops importing the page.** `client/desktop/src/main.ts:47-52` and `client/desktop/src/preload.ts:10` import the bridge table from `@banda/web/host`, which imports App packages (`client/web/src/host.ts:9-13`). The table, `BRIDGE` with the modules' parts of it, moves into `client/desktop`, and the page's `boot/desktop.ts` takes only its type. This changes where ADR 0028 d1 and d4 put it.
- **The desktop's device session stays in Electron main** (`client/desktop/src/road.ts:1-6`): one device per machine, CDP next to the webContents, and a page reload breaks nothing. The PWA's lives in its page core, behind the same port.

*Alternative weighed:* the device session in the page's core on every client. Every CDP request would take an extra hop, a reload would answer `no_device`, and each popped-out window would register as one more device.

### 7.3 Stores keyed by host

Every client store is keyed by host from its birth, so H5 and H6 do not rewrite them. They replace singletons that assume one engine (`client/ui/src/lib/signs.ts:14`, `client/ui/src/lib/projects.ts:60`, `client/ui/src/lib/look.ts:10`, `client/web/src/main.tsx:21`). The Person's marks (seen, archived, looked at) sit behind one store, on localStorage until E8 makes them a Person document (vision decision 13). _Changed on 2026-11-08 by ADR 0096: a Thread's seen and archived come from its host, in its list, not from this store._ Device storage then keeps only conveniences: the view, widths, drafts, recent toasts.

### 7.4 Forms

The form (wide, narrow, phone) comes from the device's display: the width in look units, the pointer and the keyboard. Only the Window knows it, and it gives it to the Tiling's view. It is not in Here, so no App can branch on it; §4.1 says what each area does in each form. Keys work in wide and narrow forms; in a browser tab, `reservedKeys` marks those the tab cannot take (Ctrl+W, Ctrl+T, Ctrl+N), and on a phone every action has a pointer path.

### 7.5 The phone in v1

Vision M8: the phone starts Threads, follows them in the list and the Inbox, stops them, replies to Agents, answers Questions and gets pushes.

- **Home is the sidebar list**, as `sidebar.toml` arranges it.
- **A Thread screen** shows the Thread, with Stop, the Message box, the Questions, and a **Next** button in its header: the phone's Alt+U. It runs `calls.answer`, whose `pane.pick` the Window hands to the stack of screens: the Thread's screen is pushed.
- **New Thread asks for the Project**, or takes it from the section it came from. With no workspace, `here.project` would be home.
- **No Tiling.** The phone never writes the arrangement. It keeps only its own stack of screens. The Thread's Group's other Panes are named in its header and open on a wide screen.
- **No per-Pane phone fields** until Panes can be Trees (M10).

*Alternative weighed:* a Thread screen showing its Group as read-only tabs, drawn by a pure projection of the arrangement. It needs terminal and browser Panes that work on a phone; it comes with M10.

### 7.6 Deferred

The native phone app and its kit; WASM under Hermes; ports only React Native would need; the core in a worker; popped-out Panes on the web; the look resolver on the device.

## 8. Performance architecture

### 8.1 Where the time goes

| Phase (headless, DPR 1) | Measured on 2026-11-07 | Cause in the code |
|---|---|---|
| column width | 1.46 layouts per moving frame; 126 terminal fits in 4.2 s | `style.width`, then `offsetLeft`/`offsetWidth` of every column, in one callback (`client/web/src/workspaces/layout.ts:391-400`); `fit()` renders synchronously inside `flushSync` (`client/ghostty/src/t3/lib/observeResize.ts:44`, `client/ghostty/src/t3/surface.ts:873-922`); the page box resized each frame (`apps/browser/pane/src/pages.ts:280-281`) |
| workspace switch | p95 12.0 ms per moving frame; 22 tasks over 8.3 ms, the longest 29.8 ms | the key handler re-renders the whole Window (`Shell.tsx:1109-1137`); `PaneFrame` and `Strip` not memoised (`PaneFrame.tsx:129`, `Strip.tsx:59`); new lambdas per Pane (`PaneFrame.tsx:380-392`) |
| overview | p95 3.3 ms; 4 tasks over 16.7 ms | layout read and widths written every frame (`Overview.tsx:363-398`) |
| quiet | 62 rAF callbacks a second, 122 with a browser Pane | the Mark's clock runs while any mark is registered, and the Bar's Mark always is (`client/ui/src/components/banda-mark.tsx:680-685`); the page follow re-arms while a page shows (`pages.ts:439-447`) |
| a terminal off screen, printing | over 11,500 canvas calls in 3 s | `surface.setVisible` (`surface.ts:747`) has no caller; every workspace stays mounted (`client/web/src/workspaces/Workspaces.tsx:190-199`) |
| a working Agent | not measured | Group plates animate registered custom properties on the main thread (`client/ui/src/styles/globals.css:422-446`, `:568`, `:593`, `:604`) |

The GPU on Roma's machine has every feature enabled with no flags. Headless CI caps at 60 Hz and never measures raster.

**The verdict.** Banda is not slow because of where its code runs. It changes sizes every frame, reads layout in the frame it writes it, draws what nobody sees, and re-renders the whole Window on a key. A separate compositor process, a WebGPU layer over the page or a native window toolkit would not fix any of these.

### 8.2 The model: the Tiling is a compositor

```
 key ─► Window: key router ─► Tiling action ─► predicted arrangement ─► layout ─► Tiles
                                                     │                       │
                                         intent to home host          Configure {size, scale, state}
                                                                             │ (once per move)
                     motion on Tiles: transform · opacity  ◄── one clock     ▼
                     followers (the page box) replay it              Pane obeys: hidden → no draw
                                                                             moving → no measure, no resize
```

Two rules make it Unix-like: **the Tiling knows no Pane's content**, it only hands out Configures; **a Pane knows no motion**, it only obeys its Configure. Device views such as the `<webview>` page follow what the Tiling publishes.

### 8.3 Motion rules

1. **Animate only compositor properties:** `transform`, `translate`, `scale`, `opacity`. `clip-path` only once a trace in Electron shows it composited. Never width, height, top, left, inset, margin or padding, CSS transitions included. Today's cases, such as Quick Look's `transition-[width,height]` (`client/web/src/workspaces/Peek.tsx:98`), are counted and only fall.
2. **Never read layout inside a move.** Mid-flight values are worked out from the spring. Values that cannot change during a move (outline widths, radii, `Overview.tsx:376-398`) are read once at its start.
3. **One clock.** `frames.ts` already asks for a tick only on demand (`client/ui/src/lib/frames.ts:17-21`). The loops that never stop are fixed where they are: the Mark ticks only while a mark animates; the page follows only while the Tiling moves or a hand drags; the overview stops once landed; each terminal's own rAF (`surface.ts:1934-1941`) joins the shared clock. `onMove` and `afterMoves` keep their names.
4. **Motion starts in the input task**, from the predicted target. React reconciles after.
5. **No permanent `will-change`**; reduced motion and `[motion] off` jump (ADR 0007 d9).

### 8.4 The Tile contract

```ts
export type TileState = "shown" | "moving" | "hidden"
export interface Configure {
  size: { width: number; height: number }   // CSS px of the content box, as settled
  scale: number                              // devicePixelRatio, the window's zoom in it
  state: TileState
  serial: number
}
export function tileOf(element: Element): { now(): Configure; watch(f: (c: Configure) => void): () => void }
export function useTile<T>(select: (c: Configure) => T): T
```

- **Delivered imperatively:** the terminal and the page box read `tileOf(element).watch`; React readers use `useTile(select)`. As Pane props, every visible Pane would render twice per move. The states land first (P2); the size follows the width pick (P7).
- **The scale leaves the Pane's zoom out** (found in P3): a terminal's font zoom and a page's zoom are the Pane's own state, which the Tiling cannot know, so `scale` is `devicePixelRatio` alone. A zoom of the Tiling's own, as the overview's (P10), joins it once something reads it.
- **The Tiling predicts each state at a move's start** from the target layout, plus a margin, so incoming terminals do not slide in blank. An `IntersectionObserver` per Tile corrects hand scrolls. Inactive Deck tabs, Tiles under a zoom and a window that is away are hidden. The target of a jump is shown in the input task.
- **Hidden:** draw nothing, stop timers, hold commits (at most once a second), keep state. **Moving:** measure and resize nothing; a terminal shows its retained bitmap. **Shown:** draw.
- **No React `<Activity mode="hidden">` on Tiles:** it destroys Effects, and the terminal's streams with them (`apps/terminal/pane/src/TerminalPane.tsx:256-406`).

### 8.5 Content takes its size once

A Pane's content gets a new size only through a Configure, once per move. Moves that only translate send none. When the width's Configure is sent is Roma's pick from a mockup: **A**, today, the content follows the width every frame; **B**, niri's way, the final size at once, neighbours sliding, a three-part plate answering ADR 0007 d9's objection about borders; **C**, the content holds its size, cropped, and fits once at settle. B needs `clip-path` composited, since a cover sliding over the content would show through the glass tiles (ADR 0023). So a one-day trace comes first, the mockup runs inside Electron with a busy main thread, and C is recommended unless `clip-path` is composited. A hand drag or an OS resize configures at most every 100 ms and once on release. The mechanism lands first with the policy "every frame" (P3), so nothing changes until the pick.

### 8.6 React rules and containment

1. View state (Here, the Tiling's view) lives outside React, read by selector, so a focus step re-renders only the two `PaneFrame`s whose `focused` changed. Memo boundaries sit at `Strip`, `PaneFrame`, the Pane and each widget.
2. One stable handle per Tile replaces the lambdas at `PaneFrame.tsx:380-392`. The action context is stable too: today `parts` depends on about twenty callbacks (`Shell.tsx:1017-1038`), and the key listener re-registers when it changes (`:1139-1141`).
3. No animation values in React state. The sidebar subscribes per row (`useItem(address)`), because `useSyncExternalStore` renders are never time-sliced.
4. A visible stream commits at most once per tick (`client/ui/src/hooks/use-live.ts:111`), and about ten times a second while its Tile moves.
5. Lists over about 200 rows are windowed; long documents use `content-visibility:auto`, as messages do (`client/ui/src/components/message-scroller.tsx:74`).
6. Each area gets `contain: layout paint style`. A Tile gets `contain: layout style`, with `paint` only on its content box, because the Deck's names and the focus frame sit outside it (`PaneFrame.tsx:126-127`). The terminal's mount gets `contain: strict`.

### 8.7 What a working Agent costs

A working Agent is Banda's normal state. Its Group plate breathes, sheens or pulses by animating `@property` custom properties into `color-mix` backgrounds (`globals.css:422-446`, `:463-468`, `:568`, `:593`, `:604`, on `[data-group-plate]`, `Strip.tsx:352`). Chromium cannot run these on the compositor, so every working plate repaints on the main thread every tick. `motion.spec.ts` has no working Agent, so the quiet baseline misses this.

**Proposed:** a "working" phase in motion.spec that counts paints per second; then the breath rebuilt as the opacity of a painted layer and the sheen as a translated gradient layer. ADR 0065 d6's three choices (`breath`, `line`, `sheen`) stay. The look may shift slightly, so a mockup comes first.

### 8.8 The terminal renderer

libghostty-vt gives terminal state and dirty rows, and no renderer, so Banda owns its renderer. Each step comes only when the one before misses its gate: visibility (P2); Canvas2D wins (P4: the scrollbar written only when it changes, `surface.ts:1907-1926`; a typed snapshot instead of an object per cell, `client/ghostty/src/t3/core.ts:862-884`; blit scroll instead of redrawing every row, `client/ghostty/src/t3/renderer.ts:149-151`); then one WebGL2 context shared by every visible terminal, on an OffscreenCanvas with one glyph atlas (a context per terminal would compile shaders at every workspace switch); then a worker.

### 8.9 A key is drawn before the host answers

ADR 0062 d17 decided one Rust model with WASM prediction in clients. Two facts change the order of the work:

- **The model makes its own ids:** `WorkspaceId::new()`, `PaneId::new()`, `ColumnId::new()` (`platform/workspaces/engine/src/model.rs:233`, `:343`, `:365`), and `workspaces.open` takes none (`platform/workspaces/engine/src/lib.rs:336-345`). A predicted Pane would come back with another id and remount: the terminal stream restarts, the `<webview>` reloads.
- **The latency comes from waiting, not from TypeScript.** The TS model already works out the next state (`client/web/src/workspaces/model.ts:11-12`); the Window then waits up to `DRAWN_WITHIN = 2000` ms for the host (`Shell.tsx:198`, `:438-492`).

So: every creating intent carries client-made ids, and the host refuses a duplicate (`model.rs:810-835`). Placements are the exception: `workspaces.place` carries the `show.requested@1` event, and the new Pane's id is derived from it, so several clients place it once (ADR 0082 d15). A parity test replays Rust's golden traces through the TS model; the client draws its prediction at once, sends intents in order and reconciles by `at` (A8); T1 compiles the model to WASM and deletes the TS copy; T2 adds the overlay. The page's CSP already allows WASM (`client/desktop/src/main.ts:120`).

### 8.10 Device views follow

The page layer stays a fixed layer (ADR 0013 d1). Its box sits inside a still clip container, so only `translate` is replayed, with the Tile's animation start time. It measures once at rest, and every tick only while a hand drags. This replaces ADR 0013 d1's "the tab follows the slot's place on every frame".

### 8.11 Budgets

| Measure | Budget | Today | Gate |
|---|---|---|---|
| app rAF callbacks a second, quiet | 0 | 62; 122 with a browser Pane | hard |
| ticks a second, working (a focused terminal's cursor blinks) | ≤ 2 | not measured | hard, after P0 |
| canvas calls of a hidden terminal | 0 | over 11,500 in 3 s | hard |
| layouts per moving frame, translate-only moves | 0 | measured in P0 | hard |
| layouts per moving frame, width | 0 after P7, if B or C is picked (§8.5) | 1.46 | hard after P7 |
| fits per settled size per terminal | 1 (for a width change, if B or C is picked) | about one per frame | hard after P7 |
| `PaneFrame` renders per focus step | ≤ 2 | all of them | hard |
| page trailing frames | 0 in every phase | 0 where measured | hard |
| main thread per moving frame, p95 | ≤ 4 ms | workspace 12.0, overview 3.3, width 2.8 | soft |
| longest task during a translate-only move | ≤ 8.3 ms, never a long animation frame | 29.8 ms | soft |
| opening a Pane | mount ≤ 50 ms, no long animation frame; the animation starts after the first commit | key to drawn p95 24 ms; 12 at 150 ms late (T-pred; 43 and 197 before) | soft |
| key to frame p95, also at `--latency 150` | ≤ 16 ms | width, maximize, focus, workspace and move p95 6–15 ms at 0 and 150 ms late (T-pred; 36–45 and 188–194 for width, maximize and move before); close 43 and 23 (52 and 201 before, #894); no frame late for any key | hard: no wait for the host (no frame late); soft in ms |
| a Tree's render p95 and size | ≤ 5 ms, ≤ 30 KB (vision V1) | — | V1 |

Hard gates are counts, stable on CI. Soft gates are timings: the median of three runs, failing at 20% over the committed baseline once CI's variance is known. `client/desktop/e2e/motion-budget.json` holds the numbers. A PR may lower them; it raises one only by saying why.

### 8.12 Measurement

`motion.spec.ts` v2 keeps the browser on screen in every phase (today the width phase pushes it off, `client/desktop/e2e/motion.spec.ts:204-213`). It adds phases (working, a hidden terminal printing, open and close, the Banda menu, Thread streaming, a key burst of ten keys in 50 ms, Alt+U to a hidden done Thread), a DPR 1.6 project, an init script that counts rAF calls, canvas calls, layout reads inside moves and fits, observers for long animation frames and `keydown` timing, and a trace per phase summarised over moving frames, in TypeScript. A run on Roma's display (Hyprland, 120 Hz, DPR 1.6), glass on and off, comes before releases and after the visible steps.

### 8.13 Platform and App

The platform owns the clock, the springs and the motion driver. The Tiling owns Tiles, Configure, visibility, the resize gate and published motion. The catalogue's live components (terminal, page, Thread scroller, file view, Mark, Visual) obey the contract, and the catalogue owns the terminal renderer. An App owns only what it draws, how often its data changes and its tree's size. The host never sees Tile states; they leave the device only as presence.

### 8.14 Not done

A separate compositor process; a WebGPU layer over the DOM; a native window toolkit; WebContentsView for Panes that move; Chromium GPU flags; FLIP for programmatic Strip scrolls and WAAPI for the bar's mark until a trace shows they matter.

## 9. The refactor plan

**Rules every PR keeps:**

1. `scripts/check.sh` passes. A move is its own pure `git mv` commit.
2. Action ids, `[bar]` widget ids, Pane kinds and settings keys are never renamed without an alias. Files the Person wrote keep working. Data is never rewritten.
3. Each PR adds or tightens a ratchet in `client/web/src/architecture.test.ts`.
4. A PR that touches the window posts motion.spec numbers before and after.
5. **Mockup first** where pixels or motion change: marked ◆ below. Every other PR keeps pixels the same, proven by screenshot e2e.
6. Before a step that touches files the host track also works in (`client/desktop/src/bridge.ts`, which holds the bridge's table since W0a1, with its words in `client/core/src/device.ts`; `client/desktop/src/*`; `client/ui/src/lib/look.ts`, E-steps), the PR's description names the files and the step on the other track (§10).

**Size:** S under a day, M a few days, L a week or more.

**Ids.** The vision's ids (A8, B4, B7, B8, E1–E9, H5, L3, T0–T2, V1–V4, W1–W3) mean what they mean in its §9.3. A lettered id is part of the vision step it starts with: B4a–B4i are parts of B4 (the `Shell.tsx` split and its slots), B7a of B7 (`item@1`), B8c of B8 (the client calls by intent), E8a and E8b of E8. New here: D0, C0, C1a–C1c, R1, P0–P11, T-a, T-b, T-ids, T-par, T-pred, W0, W4 (the phone form) and V-s.

| # | PR | What | Size | Needs | ◆ | Unblocks |
|---|---|---|---|---|---|---|
| D0 | ADRs and words | ADRs 0087–0089, GLOSSARY, guidelines, the draft of the skill topic `apps` (`docs/sdk/skill-apps.md`) | S | Roma | — | all |
| **Wave 1: a net, a gauge, three fixes** | | | | | | |
| C0 | Roma's day, in e2e | Solo, Flow, snooze and wake with Undo, Alt+U with the Sidebar hidden, ten Agents in a Row, a key burst; an expected-fail test for sight | S-M | — | — | every window move |
| P0 | motion.spec v2 | §8.12, reporting; the budget file in record mode | S-M | — | — | every perf PR |
| C1a | Here's Project | `Shell.tsx:1175` falls back to the workspace's Project | S | — | — | — |
| C1b | One order | the counts list in `sidebarOrder` (`tally.ts:60-77`) | S | §11.6 | ◆ small | B4f |
| C1c | Sight | §6.6 | S | §11.5 | ◆ small | P2 |
| **Wave 2: cut `Shell.tsx`, no behaviour change** | | | | | | |
| B4a | The Tiling leaves | `shell/` → `window/`, `workspaces/` → `tiling/`, but `Drawer.tsx`, `Peek.tsx` and `Popped.tsx` go to `window/` (the Top layer and popped-out windows); `useTiling` takes the queue verbatim; `here` → `instead`; three ratchets | L move | D0, C0 | — | B4b, R1, P2 |
| B4b | Keys and device | `window/keys.ts`; `window/device.ts` holds the Window's `window.banda` uses | S-M | B4a | — | W0 |
| R1 | Stores and memo | items and calls stores fed by the Watches; memo on `PaneFrame`, `Strip`, widgets; stable action context and Tile handles | M | B4a | — | workspace p95 < 6 ms |
| B4c | Here | `useHere`; replaces `WindowApi.focused/sight` (`sight` stays for the notifications part, counted, until E9), `WidgetProps.project`, `threadShown`; the menu's `Here` is renamed `MenuAt` | S-M | R1 | — | B4d, B4f, W0 |
| **Wave 3: performance nobody sees** | | | | | | |
| P1 | Idle | the Mark, the page follow, the overview, terminals on one clock | S-M | P0 | — | quiet rAF = 0 |
| P2 | Tile states | `tileOf`, `useTile`, `setVisible`, the page box, `useLive` holds; predicted states; containment | M | P0, B4a, C1c | — | hidden draws = 0 |
| P3 | Resize gate | one `ResizeObserver` per Tile, policy "every frame" | S | P2 | — | P7 |
| P4 | Terminal Canvas2D | scrollbar, typed snapshot, blit scroll | M | P2 | — | printing −50%: not met, see below |
| **Wave 4: Threads leave the Window; the Tiling names no App** | | | | | | |
| B4d | Thread verbs | item actions replace `Listing`; §6.4; `askDetails` becomes Threads' action `agents.thread.details` | M | B4c | — | B4e, B4i |
| B4e | The sidebar list | its twenty props, fourteen of them functions (`client/web/src/sidebar/Sidebar.tsx:93-140`), become store reads, item actions and `projects.*` actions for a Project's verbs (`onPin`, `onLocate`, `onProjectSettings`, `onAddProject`); `flow.pick` | M | B4d | — | W4 |
| B4f | Widgets | `OwnProps` goes; `useHere`, `useRun`, `compact`; `workspaces.list` and `workspaces.aside` become the Tiling's widgets; one `order()` for the sidebar list, the counts and Alt+U | S-M | B4c, B4e, C1b | — | phone header |
| B4g | `pane.pick` | one way to go to an Agent, answered by the Window | S | B4a | — | W4 |
| B4i | Header Slot | `pane.header`, `thread.details`; `ThreadMark` leaves the Tiling | S-M | B4d | — | T-a |
| T-a | No `Listed` | Solo asks for an owner; plates by `useMark(owner)` (`Strip.tsx:99-119`, `client/web/src/bar/Map.tsx:24-38`); `pane.header` gives no `listed` (#943) | M | R1, B4i | — | T-b |
| T-b | Solo is a view | `released`; no `fill` on focus; layout takes `filled`; `workspaces.tidy` only from the device in front (`Shell.tsx:340-347`); `tiling/flow.ts` | S-M | T-a, E6 | — | two devices at once |
| B4h | Actions by owner | the tiling's actions to `platform/workspaces/window.json`, and `client/web/window.json` keeps the Window's own (ADR 0071 d2); device-only actions hide without their capability; the Window ≤ 400 lines | S-M | B4d, T-b | — | web client |
| **Wave 5: items and marks (with M4)** | | | | | | |
| B7a | Item | `Listed` splits into the Item (with `news`) and the owner's extras; nobody reads `lists()` | M | B4e, T-a | — | E8b |
| E8a | Marks store | archived, seen (by `news`), looked at; localStorage until E8. _ADR 0096: a Thread's archived and seen come from its host (its step 2b)_ | S | B4e | — | E8b |
| E8b | Inbox from the host | the Watches go; the stores follow `calls.inbox` and `item@1` | M | E8 host, B7a, E8a | — | phone Inbox, push |
| B8c | Intents | the Pane openings and action runs of §5.3; handles for module globals | M | B8 host | — | M6 |
| **Wave 6: a key is drawn at once** | | | | | | |
| T-ids | Client ids | creating intents carry their ids | M | — | — | T-pred |
| T-par | Parity | Rust golden traces through the TS model | S-M | T-ids | — | T-pred, T1 |
| T-pred | Prediction | draw at once; FIFO with a CommandId; reconcile by `at` | M | T-par, A8, B4a | — | `--latency 150` gate |
| T1 | WASM | a leaf crate `platform/workspaces/model`; the TS model and planners (`arrange.ts:343-524`) deleted | L | T-pred, B8 | — | T2 |
| T2 | Overlay | an hour and 200 changes, "not yet saved" | M | T1, A8 | — | a sleeping home |
| **Wave 7: one core, the SDK packages** | | | | | | |
| W0 | `client/core` | the device port's words; Here; the store read by selector; the hosts store; the bridge table to `client/desktop` (narrowed on 2026-11-09, ADR 0089 d1: W0a1, W0a2, W0b) | M | B4b, B4c | — | W1, H5 |
| L3 | `@banda/ui` splits | vision L3 | M + L move | B4i, B7a | — | Level 1 |
| **Wave 8: motion you see** | | | | | | |
| P5 | `clip-path` trace | is it composited in Electron? | S | P0 | — | P6 |
| P6 | Width mockup | A, B, C and the drag rate, in Electron, busy main thread | S-M | P5 | ◆ | P7 |
| P7 | Width | as picked; 0 layouts per moving frame | M | P6, P3 | ◆ | — |
| P8 | Working plates | layers on the compositor | S-M | P0 | ◆ | — |
| P9 | Motion driver | springs into `element.animate` for moves that write every tick | M | P7 | frame by frame | P10 |
| P10 | Overview | fixed stacks, scale; Quick Look by scale | M | P9 | ◆ | — |
| P11 | WebGL2 | only if P4 misses | M-L | P4 | — | — |
| **Wave 9: web and phone (M8)** | | | | | | |
| W1–W3 | Web client | vision steps | M each | W0, E1, E3–E5, H5 | — | W4 |
| W4 | Phone form | §7.5 | M | W1, B4e–B4g | ◆ | M8 |
| **Later** | | | | | | |
| V-s | Level 1 | Widgets and Panes as Trees; `app.toml` sections; `when` as data; App Panels; phone fields; the skill topic `apps` ships | — | V2, V4 | — | Apps from elsewhere |

**P4, as it landed (2026-11-08).** In the printing phase at a scale of 1, one ABBA pair against main measured the main thread's Task time 28% lower (266 → 193 ms/s), its Script 44% lower (118 → 66 ms/s) and the on-screen terminal's canvas calls 95% lower (3992 → 198 a second); the implementer's two pairs, on an older main, had −22%, −35% and −95%. The −50% gate is not met. What is left is mostly a new terminal's scrollbar, laid out again on every printed line until its thumb reaches its floor (#793), the canvas's own commit each frame, and every row read again after each scroll (#794). At 1.6, Roma's scale, and at every scale but 1 and 2, the renderer draws as T3's did, since there T3's rounding differs from row to row and moved rows would not be main's pixels: only the scrollbar and the snapshot win there (Task −8%, Script −14%). Drawing rows in screen pixels would win there too, and changes pixels, so it waits for Roma (#787). P11 stays only if needed: WebGL2 would not remove the scrollbar's DOM cost.

**B4d, as it landed (2026-11-08).** Item actions replace `Listing`: rename, suggest a title, previous title, Mark as unread or read, Make a Project from it, snooze and wake are Threads' (`apps/agents/pane/src/list/items.ts`), Archive the sidebar list's (`client/web/src/sidebar/items.ts`), and the Thread menu, the Pane menu and the Banda menu's Tab draw their rows and run them by id. The Window no longer calls `agents.snooze` or `agents.wake` (the Projects settings' `agents.threads` stays, counted); `askDetails` is Threads' `agents.thread.details{part}`, Git's run of it counted; the woke note is the calls part's (`client/web/src/calls/woke.ts`); the Drawer's New Thread is `thread.new{place: "drawer"}`. On another machine's Pane an item action acts on an Item of that host's alone (#797). Left as §6.4 does not have it, each an issue: the Banda menu's Thread rows stay the Window's (#847); the picker stays a platform part (#848); Mark as unread stays Threads' until E8a (#849); the woke note's owner (#850); an unplaced scratch Thread elsewhere does nothing (#851). Counted until they go: the title field's store Threads writes (#861), the Window finding item actions by `does` (#862), the picker's and Make a Project's module stores (#863). Nothing the Person sees changed.

**B4i, as it landed (2026-11-08).** The two v1 Slots are `@banda/ui/slots`: a module's `slots` lists what it puts in each, `{id, slot, Fill}`, drawn in the modules' order, the Window's own first. The Window gives what the modules that run put in each (`Slots`, in `App.tsx` and the popped-out window, as it gives the previewers), and each Slot's owner reads its own in one place (`useSlot`). `thread.details` takes the place of `Module.threadDetails`: Git's rows are its `git.branch`, and Threads' card reads it. `pane.header` is drawn by `client/web/src/tiling/PaneSlot.tsx` in a Pane's header, at its start (the icon's place of a Pane that shows an Item) and after its Project, and on its tile's label in the Overview. Threads fills it with a Thread's Mark (`apps/agents/pane/src/list/header.tsx`); the Window fills it with another machine's name and icon (`client/web/src/window/named.tsx`), as no App owns the machines. The Tiling imports no `ThreadMark`, and reads an Item's Mark only for its plates (`Strip.tsx`, which T-a takes); a Deck's segment still draws the mark of a Thread that calls (`Tabs.tsx`, #942). It still reads `Listed` to put an Item's Project before its title and the Thread menu on it, and hands it to what fills `pane.header` (T-a, B7a; #943). Nothing the Person sees changed.

**B4e, as it landed (2026-11-08).** The Sidebar takes eight props, two of them functions, where it took seventeen, twelve of them functions: what it shows (`engine`, `projects`, `home`, `machine`), how its area stands (`over`, `onDismiss`, `hiding`) and `isCurrent`. The rest it runs by id with `useRun` (`client/ui/src/hooks/use-run.ts`, here and not with B4f, #906; the Thread menus and the machine label take it too, and `Bell.tsx` and `LimitsWidget.tsx` keep `window.run` until B4f): `pane.pick` for a row, `thread.new` for a New Thread, or `projects.locate` first for a Project whose folder is missing, `menu.at` for the Search and the key sheet's button, `settings.open`, `project.add`, and `projects.pin`, `projects.locate` and `projects.settings` for a Project's menu, each an unlisted Window action in `client/web/window.json`. The Window's `projects.locate` is the Person's Locate: it asks in the menu, which sends the engine's command of that name with the folder. `project.add` and `project.make` keep their ids, as a keys.toml may bind them; whether they join `projects.*`, with a grace for the old ids, is B4h's to decide. The Flow menu runs `flow.pick{flow}`, a Window action beside `flow.solo` that writes `agents.toml` for both. What stays a prop, and why: `over`, `hiding` and `onDismiss` are the Window's state of the area, and the Sidebar over the Strip lets itself go through a context as it opens a Pane or a menu; `isCurrent` says a row's Pane has the focus by all its args, as before, so nothing the Person sees changes: `Here.pane` already says what the Pane in focus shows (`showsOf`), and reading it there fixes #827 in its own PR, as it marks a row that is not marked today. Inside, what stays is the list's own folding and filter, a Project's menu around its row, and the trust card the Sidebar anchors by a row (ADR 0083, decision 5; #947). Row opens its own Pane, and "Make a Project" moved to `titles/`, beside the Thread menu that opens it. A pin goes to this machine's engine as before (#860). The one indirection of §4.4 waits for a second list: the Window names `Sidebar`. ADR 0096's step 2b follows B4e, in files it touched (`titles/ThreadMenu.tsx`, `sidebar/Sidebar.tsx`, `window/Shell.tsx`, `sidebar/items.ts`); seen and archive are read and kept as before. Held by checks: the sidebar list joins the App-strings ratchet (`open.ts` says `thread.new` once, `FlowMenu.tsx` reads `AGENTS_FILE` once); `functionProps` lists what the components of `Sidebar.tsx` and `Row.tsx` take as code, with no Project's or Thread's verb; the sidebar list pins no Project and writes no `agents.toml`; only the Window gives `run`. The Window's root is at 1005 lines. Nothing the Person sees changed.

**B4f, as it landed (2026-11-09).** Every widget on the Bar is given `{engine, projects}`, the window's own as a module's: `OwnProps` and `WidgetProps.window` are gone. The counts are the sidebar list's widget (`client/web/src/sidebar/Counts.tsx`), listed by the window's own module beside the Tiling's: they read `here.sidebar` and the thing the Pane in focus shows by selectors that keep a word each, so a move of the focus draws them only as that thing changes, as the `ahead` prop did, and a row of their list runs `pane.pick`. The bell, the limits and the servers act by `useRun` (the servers' `browser.open` stays a counted borders.3 case). The limits' look is an unlisted action, `harnesses.limits.look`, in `platform/harnesses/window.json`; as an action answers no caller, the widget hears a refused write through a store of its module's own (`platform/harnesses/pane/src/look.ts`), which the module-stores ratchet does not scan yet (#1020). `workspaces.list` (the numbers and the Group map) and `workspaces.aside` are the Tiling's widgets (`client/web/src/tiling/widgets.tsx`; their ids in `widget-ids.ts`, so placing the Bar's parts reads them without drawing any): the Window hands them, around its Bar (`TilingBar`), the workspaces, what the Apps list of their Panes and the Tiling's change, and the aside apart, so a key that moves the workspaces draws the pill not. A number on another workspace goes there by the Tiling's change, not by `workspace.go-N`, which stops at nine. That hand-off is a privileged path still: #1023 gives the two widgets the Tiling's store by selector and an action for the number. The Mark, update, look problems and the connection stay the Bar's own. `compact` is on the contract and on the counts, the workspaces and the pill, as no action brings the workspaces back; nothing reads it until W4, where the bell and the servers need an action (#1000). One `order()` (`client/web/src/sidebar/order.ts`) orders the sidebar list, the counts list and Alt+U: `keysOf` gives its keys, and `byOrder` places what the counts and Alt+U list, each with its own tie. The one difference left, another machine's Threads, which the sidebar list places among this machine's and the other two after them, stays a parameter (`elsewhere`) and #999. The `client-pane` and `client-widget` marks of borders.1 wait for an engine step (#1001). Held by checks: no page code names `OwnProps`, and `WidgetProps` holds `engine` and `projects` (a widget that took `window.run` no longer type-checks); the registry memoizes the counts and the Tiling's widgets as a module's; only the Window gives `TilingBar`; only `order.ts` takes `arrange`, and the counts and Alt+U order by `byOrder` and sort nothing themselves; the counts take no code as props; the Tiling's marks list counts the numbers' `useCalling`; the widgets marked `compact` are listed. The Window's root is at 967 lines. Nothing the Person sees changed.

**W0a1, as it landed (2026-11-09).** W0 is narrowed (ADR 0089, decision 1): `client/core` brings Here, the store read by selector, what an action runs with and the device port's words, and the hosts store at W0a2; the items and calls stores wait for B7a and E8b, the action matcher for W1, and no marks store is made (ADR 0096). W0 lands as three PRs: W0a1, then W0a2 once the other session's PR 4 is in (their #998 and #985 merged on 2026-11-09), then W0b (#1010). W0a1 makes `@banda/core`, whose `"."` holds the store (`client/core/src/store.ts`), Here (`here.ts`), `KeptHere` (`kept-here.ts`, cut from the Window's `here.tsx`, where `hereOf`, `useKeptHere` and `Kept` stay), `Args` and `Run` (`run.ts`), `PaneState` and `Place` (`pane.ts`, which `PoppedAsk` needs) and the words the page and main share (`device.ts`: `HostState`, `HostEntry`, `HostTest`, `PoppedAsk`, `Update`, `Note`, `poppedRoute`, `poppedOf`, `follow`). `@banda/core/react` re-exports it whole with the hooks and contexts (`useSelected`, `useStore`, `HereContext`, `useHere`, `RunContext`, `useRun`), and only it imports React, a peer. Its tsconfig takes the WebWorker lib, so `window`, `document` and `localStorage` do not type check there, and a lint block keeps the device's globals, `react-dom`, Electron, Node, the kit, the page, the desktop and the Apps out. The bridge's table, `BRIDGE` with `Host`, is `client/desktop/src/bridge.ts` (`@banda/desktop/bridge`): main and the preload no longer import the page, `client/desktop` depends on the modules' packages for their parts instead of on `@banda/web`, and the page takes only the type `Host`. The device object stays the page's, in `client/web/src/boot/desktop.ts`, which its callers reach through `boot/index.ts` (`device`, `ELSEWHERE`); its `Device` interface waits for W1's browser adapter. Each old path stays, only re-exporting, so the other session's open PRs keep building: `client/ui/src/lib/store.ts`, `client/ui/src/here.ts`, `client/ui/src/hooks/use-run.ts`, `client/web/src/host.ts` (all it had but `BRIDGE`, taking only types of the desktop) and `client/web/src/window/device.ts`; only the files W0a1 had to touch import from the new paths. W0a2 moves `calls/hosts.ts` and `use-machines.ts` into the core, points every importer at the new paths, removes the re-exports and hands `KeptHosts` the names memory as `new KeptHosts(device.hosts, {seen, follow})`. The page's build dedupes React; it holds one, as before, and Electron main and the preload take none of the core but `device.ts`. Held by checks: the core imports only itself, the contract and, in its bindings, React; it reads no device; it names no App; it keeps no `let`, and no instance, array or object at a module's top level but the constants listed; only the Window's `here.tsx` makes a `KeptHere`; only `boot/index.ts` takes in `boot/desktop.ts`; the desktop (`src`, `e2e`, `trials`) imports nothing of the page, by `@banda/web` or by a relative path; the page takes `@banda/desktop` only by `import type`, in six files, a list that only falls; the old paths are listed, and W0a2 empties the list; `@banda/ui`'s lasting re-exports of the core (`Args`, `PaneState`, `Place`, until L3) are listed, a list that only falls; and the ratchets that named the moved files follow them (the Tiling's imports and the App strings see `boot/`, the module stores and the page's code take in the core). A test gives the Window's `Kept` and reads its run and Here as an App's package imports them (`one-core.test.tsx`). Nothing the Person sees changed.

**W0a2, as it landed (2026-11-09).** The hosts store joins the core. `client/web/src/calls/hosts.ts` is `client/core/src/hosts.ts`, its tests beside it (`hosts.test.ts`, `away-for.test.ts`), and `client/ui/src/hooks/use-machines.ts` is `client/core/src/react/machines.ts`; the first commit only moves them, and does not build alone. The React half of the hosts is `client/core/src/react/hosts.ts`: `HostsContext`, `useHostsBy`, `useHosts`, `Reach` and `useReach`, `useNamedOf`, `useEngineOf`, `useShownNow`, `usePaneOn`, `useOurs` and `useMachinesOf`; `machines.ts` keeps `MachinesContext` and `useMachines`, and the type `Machine` stands beside `machinesOf` in `hosts.ts`. The core imports no kit: `paneHost` and `withHost` join `pane.ts`, `shownProjects` and `openProjects` are `client/core/src/projects.ts`, and `@banda/ui` names them again from `pane.ts` and `lib/projects.ts`, listed with the rest it names of the core until L3, while their tests stand beside them in the core; `useOurs` takes a read of this machine's Projects of its own shape, not the kit's `Read`. The names this device remembers of each host stay the kit's (`seenNamed`, `followNamed`, ADR 0081, decision 1): the Window hands them to the store as it makes it, `new KeptHosts(device.hosts, { seen: seenNamed, follow: followNamed })`, in `App.tsx` and in a popped-out Pane's window (`main.tsx`), and `KeptHosts.seen(key)` is what `useNamedOf` reads; `namedIn(hosts, host, seen)` and `reachWords(host, shown, seen)` take that memory last (the sidebar, the Banda menu, a Pane's frame and the machine label pass `seenNamed`), and `shownOf(was, now, at)` keeps its signature, by the host's key (`keyNamed`) where no memory is given, so a new caller in the Window passes `seenNamed`. Where no Window gives the hosts, `HostsContext`'s default has none and remembers no name. Every importer takes the new paths, the Window `@banda/core` or `@banda/core/react`, and an App or a platform part only `@banda/core/react` (Threads' New Thread and list, the terminal's servers, the harnesses' limits and look, the notifications' bell and teller), whose four packages now depend on `@banda/core`. The five paths W0a1 kept only re-exporting are gone: `client/ui/src/lib/store.ts`, `client/ui/src/here.ts` with its `./here` export, `client/ui/src/hooks/use-run.ts`, `client/web/src/host.ts` and `client/web/src/window/device.ts`. Held by checks: none of the seven paths the core or the bridge left stands, and no file of the kit or the page only re-exports what moved; the core's top-level constants are listed with the contexts' defaults made there (the hosts store's three constants, Here's `NOWHERE` and `HereContext`, the hosts' `NOWHERE`, `FORGETTING` and `HostsContext`), a list that falls with what goes, and an instance a call takes counts as made there; only the Window makes a `KeptHosts` (its root and a popped-out Pane's window; the core's default aside) and gives `HostsContext`, and only its root gives `MachinesContext` (a popped-out Pane gets them with W0b, #1010); an App or a platform part takes the core only from `@banda/core/react`, and each App's Pane test lets it (which of the hosts' names an App takes there is not held yet, #1041); the pick's ratchet reads the core too, where the hosts store places a pick on its host; the page takes `@banda/desktop` by type in five files. A test reads a New Thread's machines as Threads' package imports them, under the Window's `MachinesContext` (`one-core.test.tsx`), and one gives the store the kit's memory as the Window does (`client/web/src/names.test.ts`). The page's build holds one React and each core module in one chunk; Electron main takes only `device.ts` of the core, and the preload none. Nothing the Person sees changed.

**W0b, as it landed (2026-11-09, #1010).** A popped-out Pane's window knows the window's machines. The wrapper that gives them, `Machines`, leaves `App.tsx` for `client/web/src/window/machines.tsx`, so the popped window's chunk takes in neither `App.tsx` nor `Shell.tsx`; `Popped.tsx` tells its `KeptHosts` this machine's Projects and Host scope (`useOurs(hosts, listed, machine)`) and gives its Pane the machines through it. As it draws no sidebar, no Watches list the hosts' Projects there: `Listed`, beside the wrapper, lists each live host's, by the hook the sidebar's Watches take now too (`useListedOn`). And `machinesOf` no longer repeats the clash rule: `KeptHosts.#placed` is its one place, and places each host's Host scope's ID too (`Shown.machine`), which `machinesOf` reads. The rule kept is `#placed`'s, which `hostOfPane` routes by: this machine has every ID it knows, archived, missing and scratch Projects and its Host scope; a host after it, those it shows. The looser one, this machine's open Projects only, would have offered another machine's Project of an ID this machine has archived or missing, which a pick opens here. What the Person sees change: the popped Pane's picker lists this machine's Projects, then each other machine's under its label, where it listed its own engine's alone; and another machine's No Project of an ID this machine has (a copy of its Banda, or an entry for this machine itself) is no longer offered, in the window or a popped one, nor named again by its Pane's engine (`groupsOf`). Held by checks: only `window/machines.tsx` gives `MachinesContext`, and `App.tsx` and `Popped.tsx` take it as `<Machines>`; what `Popped.tsx` takes in, file by file, reaches neither `App.tsx` nor `Shell.tsx`; the core's tests place an ID on the first machine that has it, in the rows and the machines alike; `hosts.spec.ts` picks from a popped-out arc Pane.

**Parallel tracks.** Wave 1 needs nothing. Wave 3 runs beside Wave 4. T-ids and T-par need nothing from Wave 4. Wave 5 and B8c wait for host steps.

## 10. Where this sits on the roadmap

The vision's milestones (§10) stay. This plan puts the client's steps on them.

| Milestone (vision §10) | State | The client steps with it |
|---|---|---|
| M0 ground cleared, M1 the engine is the machine's | R0 and S3 merged | D0 can land now; Wave 1 needs nothing |
| M2 fenced Agents (the host track, now) | in progress | Waves 1–3, B4a–B4c, R1: client-only, after D0 |
| M3 a hardened kernel (A1–A9) | — | T-pred needs A8 |
| M4 calls on the host (E8, E9) | — | Wave 5: B7a, E8a, then E8b after the host's projection |
| M5 a host that may be elsewhere (E1, E3–E6, E11) | — | W0 and the device port; T-b with E6; the bridge table leaves the page |
| M6 borders (B1–B16, T1–T2) | — | Wave 4, B8c, Wave 6 |
| M7 the look | — | the kit's tokens; P8's plates |
| M8 the web client (H1–H5, W1–W3) | — | W1–W3 with the host track; W4, the phone form |
| M9 several hosts (H6, H9) | — | stores already keyed by host; the merged Inbox and sidebar list |
| M10 first SDK views (V1–V3) | — | V-s: Widgets and Panes as Trees; phone fields |
| M11 tracer App (V4) | — | the guidelines tested by an Agent writing an App; the skill topic `apps` ships |

**Two tracks** (agreed on 2026-11-07). The **client track**, this plan: T1 and T2 end to end, the `Shell.tsx` split, the client half of the B-steps, the client side of E8 and E9, motion, visibility, the terminal renderer, the `@banda/ui` split, `client/core`, the guidelines. The **host track**, the vision's host steps: S3, F0, E1, E3–E6, the host half of the B-steps, the host half of E8 and E9.

**The first PRs after D0,** in order: C0, P0, C1a, B4a, R1, B4c, P1, P2. Each is measured with motion.spec, and none changes what the Person sees except C1a's fix.

## 11. Decisions for Roma

Each decision names its ADR. The recommendation comes first.

1. **The words** (ADR 0087).
   - Recommended: **Window**, **Here**, **Top layer**, **Area**, with no umbrella word for what Apps show, and Desk still avoided.
   - Options: Shell (ADR 0062 d2's word; the terminal's in the GLOSSARY); Focus (taken three times over); Float (new); Surface or Contribution as an umbrella word; Desk for the middle (collides with Roma's «стол»).
2. **Threads and the sidebar** (ADR 0087).
   - Recommended: **two programs.** Threads is an App; the sidebar list and the Inbox are platform parts reading `item@1` and `call@1`; `pane.pick` goes to an Agent. It amends ADR 0005 d8 (the sidebar is no longer "its own module") and the wording of ADR 0062 d2; ADR 0082 stands as it is.
   - Option: one Agents App owning the Sidebar's list; it amends ADR 0082 d6 and d15 instead.
3. **The sidebar part's name** (ADR 0087).
   - Recommended: **the sidebar list** (in code, `platform/sidebar`); Inbox stays the merged Calls.
   - Option: Inbox, with the `inbox` preset renamed under ADR 0069's grace.
4. **Solo and the Flow** (ADR 0087).
   - Recommended: Solo becomes each client's view; Alt+M inside Solo releases the Group until the focus leaves it; only an Agent's Group fills (one that some Item names as its owner); `flow` stays one setting, the Person's, kept on the home host where the model places, read through one accessor, and it moves to the Tiling's settings with T0.
   - Option: keep Solo writing `fill` on focus moves (today), which fights across devices.
5. **Done toasts for Agents out of sight** (ADR 0087, amends ADR 0011 d1).
   - Recommended: yes. On screen means half a Tile shows; in Solo, only the filled Group. Ship early, then a short trial.
   - Option: keep "on screen" as "on the current workspace".
6. **The counts list's order** (ADR 0087, amends ADR 0035 d3).
   - Recommended: the sidebar's order, one order everywhere (ADR 0065 d9).
   - Option: loudest first, as today.
7. **The phone in v1** (ADR 0089, amends ADR 0062 d13).
   - Recommended: the sidebar list as home, Thread screens with Next, New Thread asks for the Project, no Tiling, and the phone never writes the arrangement.
   - Option: a Thread screen with its Group as read-only tabs; it needs Panes that work on a phone (M10).
8. **The column width** (ADR 0088, amends ADR 0007 d9).
   - Recommended: decide after the `clip-path` trace and a mockup inside Electron with a busy main thread; **C** unless `clip-path` is composited.
   - Options: B (niri, the final size at once, a three-part plate); A (today).
9. **Working Group plates** (ADR 0088, amends how ADR 0065 d6 is drawn).
   - Recommended: measure, then rebuild the breath and the sheen as layers on the compositor, through a mockup.
   - Option: keep them as they are and allow the paints.
10. **Prediction before WASM** (ADR 0088, refines ADR 0062 d17's order).
    - Recommended: client-minted ids and the TS model's prediction now, behind a parity test; WASM later deletes the TS model.
    - Option: wait for T1 before any prediction.
11. **The desktop's device session** (ADR 0089).
    - Recommended: stays in Electron main; the PWA's in its page.
    - Option: the page's core on every client.
12. **How much to build for Apps from elsewhere now** (ADR 0087).
    - Recommended: nothing manifest-first. `defineModule` stays the source and the generated `window.json` grows; `[[widgets]]`, `[[panels]]`, `when` as data and new Slots wait for V2 and the tracer App.
    - Option: hand-written `app.toml` sections now.
13. **How many ADRs now** (all three).
    - Recommended: accept all three together. ADR 0089's decisions shape no PR before W0 except the ratchet on `window.banda`, but ADR 0087 d2 (the forms) and the GLOSSARY (Client, Area, the Bar's phone line) cite it.
    - Option: accept 0087 and 0088 now and 0089 when W0 starts; then the GLOSSARY's lines from 0089 and ADR 0087's mention of the forms wait for it.

## 12. Risks

| Risk | Why it may happen | What limits it |
|---|---|---|
| The split changes Roma's day by accident | B4d–B4f and T-b move snooze, Alt+U, Solo and the counts; `window.spec.ts` covers none of Solo, Flow or a ten-Agent Row | C0 first; screenshot e2e; the "what the Person sees" table (§6.7) |
| The change queue breaks on the move | its rule is "each change worked out from what the last one drew" (`Shell.tsx:436-437`) | moved verbatim in B4a; the key-burst e2e in C0; replaced only by T-pred |
| Prediction jumps | the TS and Rust models differ, and no test compares them | T-par before T-pred; client-minted ids |
| Hidden Tiles show blank or late | `IntersectionObserver` reports after layout, a frame late | states predicted at a move's start; retained bitmaps while moving |
| `clip-path` is not composited | unverified in Electron | the trace before the mockup; variant C stays on the compositor without it |
| The overview looks different on the compositor | text rasterised at the start of a scale is soft mid-zoom; landing re-rasters every workspace | behind a mockup (P10); measured on the real display |
| Timing gates flake on CI | headless runners vary | hard gates are counts; timings stay soft until variance is known |
| Too many words and steps | about 40 PRs; three ADRs | nine new words; mockups only where pixels change; Level 1 machinery deferred to its trigger |
| Two tracks edit the same files | the host track works in `client/desktop` (the bridge's table, `bridge.ts`, among it), `client/core/src/device.ts` and the E-steps | the split into two tracks (§10); a PR that overlaps names the files and the other track's step |
| The new sidebar redesigns the list later | ADR 0079 left it out of scope | this plan changes nothing in what the sidebar list shows; the list stands behind one indirection |
