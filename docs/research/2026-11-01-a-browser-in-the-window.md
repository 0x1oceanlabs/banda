# A browser in the window: how T3 Code, Codex, Atlas and Helium do it

- **Date:** 2026-11-01.
- **For:** Roma, before the browser module's ADR (ADR 0013).
- **How:** read-only. T3 Code's code was read in a local clone of
  github.com/pingdotgg/t3code at commit `1d626d02` (2026-11-01). The rest
  is from the web: official docs, Electron's and the libraries' issues and
  code, and Helium's patches. Nothing was run.
- **Status:** research only. Nothing here is an accepted Banda decision.

**Verified** means read in code or an official source. **Inferred** means
it is our reading or prior knowledge, and it is marked so.

## Summary

1. **T3 Code and Codex both show the page in an Electron `<webview>`**, not
   in a `WebContentsView`. A `<webview>` is a DOM element, so the app's
   menus and popovers sit above it by CSS.
2. **A `<webview>` must not move in the DOM**: Electron destroys its page.
   T3 keeps every page in one fixed layer and moves it over an empty slot
   that the layout places.
3. **T3's Agents drive pages with Playwright over CDP.** Electron allows
   one debugger per page, so T3 relays CDP through it and makes it look
   like a whole browser to Playwright.
4. **Chrome extensions work in Electron 45 well enough to try**, with
   `electron-chrome-extensions` and `electron-chrome-web-store`.
   `declarativeNetRequest` was fixed and backported to 45, so uBlock Origin
   Lite runs. Password managers and full uBlock Origin are the risk.
5. **A real Chrome cannot be put inside the window on Wayland.** Atlas runs
   Chromium out of process, but only through a private macOS API.
6. **Helium's look is the one to follow**: one row in its compact layout,
   tabs on the left in its vertical layout, an address bar that shows only
   the site.

## 1. T3 Code (verified, in code)

### Where the page lives

- The main window sets `webviewTag: true`
  (`apps/desktop/src/window/DesktopWindow.ts:400`). Nothing uses
  `WebContentsView` or `BrowserView`.
- **One layer for every tab.** `ElectronBrowserHost`
  (`apps/web/src/browser/ElectronBrowserHost.tsx:126-163`) draws every live
  tab's `<webview>` in a `position: fixed` wrapper, in a fixed order,
  because "Electron destroys a moved webview's guest" (`:59-63`).
- **The slot.** The layout places an empty `BrowserSurfaceSlot` div that
  publishes its `getBoundingClientRect` to a store. It publishes again on
  ResizeObserver, window resize and scroll. The `<webview>` wrapper copies
  the rect (`hostedBrowserWebviewStyle.ts:40-49`).
- **Order on screen.** The `<webview>` is a DOM element, so z-index works:
  30 by default, popovers above it.
- **Hidden tabs** move to -100000px. Tabs an Agent drives, records or shows
  in picture-in-picture stay inside the viewport at z-index -1, because
  "Electron stops compositing offscreen guests". `visibility: hidden` can
  blank a `<webview>` for good on macOS.
- **Zoom** is set with `setZoomFactor` and set again, because Electron
  resets it. Fixed-size device viewports are drawn with `transform: scale`.
- **Keys.** The page's `before-input-event` catches the app's shortcuts and
  sends them to the app, some with `host.focus()`. A click inside the page
  fires only `focus` on the host, so T3 fakes a `pointerdown` to close the
  app's popups.

### How Agents drive it

- Tools: `preview_open`, `navigate`, `snapshot`, `act`, `evaluate`,
  `wait_for`, `screenshot`, `recording_*`, `resize`, `set_appearance`,
  `dialog` (`apps/server/src/mcp/toolkits/preview/`).
- The server runs Playwright. For the desktop's page it connects with
  `connectOverCDP` to a secret loopback endpoint. That endpoint relays CDP
  through file descriptors the desktop opens when it starts the server.
  `CdpRelay.ts` makes one `webContents.debugger.attach("1.3")` look like a
  browser-level target.
- **Snapshot** returns `page.ariaSnapshot({mode: "ai"})`, an accessibility
  tree whose refs are renamed per snapshot (`t3-<generation>-eN`), plus
  visible text, the interactive elements, a PNG, and console, network and
  action timelines. Passwords are masked; the whole is capped at about
  20 KB. A snapshot taken while the page changed is thrown away.
- **Act** takes a ref, a Playwright selector or x/y. A stale ref fails with
  "take a fresh snapshot".
- **Handoff.** `SessionControl.ts` passes control between the Person and the
  Agent, finishing what runs and voiding the refs.
- Each thread is pinned to one host so "cookie/DOM state cannot jump".
  Limits: 8 Agent tabs; Agent tabs close after 30 minutes idle.

### Elsewhere and profiles

- For a remote environment, the web build and mobile, the server runs a
  headless `chrome-headless-shell` through `playwright-core` and streams
  JPEG frames from `Page.startScreencast` at about 30 fps to a `<canvas>`.
  Input goes back as `Input.dispatch*`.
- Profiles are `persist:t3code-preview-<sha256>` partitions, one per
  environment, not per project. Cookies can be imported from Chrome,
  Firefox and Safari.
- **No Chrome extensions.**

### Security

- `will-attach-webview` refuses any partition the preview manager did not
  make and forces `sandbox: true, nodeIntegration: false`.
- Permissions: clipboard write, geolocation, fullscreen and loopback
  network are allowed; clipboard read and external protocols ask.
- `window.open`: dangerous schemes denied, a `new-window` becomes a real
  popup (OAuth needs its opener), tab dispositions open a tab.
- Downloads go to a scratch folder and reach `~/Downloads` only when a
  Person started them.

### Workarounds they needed

- Keep a reference to the attached Debugger, or the GC crashes the app
  (electron#53376).
- Automation fails while DevTools is open on the page.
- Do not change the user agent: it breaks Cloudflare Turnstile.
- Give the page an opaque background, or dark pages draw white on white.
- Remount a crashed `<webview>` with backoff.
- React drops a boolean `allowpopups`; set it as a string.
- The partition is fixed once the page attaches.

## 2. Codex and Atlas

- **Codex's app** has a built-in browser with its own profile: not the
  Person's tabs, cookies or extensions (verified,
  https://learn.chatgpt.com/docs/browser.md?surface=app). The Agent opens
  pages, clicks, types, reads the page and takes screenshots. Full CDP is a
  separate "Developer mode", asked per site. The Agent confirms before
  submitting, buying or deleting. It is an Electron `<webview>`; a June
  2026 report shows a page crashing the whole app (verified,
  github.com/openai/codex/issues/30178).
- **Atlas (OWL)** runs Chromium's browser process outside the Swift app and
  talks to it over Mojo. Pages reach the app as a shared GPU layer through
  macOS's private `CALayerHost`. Reasons: crash isolation, fewer Chromium
  patches, fast builds. Agent sessions get an in-memory partition, wiped
  when they end (verified, https://openai.com/index/building-chatgpt-atlas).

## 3. Helium's look (verified, in its patches, version 0.20.3)

- Four layouts, picked in settings or by right-clicking the frame:
  - **Classic:** Chrome's tab row above the toolbar.
  - **Compact:** the tabs sit in the toolbar, one row.
  - **Dynamic:** the tab row and toolbar overlap.
  - **Vertical:** a tab column on the left (or right), collapsing to a rail
    of favicons that opens on hover; new tab at the bottom; a key folds it.
    The page is inset with rounded corners.
- An address bar that shows only the site's origin, optionally centred.
- "Zen mode" hides the top bar until hover.
- Split view, tab groups, most-recent tab switching, sleeping tabs,
  rebindable keys, local "bangs" (`!w query`), built-in ad blocking,
  installs from the Chrome Web Store.
- Sources: https://helium.computer/,
  https://github.com/imputnet/helium (`patches/helium/ui/layout/*`).

Similar (inferred): Arc keeps the address bar and pinned tabs in its
sidebar; Zen has a compact mode that hides everything; Vivaldi puts the tab
bar on any edge.

## 4. Chrome extensions in Electron (verified)

- **Built in** (`session.extensions`): unpacked folders only, loaded again
  on every start, in persistent sessions only. APIs: `runtime`, `storage`,
  `scripting`, `webRequest`, devtools, `management`, part of `tabs`.
  Electron's docs say arbitrary Web Store extensions are not supported.
- **MV3 service workers** can get Chrome APIs since Electron 35, with
  regressions since (broken in 40, fixed in 41; `webRequest` in workers
  broken in 43, fixed in 44).
- **`declarativeNetRequest`**, which uBlock Origin Lite needs, was fixed in
  electron#55155 (merged 2026-10-23) and backported to 45 (#55283).
- **Gotcha:** an extension using DNR or `webRequest` in `defaultSession`
  breaks the main process's `net.fetch` (electron#55106, "not planned").
  Extensions belong in a partition of their own.
- **`electron-chrome-extensions` 4.10.0** (2026-10-25, MIT, Electron ≥ 35)
  adds `action` (popups and badges, through a `<browser-action-list>`
  element), `tabs` and `windows` (the app adds each tab with `addTab`),
  `contextMenus`, `commands`, `cookies`, `webNavigation`, `notifications`
  and native messaging. Gaps: no in-memory sessions; extension
  `webRequest` listeners stop when the app hooks `webRequest` itself;
  popup sizing bugs; uBlock Origin and Plasmo-built extensions break on the
  `browser` namespace (#189, fix open in #190). 1Password and NordPass broke
  on some versions.
- **`electron-chrome-web-store` 0.13.0** installs from the Web Store page,
  updates at start and every 5 hours, and has allow and deny lists.
- Sources: https://www.electronjs.org/docs/latest/api/extensions,
  https://github.com/samuelmaddock/electron-browser-shell.

## 5. Other ways, and why not

- **Another program's window inside ours:** Wayland has no XEmbed; the
  host would have to be a nested compositor (verified,
  wayland-protocols#74).
- **Screencast of a separate Chromium:** JPEG frames at 10–30 fps, lag,
  and dropdowns, IME, drag and drop, the clipboard and extension popups are
  lost or rebuilt (inferred). Fine for watching an Agent, not for a
  Person's browser. T3 uses it only where it has no window.
- **CEF:** its windows are native toplevels, so the same Wayland problem
  (inferred).
- **A real Helium as a tile next to Banda under Hyprland**, driven over
  CDP: works today, with every extension, but it is outside Banda's layout,
  Hyprland only, and its CDP port opens the whole profile (inferred). A
  fallback for an extension Electron cannot run.

## 6. Giving Agents the browser

- **`--remote-debugging-port`** opens every target: the app's own page and
  its preload too, every tab and the extensions' workers, with no
  authentication. Since Electron 30 it is set only through `appendSwitch`.
- **The usual pattern** is one `webContents.debugger` per tab in the main
  process behind a filtered CDP endpoint: Waveterm (PR #2820: `/json`
  discovery on 127.0.0.1, off by default, a "CONTROLLED" badge on the tab)
  and VS Code (a per-tab "Share with Agent", token-protected WebSockets).
- Then Playwright's `connectOverCDP`, Playwright MCP `--cdp-endpoint`,
  Chrome DevTools MCP `--browser-url` and browser-use (pure CDP since
  August 2025) all work against it.
- Playwright MCP's snapshot is an accessibility tree with refs. Its
  `--allowed-origins` is "not a security boundary".
