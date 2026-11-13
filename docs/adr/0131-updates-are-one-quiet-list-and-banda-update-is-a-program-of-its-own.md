---
status: accepted
date: 2026-11-13
---

# Updates are one quiet list, and `banda-update` is a program of its own

_It amends ADR 0119 (decisions 2, 3 and 7) and ADR 0072 (decision 5). It
serves [what we build](../what-we-build.md)'s story 1, one Banda on every
machine, which has to keep every machine on the same version without the
Person's care, and principle 3, everything is an App, with a screen or
without: the updater becomes a program of its own._

Roma, on 2026-11-13 (translated), with a picture of the popover that said
"Could not update: The first frame must be hello with a token this engine
knows." on the bar, in the popover and in Restart's dialog: "the updater
is broken, fix it properly; work the design out again; move it into a
program of its own, by our architecture". Then, of mock v1's style: "more
minimal and clear for the user".

## Where it stands

- **The engine replaces itself.** ADR 0119, plan step 4: once nothing
  runs, the engine `exec`s its new copy in its own process. The new copy
  took a new secret on the same port, and the window's client, refused,
  stayed refused (fixed in #1702). The program being updated is also the
  one that updates it.
- **Three places hold the updater:** the engine part
  (`platform/updates/engine`, about 2,000 lines in the engine's process),
  the desktop part in Electron main (`platform/updates/desktop`, about 1,100
  lines) and the widget (`client/web/src/bar/update`, about 1,300 lines).
- **The widget says too much.** A pill on the bar ("M1PRO waits"), the
  engine's own error text on the bar and in a dialog, "Restart now" beside
  "Restarts in a moment.", a row of its own for this window, and the
  release notes.

## Decision

1. **The popover is one quiet list** (mock v2, variant A, Roma's pick:
   `~/Banda/artifacts/updates/updates-v2.html`).
   - **The bar shows the icon alone:** a dot when something is ready, the
     ring while it downloads, red when something failed. No pill, and
     never an error's text.
   - **A title says it in one line:** "Banda dev.761 is ready", "Updating
     to dev.761", "Couldn't update M1PRO", "Banda is up to date".
   - **One row a machine, one word at its right, at most one button:**
     Up to date, Update, Updating (with its size), After 2 Agents, Away,
     Couldn't update with Try again. A second line only when the Person
     needs a why.
   - **This window is not a row of its own.** Its machine's row has one
     Update: it restarts the app at once, and the engine there moves onto
     its copy as nothing runs. This replaces ADR 0119, decision 7's own
     row.
   - **An error is said in words, its text behind Details**, folded.
   - **Update while Agents work asks once,** and waiting is the default:
     "Update when they finish". "Stop them and update" is the other
     button. A machine that updates by itself once idle needs no button
     while it waits: its row says "After 2 Agents".
   - **No release notes in the popover** (amends ADR 0072, decision 5);
     what changed is on the release's page.
   - **The words:** Update, Updating, Up to date, Away, Couldn't update.
     Never engine, restart, token or frame.
2. **`banda-update` is a program of its own**, as the vision's parts are
   programs (§4.1). The engine still updates itself, by itself, once
   nothing runs; what changes is which program does the work.
   - **It looks and takes.** It reads the channel's feed, downloads the
     newest engine, checks it and puts it beside the running one in
     `<data>/engine/<version>/`. It ships beside `banda` in every copy:
     in the app, in the engine's bundle, and in the copies kept.
   - **Its own service.** `banda-update run` runs as its own systemd user
     unit, or launchd job, beside the engine's, never inside it: it looks
     every hour, and asks the engine whether anything runs (Turns,
     terminals, recent keys).
   - **The switch stays the engine's.** Once nothing runs, it asks the
     engine to move onto the new copy, which the engine does in its own
     process, as now, keeping its port and its secret (#1702).
   - **It puts back what does not start.** It waits for the engine to
     answer on the new version. One that does not is marked bad in
     `<data>/engine/`, never taken again, and the engine goes back to the
     copy it ran.
   - `banda update` and the widget's Check now and Update reach it
     through the engine, whose `updates.*` methods keep their shape.
3. **The contract stays.** `updates.state`, `updates.check` and
   `updates.restart` keep their shape; only who does the work moves.

## Plan

| Step | What |
|---|---|
| 0 | #1702: the window keeps its engine across a move (done) |
| 1 | This ADR and the widget as variant A (#1711) |
| 2 | `banda-update check` and `take`: the looks and takes run in it, the engine asks it; it ships beside `banda` |
| 3 | `banda-update run` as its own unit or job: the hourly look, the wait for nothing running, the move asked of the engine, and putting back a copy that does not start |
| 4 | The app's own update (AppImage, brew) moves into it from Electron main |

## Consequences

- An update no longer depends on the program it replaces staying sane:
  a copy that does not start is put back.
- The window shows and asks; it decides and downloads nothing.
- A release carries one more small binary.
- Windows keeps its updates through the app until ADR 0090's service.
