---
status: accepted
date: 2026-11-01
---

# The browser is Chromium in a Pane, for the Person and every Agent

ADR 0005 put the browser in Banda's base, beside Threads and the terminal
(decision 15): "a Pane with a page that the Person and the Space's Agents
share, and one sign-in profile per Space", with its own ADR once it is
built. This is that ADR.

On 2026-11-01 Roma asked for "a full browser for a Person and for Agents,
with Chrome's extensions", minimal "as in Helium, with vertical and
horizontal tabs", with "our own Chrome in the middle". The evidence is
[the research note](../research/2026-11-01-a-browser-in-the-window.md): how
T3 Code and Codex show a page, how Atlas runs Chromium, Helium's layouts,
what Electron does with extensions today, and how Agents get a page.

What it found, in short:

- Banda's window is Electron, and Electron is Chromium. A page in it is a
  real Chromium page, with the GPU, DevTools and service workers. A
  Chromium or Helium of its own cannot be put inside the window on
  Wayland, which has no way to embed another program's window.
- T3 Code and Codex both show the page in a `<webview>`. T3's Agents drive
  it over CDP.
- Chrome's extensions run in Electron 45 through two libraries, with gaps.

**Decision.** Roma decided the points marked _decided_ on 2026-11-01 and
asked for the ADR; the rest are our defaults and stay his to change.

1. **The page is a `<webview>` in one layer, over a slot in the Pane**, as
   in T3 Code.
   - Every tab's `<webview>` lives in one fixed layer of the window, in a
     fixed order, because Electron destroys a `<webview>` that moves in the
     DOM. The browser Pane draws only an empty slot, and the tab follows
     the slot's place on every frame.
   - The page is a DOM element, so everything of Banda's draws over it by
     CSS: menus, the palette, notices. The page is clipped to the
     workspace, so a column half off screen shows half a page.
   - It moves with the Strip's springs, because the slot does. In the
     overview, a Pane shows a still picture of its page
     (`capturePage`), and the page comes back on zoom in.
   - A native `WebContentsView` was the other way. It sits above the whole
     page, so every animation and every menu would have to move or hide it
     through the main process.

2. **One profile** (_decided_: "один профиль, не усложняем").
   - Every tab of every browser Pane shares one persistent profile, the
     Person's: their cookies, sign-ins and extensions. It is the
     `persist:browser` partition, never `defaultSession`, where an
     extension's request rules would break the main process's own
     requests.
   - This replaces "one sign-in profile per Space" (ADR 0005, decisions 6
     and 15). More profiles come when someone needs them.

3. **The browser is the window's, not a Space's** (_decided_: an Agent
   "has access to the browser", "not only the Space").
   - It has no engine part, as the look has none: the pages live where the
     window is. A browser Pane still opens in a Space, as every Pane does,
     but the Space changes nothing in it, and its header names none.
   - A browser Pane keeps its tabs in its args: each tab's address and
     which one is shown. So it comes back as it was after a restart.
   - Several browser Panes are like several Chrome windows over the same
     profile. A tab can later leave for a Pane of its own beside it: that
     is Banda's split view.

4. **One row, as Helium's compact layout; tabs on top, or on the left by a
   button** (_decided_: "по умолчанию сверху, но можно переключить в
   вертикальные кнопкой").
   - The browser Pane draws its own header in place of the frame's: one
     row as tall as any Pane's header. The Pane contract gains a way for a
     kind to say so; the frame keeps the border, the focus and the close
     button.
   - **Tabs on top** (the default): the tabs, then back, forward and reload,
     the address, the extensions, the switch, close.
   - **Tabs on the left**: a narrow rail of favicons that opens to titles
     on hover, with the new-tab button at its bottom. The row keeps the
     rest.
   - **The switch** is a button in the row. It writes `tabs = "top"` or
     `"left"` into `~/.config/banda/browser.toml`, the way the sidebar's
     menu writes its preset (ADR 0008), and every browser Pane follows.
     `banda look` reads the file as it reads `sidebar.toml`.
   - **The address** shows only the site (`github.com`). A click or
     `Ctrl+L` opens the whole address to edit. Words that are not an
     address go to the search in `browser.toml` (`search`), DuckDuckGo
     unless it says otherwise.
   - The row takes the look's tokens. Pages follow the look's light or
     dark mode through `prefers-color-scheme`, and a tab's background is
     the theme's, so a dark page never flashes white.

5. **Keys: Alt stays Banda's, Ctrl is the browser's.**
   - The left Alt's binds work in a page as in a terminal (ADR 0005,
     decision 10). So `Alt+Left` is not "back": back is the button, the
     mouse's back button, or `Ctrl+[`.
   - The browser's keys are Chrome's: `Ctrl+T` a new tab, `Ctrl+W` close
     it (Banda closes a Pane with `Alt+W`), `Ctrl+Shift+T` reopen,
     `Ctrl+L` the address, `Ctrl+Tab` and `Ctrl+1…9` between tabs,
     `Ctrl+R` reload, `Ctrl+F` find, `Ctrl+=`, `Ctrl+-`, `Ctrl+0` zoom,
     `F12` the page's DevTools.
   - `Alt+N B` opens the browser, as ADR 0005 already says, and
     `Alt+Shift+Return` opens a new one, as Omarchy's `Super+Shift+Return`.

6. **Chrome's extensions, from the Chrome Web Store** (_decided_).
   - `electron-chrome-extensions` gives extensions Chrome's APIs: their
     toolbar buttons with popups and badges, tabs, context menus, commands,
     cookies. `electron-chrome-web-store` installs them from the Web Store
     page with its own "Add" button and keeps them updated.
   - They load into the one profile. Their buttons sit at the row's end,
     the pinned ones shown and the rest behind one menu.
   - Electron supports this less than Chrome does. On each Electron update
     we try a set: uBlock Origin Lite, Bitwarden, 1Password, Dark Reader and
     Vimium. One that cannot run in Electron is a known gap. Running a real
     Helium as a tile beside Banda is the fallback we keep in mind.
   - A popup is a view in Banda's window under its button, not a window of
     its own: Hyprland would tile one. It is as large as its page asks.
   - Tried on Electron 45.1, 2026-11-01, installed from the Web Store page:
     - Dark Reader works: its popup, and pages go dark.
     - Bitwarden installs, its worker runs and its popup shows; signing in
       was not tried.
     - 1Password installs and its popup opens, but showed nothing in the
       test; not settled.
     - Vimium installs and its popup opens; its link hints did not answer
       a key sent by the test; not settled.
     - uBlock Origin Lite installs but blocks nothing: Electron has no
       `declarativeNetRequest`. A known gap.

7. **Every Agent reaches the whole browser through CDP** (_decided_: "агент
   видит все вкладки", "просто имеет доступ к браузеру").
   - The window serves one CDP endpoint on `127.0.0.1`, with a random
     token in its path. It looks like a whole browser, and its targets are
     the browser's tabs and nothing else: never Banda's own page, its
     preload or another window. It is built on each tab's
     `webContents.debugger`, as T3's relay is.
   - So every tool that speaks CDP works with it as it is: Playwright's
     `connectOverCDP`, Playwright MCP's `--cdp-endpoint`, Chrome DevTools
     MCP's `--browser-url`, browser-use.
   - The window writes the endpoint to `$XDG_RUNTIME_DIR/banda/browser.json`,
     readable by the Person alone, and removes it when it closes.
     `banda browser` prints it. The Banda skill gets a `browser` topic
     that tells an Agent how to use it (ADR 0012).
   - `--remote-debugging-port` is never turned on: it opens Banda's own
     page too, with no token.
   - **A tab an Agent opens** opens in the browser Pane that had the focus
     last, without taking it. With no browser Pane, a new one opens as a
     column, unfocused (ADR 0005, decision 4).
   - **A tab an Agent drives** shows a mark while a CDP client is attached
     to it, and keeps drawing when it is hidden. A click on the mark stops
     it: Banda detaches the clients from that tab.
   - Banda's own browser tools for Agents (a snapshot with refs, as T3's)
     come with the MCP module, on the same endpoint.

8. **The page is kept apart from Banda.**
   - Every `<webview>` is sandboxed, without Node and with context
     isolation. The window refuses to attach one in any partition but the
     browser's.
   - A site asks the Person for the camera, the microphone, notifications
     or the location in a Banda dialog, and the answer holds for that site
     until Banda restarts. External links such as `mailto:` ask too.
   - `window.open` opens a tab, or a popup where the page needs its opener,
     as a sign-in does.
   - Downloads go to `~/Downloads`, and the row shows them while they run.
   - A crashed page shows "This page crashed" and a reload button. Banda's
     own page does not crash with it.

**Consequences.**

- `docs/architecture.md` lists the browser as an engine module. It is not
  one: it is `modules/browser/pane` and a part of `app/desktop`.
- ADR 0005's "one sign-in profile per Space" (decisions 6 and 15) gives way
  to one profile (decision 2).
- The Pane contract gains a kind that draws its own header (decision 4).
- `GLOSSARY.md` gets the browser's words, Tab first, with the first PR that
  shows them.
- Any Agent on the machine with the endpoint drives any tab, the Person's
  signed-in ones too. That is what Roma asked for; per-tab sharing, as in VS
  Code, is the way back if it proves too much.
- **The order of building**, one PR each:
  1. A page in a Pane: the layer and the slot, clipping, motion and the
     overview's picture, the profile, the page kept apart, the keys, the
     Pane's own header.
  2. Tabs: the row, tabs on top and on the left with the switch,
     `browser.toml`, the address and search, tabs kept in args, downloads.
  3. Extensions and the Web Store, tried on the set.
  4. The CDP endpoint, `banda browser`, the skill's topic, the Agent's
     mark and its stop.
- **Later:**
  - Banda's own browser tools, with the MCP module;
  - a Space on another machine and a window in a plain browser: a headless
    Chromium where the engine is, streamed as T3 Code does;
  - a tab in a Pane of its own, sleeping tabs, cookies imported from
    another browser, recording a tab.
