# Three tracks: who builds what, and when

Plan, 2026-11-13. Agreed between the session that leads story 1 and the session that wrote this, and waiting for Roma's yes. [The roadmap](2026-11-08-roadmap-in-slices.md) says what is built and what Roma tries in each slice. This file says how its three tracks run side by side: the order inside each, the weeks, the files where they meet, who leads, and what waits for Roma. It does not repeat the slices.

It serves stories 1 and 2 and principles 3, 4 and 9 of [what we build](../what-we-build.md). It takes the place of the two-track weeks in the story 1 design, which was written before the third track and is kept outside the repository.

## The tracks

| Track | It builds | It is done when | Led by |
|---|---|---|---|
| **1. Story 1** | one Banda on every machine: SE1 to SE13 | the story's text runs with a Thread at work, moved from the phone, and its room follows (SE13) | the story 1 session |
| **2. Story 2** | an Agent writes an App: 2-0 to 2c; then the engine's part of what story 1 left: SE8's costly half, SE10, T0 | Threads is an ordinary App in its own folder (T0c) | the story 1 session through delegates for 2-0; a session of its own from 2a |
| **3. The window** | what story 1 needs from the window, and the window's own unfinished ADRs: WT1 to WT10 | the Window is 400 lines, the page asks the device in one place, and each platform has its theme | one window session; the sidebar and the look stay with their sessions |

A week below is five working days. Week 1 starts on 2026-11-13.

## Track 1: story 1

The order is the roadmap's: SE2, SE1, SE3, SE5, SE6, SE7, SE4, SE9, SE11, SE12, SE13. The path that matters most is SE3 → SE5 → SE6: the door, the window in a browser, the phone. Story 1 runs end to end, with today's move, from about day 23.

Three things are settled here:

- **SE3's first PR does not wait for SE1.** SE1's PRs 1 and 2 wait for #1630, and #1630 waits for Roma. SE3's PR 1 (the door in the kernel) waits only for 2-0's welcome PR, since both edit `kernel/src/api.rs`. SE1's PR 3 (Settings for another machine) waits for nothing and goes in week 1.
- **Redoing #1324 is track 1's.** Its commit lies on an old local branch. It must land before SE3's PR 4a.
- **SE8's cheap half** fills the gaps of track 1, as small PRs. Its costly half is track 2's.

## Track 2: story 2, then the engine's part of story 1

| Weeks | What | It waits for |
|---|---|---|
| 1 to 4 | 2-0, 2a, 2b, 2c | A1a (merged); the welcome PR lands before SE3's PR 1 |
| 5 to 6 | SE8's costly half: the last screen kept "as of", the echo ahead in the terminal | The cache is a new file, `client/core/src/cache.ts`, and lands before SE4. It does not edit `queue.ts` |
| 6 to 8 | SE10: every machine's Project is whole (ADR 0120) | ADR 0120 accepted (#1578); accounts step 6 before its PRs 2 and 3; the `how-picker` branch and #1324 before PRs 6 to 9; its PRs 5 to 7 need SE4's door routes; its PR that asks for a Pane waits for WT4 |
| 9 | T0a, T0b: Threads as an ordinary App, without the folder move | track 2 free |
| 10 | T0c: `apps/agents` becomes `apps/threads` | a freeze of `apps/agents`, once SE11 to SE13 have left it |

Not on this track now: B2, A1b and A1c, B7, B8, D1. No slice needs them. A worker comes before WebAssembly, so D5 and D6 as first written are replaced by 2a and 2c.

## Track 3: the window

The roadmap had one line for this track. It has three sources:

- **What story 1 needs from the window.** A page that starts in a browser cannot read Electron's bridge (SE5). The door edits Electron main, which is one file of 1,329 lines (SE3). Two devices on one machine need a layout each (SE6, SE9). An Agent's Pane on another machine needs the one placing rule (SE9, SE13, SE10).
- **The window's ADRs that are open:** where a Pane opens (ADR 0110, steps 1b to 4), the client plan's rest (ADRs 0087 and 0089: T-b, B4h, B7a), the sidebar (ADR 0098), Banda UI (ADR 0113, steps 4 to 6), the platform themes (ADR 0100, steps 5 to 7).
- **The engine map's finding 15:** Electron main does about forty jobs in one file, and the table of what crosses to the page is spread over four packages.

| Slice | What it is | It must land before | Size |
|---|---|---|---|
| **WT1** Electron main in parts | `client/desktop/src/main.ts` splits by job. Moves only. The PR says where the three places SE3 edits went: the CSP, closing the window, signing | week 3 (SE3's PR 4a) | M |
| **WT2** The page asks the device in one place | No page code reads `window.banda` but the device's adapter: today 18 reads in 17 files (`DESKTOP_READS` in `client/web/src/architecture.test.ts`). A device-only action hides where the device cannot do it. `main.tsx`'s read is track 1's. The Settings files SE1's PR 3 edits come after it | the end of week 3 (SE5's PR 2) | M, 3 PRs |
| **WT3** The sidebar | #1630; then Woke and Asks in orange; then its refactor (one place, values from the theme, structured data in and out) with B7a, the Item | SE1's PRs 1 and 2 follow #1630; the refactor follows SE1 | L |
| **WT4** The window asks, the engine places | ADR 0110 step 1b: the window sends an intent with `from`; `placeFor` and `movesAway` leave `actions.ts` | SE9's PRs 3 and 4; SE10's Pane PR | M |
| **WT5** Refusals | ADR 0110 step 2: the engine refuses a move and says why, in words the window shows | WT8 | S-M |
| **WT6** The Top layer | ADR 0110 step 3 with ADR 0113 step 5: one stack of Drawer, Sheet and menus, named layers, one return of the focus | — | M |
| **WT7** A layout for each device | T-b: Solo is a view, and only the device in front tidies | SE6's try, if it can; SE9 for certain | S-M |
| **WT8** The Window at 400 lines | ADR 0110 step 4 with the rest of B4h: `tiling/arrange.ts`, `actions.ts` and `Shell.tsx` cleaned; the Tiling's actions to `platform/workspaces/window.json`; the Tiling's driver to new files in `client/core/src/tiling/` | after SE1 and WT5 | M-L |
| **WT9** One table of what crosses | The bridge's table in one place, its dead leaves gone, no action's name in Electron main | after SE3's PR 4b | M |
| **WT10** The look | ADR 0113 step 4 (colours) and step 6 (the catalogue page); ADR 0100 step 5 (the adapters: Hyprland and Omarchy, then macOS, then the others), step 6 (`banda theme`), step 7 (tuned on each machine) | — | L, many small PRs |

Later on this track: motion on the compositor (ADR 0088, P5 to P10), `@banda/ui` splits (L3), the Tiling's model in WebAssembly (T1, T2).

**This track's sizes are a first cut.** They come from the ADRs and the client plan, not from a study of the code as deep as the other two tracks had. The window session checks each slice against the code when it starts it, and corrects this file in that PR.

## The weeks

| Week | Track 1 | Track 2 | Track 3 | Roma tries |
|---|---|---|---|---|
| 1 | SE2; SE1 PR 3; SE8's first filler; SE3 PR 1 after the welcome PR | 2-0: the welcome names the Apps; #1226; D4a | WT1; WT2's first files; #1630 once answered; WT10 colours | devbox's engine runs after a reboot; Settings for: devbox; `banda status` lists Apps; the colours, in shots |
| 2 | SE3 PRs 1 to 3, a Dev release carrying 1 and 2; #1324 redone; SE1 PRs 1 and 2 once #1630 is in | 2a | WT1 lands; WT2's rest; WT4 once the name is chosen; the orange mock | another machine's cards have their menus; an App an Agent wrote on devbox; an Agent's Pane lands where Roma's would |
| 3 | SE3 PRs 4a and 4b; SE5 PR 1 | 2b | WT2 done; WT5; the sidebar's refactor starts | **the Mac's engine killed, the window stays**; an App in one Thread; a refused move says why |
| 4 | SE5 PRs 2 and 3; SE6 starts | 2c | WT6; WT7 | **Safari shows the same window**; the App's screen; the keys go back to the terminal when a menu closes |
| 5 | SE6; SE7 starts | SE8: the cache | WT7 lands; WT9; the sidebar's refactor ends, B7a | **the phone, every machine**; story 1 end to end with today's move |
| 6 | SE7 ends; SE4 | SE8: the echo; SE10 PRs 1 to 4 | WT8; WT10 adapters on arc | a push in the pocket, one signal; Add Project on arc from the Mac; Banda follows arc's Omarchy theme |
| 7 | SE4 ends, with its cleanups; SE9 PRs 1 and 2 | SE10 PRs 5 to 7 | WT10 the Mac's adapter | "via tailnet · 18 ms"; arc's ports on the Mac; Banda follows macOS |
| 8 | SE9 PRs 3 to 7 | SE10 PRs 8 to 10 | WT10 `banda theme`, the catalogue page | a devbox Agent's Diff on the Mac; an Agent writes a theme |
| 9 | SE9 ends; SE11 | T0a, T0b | motion: P5, P6's mock | move a Thread at work and close the window |
| 10 | SE12; SE13 | T0c, in the freeze | motion: P7 on | the story's text, from the phone; the room follows |

## Where the tracks meet

One owner per file. The other track asks first.

| File | Track 1 | Track 2 | Track 3 | Rule |
|---|---|---|---|---|
| `kernel/src/api.rs` | SE3 PR 1; SE8's lanes | the welcome PR | — | the welcome PR lands first |
| `sdk/contract/src/engine.ts`, `sdk/contract/src/generated` | SE3, SE4, SE11 | the welcome PR, 2a, 2c | — | the welcome PR first; regenerate after each rebase |
| `client/core/src/{hosts,queue,left,route,device}.ts` | owns them | SE8's cache in a new file | does not touch them | new files for anything else in `client/core` |
| `client/core/src/tiling/` | — | — | WT8, new files | — |
| `client/desktop/src/{hosts,engine,bytes}.ts`, `menubar.ts`, `road.ts` | owns them (SE3, SE4, SE7, SE9) | — | does not touch them | — |
| `client/desktop/src/main.ts` | SE3 PRs 4a and 4b edit three places | — | WT1 splits it | WT1 lands before week 3 |
| `client/desktop/src/bridge.ts` | SE3 PR 4b, two lines | — | WT9 | WT9 after SE3 PR 4b |
| `client/web/src/main.tsx`, `App.tsx` | SE3 PR 4a; SE5 PR 2 | — | leaves them | track 1 removes `main.tsx`'s bridge read |
| `client/web/src/settings/*` | SE1 PR 3; SE5's Devices section, one hunk in `sections.ts` | — | WT2 | WT2's Settings files after SE1 PR 3 |
| `client/web/src/sidebar/**` | SE1 PRs 1 and 2; the phone's form reuses its parts and edits none | — | WT3 | #1630, then SE1, then the refactor |
| `client/web/src/window/actions.ts` | SE1, own hunks | — | WT4, WT8 | #1630, then SE1, then WT8's cleaning |
| `client/web/src/window/Shell.tsx` | does not grow it | — | owns it | four lines of headroom; new UI goes in its own files |
| `platform/workspaces/**` | SE9 PRs 3 and 4; SE13 | SE10's Pane PR | WT4, WT5 | WT4 and WT5 first |
| `apps/agents/**` | SE9, SE11 to SE13 | T0a, T0b; T0c in the freeze | — | T0c after SE13 |
| `platform/harnesses/**` | SE9 PR 2 | SE10 PRs 2 and 3 | — | after #1612 and accounts step 6 |
| `engine/src/main.rs` | `devices`, `pair`, `--host`, `move` | `app`, `export` | — | one arm per PR, its code in its own file |
| `scripts/engine.mjs`, the release workflow | SE5 PR 1 | — | — | tell the release session first |
| `architecture.test.ts`, `GLOSSARY.md`, `docs/architecture.md` | all | all | all | each change in its own hunk; rebase on a pinned base |

## Rules

- Every PR names its track and its slice.
- The screens of SE5 and SE6 (pairing, the Allow card, Settings → Devices, the phone's form) are track 1's. They are new files, drawn with tokens only (ADR 0113), from one sheet of mocks Roma sees first.
- A change Roma will see is shown first and has no auto-merge. A move is its own commit.
- Sessions cannot always write to one another. Where two tracks meet, the one that comes second leaves a note for the other, and Roma passes the word.
- A week that slips is corrected here, in the PR that slips.
- A finding that blocks no slice becomes an issue, not a step.

## What waits for Roma

| What | It holds | By | Recommended |
|---|---|---|---|
| Merge #1636 | the roadmap's line on three tracks | now | merge |
| The four answers on #1630 | SE1 PRs 1 and 2; the sidebar's refactor | week 1 | the picks on its review page |
| One name for "an App asks for a Pane" | WT4, then SE9, SE10 | week 2 | one intent, `show.requested@1`, with `from` and `machine`; #1578's decision 6 names it |
| Who leads track 3, and a session for track 2 from 2a | both tracks | week 1 | the session that wrote this leads the window; a new session takes 2a |
| The mocks of SE5 and SE6, on one sheet | SE5 PR 2 | week 3 | — |
| `tailscale` on arc, devbox and the Mac; Tailscale on in the iPhone | SE5's try; SE6's try | weeks 4 and 5 | as the story 1 design says |
| ADR 0120 (#1578), its seven questions | SE10; SE9 PRs 3 and 4 | week 6 | — |
| The ADR on where an Agent's Chromium runs | SE9 PR 5 | week 8 | — |
| A quiet two hours for `apps/agents` | T0c | week 10 | Roma asks the sessions with open branches there to land them first |
