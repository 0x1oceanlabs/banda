---
status: accepted
date: 2026-11-09
---

# The sidebar is the Person's inbox of their Agents' work

_It amends ADR 0005 (decision 8), ADR 0008 (decisions 4 and 5: the row
and the presets), ADR 0017 (decision 3), ADR 0067 (decisions 3 and 4:
the header and the foot), ADR 0069 (Archive as a shelf), ADR 0074
(decisions 1 and 6: asking and the Snoozed shelf) and ADR 0079 (the Flow's
place). The mark it draws is ADR 0099's. Code is cited from main at
`de0deb68`; the audit cites `290ec9a9`._

Roma, on 2026-11-09 (translated): "I want to put the sidebar with the
Agents in order." Roma runs ten Agents and more at once, and asked for a
card that says whose turn it is, how long it has waited, what was done,
and which machine and Agent it is; minimal but telling; three lines of
two sides, and a two- and a one-line form; and the sidebar "as an
inbox, a task manager between the Agent and the Person", keeping what
is useful in today's.

What followed, all in the brand workspace's `artifacts/`:

- `sidebar-audit/1-what-it-shows.md` and `2-code.md`: what the sidebar
  shows today, and how its code stands.
- `sidebar-card/mock-v1.html` … `mock-v5-inbox.html`: the card, five
  rounds. Roma accepted v5.
- `sidebar-card/concept-v6.html`: tabs, hover actions, sorting, the view
  menu, keys and inbox zero.
- `sidebar-card/proto.html`: a prototype on `@banda/ui`, clicked through
  by Roma, source on the unpushed branch `proto/sidebar-inbox`
  (`client/proto-sidebar`).
- `sidebar-card/concept-v7.html`: the eleven points left open, each with
  a mock. Roma: "the proposals are all good".

## Where it stands

From the audit (`2-code.md`):

- **Where a Thread stands is worked out in about fifteen places**, with
  three meanings of "waiting": asking and failed (`marks.ts`
  `needsPerson`, the bar's Mark); asking, failed, offline and done
  (`waits`, used by `rollup`, `tally`, `callingIn`, `rank`); and "Wait
  for you" in the counts' list, which is `!works`.
- **Two bugs follow from it.** An archived Thread with an unseen Done is
  still a Call, so `Alt+U` goes to it (`callsOf`,
  `client/ui/src/pane.ts`, leaves archived in). The bar's Mark counts
  snoozed and archived Threads (`ThreadsWatch.tsx` reports
  `attentionOf` over all of them).
- **`Sidebar.tsx` is 1156 lines**: view state, data, header, foot,
  sections, the Project list, host parts, two kinds of row and a Project
  menu. Rows have no view model: `Row.tsx` reads `Listed` and the
  settings and decides the look itself, and `Counts.tsx` draws a second
  row by hand.
- **Another machine is bolted on**: lists merged by `ProjectId`, the
  host passed as `elsewhere`, and a cut-down `ElsewhereRow`.
- **A Thread that asks cannot be snoozed** (`snoozable`,
  `client/ui/src/pane.ts:347`; ADR 0074, decision 1).
- **Three presets** (`platform/look/sidebars/{inbox,projects,places}.toml`,
  ADR 0008, decision 5) arrange the list three ways.
- **The header** holds Search, the Flow (`FlowMenu`, `Sidebar.tsx:302`,
  ADR 0079) and New Thread; **the foot** Settings, the key sheet, the
  theme, the view menu and Add Project (ADR 0067).

## Decision

### The list

1. **The sidebar is an inbox.** Its home answers one question: what does
   the Person have to do now? What does not need them is quieter, or on
   another tab.
2. **Four tabs under the search: Inbox, Working, Later, Archive**
   (`1`–`4`). Archive is an icon at the right. They replace the folded
   shelves at the bottom (ADR 0069, ADR 0074 decision 6). A tab's count
   is plain text; Inbox's is in `--attention` while something is the
   Person's turn.
3. **Inbox holds three parts, in this order:**
   - **Your turn**: what calls, as ADR 0081's Call (asks, failed, done
     and not seen, woke). Big cards. Oldest first by default: no one
     waits forever, and `Alt+U` walks it.
   - **Open**: seen, no turn running. One line each, in the normal
     colour, newest first, under a divider.
   - **Working**: a grey shelf of one-line rows, by when they started, so
     rows do not jump while Agents write. The first six, then "+ N more".
4. **Inbox zero** is when Your turn and Open are both empty. The list
   says so in words, and what comes next: "Nothing waits for you · 7 at
   work · next wakes at 18:30".
5. **The other tabs.** Working: every Thread at work. Later: by when it
   wakes, under Today, Tomorrow, Later, Someday and When done. Archive:
   the last archived first, under Today and Earlier.
6. **The order holds still under the pointer,** silently: a card never
   moves from under a click; what is new takes its place when the pointer
   leaves. The "↑ N updates" pill goes.
7. **One view, grouped or not.** The three presets go. The view menu's
   **Group by: None, Project, Machine** arranges the list, and
   `sidebar.toml` keeps it as `group = "none" | "project" | "machine"`.
   - **By Project**: each Project with something to show is a header in
     its own order (by name now, by dragging later): its sign, its name,
     a fold, and on the right a rollup, how many wait for the Person in
     the colour of the loudest and how many work in grey. A folded
     Project shows the loudest one's mark too. Under it: Your turn (two
     lines, the Project is in the header), Open, Working. The pointer
     over the header shows **+** (New Thread here) and **⋯** (the
     Project's menu). The Working tab is grouped the same way.
   - **By Machine** is the same with the machine's icon and name.
   - The order of the Projects does not follow need: the rollup says
     where the calls are, and `Alt+U` still walks the oldest first.

### The card

8. **A card has three lines, each with a left and a right.**

   | | Left | Right |
   |---|---|---|
   | 1 | the mark, the title | how long it waited, in the call's colour |
   | 2 | a word and what it says | a PR with ✓ or ✗, or the diff in grey |
   | 3 | the Project's sign and name | the machine, the Harness's emblem |

   - **Colour only on the mark and the time** of a call. The rest is the
     text's colours. No shadow under the open Thread's card.
   - **Line 2's word** is neutral: **Asks**, **Done**, **Failed**,
     **Woke**. After it: the question, the done note, why it failed, or
     "You snoozed it 3h ago" and what was. Failed shows nothing on the
     right.
   - **Line 3 names the Project, not the branch**: the branch says
     little at a glance.
   - **A working row** says on line 2 what it does now, from its
     Thread's events (ADR 0099): "pnpm test", "Edits Row.tsx", "3
     sub-agents at work", "No events for 6m", "Usage limit · goes on at
     15:00". At its limit, line 1's right says when it goes on.
   - **Times are short**: now, 40s, 14m, 2h, 3d. Nothing ticks.
   - **Long text fades out** at its end, and only when it does not fit.
     No "…".
9. **Density.** `card = "auto" | 3 | 2 | 1`. Auto: three lines for Your
   turn, one for the rest; two for Your turn when grouped by Project. A
   one-line working row shows the machine and the time. No card grows on
   hover or click: tried and dropped, rows jumped.

### Acting on it

10. **The pointer over a card shows its actions inline** at line 1's
    right; the title fades back to make room, and the time hides.

    | Where | Actions |
    |---|---|
    | Asks | Later |
    | Done, Failed, Woke, Open | Later, Archive |
    | Working | Later, which is "when done" |
    | Later | Wake |
    | Archive | Unarchive |

    Later is a clock, Archive a check, Wake an arrow back, Unarchive the
    archive-restore icon; each says its key in its tooltip. Archive acts
    at once, with an "Archived · Undo" toast; Later opens the snooze
    picker at the card (ADR 0074, decision 5).
11. **A Thread that asks may be snoozed.** The Agent waits; it comes back
    as Woke with the same question. A new call (a new question, a
    failure) still wakes it early (ADR 0074, decision 1). It still
    cannot be archived while it asks.
12. **Someday stays**: a snooze with no time, last in Later, that never
    wakes by itself. Inbox zero says "4 someday" once a week.
13. **Keys in the sidebar**: `↑` `↓` select, `Enter` opens, `Shift+Enter`
    opens beside, `S` archive, `Z` later, `U` unread, `1`–`4` the tabs.
    The selection moves on after an archive, as in a mail inbox. `Alt+S`,
    `Alt+Z`, `Alt+U` and `Alt+A` work from anywhere, as now.
14. **Right click on a card** opens one menu, by where it is: Open, Open
    beside; Archive, Later…, Mark as unread; Rename… (`F2`), Fork, Move
    to Project…; Copy as Markdown, Show folder. In Archive: Unarchive and
    **Delete…**, the only place to delete, after a confirmation. On a
    working card: Later — when done, and Stop. A right click on line 3's
    sign opens the Project's menu.
15. **Several at once.**
    - The pointer over Your turn's header shows **Archive N done**: only
      Done, not Asks, Failed or Woke. A toast undoes it.
    - `Ctrl`+click, `Shift`+click, `Shift+↑↓` and `Ctrl+A` select; checks
      take the marks' place and a bar at the foot offers Archive, Later,
      Unread and ✕. `S` `Z` `U` act on all of them; `Esc` clears. One
      snooze time serves them all.

### Projects

16. **A Project has no list of its own in the sidebar.** What one does
    with it moves to where it is needed:
    - a new Thread in it: ✎ (decision 19) and the group header's **+**;
    - its menu: the group header's **⋯** and a right click on its sign:
      New Thread here, Open folder, Project settings…, Archive its
      Threads, Remove from Banda;
    - **Add Project…** and **Projects…** (the Projects' settings Pane):
      in ✎'s menu;
    - a Project to trust, or one whose folder is missing, is a **card in
      Your turn**, its actions on it (Trust / Not now; Locate… / Remove).
      No band above the list.
    - A Thread with no Project (ADR 0046) says "No project" on line 3,
      and is its own group, last.

### Search

17. **Search filters the list where it is** (`Alt+Space` or a click; the
    field is quiet, with no frame, its key shown on hover).
    - It searches every tab and every machine: titles first, then
      messages, each with a line of context.
    - While it searches, the tabs count matches and an **All** tab, first
      and picked, shows them together.
    - `is:` (asking, failed, done, woke, working, later, archived), `in:`
      (a Project), `on:` (a machine), `by:` (a Harness) narrow it; the
      hint shows on `:` or an empty field.
    - `↑↓` and `Enter` open; `Esc` clears and goes back.
    - Each machine's engine searches its own messages; a machine away is
      searched by title only, and says so.

### Machines

18. **Another machine's cards are ordinary cards**, its icon on line 3.
    - When it is away, its cards **stay where they are**, dimmed, line 3
      "mac · away 12m"; its working ones show the offline mark. A
      question from it is still the Person's turn; its answer buttons
      wait until it is back. When it comes back the cards update
      silently.
    - The foot shows a dot per machine; a click lists them with their
      battery and whether they stay awake (ADR 0097), and Machines….
    - The bar's logo shows offline only for a machine away with Agents at
      work.

### The header, the foot, the bar

19. **The header holds Search and ✎.**
    - A click on ✎ starts a Thread at once: in the open Thread's
      Project, on its machine, with the default Harness.
    - A right click, or a press held, opens its menu: New Thread
      (`Alt+N`); in (the Projects, No project); on (the machines); with
      (the Harnesses); then Add Project… and Projects…. A tick marks what
      a click takes; picking one starts the Thread.
20. **The Flow moves to the bar**, beside the workspaces' numbers: it
    arranges the desk, not the list. Its icon shows the Flow in force;
    `Alt+Shift+M` as before (ADR 0079).
21. **The foot holds Settings, View and Quiet on the left, the machines
    on the right.** No words; each tooltip names its key.
    - **Quiet** is new: for 30 minutes, an hour, until tomorrow 9:00 or
      until turned off, no sound, no toast, no system notification, and
      no mark calls. The inbox still fills. While it is on, the foot's
      bell is crossed and so is a small bell on the bar's logo. It is
      Banda's own; following the desktop's Do Not Disturb stays as it is.
    - **The key sheet** (`Alt+K`) and **the theme** move to the Banda
      menu, which the bar's logo opens too; the theme stays in Settings →
      Appearance.
    - No button hides the sidebar (ADR 0067, decision 5).
22. **The sidebar hidden** (`Alt+A`): the bar's logo shows the loudest
    state (ADR 0099), and beside it a count, Your turn in its colour and
    the working in grey ("3 · 7"); nothing when nothing calls. A click
    opens a small inbox: the same one-line cards, the same keys, and "7
    at work ›" to open the sidebar on Working. `Alt+U` works as ever.

### Children and empty places

23. **A Harness's sub-agents have no cards**: their Agent's mark shows
    them (ADR 0099) and line 2 counts them.
24. **A Thread another Agent started through Banda (ADR 0019) is a
    child.** In Working it sits under its parent, with ↳, not by when it
    started. When it asks or fails it goes to Your turn itself, line 3
    "↳ ‹parent›". The window no longer lifts a child's louder mark onto
    its parent (`folded`, `client/web/src/bar/attention.ts`).
25. **Every empty place says what goes there and offers one way to fill
    it**: the first run ("Add a project to start", Add Project…, or a
    Thread with no project); inbox zero (decision 4); Working ("No Agent
    works now", New Thread); Later ("Nothing snoozed. Z on a card puts it
    here"); Archive ("S on a card closes it here"); a search with no
    match ("No Thread matches "zed" · searched titles and messages on arc
    and mac").

### Where a Thread stands, once

26. **One function says where a Thread stands** for the list, the bar,
    the counts, `Alt+U`, the notifications and the workspace dots:
    `turn`, `open`, `working`, `later` or `archived`, with its word. The
    other fourteen places read it.
    - It fixes the two bugs: an archived Thread is no Call, and the bar's
      Mark leaves out what is snoozed or archived.
    - "Waiting" means one thing: Your turn.
27. **A card is drawn from one row model**, `card.ts`: the sidebar, the
    bar's small inbox and the counts' list draw the same thing.

## What it amends

- **ADR 0005, decision 8; ADR 0008, decisions 4 and 5**: the row is
  decision 8's card; the three presets become `group`; `sidebar.toml`
  takes `group`, `card`, `[inbox] order`, `open`, `working`, and
  `[hold] still`. A file that names a preset still reads: `inbox` is no
  group, `projects` is `group = "project"`, `places` is
  `group = "project"` too.
- **ADR 0017, decision 3; ADR 0067, decisions 3 and 4**: the header and
  the foot are decisions 19–21's. **ADR 0079**: the Flow's menu is in
  the bar.
- **ADR 0069** and **ADR 0074, decision 6**: Archive and Snoozed are
  tabs, not shelves. **ADR 0074, decision 1**: a Thread that asks may be
  snoozed.
- **GLOSSARY**: the Inbox is the tab, the Person's Calls and the Threads
  open with no turn; the Sidebar's entry loses "a preset arranges it";
  Snooze keeps its name in code and docs and is shown as **Later**;
  Quiet is new.

## Plan

Each step is its own PR, tried in the window before it.

0. This ADR and ADR 0099, and the GLOSSARY.
1. **Where it stands, once** (decision 26): `status.ts` with the five
   places and their words, its tests, and the fourteen readers moved to
   it; the two bugs fixed.
2. **The row model** (decision 27): `card.ts`, from `Listed` and the
   settings to the six slots; `Row.tsx` and `Counts.tsx` draw it.
3. **`Sidebar.tsx` split** into its header, tabs, list, sections, rows
   and foot, with nothing changed on screen.
4. **The tabs and the Inbox** (decisions 1–6).
5. **The card** (decisions 8–9).
6. **Hover actions, keys and the toast** (decisions 10, 13), and snooze
   on asking (11–12).
7. **Group by and the view menu** (decision 7), `sidebar.toml`'s keys,
   the presets read as `group`.
8. **Header, foot and bar** (decisions 19–21): ✎'s menu, the Flow in the
   bar, Quiet, the key sheet and the theme in the Banda menu.
9. **The card's menu** (14) and **several at once** (15).
10. **Projects** (16): the group header's menu, trust and missing as
    cards.
11. **Search** (17).
12. **Machines** (18).
13. **Children** (23–24) and **empty places** (25).
14. **The sidebar hidden** (22).

Steps 1–3 change nothing on screen but the two bugs. ADR 0099's steps
come beside 4–6.

## Roma's calls

On 2026-11-09, over the mocks and the prototype:

- The card v5; colour only on the mark and time; no shadow; line 3 the
  Project, not the branch; Open in the inbox at normal colour, Working
  grey; no "↑ N updates"; no card that grows.
- The hover actions inline, Later first, the title fading back; icons,
  not words.
- All eleven of `concept-v7.html`'s points, and its five open decisions:
  later on asking, tabs, Add Project in ✎'s menu and the machines in the
  foot, Someday, the view menu for the presets.
- One view and Group by, not three presets: "let's see the mock grouped
  by Projects" — "yes, good".
- The icons: Flow to the bar, the key sheet and theme to the Banda menu,
  Quiet in the foot: "all the decisions are good".
