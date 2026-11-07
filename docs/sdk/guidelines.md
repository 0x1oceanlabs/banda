# Writing for Banda: rules for Apps and platform parts

_Proposed with ADR 0087, ADR 0088 and ADR 0089 on 2026-11-07. It holds
once they are accepted; until then it is a draft. Its digest for Agents is
drafted in `docs/sdk/skill-apps.md`, and becomes the Banda skill's topic
`apps` once an App from elsewhere can be installed (V4); a change to a
rule changes both in one PR._

**Who it is for.** Anyone, Person or Agent, who writes a Banda App, adds
something to the Window, or writes a platform part.

**How to read it.**

- Each rule has an id, such as `borders.3`, so a review, a test or an
  allowlist line can name it.
- **Check** says what holds the rule: `today` (a check that runs now),
  `planned` (a check a named step adds), or `review` (no machine check
  yet).
- **When:** a rule binds new code from the day the ADRs are accepted,
  unless it says *After* a step: then it binds once that step has built
  what it needs, and until then the rule's *Until* says what to do.
  Today's cases are counted (borders.10) and only fall.
- Where this page and an accepted ADR disagree, the ADR wins until it is
  amended.
- Code is cited as `path:line` from main at `ed293406`. Step ids are the
  research's §9 (`docs/research/2026-11-07-client-architecture.md`).

---

## 0. The shape on one page

```
            device input (keys · pointer · touch)
                       │
             ┌─────────▼────────────┐   Here: this Window's one record of where the Person is
             │ Window (per client)  │───────────────┬───────────────┐
             │ areas · Here · keys  │               ▼               ▼
             │ device port          │            Widgets        actions you run
             └┬───────┬──────┬──────┘
         Bar  │ Sidebar│     middle ──► Tiling («композер»): arrangement, Tiles, motion ──► Panes
              │        │                Top layer: Banda menu · launcher · Drawer · Quick Look · dialogs · toasts
   An App gives:   Actions · Panes · Widgets · Items (item@1, Slots) · call@1 · facts · intent handlers
   An App reads:   its args · Here (in a Widget) · its own data (query / follow)
   An App acts by: a command · its own or the platform's action id · an intent
```

There are five channels, as ADR 0087 d5 has them, and no sixth:

| Unix | Banda | Rule |
|---|---|---|
| `$PWD`, the environment | **Here** | read-only; by selector now (`useHere`), as declared args for a Tree Widget at V2; never fetched from a global |
| `read(2)`, inotify | **Data**: query and follow a host; the items, calls and marks stores | the only source of data |
| argv, exit status, `xdg-open` | **Acts**: a command to your host part (with a receipt); an action id, your own or the Window's, the Tiling's or a platform part's; an intent for another App | the only way to change anything |
| a column a file manager asks a provider for | **Slots**: Items you put in another App's thing | the only way to add to another App's thing |
| syslog | **Facts**, published by one host part and heard by another | the only way host parts hear each other |

What Apps give never talk to each other.

---

## 1. Borders

- **borders.1 An App's code runs on its host.** Its logic, data and views
  live in its host part; the client draws its Trees with the catalogue
  (ADR 0062 d7). Client code is allowed only for first-party live
  components. A Pane or Widget still written in client React carries an
  `[unstable] client-pane` or `client-widget` mark in its manifest, and
  that count only falls. *After* B4f for the two marks. *Check:* today,
  the mark ceiling (`engine/src/modules.rs:32`); planned, the two new
  marks (B4f).
- **borders.2 Own your data.** A module's name prefixes its methods,
  events and tables; it writes only its own tables and reads no other
  module's (`kernel/src/module.rs:33-37`). *Check:* the kernel's SQLite
  authorizer refuses a module's SQL any table outside its prefixes, the
  kernel's included (`kernel/src/tables.rs`, A4), and no module's code
  names the kernel's tables (`kernel/tests/architecture.rs:69-83`).
- **borders.3 Reach another App only by names it publishes.** Published
  facts you list in `listens`, published queries you list in `calls`, and
  intents (ADR 0082 d2, d7). Never call another App's method by its
  string, never run another App's action by its id, and never open
  another App's Pane by its kind and its private args. Your own actions,
  and those of the Window, the Tiling and the platform (`pane.pick`,
  `sidebar.toggle`, `harnesses.usage`), you run by id; calls to the
  platform (`projects.*`, `harnesses.*`, `problems.*`) are fine. The
  Person's keys, menus and the CLI may run any action; your code may not.
  *After* B8 for intents. *Until* then, a new cross-App act is a counted
  case. *Today's cases:* `agents.threads` and `agents.changes` from Files
  and Git (`apps/files/pane/src/live.ts:24`, `:84`;
  `apps/git/pane/src/read.ts:160`); `terminal.terminal` from Threads
  (`apps/agents/pane/src/SignIn.tsx:220`); `browser.open` from the
  terminal (`apps/terminal/pane/src/Servers.tsx:120`). *Check:* planned
  (the borders test; the registry refuses an undeclared listen).
- **borders.4 Import no other App, and none of its contract types.** A
  Pane imports only the contract, the kit, React and lucide
  (`apps/git/pane/src/architecture.test.ts:11-17`, which still lets Git
  import Threads' contract at `:12`). Name another App's things by
  Address. *Check:* today (one copy of the test per App); planned (one
  shared test).
- **borders.5 The kernel, the platform, the Window and the Tiling name no
  App.** No App id in their strings, no Thread-shaped type such as
  `Listed` (`client/ui/src/pane.ts:229`). *Check:* today for the kernel
  (`kernel/tests/architecture.rs:38-64`) and for package imports
  (`client/web/src/architecture.test.ts:59-64`); planned, a ratchet on
  strings (B4a).
- **borders.6 Don't reach into the Window.** Keep no `WindowApi` in a
  module variable (`apps/browser/pane/src/threads.ts:22`,
  `apps/git/pane/src/ended.ts:12-21`); use no module global as a channel
  between Apps (`client/ui/src/components/thread-details.tsx:73-90`); take
  no privileged props (`client/web/src/bar/Widgets.tsx:20-40`). The
  Window gives you Here and runs actions; that is all. New code keeps it
  now; the cases named here are counted until B4d, B4f and B8c.
  *Check:* planned.
- **borders.7 Work in one Project at a time.** App code is walled to the
  Project it runs for; only the platform listens across Projects (ADR
  0082 d6). Anything that spans Projects reads `item@1` and `call@1`.
  *Check:* today, the kernel's wall.
- **borders.8 Never place or move Panes.** Ask with `show.*@1`; the home
  host places the Pane and never moves the one the Person is in (ADR 0082
  d7). *After* B8. *Until* then, open a Pane only through your own
  actions and `PaneProps.open`. *Check:* review.
- **borders.9 No client daemons.** No `start()` hook
  (`client/ui/src/module.ts:426`). Work without a view runs on the host,
  as a listener with a cursor. A notice goes through `notice.post@1` or
  `call@1`. New code adds no `start()`; today's are counted until E6, E8
  and B8. *Check:* planned (the contract drops `start`).
- **borders.10 Every exception is counted.** An `[unstable]` mark that
  says why (ADR 0022 d6), or an allowlist line naming the rule id. Both
  counts only fall. A PR that removes a case lowers its ceiling in the
  same PR. *Check:* today.
- **borders.11 A platform part** keeps borders.2 to borders.10. It may
  hold rights no App gets, and it is generic over `item@1`, `call@1` and
  Address. *Check:* as borders.5.

---

## 2. What you give

| Kind | Where it shows | Names a Project | Use it for |
|---|---|---|---|
| **Action** | keys, menus, the Pane header, the Banda menu, the CLI, Agents | through its args | every verb; it comes first |
| **Pane** | a Tile, the Drawer, Quick Look, a window of its own | yes, and its subject | work the Person looks at for minutes |
| **Widget** | the Bar | no; it reads Here | a glance: a state, a count, the current thing |
| **Item** | the sidebar, the Inbox, the bar's Mark, push (`item@1`, `call@1`); another App's Slot | yes | being listed; calling the Person; adding to another App's thing |
| **Item action** | the Thread menu and its kin | the Item's | a verb on your own Items |

- **give.1 Start with an Action.** Anything with a button, a key or a menu
  row is an Action first: an id and a JSON Schema of its args, with no
  closure in what it declares (ADR 0005 d2, ADR 0071 d1). Every Widget's
  click and every way to open a Pane names one, so a phone, or a Person
  who hides that area, still reaches it. *Check:* planned.
- **give.2 Make a Pane when the Person works in it.** It names its
  Project and its subject (`subject` arg, an Address). It looks the same
  on every client: it never reads Here to draw. Its header is data in its
  manifest (ADR 0066 d6). When it leaves every workspace, it hears
  `pane.left@1` on the host instead of a client `closed()`, *after* E6.
  *Check:* review.
- **give.3 Make a Widget only if it says something without a click.** It
  draws nothing while it has nothing to say (ADR 0024 d3). A click runs an
  action through `useRun()` or opens its own popover. Mark it `compact`
  only if it has a form that stays in a narrow Bar and a phone's header.
  Where it stands is the Person's `look.toml [bar]`, never yours (ADR
  0064). *Until* B4f, run the action through `WidgetProps.window.run`.
  *Check:* review.
- **give.4 To be listed or to call the Person, publish `item@1` or
  `call@1`,** in the same transaction as the change behind it (ADR 0082
  d9). Don't ask for a place in the Sidebar: the sidebar list shows
  what you publish. *After* B7 (`item@1`, `call@1`). *Until* E8,
  first-party Apps give a Watch. *Check:* review.
- **give.5 To add to another App's thing, put an Item in its Slot**
  (`thread.details`, `pane.header`). Never draw into another App's Pane.
  *After* B4i. *Until* then, add nothing to another App's Pane.
  *Check:* review.
- **give.6 A verb on your own Items is an item action.** The Thread menu
  lists the owner App's item actions and then the platform's (unread,
  archive). *After* B4d. *Until* then, `Listing` (`client/ui/src/module.ts:288-301`).
  *Check:* review.
- **give.7 A dialog, popover or picker is part of the view that opens
  it,** drawn in the Top layer. It is not something you add to the
  Window. *Check:* review.

---

## 3. Here: the context, like `$PWD`

Every rule here binds *after* B4c, which builds Here. *Until* then, take
context from your args and `PaneProps`, and from `WidgetProps.project` in
a Widget.

```ts
type Here = {
  front: boolean
  sidebar: boolean
  workspace: { id: string; project?: ProjectId } | null
  pane: { id: string; project: ProjectId; subject?: Address } | null
  project: ProjectId          // the Pane's, else the workspace's, else home
}
```

Neither the Pane's kind nor the device's form is in it: branch on
neither (borders.5, device.5).

- **here.1 Context comes only from Here and your own args.** Not from
  globals, module variables, DOM queries or another App's rows (today
  Files reads Threads' rows, `apps/files/pane/src/index.ts:20-29`).
  *Check:* planned.
- **here.2 Read only the fields you need, by selector:**
  `useHere((h) => h.project)`. A Tree Widget will declare them as `reads`
  and get them as args (V2). *Check:* review; planned with V2.
- **here.3 Here is read-only.** Change where the Person is only by an
  action (`pane.pick`, `sidebar.toggle`, `show.*@1`). *Check:* by
  construction.
- **here.4 Here never reaches a host as state,** only as the args of a
  query or a command. Hosts see presence, nothing more (ADR 0082 d12).
  *Check:* review.
- **here.5 A Pane never reads Here to draw,** and its header and Pane
  menu act on its own args (ADR 0066 d6). An act gets Here at its
  gesture: an unset `project` or `pane` arg is filled from the gesture,
  then from Here. *Check:* review.
- **here.6 Don't work out sight or visibility yourself.** The platform
  derives sight; drawing follows the Tile's state (motion.4). *Check:*
  review.

---

## 4. Data

- **data.1 Data comes only from a host:** a query, answered with how
  fresh it is; a follow of facts; or a stream for fast output. In v1 a
  view is read whole again on its facts. *Check:* review.
- **data.2 A write is a command.** It carries a CommandId, gets a receipt
  with `at`, shows as pending until a read at or past `at`, and a refusal
  rolls it back. Long work reports through facts; a command never hangs
  (ADR 0082 d4). *Check:* review.
- **data.3 Publish what others may hear,** in `facts!`, named
  `<app>.<noun>.<past-verb>@<major>`, whose payloads name things by
  Address. Every other fact is your own (ADR 0082 d5). *Check:* today
  (the macro); review for the names.
- **data.4 The client never touches a host's disk.** It reads no path and
  builds no file address from one. Bytes come by a signed URL (ADR 0082
  d13). New code keeps it now; today's reads are counted until E1.
  *Check:* planned (E1).
- **data.5 The Person's data lives on the home host,** as Person
  documents: seen and archived marks, drafts that must follow the Person.
  Device storage holds only conveniences for one device (a folded
  section, a remembered width), wrapped so the page works without it.
  *After* E8. *Until* then, keep the Person's marks behind the marks
  store (E8a), never in your own `localStorage` key. *Check:* planned (an
  allowlist of `localStorage` uses that only falls).
- **data.6 Settings:** list your files in your manifest, read only your
  own, write through `settings.set`, and let Banda draw your section from
  the file's schema. *Check:* review.
- **data.7 A view is pure and bounded:** read-only, nothing kept between
  calls, a tree of at most 30 KB rendered in at most 5 ms at p95 (vision
  §5.7). *Check:* planned (V1).
- **data.8 Show staleness.** Rows from a host that stopped answering dim
  and say "as of"; commands fail at once (ADR 0082). *Check:* review.

---

## 5. Design

- **design.1 Draw only with the catalogue:** shadcn's components and
  Banda's own. A new component goes into the catalogue, and only when it
  needs every frame or a fast stream and two Apps use it, or it is a
  first-party live component (vision §5.2). *Check:* today for imports
  (borders.4); review for the rest.
- **design.2 Props carry no colours and no functions** in a Tree.
  `className` takes layout utilities only; colour comes through variants.
  *Check:* planned (the Tree schema refuses them).
- **design.3 Colour means state, one meaning per colour:** `--attention`
  waits for the Person, `--destructive` is a failure, `--warning` a limit
  coming near, `--added` and `--removed` are line counts (ADR 0058, ADR
  0024). An App never picks a hue to decorate or brand. *Check:* review.
- **design.4 Tokens only,** from the look (ADR 0080 d7): no hex, rgb,
  oklch or `color-mix` in App code. *Check:* planned (a lint).
- **design.5 The Bar draws text and small icons,** no boxes or pills
  (ADR 0024 d2), and is quiet while nothing happens. *Check:* review.
- **design.6 Banda draws the Pane header** from your manifest, and Banda's
  buttons end it (ADR 0066 d1, d6). Draw no title bar of your own.
  *Check:* review.
- **design.7 Menus are Banda's,** each row an action shown with its key
  (ADR 0063 d3, ADR 0066 d3). *Check:* review.
- **design.8 In Banda's own repository, a visible change to the Window
  goes to the maintainers as a before and after mockup first.** An App
  from elsewhere shows its Person instead. *Check:* practice.

---

## 6. Motion and performance

| Measure | Budget |
|---|---|
| a frame at 120 Hz | 8.3 ms |
| main thread per moving frame, p95 | ≤ 4 ms |
| a task during a move that only translates | none over 8.3 ms |
| layouts per moving frame, a move that only translates | 0 |
| layouts per moving frame, a column's width | 0 after P7, if the width pick is B or C (ADR 0088 d5) |
| animation frames a second while quiet | 0 |
| draws by a hidden Pane | 0 |
| a key to its frame, p95, also at `--latency 150` | ≤ 16 ms |
| a Tree | render ≤ 5 ms at p95, ≤ 30 KB |

These are ADR 0088's. The hard ones (counts) gate in `motion.spec.ts`;
timings gate softly once CI's variance is known.

- **motion.1 Animate only `transform`, `translate`, `scale` and
  `opacity`.** Never width, height, left, top or a scroll offset per
  frame, CSS transitions included. *Check:* planned (a ratchet on
  `transition-[width|height|left|top]` and `transition-all`).
- **motion.2 Never read layout in a tick that writes it.** Read
  `offset*`, `getBoundingClientRect` and `getComputedStyle` when a move
  starts or settles, or in the clock's read phase (`afterMoves`).
  *Check:* planned (motion.spec counts reads inside moves).
- **motion.3 No animation-frame loop of your own.** Use the shared clock
  (`client/ui/src/lib/frames.ts`) and the platform's motion driver, and
  ask for ticks only while something moves. *Check:* planned (an
  allowlist that only falls).
- **motion.4 Obey your Tile's Configure.** Read it with `useTile(select)`
  or `tileOf(element)`, never keep your own `ResizeObserver` or
  `IntersectionObserver` inside a Tile. Hidden: draw nothing, stop timers,
  keep state. Moving: measure nothing, resize nothing. Fit once per
  settled size. *After* P2, which builds the Configure. *Until* then,
  keep no observer or loop of your own (motion.3). *Check:* planned
  (motion gates, P2).
- **motion.5 No animation values in React state.** Read Here and data by
  selector; memoise; pass no inline functions or objects into a memoised
  child; act by action id. *Check:* review; the render counter gates the
  Window's own parts.
- **motion.6 Keep heavy work off the main thread.** Over 4 ms goes to a
  worker or is cut into pieces; lists over about 200 rows are windowed;
  fast output comes as a stream. *Check:* review.
- **motion.7 Motion comes from the look's springs** and honours reduced
  motion; write no durations of your own (ADR 0007 d9). *Check:* review.
- **motion.8 In Banda's own repository, a PR that touches motion or a
  live component posts the motion.spec numbers before and after.**
  *Check:* practice.

---

## 7. Desktop, web and phone

| Area | Wide | Narrow | Phone (PWA, v1) |
|---|---|---|---|
| Bar | three parts | widgets marked `compact` | the Mark, Here's title, two widgets marked `compact` |
| Sidebar | docked at the left | over the middle | the home screen |
| middle | the Strip | the Strip | one Thread screen; no Tiling |
| Top layer | centred or dropped from the top | the same | bottom sheets |

- **device.1 Declare what you need from the device** from the closed list
  (`notify`, `sound`, `clipboard`, `pick_file`, `open_outside`, `webview`,
  `drag_out`; ADR 0082 d12), each with a fallback. Where a client lacks
  it, Banda says so and shows the fallback. *After* E3, the device road.
  *Until* then, a module's desktop part is a counted case. *Check:*
  planned.
- **device.2 No `window.banda`, Electron, `node:*` or preload in view
  code.** Ask the device through your host part. *Check:* planned (a
  ratchet that allows `window.banda` only in `boot/desktop.ts`).
- **device.3 Every action has a path without a key and without hover:**
  a menu row or a tap. A key a browser tab cannot take (Ctrl+W, Ctrl+T,
  Ctrl+N) is never the only path. *Check:* review.
- **device.4 Sizes in rem;** text follows the Pane by container queries;
  touch targets at least 44 px in the phone form. *Check:* review.
- **device.5 App code never branches on the device.** Declare what you
  need; the Window places it and the catalogue adapts. *Check:* review.

---

## 8. Trust

- **trust.1 Declare your capabilities** (`files`, `run`, `net`,
  `sessions`, `device.<cap>`) and take the fewest. The kernel checks every
  call, Banda's own Apps included. *Check:* today.
- **trust.2 Only a gesture on one of the Person's devices acts as the
  Person.** A Tree fires only its own App's `ui`-marked commands. Handlers,
  listeners and views act as the App, with `on_behalf` recorded (ADR 0083
  d3). *Check:* planned (the renderer, V2).
- **trust.3 An action that sends words to an Agent, or runs or opens
  something outside Banda, is `runsAsPerson`** (`client/ui/src/module.ts:195`),
  and only the Person binds or fires it (ADR 0083). *Check:* today.
- **trust.4 A device request that opens, runs or reads needs a gesture on
  that device** (ADR 0082 d12). *Check:* review.
- **trust.5 No secrets in logs, facts, Trees, args, Problems, toasts, URLs
  or recordings.** Credentials come through the gateway; redact before
  recording a Problem. *Check:* review.
- **trust.6 HTML you did not write runs only in a Frame,** on its own
  origin with its own CSP. *Check:* review.
- **trust.7 Banda's own reads of a Project never run its content.** Git
  goes through `platform/git-cli` (ADR 0083 d5). *Check:* today.
- **trust.8 For Agents:** never touch credentials, a Harness's own
  configuration or Banda's data folder, and never write a `keys.toml` line
  that acts as the Person (`platform/skill/SKILL.md:58-65`). *Check:*
  review; the fence holds it (ADR 0083).

---

## 9. Words

- **words.1 An App id is one lowercase word.** It prefixes the App's
  methods, facts, tables, Panes, Widgets and actions
  (`kernel/src/module.rs:40-41`). The one exception: an id a Person may
  already bind keeps its name, with an alias, when its owner changes
  (`thread.unread` becomes the platform's; `thread.rename` stays Threads',
  whose App id is `agents`, later `threads`). A new id never takes
  another owner's prefix.
- **words.2 Reserved prefixes:** `window.`, `tiling.`, `banda.`, and every
  platform part's id. Reuse an intent verb before you add one.
- **words.3 A title says what happens,** in sentence case, with the
  GLOSSARY's words capitalised as it has them. The Person never reads
  "plugin", "extension" or "module".
- **words.4 Use the GLOSSARY's words:** Window, Area, Top layer, Here,
  Pane, Tile, Configure, Widget, Item, Item action, Slot, Action, Tiling.
  Avoid: shell (a terminal's program), Overlay for the Top layer (it is
  the tiling's unsaved changes), Focus for Here, Desk for the middle,
  Surface, Panel, Row or Card for Slot contents, Frame for an animation
  frame (say tick), plugin, extension, "agents manager" as a program.

---

## 10. Checks

**What `scripts/check.sh` holds today:** `cargo fmt`, `clippy -D
warnings` and `cargo test` (`scripts/check.sh:48-61`); the kernel names no
module and no module touches its tables (`kernel/tests/architecture.rs`);
each `[unstable]` mark says why and their count stays at the ceiling
(`scripts/check.sh:63-65`); the generated TypeScript matches the Rust;
prettier, ESLint, typecheck and tests; each App's Pane imports only the
contract, the kit, React and lucide; only `modules.ts` and the bridge
table name an App's package (`client/web/src/architecture.test.ts:41-90`);
the window's end-to-end tests, and motion.spec, which measures and asserts
nothing yet.

**Planned,** each an allowlist whose count only falls:

1. **The borders test,** one shared test for every App (replacing the
   copies per App): imports outside the allowlist; calls to another App's
   methods not listed in `calls`; `requestAnimationFrame`, `localStorage`,
   `window.banda`; a module-level variable holding a `WindowApi`; colour
   literals. Each case is a line naming its rule id and why.
2. **The Window and Tiling ratchets** (ADR 0087): no App strings, no
   `Listed`, no Thread imports; the Window's root at 400 lines or fewer.
3. **The motion gates** (ADR 0088): quiet ticks, hidden draws, layouts per
   moving frame, renders per focus step, trailing frames.
4. **Manifest checks,** with the Level 1 manifest sections at V2: every
   Widget names an action; every action with args has a schema;
   capabilities come from the known list.

Headless runs cap at 60 Hz and have no GPU raster, so the gates count
work, not frames shown. Runs on a real display stay a step before
releases.

---

## 11. Checklist

- [ ] Every verb is an Action with an args schema.
- [ ] Each Pane names its Project and subject, never reads Here to draw,
      and its header is data.
- [ ] Each Widget is quiet while idle, names its action, and reads Here by
      selector.
- [ ] To be listed or to call the Person, I publish `item@1` or `call@1`.
- [ ] I reach other Apps only through published facts, published queries
      and intents; no other App's id is in my strings or imports, and I
      run by id only my own actions and the platform's.
- [ ] I keep no module-level state about the Window; context comes from
      Here and my args.
- [ ] Data comes from my host; writes are commands shown as pending; no
      paths on the client.
- [ ] The Person's data is on the home host; device storage holds only
      conveniences.
- [ ] Catalogue components and tokens only; colour only for state.
- [ ] No loop of my own; motion on the compositor; nothing drawn while
      hidden; nothing measured mid-move.
- [ ] Device needs declared with a fallback; no `window.banda`.
- [ ] Fewest capabilities; `runsAsPerson` on whatever acts as the Person;
      no secrets anywhere they can leak.
- [ ] GLOSSARY words only.
- [ ] Every exception is a mark or an allowlist line with its reason.
- [ ] In Banda's own repository: `scripts/check.sh` passes, and motion
      numbers are posted if anything moves.

---

## 12. A minimal App

This is the target shape, once views and the renderer exist (V1, V2; vision
§5.4). The manifest keys are proposed; the helper names are illustrative.
The tracer App (V4) will replace this as the living example.

The App is Habits: a Project's daily habits, a Pane to tick them off, and
a Widget with how many are left.

```toml
# apps/habits/app.toml
id = "habits"
kind = "app"
name = "Habits"
about = "A Project's daily habits, ticked off once a day."
version = "0.1.0"
api = 1                            # the major of the App API it is written to
settings = []

[needs]                            # what it hears, calls and may do (ADR 0082)
capabilities = []                  # no files, run, net, sessions or device

[[panes]]
kind = "habits.today"
view = "today"                     # the view that answers its Tree
title = "Habits"
icon = "list-checks"
opens = "project"                  # a hint: on its Project's workspace

[[widgets]]
id = "habits.left"
view = "left"
reads = ["project"]                # read again only when Here's Project changes
compact = true                     # stays in a phone's header
act = "habits.show"                # what a click runs

[[actions]]
id = "habits.show"
title = "Show today's habits"
section = "Habits"
intent = "show.habits@1"           # resolved to this App's Pane; no default key
```

```rust
// apps/habits/host/src/lib.rs
banda_kernel::methods! {
    Habits(Call) as "HabitsMethods" in "habits/" {
        /// Today's habits, each with whether it is done.
        view today(ViewAsk<Nothing, Nothing>) -> Tree, Read, follows ["habits.habit.done"];
        /// How many are left today; nothing when none are.
        view left(ViewAsk<Nothing, Nothing>) -> Tree, Read, follows ["habits.habit.done"];
        /// Adds a habit.
        command add(Add) -> HabitId, Write, ui;
        /// Ticks one off for today. `ui`: this App's views may fire it.
        command done(Done) -> (), Write, ui;
    }
}

banda_kernel::facts! {
    /// A habit was ticked off: `{habit, day}`.
    habit.done@1(HabitDone),
}

fn today(read: &Read, _: ViewAsk<Nothing, Nothing>) -> Result<Tree, Refusal> {
    let habits: Vec<Habit> = read.all("select id, title, done_on from habits_items order by id")?;
    Ok(ui::list(habits.iter().map(|habit| {
        ui::check(&habit.title)
            .checked(habit.done_today())
            .on_change(ui::command("habits.done", json!({ "habit": habit.id })))
    })))
}

fn left(read: &Read, _: ViewAsk<Nothing, Nothing>) -> Result<Tree, Refusal> {
    let left: u32 = read.one("select count(*) from habits_items where done_on is not date('now')")?;
    Ok(match left {
        0 => ui::nothing(),                              // quiet while idle (give.3)
        n => ui::widget().icon("list-checks").count(n),  // no colour: a count is not a state (design.3)
    })
}
```

```rust
// a module test through its interface: commands in, facts and views out
#[tokio::test]
async fn ticking_a_habit_leaves_one_fewer() -> Result<()> {
    let p = test_kernel(Habits).await.project();
    let id: u64 = p.command("habits.add", json!({ "title": "Stretch" })).await?;
    assert_eq!(p.view("habits.left").await?.count(), Some(1));
    p.command("habits.done", json!({ "habit": id })).await?;
    assert!(p.facts().any(|f| f.kind == "habits.habit.done"));
    assert!(p.view("habits.left").await?.is_nothing());
    Ok(())
}
```

An Agent sees what it drew with `banda call habits.left --project <path> | jq`.

**What it does not have:** client code, a `start` hook, a Watch, a colour,
a path, a key of its own, or another App's name.

**Until V1 and V2,** Banda's own Apps write `defineModule`
(`client/ui/src/module.ts:430`) with client React views. For their new
code:

- **These bind now:** borders.2 to borders.7, borders.9 to borders.11,
  give.1 to give.3 and give.7, data.1 to data.4, data.6 and data.8,
  design.1 and design.3 to design.8, motion.1 to motion.3 and motion.5 to
  motion.8, device.2 to device.5, trust.1, trust.3 to trust.8, and the
  words.
- **These bind after their step:** here.1 to here.6 (B4c); give.4 (B7);
  give.5 (B4i); give.6 (B4d); motion.4 (P2); borders.8 (B8); data.5 (E8);
  device.1 (E3); borders.1's marks (B4f).
- **These wait for the renderer:** data.7, design.2 and trust.2 (V1, V2).

Today's cases of borders.3, borders.6, borders.9 and data.4 are counted,
and fall as B4d, B4f, B8c, E1, E6 and E8 land.
