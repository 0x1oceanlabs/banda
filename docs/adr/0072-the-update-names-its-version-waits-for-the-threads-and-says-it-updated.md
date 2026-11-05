---
status: accepted
date: 2026-11-05
---

# The update names its version, waits for the Threads, and says it updated

ADR 0041 drew Banda's update as an arrow in a circle and nothing more.
Beside the icon, a version and a word were weighed and not taken. Its
popover names the new version in full, lists the notes flat, and has
"Restart" even while Threads work. ADR 0045 kept Banda Dev's widget on
the bar and added "Update now".

Roma, on 2026-11-05: "let's update the auto-update plugin; I want a good,
thought-out design for it, a new icon and animations." Roma looked at a
mock of eight states and three icons (`artifacts/update-widget/v1.html`
in the brand workspace: A, the ring; B, the ring and the version; C, two
layers) and took B and every change the mock proposed.

## Decision

1. **Once a version is ready, the icon names it.**
   - The arrow in the circle stays. Beside it, the version as the
     notes name it (`dev.104`, `0.3.0`), on a tint of `--added`. This
     changes ADR 0041, decision 4, which weighed a version beside the
     icon and did not take it.
   - It names it while a version is ready, while Banda waits to restart
     into it (decision 3), and on macOS while one is out. While one
     downloads, the circle fills as before, with no version.
   - The line on hover says what a click does: "dev.104 is ready ·
     click to restart".
2. **The icon moves with its state, once, and calmly.**
   - Looking: a short arc runs round the circle.
   - Downloading: the circle fills, and the arrow rises a pixel and back,
     slowly.
   - Ready: the circle closes with a flash of `--added`, and the arrow
     jumps once.
   - Failed: `--destructive`, a `!` in place of the arrow, and one
     shake as it comes.
   - Updated (decision 4): the arrow leaves upward, and a check draws
     itself.
   - The widget grows into the bar as it comes and shrinks as it goes.
   - With `prefers-reduced-motion`, none of it moves.
3. **While Threads work, Banda restarts once they stop.**
   - With a version ready and a Thread at work, the popover's first
     button is "Restart when idle"; "Restart now" is the second. Until
     they stop, the popover says it waits, and has "Cancel".
   - A restart the Person asked for while the version downloaded ("Update
     now", ADR 0045) waits the same way once it is down: it no longer
     stops a turn by itself.
   - Main keeps that it waits (`update.wait`, and `update.later` to stop
     waiting) and says so on `ready` as `waits`. The window knows the
     Threads that work, so it is the window that asks for the restart,
     once none has worked for two seconds.
4. **After a restart, the new Banda says it updated.**
   - Before it installs, main writes the version it leaves and the notes
     to `update.json` in the app's folder of data. The new Banda reads it
     at its start, and when it names the version that runs, the update is
     `updated`, with `from` and `notes`. Main deletes the file either way.
   - The widget shows the check and the version for six seconds, and the
     line "Updated to dev.104". A click opens what changed, with "Got
     it". Then the window tells main (`update.seen`), and the update is
     `none` again: Banda's widget goes, Banda Dev's dims.
   - Only an AppImage restarts into a new version itself, so only it says
     so. A Banda that brew updated says nothing.
5. **The popover says where Banda goes from, and what changed, by kind.**
   - Its head is the version the Person has and the one that comes
     (`dev.97 → dev.104`), and how many versions lie between.
   - While a version downloads, a bar fills, with how much is down of
     how much (`12 of 31 MB`). electron-updater gives the bytes, of the
     changed blocks only when it downloads those.
   - A Dev's note is the title of its commit (`Built from 6e9145f:
     feat(window): …`). The popover groups the notes into New (`feat`),
     Fixed (`fix`) and Other, with the scope beside each, dimmed. Six
     show, and "Show all" shows the rest. A note in no such form stays
     in Other as it is.
   - When an update failed, "Try again" is `update.now`.

## Consequences

- `Update` gains `down` and `size` on `downloading`, `waits` on `ready`,
  and the state `updated`. The bridge gains `update.wait` and
  `update.seen`.
- ADR 0041, decision 4, and ADR 0045, decision 2, hold as this ADR
  changes them.
- `GLOSSARY.md`'s **Update** says that Banda waits for the Threads and
  says it updated.
- One PR, with this ADR.
