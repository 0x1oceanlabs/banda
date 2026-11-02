# Banda's own browser tools for Agents: how they should work

- **Date:** 2026-11-02.
- **For:** Roma, before an ADR for issue #151.
- **How:** read-only. Three notes beside this one hold the evidence, each
  with its sources, commits and file:line citations:
  - `2026-11-02-browser-tools-t3-code.md`: T3 Code's preview tools, read
    in its code at `47f2c8d2` (2026-11-02).
  - `2026-11-02-browser-tools-landscape.md`: Playwright MCP, Chrome
    DevTools MCP, browser-use, Stagehand, Vercel's agent-browser,
    Anthropic's browser toolset and Claude in Chrome, Atlas, Comet.
  - `2026-11-02-browser-tools-in-banda.md`: Banda's MCP module, the
    engine ↔ window link and the browser, read on main at `c95d244`.
- **Status:** research only. Nothing here is a Banda decision. The
  questions for Roma are at the end.

## What we have now

- An Agent reaches the tabs through Banda's CDP endpoint (`banda browser`,
  #142). It needs a tool of its own for that, such as Playwright MCP, and
  a shell to start it.
- A tab with a CDP session shows the Agent's mark. A click on it ends
  every session on the tab (#144). The mark names no Thread, and nothing
  stops the client from coming back (#154).
- `banda mcp` gives each Thread's Agent three tools from the agents
  module's methods (`threads`, `read`, `send`), plus `skill`. No tool is
  served by the window. No path lets the engine ask the window something
  and wait for the answer.

## What the field has settled on

1. **The page is read as an accessibility tree with short refs.**
   Playwright MCP, Chrome DevTools MCP, agent-browser, Stagehand,
   Anthropic's toolset and T3 Code all give the model lines such as
   `- button "Submit" [ref=e2]` and act by ref. Screenshots are the
   fallback, for canvas pages and such. Models already know this form.
2. **A ref lives as long as its element.** Playwright keeps a ref on the
   DOM node while its role and name stay. Chrome DevTools keys it on the
   node and the document. Anthropic says never to renumber a ref until the
   tab navigates. A stale ref fails with "take a new snapshot".
   - T3 renames every ref on each snapshot, and any frame navigation
     kills them all. Simple, but noisy on pages with live iframes.
3. **An action answers in a line, not a snapshot.** Playwright MCP tried a
   full snapshot after each action, then a diff, then dropped both: the
   snapshot now goes to a file. Chrome DevTools, Anthropic and T3 answer
   with a short line. The Agent asks for a snapshot when it needs one.
4. **Every result is capped, and says what it cut.** T3: 20 KB, shedding
   logs, then page text, then the tree, with an `omitted` list. Anthropic:
   50,000 characters. Big things (full snapshots, traces, screenshots) go
   to a file, and the answer gives the path.
5. **No image unless asked.** Harnesses replay images on every later
   request (T3's comment). A screenshot is an option of the snapshot or a
   tool of its own.
6. **The tab is named in every call, or there is one clear current tab.**
   Chrome DevTools needs `pageId` on every page tool. Anthropic adds the
   list of tabs to every result. T3 keeps a current tab per Agent session
   and refuses "pass a tabId" once it owns several.
7. **An Agent works in its own tabs.** Playwright's extension and Claude
   in Chrome give each Agent a tab group; the Person drags a tab in to
   share it. T3 fixes a tab's owner when an Agent opens it; a tab the
   Person opened is "unclaimed", and any Agent may act on it.
8. **The Person sees it and can take over.** A visible Agent cursor,
   slowed down so the eye can follow (T3: about 200 ms per pointer
   action). Stop and Take control buttons (Atlas, Steel, Browserbase,
   T3's streamed view). In T3 a take kills the refs, and the Agent's
   queued actions fail with "take a fresh snapshot".
   - T3's native desktop `<webview>` has **no** human lock: an Agent can
     click while the Person types in the same page. Banda shows pages in
     a `<webview>` too, so it must say itself what "the Person drives"
     means.
9. **Page content is untrusted.** Mark it so in the answer. Allow only
   http and https (Comet's `file://` leak is the warning). Keep secrets
   out of the context: T3 masks password fields before it cuts text.
   Anthropic keeps `javascript_exec` and `file_upload` off by default, and
   says to confirm purchases, messages, account changes and accepting
   terms before the call.
10. **Few tools by default.** Tool schemas cost tokens on every request:
    Anthropic's 27 default tools are about 6,600 tokens. Playwright and
    Vercel say a coding Agent spends fewer tokens with a CLI that writes
    big output to files.

## How it could work in Banda

A sketch for the ADR, from the three notes. Each point names its source.

### The tools

A small set, named as Playwright MCP names them, since models know those
names (landscape, lesson 25):

| Tool | What it does |
|---|---|
| `browser_tabs` | The Thread's tabs: id, address, title, which is current, who drives. |
| `browser_open` | A new tab, with an address or blank, in the Thread's Space; it does not take the focus. |
| `browser_navigate` | Address, back, forward, reload; waits for the load, with a time limit. |
| `browser_snapshot` | The tab's tree with refs, its address and title, and new console errors; capped at about 20 KB with an `omitted` list. `image: true` adds a screenshot; `file: true` writes it all to a file. |
| `browser_find` | Searches the tree by words; cheaper than a whole snapshot. |
| `browser_act` | One action on a ref, or at x/y: click, type, fill, select, press, hover, scroll, drag, upload. Answers a line, plus what changed: address, title, a new tab, a dialog, a download. |
| `browser_wait_for` | Until a text, a ref or an address shows; 15 s by default, 60 s at most. |
| `browser_dialog` | Accepts or dismisses the dialog the tab shows. |

Behind a setting, off at first: `browser_evaluate` (runs JavaScript),
the console and network lists, recording.

### The snapshot and the refs

- Built by Playwright's `ariaSnapshot({ mode: "ai" })`, as T3 does it. It
  covers frames (`f1e3` refs) and open shadow roots, and gives refs only
  to elements a pointer can reach.
- Refs as Playwright keeps them, stable while the element stays, and
  scoped to their tab. A stale ref fails with what to do next.
- Masking of password fields, and the cap, as T3 does them: mask first,
  then cut.

### Which tabs a Thread drives, and where they show

- **Its own tabs.** A tab a Thread opens is that Thread's. A tab the
  Person opened is the Person's until they hand it to a Thread. This is
  the "per-tab sharing" ADR 0013 names as the way back. It changes
  decision 7, where every Agent sees every tab.
- **In its Space.** A Thread's tab opens in a browser Pane of the
  Thread's Space, or a new one beside it, without the focus. Today it
  opens in the browser Pane focused last, of any Space. That changes
  ADR 0013 decision 3, "the Space changes nothing in it".
- **The tab names its Thread.** The mark shows the Thread's title. A
  click on the title goes to the Thread, and a stop button stops that
  Thread on that tab. The code then refuses the Thread on that tab until
  the Person hands it back (#154).
- **The Person takes over by acting.** A click or a key in a driven tab
  takes it: the Agent's next call is refused with "the Person took this
  tab", until the Person gives it back or a time passes. T3 has no such
  lock on its desktop `<webview>`; Banda would have its own.
- **The Agent's cursor shows** in the tab while it acts, as T3 draws it.

### Where the tools run

The Banda note weighs four places (Q1). Two fit Banda's rules:

- **The tools are methods.** The browser gets an engine part, a module
  whose methods carry the `tool` mark, as ADR 0019 asks: "a tool is a
  method". The kernel's Space wall and access decision run as for every
  tool, and the module knows which Thread's Agent calls.
- **The window's main process does the work.** A tool call becomes a
  request the window's main process takes from the engine, and answers.
  Main runs it with `playwright-core` over its own CDP endpoint, one
  client per Thread, so the endpoint knows which Thread drives which tab.
- **What is missing.** No path today lets the engine ask the window and
  wait. It needs one: a request stream the window holds, answered by a
  call, or a new frame in the API. MCP answers need image content. The
  module must learn the Thread from the Agent (the agents module keeps
  that map).
- **The other way, smaller and later in trouble.** `banda mcp` speaks CDP
  itself, from Rust, as `skill` is answered there. It needs no new path,
  but it breaks "a tool is a method" a second time, knows no Thread on
  the endpoint, has no Playwright, and cannot reach a Space on another
  machine.
- **No window open.** The tools are listed anyway, since `banda mcp`
  reads its list once, and refuse: "Banda's window is not open. Nothing
  was done."

### Safety

- Only http and https, and `localhost` for the Space's own dev servers.
- Page text comes back marked as the page's, not as instructions.
- Passwords masked before the cut; no secrets in answers.
- `browser_evaluate` and uploads off until the Person turns them on.
- `browser_act` is marked destructive and open-world in its MCP
  annotations, so the Harness asks the Person before it runs, under the
  Thread's mode. A confirmation of Banda's own, for purchases and
  messages, can come later.

## The order of building, if the ADR agrees

1. The ADR: the answers to the questions below.
2. The request path from the engine to the window's main process, and
   the browser's engine part with `browser_tabs` and `browser_snapshot`.
3. `browser_open`, `browser_navigate`, `browser_act`, `browser_wait_for`,
   `browser_dialog`, with the short answers and the Agent's cursor.
4. Tabs owned by Threads, shown in their Space; the mark names the Thread;
   stop per Thread; the Person takes over by acting (#154 goes in here).
5. Screenshots as image content, `browser_find`, and the opt-in tools.
6. The skill's `browser` topic names Banda's tools; the CDP endpoint stays
   for the Person's own programs.

## Questions for Roma

1. **Which tabs may a Thread drive?** Its own and those the Person hands
   it (recommended, as every other product does), or every tab, as
   ADR 0013 decision 7 says now?
2. **Where does a Thread's tab show?** In a browser Pane of the Thread's
   Space (recommended), or in the browser Pane focused last, as now?
3. **Does the Person take a tab by acting in it?** A click or a key stops
   the Agent there until the Person gives the tab back (recommended), or
   only the stop button stops it?
4. **Where do the tools run?** As methods of a browser engine part, done
   by the window's main process with Playwright (recommended), or in
   `banda mcp` over raw CDP, smaller but outside the rules?
5. **Which profile do the Agents use?** The Person's one profile, signed
   in, as now; or a separate profile for Agents, signed out, as Atlas and
   Claude Code's own browser offer?
6. **Who confirms a risky action?** The Harness's own question before a
   tool call, under the Thread's mode (recommended at first), or a
   question of Banda's before a purchase, a message or a form sent?
