---
status: accepted
date: 2026-11-04
---

# A Thread's web links open in Banda

A normal click in a Thread currently opens the system browser (#493).
Roma asked to keep web navigation in Banda and use Ctrl+click to open the
external browser. Local files (#492) are a separate change.

**Decision.**

1. A Person's normal click or Enter on an HTTP(S) Markdown link opens the
   address through `browser.open`, in the source Thread's Space. This is
   Person navigation: it focuses the new browser Pane and grants no Agent
   control. A Thread in its own window uses the existing action relay.
2. Ctrl+click opens the same address in the system browser. Ctrl is literal
   on macOS too; its native Ctrl+click context-menu event does the same
   action. An ordinary context menu keeps its browser behaviour.
3. Markdown keeps a real link's full `href`, so copying its address still
   works. Opening is supplied by the Thread through `@banda/ui`; Markdown
   names neither the browser module nor Electron. The desktop continues
   to prevent Banda's application page from navigating away.
4. A named link keeps the Agent's text, with the destination's host in
   quieter text. A bare URL is visually ellipsized at a bounded width;
   its text and href stay complete for copying. Hover shows the full
   address and explains normal click and Ctrl+click. No remote metadata
   or favicon is fetched just to draw a link.
5. This does not change local-file links, browser pages, or links in a
   Visual. Unsupported schemes are never promoted to web links.

**Consequences.** A Markdown link renderer owns the common link appearance
and click semantics. The Thread supplies its opener through context, as it
already supplies the resolver for local media. No new engine or desktop
channel is needed.
