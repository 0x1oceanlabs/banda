# An Agent's browser on its own machine, with no window

Research, 2026-11-14, for Roma's question 3 of ADR 0120 (PR #1578): how an
Agent gets a browser that lives on its own machine and needs no window. It
serves [what we build](../what-we-build.md)'s principle 9 ("browser pages
... look and act the same in every client"; "devbox, which has no window,
passes every try of story 1") and principle 4 ("close the window and
nothing is lost or stops"). It carries out ADR 0062 decision 12 and the
architecture vision's I7. It decides nothing: the decisions are in the
draft ADR 0132 beside it.

Evidence comes in three kinds, each marked:

- **Code**: a path and lines in this repository at `ae8a8cfd`, or in T3
  Code's repository on 2026-11-14.
- **Run**: a command run on 2026-11-14 on devbox (Ubuntu 26.04, kernel
  7.0, no GPU) or arc (Arch, kernel 7.2, Intel GPU), with its output.
- **Source**: a page on the web, with its date or "accessed 2026-11-14".

What was not checked says so. The Mac was out of reach from devbox, so
nothing here ran on macOS or Windows.

## 1. Where it stands

- **Every browser tool asks the window.** The browser's engine part holds
  no pages; each of its eight tools calls `call.ask_window(...)`
  (`apps/browser/engine/src/lib.rs:348-431`). With no window the kernel
  refuses: "Banda's window is not open." (`kernel/src/window.rs:96-98`).
  ADR 0029 decision 2 chose this road on 2026-11-02.
- **Only a window on the Agent's own machine answers.** The road is one
  stream per engine, `window.requests`, held by the latest window to ask
  (`kernel/src/window.rs:10-12, 137-142`). Electron main holds it on its
  own engine only (`client/desktop/src/road.ts:29-40`,
  `Engine.use((engine) => engine.client)`). So an Agent on arc has a
  browser only while a Banda window runs on arc itself, and its tabs open
  on arc's screen. The Mac's window never answers arc's road, awake or
  asleep. Today arc runs a window under Wayland (Run: `pgrep -af banda` on
  arc shows the AppImage with `--ozone-platform=wayland`), which is why
  arc's Agents have a browser at all. devbox has no window, so its Agents
  have none.
- **The Visual layout asks the window too.** `show_visual` asks `heights`
  and falls back to the Agent's own height when no window answers
  (`apps/agents/engine/src/lib.rs:1705-1716`); `preview_visual` asks
  `lay_out` and is refused with no window (`:1752`). That is the vision's
  E13.
- **Agents' tabs already have a profile of their own**, per Project, apart
  from the Person's: `persist:agents-<project>` on the device
  (`apps/browser/desktop/src/profile.ts:1-12`; ADR 0083 decision 4). The
  vision's table puts that profile on the host later, under
  `projects/<id>/browser/agents/`, and says "Agents' profiles never move
  with a Project: cookies are secrets"
  (`docs/research/2026-11-06-architecture-vision.md:506-508`).
- **ADR 0062 decision 12 already chose the direction**: "An Agent's pages
  run by default in a headless Chromium on the host. A client sees and
  works them as a screencast over CDP, so an Agent keeps its browser with
  the laptop closed and a phone can watch it. The client's Browser stays
  ... Both are one Browser App with one set of tools; where a tab runs is
  the tab's." ADR 0106 keeps pixels for exactly this case: "They stay for a
  process that is not Banda's: the Agents' Chromium on arc, later"
  (`docs/adr/0106-*.md:888-890`). What is open is how: which Chromium, who
  drives it, how a client shows it, and in what order.

## 2. What the browser's code is made of

About 12,300 lines (Code: `find apps/browser -type f | xargs wc -l`). The
engine part is thin (732 lines); the work is in Electron main
(`apps/browser/desktop/src`) and the Pane (`apps/browser/pane/src`).

| File | What it does | On a host Chromium |
|---|---|---|
| `engine/src/lib.rs` | the eight tools, their types, the answers' words, the 20 KB cap, the page-text marks | **as is**; only where a call goes changes |
| `desktop/src/drive.ts` (944) | Playwright per tab, held between calls; `ariaSnapshot({mode:"ai"})` refs (`:659`); which Thread drives which tab | **mostly as is**: it gets a `Page` from Playwright's own browser in place of `connectOverCDP` to a per-tab socket (`:434`); the `WebContents` parts (throttling, `:130`, `:826`) go |
| `desktop/src/hands.ts` (470) | click, fill, select, drag, press on a ref; refuses password and card fields | **as is**, but keys: they go through Electron's `sendInputEvent` (`:326-354`, ADR 0029 decision 3, amended 3b, because CDP keys follow the window's focus). Headless has no window focus, so Playwright's own keyboard serves |
| `desktop/src/asked.ts` (138) | answers the road's requests; a call reaches only the tabs in its reach | **as is** in shape: the same requests and answers |
| `desktop/src/capture.ts` (56) | screenshot, fields masked in the page before the picture; resized by Electron's `nativeImage` | masking **as is**; resizing by CDP's `clip`/`scale` in place of `nativeImage` |
| `desktop/src/dialogs.ts` (282) | page dialogs with Electron's native return values (ADR 0060) | the IDs and answers as is; the edge becomes CDP's `Page.javascriptDialogOpening`, which headless gives plainly |
| `desktop/src/profile.ts` (241) | Electron session partitions; permissions asked of the Person | a persistent user-data folder per Project; every permission refused (no camera, location or other program on a server) |
| `desktop/src/blocker.ts` (96) | Ghostery's engine; Agents' profiles get the request filter alone | the same lists through Ghostery's Playwright package (not tried) |
| `desktop/src/cdp.ts` (787) | a token-scoped CDP socket per tab over `webContents.debugger` | **not needed** for host tabs: the driver owns the browser through a pipe. Stays for lent tabs |
| `desktop/src/tabs.ts`, `lends.ts` | which page is whose, what is lent | lends stay in the window (they are the Person's tabs); the host keeps its own list of Agents' tabs |
| `extensions.ts`, `popup.ts`, `keys.ts`, `preload.ts` | Chrome extensions, popups, Banda's keys in a page | **window only**: Agents' profiles have no extension already (`extensions.ts:9-16`) |
| `pane/src/BrowserPane.tsx` (1,264) and the rest | the Pane: a `<webview>`, tabs, the address, the Thread's pill and cursor | a second surface for a host tab: frames on a canvas, input sent back. The tab row, address, pill, cursor and site gate stay |

The driving half (drive, hands, capture, the snapshot) is Playwright on a
`Page`, so it does not care whether the page is a webview or a headless
tab. What is bound to the window is the edge: the per-tab sockets, keys
through Electron, native dialogs, `nativeImage`, session partitions.

## 3. Runs

All on 2026-11-14. Scripts and raw output are in the session's scratchpad,
not kept; the numbers are below.

### 3.1 What starts with no display

| Run | Machine | Result |
|---|---|---|
| Chrome for Testing 156.0.8078.4 `chrome-headless-shell`, default sandbox | devbox | **fails**: "No usable sandbox! ... Ubuntu 23.10+ ... disabled unprivileged user namespaces with AppArmor". `kernel.apparmor_restrict_unprivileged_userns = 1`, `unshare -Ur` refused |
| the same, `--no-sandbox` | devbox | renders |
| CfT 156 `chrome --headless=new`, default sandbox | devbox | crashes the same way; `--no-sandbox` renders, and a 1280×800 screenshot of github.com is written |
| Electron 45.1.0 (the window's), `--ozone-platform=headless` with no screen size | devbox | starts, but every capture is 1×1 |
| Electron 45.1.0, `--ozone-platform=headless --ozone-override-screen-size=1600,1000` (as `scripts/try.sh:221` and the e2e tests do) | devbox | renders a hidden window, a shown one and an offscreen one; `webContents.debugger` screencast gives 60 fps of an animation. Its sandbox works only because devbox has an AppArmor profile for `node_modules/electron/dist/electron` (`/etc/apparmor.d/banda-dev-electron`) |
| system Chromium 155.0.8059.84 (Arch package, 431 MiB installed), `--headless=new`, sandbox on | arc | renders |
| the same, with `DISPLAY`, `WAYLAND_DISPLAY`, `DBUS_SESSION_BUS_ADDRESS` and `XDG_RUNTIME_DIR` unset | arc | renders |
| the same inside `bwrap --unshare-user --unshare-ipc --unshare-pid --dev /dev --proc /proc`: a user namespace of its own and a `/dev` of null, zero, full, random, urandom, tty, pts, shm (no `/dev/dri`), as the fence makes (`platform/fence/src/linux/launch.rs:47, 483-513`) | arc | **renders with Chromium's sandbox on**: its namespace sandbox nests inside the outer one. Landlock's scopes, the fence's fourth layer, were not reproduced |

No GPU is needed for pages: Chromium composites in software. WebGL without
a GPU now needs `--enable-unsafe-swiftshader`, which Chromium says is not
for untrusted content (Source: blink-dev "Intent to Remove: SwiftShader
fallback", accessed 2026-11-14); the run on devbox printed that warning.

### 3.2 Size and memory

| Thing | Size |
|---|---|
| CfT 157.0.8103.78 `chrome-headless-shell` zip (Source: HTTP Content-Length on storage.googleapis.com, 2026-11-14) | linux64 122.0 MB, mac-arm64 100.0 MB, win64 120.2 MB |
| CfT 157 `chrome` zip (same) | linux64 193.9 MB, mac-arm64 187.5 MB, win64 200.1 MB |
| unpacked, CfT 156 linux64 (Run: `du -sh` of Playwright's cache on devbox) | headless shell 273 MB, chrome 403 MB |
| Electron 45.1.0 `dist` (Run) | 274 MB |
| Banda's engine folder on arc (Run) | 426 MB: `banda` 249 MB, `node` 144 MB, the ACP adapters 3 MB |
| one browser, one context, Wikipedia then GitHub then an animation (Run: sum of RSS of its processes) | headless shell 668 MB, `chrome --headless=new` 1,198 MB |
| start to a first page (Run, Playwright `launch` + `newPage`) | headless shell 100 ms, chrome 221 ms |

CfT publishes every milestone and channel with download URLs in JSON
(`known-good-versions-with-downloads.json`,
`last-known-good-versions-with-downloads.json`), for linux64, linux-arm64
(since 153), mac-arm64, mac-x64, win32 and win64 (Source:
github.com/GoogleChromeLabs/chrome-for-testing, accessed 2026-11-14). The
repository is Apache-2.0; the binaries are Chromium, whose own licence is
BSD-3 with third-party notices; that CfT's binaries carry no Chrome terms
is **not verified**. Downloading on first use, as T3 Code does, means
Banda redistributes nothing.

`chrome-headless-shell` is Chrome's old headless, split out in Chrome 120
and called deprecated. It needs no X11, Wayland or D-Bus and does less;
the new headless is the whole Chrome, extensions included (Source:
developer.chrome.com/blog/chrome-headless-shell, accessed 2026-11-14).
Playwright uses the shell by default for headless runs.

### 3.3 The screencast

`Page.startScreencast` sends a JPEG or PNG frame each time the compositor
draws a new one, and holds the next until the client acks (Source:
devtools-protocol `Page.pdl`, accessed 2026-11-14). Measured on devbox,
1280×800, JPEG, five seconds each, the bytes before base64:

| Page | Quality | Frames/s | KB/s | KB/frame |
|---|---|---|---|---|
| a static page | 60 | 0.2 | 19 | |
| Hacker News, idle | 60 | 0.2 | 16 | |
| GitHub sign-in, typing 10 keys/s | 60 | 6.4 | 163 | 25 |
| Wikipedia, scrolling 10 wheels/s | 60 | 27 | 2,850 | 104 |
| Wikipedia, scrolling 10 wheels/s | 40 | 13 | 1,060 | 82 |
| a CSS animation | 60 | 60 | 540 | 9 |
| the same, `everyNthFrame: 3` | 60 | 20 | 178 | 9 |
| Wikipedia's article, idle after 8 s | 60 | 49 | 4,990 | 102 |

The last row matters: a page that never stops moving (here Wikipedia's
article, which keeps repainting) streams megabytes a second while it is
watched. Frames are paced by acks, so a viewer that acks only once a frame
has reached it and been drawn sets the rate to what the link carries. T3
Code does exactly that: "Chromium's ack for each frame waits for the
viewer's `ack` message. Only one frame in flight"
(`apps/server/src/preview/ServerBrowserStream.ts:127-128`, quality 70 by
default, 1280 wide at most, `:89-91`).

**Over a real link.** Chromium 155 headless on arc, driven from devbox
through `ssh -L` (round trip 36 ms, Run: `ping arc`):

- a typed character to the frame that shows it: median 52 ms, p90 58 ms,
  over 15 keys;
- scrolling a long text page at 10 wheels/s: 8.7 frames/s, 337 KB/s of
  base64 on the wire, with Chromium's default of three frames in flight.

So a key echoes about one round trip plus a frame later, as a terminal on
arc does (ADR 0106's budget, one round trip per gesture).

### 3.4 Not tried

- macOS and Windows, anything: the headless shell, the sandbox, a Mac
  with its lid closed.
- Banda's own fence (`banda fence --probe`): it is off (ADR 0115), and the
  `bwrap` run above stands in for its namespaces only.
- Ghostery's Playwright package; a site that refuses a headless browser.
- Electron's Chromium on arc, and Electron on macOS with no window shown.

## 4. How others do it

From a web survey on 2026-11-14; each line's source is a product's own
page, accessed that day, unless a date is given. "Laptop closed" means the
Agent keeps its browser while the Person's computer sleeps.

| Product | Where Chromium runs | Driven by | The Person sees | Laptop closed |
|---|---|---|---|---|
| **T3 Code** (since PR #15328, merged 2026-10-06) | the environment's server: one Chromium for all tabs, CfT `chrome-headless-shell` 157.0.8103.78 pinned with its SHA-256, downloaded on first use (`apps/server/src/preview/PreviewBrowser.ts:24-30`) | Playwright on the server; one road for every tab | a JPEG screencast over an authenticated WebSocket, viewer-paced, with mouse, touch, keys and text sent back; a read-only watcher too. A desktop on the same machine draws that machine's tabs in a `<webview>` and the server still drives them | **yes** |
| Claude Code + Claude in Chrome | the Person's own Chrome | an extension, native messaging, and a relay `bridge.claudeusercontent.com` | the real window | no; the extension's worker "can go idle during extended sessions" |
| Claude Code / Codex CLI + Playwright MCP or chrome-devtools-mcp | wherever the CLI runs; `--headless`, or `--cdp-endpoint`/`--browserUrl` to any Chromium | Playwright / Puppeteer | snapshots and screenshots in the chat; nothing live | yes, with `--headless` on the server |
| Codex app | the desktop app, a profile apart; Codex cloud tasks "have their own browser inside the cloud task" | computer use; CDP in a developer mode | a pane beside the chat; for the cloud, not documented | app no; cloud yes |
| ChatGPT agent / Operator, now ChatGPT Work | OpenAI's cloud | computer use | a live view, "Take over browser" | yes |
| Cursor | editor: a web view in the client; cloud agents: a VM with a desktop | MCP in an extension; computer use | a pane; the cloud's remote desktop to take over | editor no; cloud yes |
| VS Code integrated browser (GA mid-2026) | the client; a remote's pages by a forwarded port or a proxy through the remote host | built-in chat tools; "Share with Agent" lends a page | a tab in the editor; Agents' pages get storage of their own per chat | no |
| browser-use | local Chromium, the Person's Chrome, or their cloud | raw CDP | the cloud's `live_view_url` in an iframe | cloud yes |
| Browserbase, Steel, Anchor | their cloud | CDP | an iframe; Steel streams WebRTC H.264 at 25 fps for a headful browser and the CDP screencast for headless; Browserbase records the screencast as video | yes |

Everything that keeps working with the laptop closed runs Chromium on the
Agent's side. Everything that uses the Person's own sign-ins drives the
Person's own browser and stops when it does. T3 Code, the closest to
Banda, moved its Agents' browser from the desktop's webview to the server
a month ago, with the same arguments as ADR 0062 decision 12, and its PR
lists the costs it met: the AppArmor sandbox on Ubuntu (it ships
`t3 browser setup`, which writes `/etc/apparmor.d/t3-chrome-headless-shell`
with `userns,`; `PreviewBrowserHost.ts`), Chrome's refusal to sandbox as
root, missing libraries, renderer crashes from service workers in the
shell, and a fixed scale of 2 so captures stay sharp.

## 5. The questions, with options

Each option with its cost; the pick is the draft ADR's, for Roma.

### Q1. Which Chromium

| Option | For | Against |
|---|---|---|
| **A. CfT `chrome-headless-shell`, pinned per Banda release, downloaded on first use** | 100–122 MB once per machine and version; no display, D-Bus or GPU; the same on all three systems and arm64; the version moves with Banda's own update; Banda ships nothing more; T3 and Playwright use it | old headless, called deprecated; no extensions; renderer quirks T3 met (service-worker badges) |
| B. CfT `chrome`, `--headless=new` | the real Chrome, extensions possible | 190–200 MB; about 1.8× the memory in the run; needs more system libraries |
| C. The system's Chromium or Chrome | nothing to download where it exists (arc) | absent on devbox and most servers; version and flags differ per machine; a Person's own profile lock if pointed at theirs |
| D. Electron's Chromium, from the window's app | already on a machine with the window; one Chromium version | absent where only the engine runs (devbox, a Cloud machine): the case this is for. Runs only under Ozone headless with a screen size given; ties the Agents' browser to the window's build and lifetime, against ADR 0086 |

### Q2. Who drives it

| Option | For | Against |
|---|---|---|
| A. The engine, in Rust, over CDP | one process | Playwright's `ariaSnapshot` refs, waits and actionability would be written again: the heart of `drive.ts` and `hands.ts` |
| **B. A small driver beside the engine, on the engine's own Node, the way the ACP adapters run (`adapters/*.mjs`)** | `drive.ts`, `hands.ts`, `capture.ts` and the snapshot move almost as they are; it answers the same requests the window answers today, in the same types | one more process per machine, started by the engine while a host tab lives |
| C. Playwright MCP, started by the engine | nothing to write | a second set of tools with other names and rules: no Thread on the tab, no site gate, no handoff, no lend; two doors |

### Q3. One browser per machine, per Project or per Thread

| Option | For | Against |
|---|---|---|
| per machine | one process | Agents of two Projects share sign-ins, against ADR 0083 decision 4 and the vision's decision 14 |
| **per Project** | as today's `persist:agents-<project>`, moved to the Project's machine; an Agent signs in once for its Project | one Chromium process per Project with an open tab (0.3–0.7 GB each in the run) |
| per Thread | nothing shared | every Thread signs in again |

A persistent profile is a folder, so per Project means one browser process
per Project (Playwright's `launchPersistentContext`), started on the first
call and gone a minute after its last tab closes, as T3's does.

**The credential broker** of I7 is not defined elsewhere in the vision; it
sits in its isolation part, under "injection that steals secrets ...
cookies" (`architecture-vision.md:522`). Read so, it is a way to give
an Agent's profile one sign-in without giving it the Person's cookie jar:
the Person signs in inside the Agent's tab, or one site's cookies are
copied from the Person's profile into the Project's, or a password manager
fills a field the model never sees. The first already exists as
`browser_handoff` (ADR 0029 decision 6), and a screencast the Person can
type into makes it work for a host tab. The other two are not needed for
a first slice.

### Q4. How the Person sees and acts

| Option | For | Against |
|---|---|---|
| **A. CDP screencast, JPEG, paced by the viewer's acks, only while a Pane shows the tab** | measured above: near nothing idle, 0.2–3 MB/s moving, a key in about one round trip; the Person's mouse, wheel, keys and text go back as `Input.dispatch*`; nothing streams when no one watches | a moving page costs megabytes a second; pixels lose the device's text selection, spelling and native menus (T3 had to draw `<select>` itself, its PR #31561) |
| B. WebRTC video of a headful browser (Steel) | cheaper for motion | an encoder, ICE and maybe TURN; a display on the server |
| C. Screenshots on demand | almost free | not live; the Person cannot act |
| D. Load the same address on the device | the device's own rendering | another session, other cookies, another page state; a second request to the site; it is not the Agent's page |

Signing in: the Person types into the watched tab; the keys go to the
machine over the engine's own road, which is already authenticated, and
`browser_snapshot` keeps masking password fields (ADR 0029 decision 7).

### Q5. The Person's tabs, and one door

The Person's tabs stay in the window's Chromium, the device's (ADR 0062
decision 12, ADR 0101 decision 3): their sign-ins, extensions and Web Apps
belong to the device. What must not appear is a second browser: there is
one Browser App, one Pane kind `browser.browser`, one tab row, one set of
tools, and a tab says where it runs. A browser Pane may hold tabs of both
kinds; a host tab draws from frames and is marked with its machine, as
any other machine's Pane is (ADR 0106 law 5).

One choice stays: when the window and the Agent are on the same machine,
does the Agent's tab still run in the host Chromium (one road for every
Agent tab, as principle 9 asks), or in the window's webview as now (T3's
hybrid, no frames on loopback)? One road removes the Agents' partitions
and the per-tab sockets' Agent use from the window; the hybrid keeps two
implementations of an Agent's tab.

A lent tab is the Person's, on their device. It stays as built, for
Agents of the device's own machine. Lending a Mac tab to an arc Agent
needs the device's road through the router, and is later.

### Q6. Under the fence

The engine starts the host Chromium, and the engine is outside the fence
(ADR 0083 decision 1), so the fence does not bind it. Where it would (a
Chromium an Agent starts itself, as Playwright MCP does), the `bwrap` run
on arc shows the namespace sandbox nesting inside a fence-like box with no
`/dev/dri`. The real bound is the system: on Ubuntu 23.10+ with AppArmor's
user-namespace rule (devbox), Chromium's sandbox does not start unless the
binary has a profile with `userns,`, which needs root once. Options:
refuse in words and give the one command (T3's way), fall back to
`--no-sandbox` by itself, or a setting the Person turns. A page an Agent
opens is untrusted content, so a silent fallback runs it unsandboxed on
the Person's machine.

### Q7. The Visual layout (E13)

`heights` and `lay_out` load the Agent's HTML at given widths and read its
height and console; that is a page load, which the host Chromium does as
well as the window (a context with no profile). The window measures with
its own fonts today, which already differ from the device that shows a
remote Thread, so measuring on the machine is no worse, and it answers with
no window. The vision's other road, frames that size themselves (V6),
removes the measuring altogether, and is larger. The two do not exclude
each other: the host can answer now, and V6 can replace it.

### Q8. Others

See section 4. With the laptop closed, only an Agent-side browser works.

### Q9. The thinnest first slice

An Agent on a machine with no window opens a page, reads it, acts in it
and takes a screenshot, all in the host Chromium; the Person sees it in
the Thread through the tools' answers and screenshots, with no Pane yet.
It needs the download, the driver on the engine's Node, the eight tools
routed there, and the site gate's wait in the engine. It is tried on
devbox, which has no window, and on arc with its window closed. The Pane
that watches, then acts, comes next; then one road for every Agent tab;
then the Visual layout.

## 6. Limits of this research

- The engine's Node is 144 MB of Node 24 (Run on arc); that Playwright
  runs in it as a separate script, as the ACP adapters do, is assumed, not
  tried.
- Memory figures are one run each, with one heavy page; they vary widely
  by site.
- The bandwidth numbers are JPEG bytes from Chromium at 1280×800; T3 uses
  a device scale of 2, which roughly quadruples the pixels.
- T3 Code's behaviour is read from its code and PR text, not run.
