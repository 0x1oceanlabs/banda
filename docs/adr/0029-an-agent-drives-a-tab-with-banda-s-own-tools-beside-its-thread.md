---
status: accepted
date: 2026-11-02
---

# An Agent drives a tab with Banda's own tools, beside its Thread

ADR 0013 gave every Agent the whole browser through a CDP endpoint
(decision 7), and left Banda's own browser tools for later. Today an
Agent needs a tool of its own for the endpoint, such as Playwright MCP,
and a shell to start it. The tab it drives shows a bot icon that names no
Thread, and a stop holds only until the client attaches again (#154).
Issue #151 asks for Banda's own tools: a snapshot with refs, and actions
on a ref.

The evidence is in five research notes of 2026-11-02, summed up in
[browser tools for Agents](../research/2026-11-02-browser-tools-for-agents.md):

- T3 Code's tools;
- the field: Playwright MCP, Chrome DevTools MCP, Anthropic's tools, Claude
  in Chrome, Atlas, Comet, Gemini;
- Codex's built-in browser;
- how others let the Person take a tab over and confirm risky steps;
- how the browser and `banda mcp` stand in Banda now.

In short:

- The field reads a page as an accessibility tree with short refs
  (`- button "Submit" [ref=e2]`). An action answers in a line, not a new
  snapshot, and every answer is capped.
- Codex's built-in browser has no lock: the Person and the Agent act in
  the same page at once. Codex gates sites in its code ("Allow access to
  this site?": once, always, deny). It leaves the decision to ask before
  "Pay" or "Send" to the model's prompt.
- Gemini, Atlas and Claude Code hand the Person the steps an Agent must
  not take: signing in, paying, signing up, accepting terms. The Person
  says "carry on" when done.

**Decision.** Roma decided the points marked _decided_ on 2026-11-02 and
saw [a mockup](../research/2026-11-02-browser-tools-mockup.html) of the
tab, and accepted the whole on 2026-11-02. The rest are our defaults
and stay Roma's to change.

1. **Every tab** (_decided_), as ADR 0013 decision 7 says. A Thread's
   Agent may read and drive any tab, the Person's signed-in ones too, in
   the Person's one profile (_decided_, ADR 0013 decision 2).

2. **The tools are methods of the browser's engine part, and the window
   does them** (_decided_: "через движок").
   - The browser gets an engine part, `modules/browser/engine`, of Space
     scope, so a call carries the Agent's Space and meets the kernel's
     wall. The pages stay the window's; that ends only ADR 0013 decision
     3's "it has no engine part".
   - Its methods carry the `tool` mark, as ADR 0019 decision 3 asks.
     Reading (`tabs`, `snapshot`) needs `Read`. Acting needs `Write`, and
     its MCP annotations say destructive and open-world.
   - **The kernel gets a road to the window**, for every module, as the
     terminal's tools will want it too. A module's method asks the
     window and awaits the answer, within a time limit it gives. The
     window holds one stream for the machine, `window.requests`, and
     answers by `window.answer`. Both need `Run`, as the terminal's
     Person-only stream does, so no Agent can hold or answer them. One
     window holds the stream at a time.
   - With no window, the ask refuses: "Banda's window is not open.
     Nothing was done." The tools are still listed, since `banda mcp`
     reads the list once. Past its limit, a call refuses and says the
     action may have run, with a code of its own, `may_have_run`, so an
     Agent looks before it asks again (amended in step 3a).
   - **Main holds the stream**, as an API client of its own: it has the
     engine's port and secret, and the stream is a scoped resource that
     ends with the window (ADR 0020). The page is not on the road.
   - **A call knows its Thread.** Each Thread has an Agent of its own,
     and the call carries that Agent, so the browser's engine part tells
     the window which Thread acts with no change to passes. The window
     finds the Thread and its title by the Agent in `agents.threads`, for
     the tab. (Amended in step 2: a pass naming its Thread proved
     needless.)
   - Main does the work with `playwright-core`, loaded on the first call.
     It connects to its own CDP endpoint once for each tab a Thread acts
     on, to a socket whose one target is that tab, so it attaches to no
     other; it holds the connection, where a snapshot's refs live, until
     the tab goes or the Person stops the Agent there. It keeps which
     Thread drives which tab. (Amended in step 2c: one connection per
     tab, as one that sees every tab attaches to every tab.)
   - No call waits for the Person: a Harness drops a long call (Codex's
     default is 60 s). Where the Person must act, the call refuses and
     says what to wait for (decision 6).

3. **The tools**, with Playwright MCP's names where it has one:

   | Tool | What it does |
   |---|---|
   | `browser_tabs` | Every tab: its id, address, title, which Pane and Space, and which Thread drives it. |
   | `browser_open` | A new tab beside the Thread (decision 4), with an address or blank. |
   | `browser_navigate` | Address, back, forward, reload; waits for the load. |
   | `browser_snapshot` | The tab's tree with refs, its address and title, and new console errors. |
   | `browser_act` | One action on a ref: click, type, fill, select, press, hover, scroll, drag; accepting or dismissing the tab's dialog comes with step 4. |
   | `browser_wait_for` | Until a text, a ref or an address shows; 15 s by default, 60 s at most. |
   | `browser_handoff` | Hands the tab to the Person for a step that is theirs (decision 6). |

   - A tab's id is its page's, for as long as Banda runs (amended in step
     2b): a page knows no Pane's tab id, and an Agent lists the tabs again
     after a restart anyway. Which Pane and Space come with step 4.
   - The snapshot is Playwright's `ariaSnapshot({ mode: "ai" })`, as T3
     Code makes it. A ref lives as long as its element. A stale ref
     refuses with "take a new snapshot".
   - An action answers in a line, plus what changed: the address, the
     title, a new tab, a dialog, a download.
   - Keys go to the tab through Electron, not CDP: a tab is a webview in
     Banda's window, and CDP's keys go where the window's focus is, as
     the Person's Thread. Mouse actions stay Playwright's. (Amended in
     step 3b.)
   - A dialog a page shows waits for the Person, who answers it as
     always, and the answer says so. The Agent's accept and dismiss come
     with step 4, when Banda draws a page's dialogs itself: Electron's
     own box cannot be tried in the headless tests, which it ends.
     (Amended in step 3b.)
   - Every answer is capped at about 20 KB and says what it left out.
   - Page text comes back marked as the page's, not as instructions. Only
     http, https and `localhost` addresses open.
   - Later, behind a setting: screenshots as image content (`said` gains
     an image kind), `browser_evaluate`, uploads, the console and network
     lists.

4. **A Thread's tab opens beside the Thread, and shows that the Thread
   drives it** (_decided_: "в панели возле него", the look to be drawn).
   - `browser_open` opens the tab in a browser Pane in the column right of
     the Thread's Pane, or in a new one there. The tab does not take the
     focus. When the Thread's Pane is not shown, the tab opens in the
     Thread's Space, in the browser Pane focused last, or in a new one.
     The window finds the Thread by the Agent the call came from: each
     Thread lists its own (`Listed.agent`), and `WindowApi.beside` says
     where its Pane is. (Amended in step 4a.)
   - A Thread drives a tab from its first call there until its turn
     ends, the Person stops it, or the tab closes. Stopping the turn ends
     it too. Main tells the tab's Pane which Agent drives it and the step
     it takes; the window, which lists each Thread's turn, tells main
     when it ends, and main lets the tab go. A Thread that calls with no
     turn running, as a test's Agent does, drives until it is stopped.
     (Amended in step 4b.)
   - While it drives, the tab shows it, as the mockup's second variant
     does:
     - a bot icon on the tab, a stop on hover;
     - a soft glow round the page;
     - the Agent's cursor, labelled with the Thread, which moves to its
       target before it clicks;
     - a glass pill at the foot of the page with the Thread's title, the
       step it takes and Stop. A click on the title goes to the Thread.
   - Banda draws them in the window's top layer, over the page and not in
     it, so the page never sees them.
   - A tab driven through the CDP endpoint by a program of the Person's
     keeps the plain bot icon, as now. A Thread's Stop ends only that
     Thread there, not the Person's programs.

5. **No lock: the Person and the Agent act in the tab at once**
   (_decided_: "а без блокировки", as Codex's built-in browser).
   - The Person's clicks and keys go to the page as always. Nothing
     pauses the Agent.
   - Main notes a mouse press, a key or a wheel of the Person's on a
     driven tab, once until the next snapshot. The next answer to that
     Thread then says: "The Person also acted on this page since your last
     snapshot. Take a new snapshot before you act by ref." (Roma's yes,
     2026-11-02.) Each Thread that called on the tab hears it once, as
     its own: main knows the Thread by the Agent the call came from,
     which is that Thread's alone. (Amended in step 4a.)

6. **A Thread waits for the Person, for one of three reasons.**
   - **Stopped** (#154): the Person pressed Stop.
   - **A new site** (B below): the Thread may not use the site yet.
   - **Handed over** (E below): the Agent called `browser_handoff`.

   While it waits, the Thread's calls on that tab, or that site, refuse
   and say why and what to wait for. The pill turns orange and asks:

   | Reason | The pill | The Person's answer |
   |---|---|---|
   | Stopped | "Stopped <Thread>" | Let drive again |
   | A new site | "Let <Thread> use github.com?" | Once, Always, Deny |
   | Handed over | "Your turn: <why>" over the page | Done — hand back |

   - The answer is a command of the browser's engine part that needs
     `Decide`, so only a Person gives it.
   - A new site's answer and "Done" also write a line into the Thread as
     the Person's message, by `agents.send` ("github.com: allowed once.
     Carry on."). The Agent's turn has ended, and the message starts its
     next one.
   - The engine part writes each wait and its answer as events, so the
     browser's Watch marks the Thread as asking, and ADR 0011's sound,
     notification and sidebar call the Person as for a Question.
   - Once holds for that Thread until Banda restarts, as a site's camera
     answer does (ADR 0013 decision 8). Always and Deny go to
     `browser.toml`'s `[agents] sites`, which Settings shows and edits.
   - Amended in step 4d, for Stopped:
     - The wait lives with its tab in the window's main process, not in
       the engine part, and ends with the tab. A tab's ID lasts only as
       long as the window, so events in the engine would outlive the tabs
       they name.
     - The answer goes over the window's bridge, which no Agent reaches.
       That guarantees what `Decide` would: only the Person answers.
     - Stopping calls nobody, since the Person just did it. The Thread
       asks once it calls on the tab again and is refused. From then on,
       the browser's Watch lists the wait with `Listed.on`, its Agent.
       The window draws that wait on the Thread's row, not on a row of
       its own, and calls the Person as for a Question.

7. **Who confirms a risky step: A, B and E first** (_decided_).
   - **A. The Harness asks**, as before any tool, under the Thread's mode
     (ADR 0003), from the tools' annotations. Nothing new in Banda.
   - **B. A site needs the Person's yes, in Banda's code.** A Thread's
     first read or action on a site it may not use yet waits for the
     Person (decision 6). `localhost` and `127.0.0.1` never ask.
   - **E. Some steps are the Person's.**
     - In code, in main: `browser_act` refuses to type or fill a password
       field, or a card's number, expiry or code, by their input type and
       `autocomplete`. Snapshots mask those fields before the cut, so a
       password never reaches the model.
     - In the tools' words and the skill: signing up, accepting terms,
       and the final press to pay, send money or post publicly. For those
       the Agent calls `browser_handoff` with why (decision 6).
   - C (Banda pausing by itself at a form sent, a download, a risky
     page) and D (a confirmation mode per Thread) come later, if A, B and
     E prove too little.

**Build order.** One PR each; `scripts/check.sh` passes after each.

1. This ADR, with the mockup.
2. The road, in three PRs. 2a: `window.requests` and `window.answer` in
   the kernel, and a `Call::ask_window`. 2b: main as an API client
   holding the stream; the browser's engine part with `browser_tabs`;
   the refusal with no window. 2c: `browser_snapshot`, Playwright in
   main.
3. Acting, in two PRs. 3a: `browser_open` and `browser_navigate`, with
   the short answers and `may_have_run`; a tab opens in the browser Pane
   focused last, as one the CDP endpoint opens, until step 4. 3b:
   `browser_act` and `browser_wait_for`; the Person's input noted
   (decision 5); E's refused and masked fields.
4. The Thread on the tab, in seven PRs (amended in steps 4a, 4b and
   4c). 4a: tabs open beside the Thread; the Person's input noted for
   each Thread. 4b: the icon, glow and pill, as the mockup's second
   variant; a Thread drives a tab until its turn ends; the pill's Stop.
   4c: the Agent's cursor: before `browser_act` acts on an element, main
   tells the tab's Pane where the element is and waits 300 ms while the
   cursor glides there. 4d: the Stopped wait with its answer, events and
   calls (decision 6, closing #154), which the other two waits build on.
   4e: `browser_handoff` and its wait, "Done" writing into the Thread.
   4f: B's site gate, `[agents] sites` in `browser.toml` and Settings.
   4g: a page's dialogs drawn by Banda, which the Agent may accept or
   dismiss, shown to Roma as a mockup first.
5. Screenshots as image content, and the tools behind a setting.
6. The skill's `browser` topic names Banda's tools. The CDP endpoint
   stays, for the Person's own programs.

**Consequences.**

- ADR 0013 decision 3 changes: the browser has an engine part, which
  holds no pages. `module.toml` and `docs/architecture.md` say so.
- ADR 0013 decision 7 holds: every tab, through Banda's tools now, and
  the endpoint for programs. A tab opened through the endpoint still opens
  in the browser Pane focused last.
- The kernel gains a road from a module to the window, and the window's
  main process becomes an API client. The terminal's tools can use the
  road too.
- `banda mcp` stays a pipe; the tools are the browser module's methods.
- Main ships `playwright-core`, loaded on the first tool call.
- `GLOSSARY.md` gets "drives" (a Thread drives a Tab) and "hand to the
  Person", with the PR that shows them.
- The Thread Pane shows the Person's answers as their messages, not as a
  card of the browser's: it shows only the Harness's Questions. A
  question of a module's own in the Thread can come later, for every
  module.
