# The window's plan: track 3 in slices

Plan, 2026-11-13. Roma accepted the map of the window as it is, its six
rules ([the window](../window.md)) and the four decisions of
[ADR 0127](../adr/0127-the-window-shows-and-asks-and-each-thing-has-one-place.md)
the same day, and asked for the work in this order: the structure, then
the look, then the details. This file is track 3 of the three tracks: what
each slice builds, what Roma tries, what it waits for and which files it
takes. [The roadmap](2026-11-08-roadmap-in-slices.md) names the track.

It serves principles 2, 3, 4 and 9 of [what we build](../what-we-build.md)
and stories 1 and 2. The map and the evidence behind each slice are kept
outside the repository (`~/Banda/artifacts/window-architecture/`).

## The three passes

| Pass | What | How it is agreed |
|---|---|---|
| **1. The structure** (WS1 to WS11) | every rule in one place, the engine decides, actions run from anywhere, the Tiling's file, the road of a theme | each slice is tried and merges itself once `ci` is green (Roma, 2026-11-13) |
| **2. The look** | the themes themselves, Banda and macOS first | with Roma by eye, in a session of its own; nothing merges itself |
| **3. The details** | small things | a session of its own, last |

## Pass 1: the structure

| Slice | It builds | What Roma tries | Rule |
|---|---|---|---|
| **WS1** an action runs from anywhere | `banda act ID`, an Agent's tool, the engine's check of the id and its arguments | `banda act overview.toggle` opens the Overview; an Agent asked to "put a terminal beside you" does it | 3 |
| **WS2** the window asks, the engine places | ADR 0110 step 1b: `placeFor`, `movesAway` and `bringing` leave the window; the window sends the Pane and where it is opened from | in the Flow `free`, a Diff an Agent opens lands where Alt+D puts it; `banda files .` lands where Alt+E does | 2 |
| **WS3** the engine refuses | ADR 0110 step 2: a move onto another Project's workspace is refused for every caller, with a code the window words | `banda call workspaces.move` onto another Project's workspace is refused in the words a drag gets | 2 |
| **WS4** the Tiling's file | `tiling.toml`: the Flow, the widths and rules by Pane kind, read by the engine; the Settings Pane shows it; `flow` leaves `agents.toml` under its grace | a rule "a terminal opens a third wide" holds from a key, from an Agent and from `banda`; Settings and the file say the same | 6 |
| **WS5** the view is the device's | Solo, the row for a while and a width as drawn write nothing; `workspaces.tidy` only from the device in front; then the arrangement kept under the device's name | Solo in one window leaves a second window on the same engine as it was; each keeps its own arrangement | 5 |
| **WS6** the Top layer is one stack | ADR 0110 step 3: one order of what lies over what, one Esc, one return of the focus; the layers get names (ADR 0113, step 5) | typing in a Thread, open Settings and press Esc: the caret is back in the message; a menu over a Sheet over the Drawer closes one at a time | 1 |
| **WS7** actions by their owner | ADR 0087 B4h and ADR 0110 step 4: the Tiling's actions move to the Tiling with `platform/workspaces/window.json`, an App's to the App; the Tiling's driver moves to `client/core`; the Window's root is 400 lines or fewer | nothing changes on the screen; `banda keys` names each action's owner | 1 |
| **WS8** the window names no App | Settings sections, the menu's "New" rows and the Flow's file come from what Apps declare; the App-names ratchet reads `menu/` and `settings/` too and ends empty | turn an App off: its Settings section and its rows go; with story 2's 2c, an App an Agent wrote shows its own | 4 |
| **WS9** changes come as events | a new, renamed or removed Project is a fact the window follows; nothing is read again "when the window comes to the front" | `banda project add` shows in an open window at once | 2 |
| **WS10** the device is a port | ADR 0089 W1: the `Device` port in `client/core`, and Electron main as its parts by capability, with the bridge's answers out of `main.ts` | nothing changes on the screen; the window starts, hides and quits as before | 5 |
| **WS11** the road of a theme | a theme is tokens the engine serves (no `banda look` child of main); one look store in `client/core`; what is behaviour leaves `look.toml`; the themes kept are Banda and macOS first | pick a theme in a browser tab and in the desktop window: both follow; a theme's file is the only place its colours are | 6 |

### The order, and what each waits for

| Week | Slices | Waits for |
|---|---|---|
| 1 (from 2026-11-13) | this plan; WS1; WS2 starts | nothing |
| 2 | WS2 ends; WS3; WS9 | WS9's fact is one hunk in `kernel/src`, after SE3's PR 1 (#1650) |
| 3 | WS4; WS5 (the view); WS6 | WS4 and WS5 stand on WS2 |
| 4 | WS7; WS8 | #1630 and SE1 have left `window/actions.ts`; the page's device reads are behind the adapter (track 1, end of week 3) |
| 5 | WS10; WS11; WS5 (the arrangement by device) | SE3's PRs 4a and 4b have left `main.ts`; device records (SE3) |

SE9 (week 7) needs WS2 and WS5. Both are done by week 5, so story 1 does
not wait for the window.

### What each slice takes

| Slice | Files | Whose they are today |
|---|---|---|
| WS1 | a new arm in `engine/src/main.rs` with its code in its own file; `platform/keys/engine`; `client/web/src/window/` (a new file for what is asked from outside) | the arm is one hunk, as the tracks' table asks |
| WS2, WS3 | `platform/workspaces/**`; `client/web/src/tiling/{arrange,arrangement,model}.ts`; the placing lines of `window/actions.ts` and `Shell.tsx` | track 3; SE9's PRs 3 and 4 and SE10's Pane PR come after |
| WS4 | `platform/workspaces/**`, `platform/look`, `platform/settings`; `client/web/src/settings/sections.ts`, one hunk | the Settings files after SE1's PR 3 |
| WS5 | `platform/workspaces/**`; `client/web/src/tiling/`; `window/actions.ts` (the Flow's lines) | track 3 |
| WS6 | `client/web/src/window/{Sheet,Drawer,Peek}.tsx`, `menu/BandaMenu.tsx`, a new `window/top/`; `client/ui/src/styles/globals.css` (the layers) | the look's session is told before the layers are named |
| WS7 | `client/web/src/window/{actions,Shell}.tsx`, `tiling/`, each App's `pane/src/index.ts`, `client/core/src/` (new files) | after #1630 and SE1 |
| WS8 | `client/web/src/settings/`, `menu/`, `registry.tsx`, `architecture.test.ts` | the Settings files after SE1's PR 3; the screen of an unknown App is track 2's (2c) |
| WS9 | `kernel/src/project.rs`, `client/ui/src/hooks/use-projects.ts` | one hunk in the kernel |
| WS10 | `client/desktop/src/main.ts`, `bridge.ts`, new files beside them; `client/core/src/device.ts` | after SE3's PR 4b; track 1's files (`hosts`, `engine`, `bytes`, `road`, `menubar`) are not touched |
| WS11 | `platform/look`, `platform/theme`, `client/core/src/` (a new `look.ts`), `client/web/src/look.ts`, `client/desktop/src/look.ts` | the look's session (ADR 0113, steps 4 to 6) is told first; SE5 keeps a web client's device settings |

## What is not this track's

- **Who calls the Person, and who is told** (the map's third pain): the
  machine decides it in SE7, on track 1. The window's part, the sidebar
  list reading the machine's rows and no longer working them out, follows
  SE7 in the sidebar's own session.
- **The screen of an App the client was not built with** (a Tree): story
  2's slice 2c, on track 2. WS8 leaves the window ready for it.
- **The door, the device's key and the machines' router:** story 1.
- **The Sidebar's own steps:** its session, within ADR 0098; #1630 first.

## Rules

- Every PR says "track 3" and its slice.
- A slice that changes what Roma sees shows it first (a mock or a
  picture), and does not merge itself. The structure pass changes little
  that is seen; WS4's Settings section, WS6 and WS11 are the ones that
  may.
- A slice that takes a file another track owns says so in a note, and
  goes second.
- A finding that blocks no slice becomes an issue.
- A week that slips is corrected here, in the PR that slips.
