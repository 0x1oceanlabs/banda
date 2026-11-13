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
   programs (§4.1): one job, its own process, its own unit.
   - It runs as its own systemd user unit and timer, or launchd job, beside
     the engine's, never inside it. It reads the channel's feed,
     downloads, checks and puts the copy in `<data>/engine/<version>/`,
     then points `<data>/engine/current` at it.
   - **It asks the engine, it does not replace it.** The engine answers
     whether anything runs (Turns, terminals, recent keys); once nothing
     does, `banda-update` restarts the engine's unit through systemd or
     launchd, which starts `current`. The engine no longer `exec`s a copy.
   - It updates the app too: the AppImage swap and brew move out of
     Electron main. The window only shows its state.
   - What it says is a file, `<state>/updates.json`, and its log. The
     engine serves that file on `updates.state` as now, so the widget and
     `banda update` read the same thing.
   - `banda update` calls it: `--check`, `--now`, `--version <v>`.
3. **The contract stays.** `updates.state`, `updates.check` and
   `updates.restart` keep their shape; only who does the work moves.

## Plan

| Step | What |
|---|---|
| 0 | #1702: the window keeps its engine across a move (done) |
| 1 | This ADR and the widget as variant A (decision 1) |
| 2 | `banda-update`: its crate and binary, the feed, take and check moved from `platform/updates/engine`; packed beside `banda` |
| 3 | Its unit and timer (Linux), its job (macOS); the engine's restart through the unit; the engine's `exec` goes |
| 4 | The app's update moves from Electron main into it |
| 5 | `platform/updates` keeps only the engine's answer of what runs and `updates.state` served from the file |

## Consequences

- An update no longer depends on the program it replaces staying sane.
- The window shows and asks; it decides and downloads nothing.
- A release carries one more small binary.
- Windows keeps its updates through the app until ADR 0090's service.
