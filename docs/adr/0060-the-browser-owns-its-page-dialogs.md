---
status: accepted
date: 2026-11-04
---

# The browser owns its page dialogs

ADR 0029 step 4g calls for dialogs inside the browser Pane, with answers
from the Person or an Agent. Roma reviewed the interactive mockup and
chose the center of the page on 2026-11-04, then asked to implement it.

**Decision.** Alert, confirm and prompt are drawn in the center of their
page, with its origin and plain text, while other tabs and Panes remain
usable. Main owns the native callback and an opaque dialog ID. Only the
first answer to that ID wins. Agents answer through `browser_act`, under
the tab's existing site and handoff gates. Reading a blocked page returns
its dialog without trying to execute JavaScript in it.

Electron has no public replacement handler that preserves the synchronous
return values of alert, confirm and prompt. `dialogs.ts` alone replaces
its internal `-run-dialog` listener for browser webviews, restoring it on
disposal. It decodes the native input, cancels pending callbacks on native
cancellation or destruction, and keeps external CDP answers in sync. This
is a version-sensitive dependency, covered by real Electron tests; an
Electron upgrade must keep those passing. Electron also replaces the renderer's prompt() with an exception. The
browser's sandboxed preload replaces only that function, with a synchronous
IPC call that returns text or null. Main accepts it only from attached
browser webviews and exposes no other capability. This amends ADR 0013's
no-preload rule: browser pages stay sandboxed, context-isolated and without
Node; Banda supplies this one fixed preload instead of any requested path.
The CDP relay publishes prompt opening and closing events from the same
state, so external clients answer the same pending callback.

Evidence: Electron's [renderer setup](https://github.com/electron/electron/blob/v44.3.0/lib/renderer/window-setup.ts)
and [native dialog handler](https://github.com/electron/electron/blob/main/lib/browser/api/web-contents.ts).
The real end-to-end test exercises the pinned Electron binary, including
native subframe prompts. Its Electron automation client listens for native
dialogs without auto-dismissing them. The browser removes a pending native
dialog when CDP closes it, so another client's answer also removes its UI.

Before-unload is deferred: Electron's `will-prevent-unload` accepts a
synchronous decision, unlike the callback of the other three dialogs.
Reissuing a cancelled navigation could change a POST or a page's state,
so this PR keeps Electron's behavior. The mockup retains the proposed
before-unload design for a future implementation.

This amends ADR 0029 decision 3's temporary Person-only handling for these
three dialog types. The approved mockup and contract notes are in
`docs/research/2026-11-04-browser-page-dialogs*`.
