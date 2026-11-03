---
status: accepted
date: 2026-11-03
---

# Banda Dev updates now, from the bar

ADR 0041 has Banda look for a new version a minute after the start and then every hour, and install it when the app quits. Its widget draws nothing while there is no new version. "Check for updates" sits in the Banda menu. On 2026-11-03 Banda Dev sat on dev.97 while dev.101 was out, and Roma asked: "so that I could update with a button in the widget." Roma looked at a mock of four states and took it.

**Decision.**

1. **Banda Dev's widget is always on the bar.**
   - With nothing new, it is the arrow in a dashed circle, dimmed.
   - Its popover names the running version, says when Banda last looked, and has "Update now".
   - Banda keeps ADR 0041's widget: nothing while there is nothing to say.
   - Banda Local has no update, and no widget.

2. **"Update now" looks, downloads, and restarts into the new version as soon as it is down.**
   - `update.now` is a new action:
     - With a version ready, it is `update.restart`.
     - While a version downloads, Banda restarts once it is down.
     - Otherwise it looks now, and the widget says it is looking.
   - What the look finds shows in the popover:
     - A new version downloads, with its notes and the circle that fills. The line says that Banda restarts when it is down.
     - No new version: "You have the newest Banda Dev", and when Banda looked.
     - A look or a download that failed for want of a network says so here ("Could not update: …"), though ADR 0041 keeps it quiet when Banda looks by itself, because here the Person asked.
   - While Threads work, the popover warns that a restart stops their turns, as ADR 0041's does.
   - "Don't restart" (`update.later`) keeps the download and installs it on quit, as ADR 0041 has it.

3. **In Banda Dev, the Banda menu's "Check for updates" is a look the Person asked for.** The widget shows what it finds, as above, but it does not restart. In Banda the look stays quiet, as ADR 0041 has it.

**Consequences.**

- `Update` gains `always` (the widget stays on the bar), `looking`, `looked` and `missed` on `none`, and `restarts` and `notes` on `downloading`.
- ADR 0041, decision 4, holds for Banda. For Banda Dev it holds as this ADR changes it.
- One PR, after ADR 0041's step 4 (PR #407), on top of it.
