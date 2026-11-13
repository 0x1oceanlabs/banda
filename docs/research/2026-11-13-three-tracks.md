# Three tracks: who builds what, and when

Plan, 2026-11-13. Agreed between the session that leads story 1 and the session that wrote this. Roma accepted tracks 1 and 2 (2026-11-13); track 3 gets its plan from a design session of its own first. [The roadmap](2026-11-08-roadmap-in-slices.md) says what is built and what Roma tries in each slice. This file says how its three tracks run side by side: the order inside each, the weeks, the files where they meet, who leads, and what waits for Roma. It does not repeat the slices.

It serves stories 1 and 2 and principles 3, 4 and 9 of [what we build](../what-we-build.md). It takes the place of the two-track weeks in the story 1 design, which was written before the third track and is kept outside the repository.

## The tracks

| Track | It builds | It is done when | Led by |
|---|---|---|---|
| **1. Story 1** | one Banda on every machine: SE1 to SE13 | the story's text runs with a Thread at work, moved from the phone, and its room follows (SE13) | a session of its own |
| **2. Story 2** | an Agent writes an App: 2-0 to 2c; then the engine's part of what story 1 left: SE8's costly half, SE10, T0 | Threads is an ordinary App in its own folder (T0c) | a session of its own; 2-0's last PRs were delegated from the story 1 session |
| **3. The window** | the window's architecture: first how it works today and where Roma sees each part, then its philosophy, then slices | Roma accepts its plan, and this file and the roadmap gain its slices | a window session of its own; the sidebar and the look keep their sessions |

A week below is five working days. Week 1 starts on 2026-11-13.

## Track 1: story 1

The order is the roadmap's: SE2, SE1, SE3, SE5, SE6, SE7, SE4, SE9, SE11, SE12, SE13. The path that matters most is SE3 → SE5 → SE6: the door, the window in a browser, the phone. Story 1 runs end to end, with today's move, from about day 23.

Four things are settled here:

- **SE3's first PR does not wait for SE1.** SE1's PRs 1 and 2 wait for #1630, and #1630 waits for Roma. SE3's PR 1 (the door in the kernel) waits only for 2-0's welcome PR, since both edit `kernel/src/api.rs`. SE1's PR 3 (Settings for another machine) waits for nothing and goes in week 1.
- **Redoing #1324 is track 1's.** Its commit lies on an old local branch. It must land before SE3's PR 4a.
- **SE8's cheap half** fills the gaps of track 1, as small PRs. Its costly half is track 2's.
- **The window's minimum is track 1's** until track 3 has a plan, so story 1 waits for no design:
  - SE3's PRs 4a and 4b edit three places of `client/desktop/src/main.ts` (the CSP, closing the window, signing) where they are, each in its own hunk. Nobody splits `main.ts` before track 3's plan.
  - Before SE5's PR 2 (the end of week 3), no page code reads `window.banda` but the device's adapter: today 18 reads in 17 files (`DESKTOP_READS` in `client/web/src/architecture.test.ts`), and a device-only action hides where the device cannot do it. The Settings files go after SE1's PR 3.
  - SE9 (week 7) needs the window to ask and the engine to place (ADR 0110, step 1b) and a layout for each device (T-b). Track 3's plan is due before then; if it is late, SE9 does only what it needs.

## Track 2: story 2, then the engine's part of story 1

| Weeks | What | It waits for |
|---|---|---|
| 1 to 4 | 2-0, 2a, 2b, 2c | A1a (merged); the welcome PR lands before SE3's PR 1 |
| 5 to 6 | SE8's costly half: the last screen kept "as of", the echo ahead in the terminal | The cache is a new file, `client/core/src/cache.ts`, and lands before SE4. It does not edit `queue.ts` |
| 6 to 8 | SE10: every machine's Project is whole (ADR 0120) | ADR 0120 accepted (#1578); accounts step 6 before its PRs 2 and 3; the `how-picker` branch and #1324 before PRs 6 to 9; its PRs 5 to 7 need SE4's door routes; its PR that asks for a Pane waits for ADR 0110's step 1b |
| 9 | T0a, T0b: Threads as an ordinary App, without the folder move | track 2 free |
| 10 | T0c: `apps/agents` becomes `apps/threads` | a freeze of `apps/agents`, once SE11 to SE13 have left it |

Not on this track now: B2, A1b and A1c, B7, B8, D1. No slice needs them. A worker comes before WebAssembly, so D5 and D6 as first written are replaced by 2a and 2c.

## Track 3: the window

Its plan comes from a design session of its own, in three steps, each one Roma agrees to before the next:

1. **How the window works today, and where Roma sees it.** From the screen inward: the sidebar, the tiling, the Panes, the menus, the bar, Settings, Electron main and its bridge. For each part, the code behind it and the way its data goes, with screenshots.
2. **The window's philosophy.** A few principles for how it should work, each with what it asks of the code and a check, in the shape of [what we build](../what-we-build.md).
3. **The plan in slices,** each with what Roma tries. Once Roma accepts it, its slices join this file and the roadmap.

Its sources: ADRs 0087 to 0089 and the [client architecture](2026-11-07-client-architecture.md); ADR 0110 (where a Pane opens, steps 1b to 4); ADR 0098 (the sidebar); ADR 0113 and ADR 0100 (the look); ADR 0102 (Project desks); the engine map's findings on Electron main and its bridge.

Until then the window takes no large step. The sidebar session (#1630 and its own steps) and the look's session go on within their ADRs, and what story 1 needs from the window is track 1's (above).

## The weeks

| Week | Track 1 | Track 2 | Roma tries |
|---|---|---|---|
| 1 | SE2; SE1 PR 3; SE8's first filler; SE3 PR 1 after the welcome PR | 2-0: the welcome names the Apps; #1226; D4a | devbox's engine runs after a reboot; Settings for: devbox; `banda status` lists Apps |
| 2 | SE3 PRs 1 to 3, a Dev release carrying 1 and 2; #1324 redone; SE1 PRs 1 and 2 once #1630 is in; the page's first device reads behind the adapter | 2a | another machine's cards have their menus; an App an Agent wrote on devbox |
| 3 | SE3 PRs 4a and 4b; SE5 PR 1; the page's last device reads | 2b | **the Mac's engine killed, the window stays**; an App in one Thread |
| 4 | SE5 PRs 2 and 3; SE6 starts | 2c | **Safari shows the same window**; the App's screen |
| 5 | SE6; SE7 starts | SE8: the cache | **the phone, every machine**; story 1 end to end with today's move |
| 6 | SE7 ends; SE4 | SE8: the echo; SE10 PRs 1 to 4 | a push in the pocket, one signal; Add Project on arc from the Mac |
| 7 | SE4 ends, with its cleanups; SE9 PRs 1 and 2 | SE10 PRs 5 to 7 | "via tailnet · 18 ms"; arc's ports on the Mac |
| 8 | SE9 PRs 3 to 7 | SE10 PRs 8 to 10 | a devbox Agent's Diff on the Mac |
| 9 | SE9 ends; SE11 | T0a, T0b | move a Thread at work and close the window |
| 10 | SE12; SE13 | T0c, in the freeze | the story's text, from the phone; the room follows |

Track 3's weeks come with its plan. Its design session runs from week 1, and its plan is due by about week 4, before SE9 needs the window.

## Where the tracks meet

One owner per file. The other track asks first.

| File | Track 1 | Track 2 | The window (track 3, and the sessions that own its parts today) | Rule |
|---|---|---|---|---|
| `kernel/src/api.rs` | SE3 PR 1; SE8's lanes | the welcome PR | — | the welcome PR lands first |
| `sdk/contract/src/engine.ts`, `sdk/contract/src/generated` | SE3, SE4, SE11 | the welcome PR, 2a, 2c | — | the welcome PR first; regenerate after each rebase |
| `client/core/src/{hosts,queue,left,route,device}.ts` | owns them | SE8's cache in a new file | does not touch them | new files for anything else in `client/core` |
| `client/desktop/src/{hosts,engine,bytes}.ts`, `menubar.ts`, `road.ts` | owns them (SE3, SE4, SE7, SE9) | — | does not touch them | — |
| `client/desktop/src/main.ts` | SE3 PRs 4a and 4b edit three places, each in its own hunk | — | its plan decides any split | no split before track 3's plan |
| `client/desktop/src/bridge.ts` | SE3 PR 4b, two lines | — | owns it | its table changes after SE3 PR 4b |
| `client/web/src/main.tsx`, `App.tsx` | SE3 PR 4a; SE5 PR 2 | — | leaves them | track 1 removes `main.tsx`'s bridge read |
| `client/web/src/settings/*` | SE1 PR 3; the device reads before SE5 PR 2; SE5's Devices section, one hunk in `sections.ts` | — | — | the device reads after SE1 PR 3 |
| `client/web/src/sidebar/**` | SE1 PRs 1 and 2; the phone's form reuses its parts and edits none | — | the sidebar session (#1630, its refactor) | #1630, then SE1, then the refactor |
| `client/web/src/window/actions.ts` | SE1, own hunks; the device-only actions before SE5 PR 2 | — | ADR 0110's steps | #1630, then SE1, then any cleaning track 3 plans |
| `client/web/src/window/Shell.tsx` | does not grow it | — | owns it | four lines of headroom; new UI goes in its own files |
| `platform/workspaces/**` | SE9 PRs 3 and 4; SE13 | SE10's Pane PR | ADR 0110's steps 1b and 2 | ADR 0110's steps first |
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

## After the three tracks

What the tracks leave out, found on the way or put off on purpose, is kept in [the backlog](2026-11-13-backlog.md): the engine from the inside, the deferred leftovers, the window's candidates until its plan, the other stories and parked ideas. After week 10, Roma goes through it and chooses what comes next.

## What waits for Roma

| What | It holds | By | Recommended |
|---|---|---|---|
| The four answers on #1630 | SE1 PRs 1 and 2; the sidebar's refactor | week 1 | the picks on its review page |
| One name for "an App asks for a Pane" | ADR 0110's step 1b, then SE9, SE10 | with track 3's plan | one intent, `show.requested@1`, with `from` and `machine`; #1578's decision 6 names it |
| Track 3's plan: how the window works, its philosophy, its slices | track 3; SE9 | about week 4 | a design session of its own, Roma agreeing step by step |
| The mocks of SE5 and SE6, on one sheet | SE5 PR 2 | week 3 | — |
| `tailscale` on arc, devbox and the Mac; Tailscale on in the iPhone | SE5's try; SE6's try | weeks 4 and 5 | as the story 1 design says |
| ADR 0120 (#1578), its seven questions | SE10; SE9 PRs 3 and 4 | week 6 | — |
| The ADR on where an Agent's Chromium runs | SE9 PR 5 | week 8 | — |
| A quiet two hours for `apps/agents` | T0c | week 10 | Roma asks the sessions with open branches there to land them first |
