---
status: proposed
date: 2026-11-14
---

# An Agent's pages run in a Chromium of its own machine, and a client watches them

_It carries out ADR 0062 decision 12 and the architecture vision's I7. It
amends ADR 0029 decisions 2 and 3 (the tools ask where the tab runs, not
the window) and ADR 0083 decision 4 (the Agents' profile moves to the
Project's machine). It serves [what we build](../what-we-build.md)'s
principle 9, where the work runs makes no difference ("devbox, which has no
window, passes every try of story 1"), and principle 4, close the window
and nothing is lost or stops. The evidence is
[the research](../research/2026-11-14-agent-browser-on-the-host.md)._

Roma, on 2026-11-14 (translated): "An Agent on arc, which I watch from the
Mac, loses its browser as soon as the Mac sleeps or the window is closed.
I need an Agent's browser that lives on its own machine and depends on no
window." ADR 0120's question 3 left this for its own research.

## Where it stands

- **Every browser tool asks the window**, by the kernel's road
  (`apps/browser/engine/src/lib.rs:348-431`), and is refused with "Banda's
  window is not open." when none holds it.
- **Only a window on the Agent's own machine answers.** Electron main holds
  its own engine's road (`client/desktop/src/road.ts:29-40`). An arc
  Agent's tabs open on arc's screen, while arc's window runs; the Mac's
  window never answers for arc. devbox, with no window, gives its Agents
  no browser at all.
- **The driving half is Playwright on a page**, and does not care where the
  page is: `drive.ts`, `hands.ts`, `capture.ts` and the snapshot. What is
  the window's is the edge: per-tab CDP sockets on `webContents.debugger`,
  keys through Electron, native dialogs, session partitions (research,
  section 2).
- **Measured on 2026-11-14:** Chrome for Testing's headless shell renders
  with no display, D-Bus or GPU, and Chromium's sandbox nests inside a
  fence-like namespace on arc. On devbox, Ubuntu's AppArmor rule stops the
  sandbox unless the binary has a profile. A screencast costs almost
  nothing while a page is still and 0.2–3 MB/s while it moves; a typed key
  shows on devbox 52 ms after it left, from a Chromium on arc 36 ms away.
- **T3 Code moved its Agents' browser to the server on 2026-10-06**
  (pingdotgg/t3code#15328): a pinned headless shell downloaded on first
  use, Playwright on the server, a viewer-paced JPEG screencast.

## Decision

1. **An Agent's tab runs in a Chromium of its Project's machine.**
   - `browser_open` opens it there. Every Agent tab runs there, whichever
     window, if any, is open (question 2).
   - The Person's own tabs stay in the window's Chromium, the device's
     (ADR 0062 decision 12, ADR 0101 decision 3). A tab the Person lends
     a Thread stays theirs and stays where it is, for Agents of the
     device's own machine, as ADR 0083 decision 4 built it.
   - There is one Browser App, one Pane kind (`browser.browser`), one tab
     row and one set of tools. Where a tab runs is the tab's, and the
     Pane marks a machine's tab with its machine, as it marks any other
     machine's Pane (ADR 0106 law 5). No second browser, no second door.

2. **The Chromium is Chrome for Testing's headless shell, pinned by each
   Banda release and fetched on first use** (question 1).
   - The engine fetches the zip for its system from
     `storage.googleapis.com/chrome-for-testing-public/<version>/`, checks
     its size and SHA-256 against the pin in the release, and unpacks it
     into the machine's Banda data, beside the engine. Nothing else is
     installed, and Banda ships no browser.
   - A Banda update moves the pin; the next start fetches the new one and
     drops the old. While it fetches, a call is refused in words that say
     how much has come ("Banda is fetching its browser for Agents: 40 of
     122 MB."), so no call waits past a Harness's limit.
   - It runs with Chromium's sandbox, always. Where the system refuses it
     (Ubuntu's AppArmor rule for user namespaces), a call is refused with
     the one command that allows it, `banda browser setup`, which the
     Person runs once in a terminal with `sudo` (question 4). Banda never
     starts it without the sandbox by itself.

3. **A driver beside the engine drives it** (question 3).
   - The browser's engine part starts a driver on the engine's own Node,
     as the Harnesses' ACP adapters run, while any host tab lives. It
     speaks lines of JSON to the engine part: the same requests and
     answers the window's road carries today (`Act`, `Shown`, `ReadTab`,
     `Screenshot`), so the contract does not change.
   - The driver is `drive.ts`, `hands.ts`, `capture.ts` and the snapshot,
     moved out of Electron main into the App's host part. Its `Page` comes
     from Playwright's own launch of the headless shell, over a pipe; no
     debugging port listens.
   - Keys go through Playwright's keyboard: ADR 0029's step 3b amendment
     (keys through Electron) was for a webview in a focused window and
     does not apply to a host tab.
   - Page dialogs come through CDP's `Page.javascriptDialogOpening`; the
     IDs and answers stay ADR 0060's.

4. **A profile per Project, on the Project's machine** (question 5).
   - The Agents of Project P use one persistent profile, under P's data on
     its machine, as the vision's table says. It never moves with the
     Project: cookies are secrets.
   - A profile is a folder, so each Project with a host tab has one
     Chromium process. It starts on the first call and quits a minute
     after its last tab closes.
   - Every permission a site asks for is refused: there is no camera,
     location or program to give on a machine. Downloads go to the
     machine's Downloads folder, and the answer names the path.
   - Ad blocking follows `browser.toml`'s `blocker`, with the request
     filter alone, as the Agents' profiles have it now.

5. **The waits live with the tab, in the engine.** ADR 0029 decision 6's
   three waits (Stopped, a new site, handed over) moved into main in steps
   4d to 4f because the tabs lived there. A host tab lives in the engine,
   so its waits do too, and the answer is a command of the browser's
   engine part that needs `Decide`, as the decision first said.
   - Where the Person answers: the tab's pill, in any client that shows
     the tab, and, before a Pane can show it, a card in the Thread with
     the same choices (question 6).
   - `browser.toml`'s `[agents.sites]` is the machine's (ADR 0106
     decision 7) and is read there.

6. **A client watches a host tab as a screencast, and the Person acts in
   it** (question 7).
   - A browser Pane showing a host tab streams it: `browser.watch {tab}`,
     a stream of the browser's engine part, gives JPEG frames from
     `Page.startScreencast`, at the Pane's size times the device's scale.
   - The viewer paces it: the engine acks Chromium's frame only once the
     client acked it, one frame in flight, so a slow link gets fewer
     frames, never a queue. Nothing streams while no Pane shows the tab.
   - The Person's pointer, wheel, keys and typed text go back as one act
     each (ADR 0106 law 4), and the driver dispatches them by CDP's
     `Input` domain. A copy in the page goes to the device's clipboard.
   - The Person acting there marks the tab touched, so ADR 0029 decision
     5 holds as it is.
   - Frames travel in the JSON stream as base64 until ADR 0082 decision
     11's binary frames come, which then carry them as they are.

7. **The Visual layout asks the host Chromium** (question 8). `heights` and
   `lay_out` load the Agent's HTML in a context with no profile, at the
   given widths, and answer as the window does now. The window's handlers
   for them go. Frames that size themselves (the vision's V6) may replace
   this later.

## Slices

Each slice is one PR or a few, tried by hand before the next. The first is
for Roma to try within two days.

1. **An Agent browses with no window.** The fetch, the driver, the
   profile, the eight tools routed to it, and the waits in the engine with
   their card in the Thread. No Pane shows a host tab yet: the Person sees
   the work in the tools' answers and in `browser_screenshot`'s pictures in
   the Thread. `browser_handoff` on a host tab is refused in words until
   slice 3 ("Your Person cannot see this tab yet."). _Try:_ on devbox, which
   has no window, after `banda browser setup`, and on arc with its window
   closed: "open the Banda repo's pull requests and tell me the newest
   one's title", then "take a screenshot". The answer and the picture come
   back; the Mac can sleep meanwhile.
2. **A Pane watches.** A browser Pane draws a host tab from its frames, on
   any client: the Mac watches arc's Agent. The tab row marks the
   machine. Read-only. _Mock first_, with the kit, as AGENTS.md asks.
   _Try:_ the same Thread on arc, its tab opened from the Mac and from a
   second window; close one; the frames stop when no Pane shows it.
3. **The Person acts in it.** Pointer, wheel, keys, text, the clipboard;
   the pill's Stop, the site gate and handoff in the Pane. _Try:_ an Agent
   hands over "Sign in to GitHub" on arc; Roma signs in from the Mac; the
   Agent goes on; the sign-in holds in the Project's next Thread.
4. **One road for every Agent tab.** Agents' tabs of a Project on the
   window's own machine run in the host Chromium too. The window's Agents'
   partitions and the Agents' use of its per-tab sockets go; lends stay.
5. **The Visual layout on the host** (decision 7).
6. **Later**, each an issue: binary frames; a credential broker beyond
   the Person's own sign-in (question 9); lending a device's tab to
   another machine's Agent; a Person's own program on a host tab through a
   CDP endpoint; `browser_close` if question 10 says so.

## Questions for Roma

Each with the recommended answer first.

1. **Which Chromium?**
   - **A (recommended).** Chrome for Testing's headless shell, pinned per
     release, fetched on first use: about 120 MB once per machine, no
     display, the same on Linux, macOS, Windows and arm64.
   - B. Chrome for Testing's full Chrome, headless: real Chrome and
     extensions; 190–200 MB and about twice the memory.
   - C. The system's Chromium or Chrome: nothing to fetch where one is,
     but absent on devbox and most servers, and different on each.
   - D. Electron's, from the window's app: absent where only the engine
     runs, which is the case this is for.
2. **On the window's own machine, where do the Agents' tabs run?**
   - **A (recommended).** In the host Chromium too: one road for every
     Agent tab (slice 4), and the window keeps only the Person's tabs and
     lends.
   - B. In the window's webview as now when a window is there, and in the
     host Chromium when none is (T3 Code's way): no frames on loopback,
     two implementations of an Agent's tab.
3. **Who drives it?**
   - **A (recommended).** A driver on the engine's Node, made of today's
     driving code.
   - B. The engine itself in Rust over CDP: Playwright's snapshot and
     actions written again.
   - C. Playwright MCP: a second set of tools and rules.
4. **Where the system blocks Chromium's sandbox (devbox):**
   - **A (recommended).** Refuse, and give `banda browser setup`, which
     writes an AppArmor profile with `userns` for the shell's path, once,
     with `sudo`.
   - B. Start it without the sandbox by itself.
   - C. A setting that turns the sandbox off, the Person's to set.
5. **Whose profile?**
   - **A (recommended).** One per Project, on its machine: an Agent signs
     in once for its Project.
   - B. One per machine: all Projects share sign-ins.
   - C. One per Thread: every Thread signs in again.
6. **Before a Pane can show a host tab (slice 1), where does the Person
   answer "Let this Thread use github.com?"**
   - **A (recommended).** A card in the Thread, Once, Always, Deny, as the
     pill offers.
   - B. Only `browser.toml`'s `[agents.sites]`, by hand, until slice 2.
7. **How does the Person see it?**
   - **A (recommended).** A JPEG screencast, paced by the viewer, only
     while a Pane shows the tab.
   - B. WebRTC video of a browser with a display: cheaper in motion, much
     more machinery.
   - C. Screenshots only: not live, nothing to act in.
8. **The Visual layout (E13)?**
   - **A (recommended).** The host Chromium measures it, as slice 5; V6
     may replace it.
   - B. Wait for V6, frames that size themselves.
9. **A credential broker in the first slices?**
   - **A (recommended).** No: the Person signs in inside the Agent's tab
     (handoff, slice 3). Copying a site's cookies from the Person's
     profile, or a password manager filling a field, come when asked.
   - B. Copy one site's sign-in from the Person's profile into the
     Project's, in slice 3.
10. **When does a host tab close?** It has no Pane that the Person
    closes, unless one shows it.
    - **A (recommended).** When the Person closes it in a Pane, or the
      Agent closes it: `browser_close {tab}` joins the tools. All go when
      the engine restarts; the profile keeps the sign-ins.
    - B. Also when its Thread is done (settled).
    - C. Only when the engine restarts.

## Consequences

- An Agent keeps its browser with every window closed, on any machine
  where the engine runs, and devbox's Agents get one.
- The window loses the Agents' half of the browser's desktop part once
  slice 4 lands, and keeps the Person's tabs, extensions and lends.
- A machine fetches about 120 MB on the first browser call, and each
  Project with an open Agent tab holds one Chromium process.
- A Person watching a page that keeps moving spends megabytes a second on
  the link while the Pane shows it.
- Ubuntu machines need one `sudo` command before their Agents browse.
- Not tried before this ADR: macOS and Windows, a Mac with its lid closed,
  Ghostery's Playwright package, Banda's own fence.
