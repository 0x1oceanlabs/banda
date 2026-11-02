# Browser tools for Agents: how they fit Banda today

Companion to `2026-11-02-browser-tools-for-agents.md` (issue #151).

Read on origin/main at `c95d244` (2026-11-02). Every path is relative to the
repo root. Read-only: nothing in the repo changed.

Issue #151 asks for "a snapshot of a page with refs to its elements, and
acting on a ref (click, type, navigate, read)", "with the MCP module, on the
same endpoint, so an Agent in a Thread needs no tool installed". It also asks
which tab a Thread drives, and how the Person sees and stops it.

---

## 1. The MCP module today

### Transport and process

- `banda mcp` is a stdio MCP server. It reads one JSON-RPC message per line
  and writes one answer per line (`engine/src/mcp.rs:10-14`, `:52-84`).
- It is a pipe. On the other side it is a WebSocket client of the engine's
  API, the same client the CLI uses (`engine/src/mcp.rs:118-131`,
  `engine/src/client.rs:27-45`).
- It needs two variables: `BANDA_TOKEN` (the pass) and `BANDA_ENGINE` (the
  API's `ws://127.0.0.1:<port>/ws`) (`engine/src/mcp.rs:5-8`, `:54-65`).
- It speaks four methods: `initialize`, `ping`, `tools/list`, `tools/call`
  (`engine/src/mcp.rs:103-115`). It asks the client nothing, and it answers
  no notification.
- It handles one message at a time, in order (`engine/src/mcp.rs:68-82`). A
  long tool call blocks the next call of the same session.
- `client.ask` waits for its answer with no timeout
  (`engine/src/client.rs:92-122`).
- It advertises `capabilities: { tools: {} }` and no `listChanged`
  (`engine/src/mcp.rs:176-182`). The tool list is read once, when it first
  connects (`engine/src/mcp.rs:117-131`). So tools cannot appear later, for
  example when the window opens.

### How a Harness gets it

- `banda serve` builds a `Pipe`: its own program path and the engine's URL
  (`engine/src/serve.rs:47-52`). The agents module gets it with `.piped()`
  (`engine/src/serve.rs:55`, `modules/agents/engine/src/lib.rs:110-117`).
- For each session it asks the kernel for a new pass, and makes the
  program `banda mcp` with the two variables
  (`modules/agents/engine/src/lib.rs:69-96`, `kernel/src/space.rs:352-356`).
- ACP hands it to the Harness as a stdio MCP server named `banda`, in
  `session/new`, `load` and `resume` (`modules/agents/engine/src/acp.rs:531-544`,
  `:660-694`, `:729-742`).
- Both Harnesses go through ACP adapters: Claude Code through
  `@agentclientprotocol/claude-agent-acp`, Codex through
  `@agentclientprotocol/codex-acp` (`modules/agents/engine/src/settings.rs:200-215`).
  So there is one path for both. No Harness config file is written
  (ADR 0019, `docs/adr/0019-…md:33-36`).
- The engine's test checks the variables and the tool list
  `["threads", "read", "send", "skill"]` (`engine/tests/engine.rs:309-339`).

### How tools are declared

- A line in a module's `methods!` table that ends `, tool "<name>"` is a
  tool (`kernel/src/methods.rs:15-17`, `:184`, `:252-260`).
- Its description is the method's `///`, its input schema the params' JSON
  Schema via `schemars` (`kernel/src/methods.rs:55-82`).
- `Module::tools` returns them (`kernel/src/module.rs:55-60`). The kernel
  answers `spaces.tools` with all modules' tools (`kernel/src/kernel.rs:503-505`).
- Today there are three: `threads`, `read`, `send`, all in the agents module
  (`modules/agents/engine/src/lib.rs:176`, `:179`, `:188`).
- The fourth, `skill`, is answered inside `banda mcp` itself, with no engine
  (`engine/src/mcp.rs:146-148`, `:197-216`). It is the one precedent for a
  tool that is not a method.
- ADR 0019 says "There is no other way to make a tool"
  (`docs/adr/0019-…md:56-61`). `skill` is its stated exception
  (`docs/adr/0019-…md:70-73`).

### Identity

- A pass is 32 random bytes in hex, kept in memory, one per session opened,
  and it names `(AgentId, SpaceId)` (`kernel/src/passes.rs:1-37`).
- Since ADR 0006, each Thread has its own Agent, made with the Thread
  (`modules/agents/engine/src/lib.rs:842-850`). So a pass names one Thread.
  But the kernel knows only the AgentId. The agents module maps it back
  with `store::thread_of` (`modules/agents/engine/src/store.rs:819-830`),
  as `send` does (`modules/agents/engine/src/lib.rs:544-549`).
- A module "reads no other module's" tables and reaches others "only by
  commands and events" (`kernel/src/module.rs:28-33`). So a new browser
  engine module would know the caller's AgentId, not its Thread or title,
  unless it follows the agents module's events (the `ThreadStarted` fact
  carries `agent`, `modules/agents/engine/src/lib.rs:845-850`) or the kernel
  gives it more.
- The pass is not a wall against a program that lies. The Thread's mode is
  the wall for what the Agent runs (`docs/adr/0019-…md:52-54`).

### Permissions

- Every call passes the Space wall and the access decision in the kernel
  (`kernel/src/kernel.rs:329-380`).
- `access::within`: a pass works only in its own Space
  (`kernel/src/access.rs:65-78`). A walled call that names no Space runs in
  its own (`kernel/src/kernel.rs:456-460`).
- `access::decide`: an Agent may `Read` and `Write`; it may not `Manage`,
  `Decide` or `Run` (`kernel/src/access.rs:27-47`). `Run` is "run programs as
  the Person, as a terminal does" (`kernel/src/access.rs:23-25`).
- A machine-scope module refuses any pass: "An Agent's pass is for its
  Space, not this machine" (`kernel/src/kernel.rs:283-290`, `:462-470`). So
  an Agent cannot call `workspaces.open` today.
- `rules::can` is not a tool permission. It says what a Person may do with
  each turn (stop, retry, edit, withdraw, steer)
  (`modules/agents/engine/src/rules.rs:206-231`; ADR 0014 decision 2).
- The Harness may still ask the Person before an MCP tool call, under the
  Thread's mode (ADR 0003; `docs/adr/0019-…md:52-54`).

### How an answer flows back

- `tools/call` finds the tool, calls its method with a fresh `CommandId`, and
  the method's JSON answer becomes one text block
  (`engine/src/mcp.rs:142-170`, `:184-187`).
- A refusal becomes `isError: true` with "Refused (code): … Nothing was
  done." (`engine/src/mcp.rs:189-195`). An unknown tool is a tool error too
  (`engine/src/mcp.rs:150-155`). Only a broken engine is a JSON-RPC error,
  and the next call connects again (`engine/src/mcp.rs:164-168`).
- `said` makes only `{"type":"text"}` content (`engine/src/mcp.rs:184-187`).
  An image answer (a screenshot) needs a new content kind there.

### Size limits

- Banda sets none: not in `banda mcp`, not in the API. The API's only
  constants are the event page size (500) and the hello timeout
  (`kernel/src/api.rs:45-48`). The WebSocket limits are the libraries'
  defaults (tungstenite: 64 MiB message, 16 MiB frame; I did not check the
  versions pinned).
- The Harness caps what it reads of a tool's output (Claude Code has an MCP
  output token limit). Not checked here. T3 Code caps a snapshot at about
  20 KB (`docs/research/2026-11-01-a-browser-in-the-window.md:73-77`).

### Is any tool served by the window? Is there an engine→window request path?

No to both.

- All three method tools are agents-module methods. `skill` is answered in
  `banda mcp`.
- The browser module has no engine part (`modules/browser/module.toml:1-14`,
  `modules/browser/pane/src/index.ts:1-3`, `:13-15`). It has no tools.
- No path today lets the engine ask the window something and wait for the
  answer. Section 2 lists what exists.

---

## 2. The engine ↔ window link

| Channel | Direction | What it carries | Where |
|---|---|---|---|
| The engine's first line | engine → window main, once | port, secret, `window` (the door's path), `browser` (browser.json's path) | `engine/src/serve.rs:66-76`; `app/desktop/src/engine.ts:21-32`, `:57-77`, `:98-108` |
| The engine's stdin | window → engine | held open; closing it stops the engine | `engine/src/serve.rs:86-102` |
| The engine API (WebSocket) | page → engine calls; engine → page events and stream pieces | `hello`, `call`, `subscribe`, `stream`; no frame where the engine asks a client | `kernel/src/api.rs:1-23` |
| Who is the API client | the **page** (renderer), as owner | main hands it the address and secret over IPC; main never connects | `app/desktop/src/main.ts:177`; `app/web/src/App.tsx:17` |
| The door, `window.sock` | CLI → window main | one JSON line in, one line out; one command: `menu`; handlers are sync (`(value) => string`) | `app/desktop/src/door.ts:1-51`; `app/desktop/src/main.ts:282-287`; `engine/src/main.rs:434-443`, `:478-499`; path `engine/src/places.rs:87-90` |
| `browser.json` | window main → CLI | CDP endpoint, its WebSocket, port; mode 0600; removed when the window closes | `app/desktop/src/cdp.ts:677-689`; `engine/src/places.rs:92-95`; `engine/src/main.rs:445-476` |
| Electron IPC | page ↔ main | e.g. `browser:news` main → page; `browser.created`, `browser.stop` page → main | `app/desktop/src/main.ts:229-237`; `app/desktop/src/tabs.ts:53-54` |
| Watches | engine events → page, per Space | what a module's work calls the Person for, and the sidebar's lists | `app/ui/src/pane.ts:177-199` |

What follows:

- The engine never connects to `window.sock`. Only the CLI does
  (`engine/src/main.rs:436-438`).
- The engine does not know if a window is open. Only `banda browser` checks,
  by reading `browser.json` and connecting to its port
  (`engine/src/main.rs:454-462`).
- The window's main process does not speak the engine API.
- The engine can push to the page only by events of the log or by a module
  stream the page opened (`kernel/src/api.rs:11-21`,
  `kernel/src/module.rs:11-15`).

What an engine-side tool would need to reach the browser, by option:

1. **A request stream.** A Space-scoped engine module (say `browser`) with
   tool methods. A tool call parks a request. The window holds a `stream`
   per Space (a Watch-like part, or main as a new API client) and gets each
   request as a piece. It answers with a `call` such as `browser.answer`.
   This uses only primitives the API has (`kernel/src/module.rs:77-84`).
   It needs the browser module to grow an engine part, against ADR 0013
   decision 3 ("It has no engine part", `docs/adr/0013-…md:58-62`).
   Requests and answers would be Rust types, so ADR 0014 holds.
2. **A new API frame.** A client says "I serve tools X", and the engine
   routes tool calls to it. Nothing like it exists. It is a contract change
   in `kernel/src/api.rs`.
3. **The door.** `banda mcp` (or the engine) writes to `window.sock`. The
   door would need async handlers, bigger answers, and more commands
   (`app/desktop/src/door.ts:14`, `:26-28`). It is outside the contract: it
   is a local socket the window has, not a module's API.
4. **No engine at all.** `banda mcp` reads `browser.json` as `banda browser`
   does, and speaks CDP to the window's endpoint itself. It finds the state
   folder with `Places::from_env` (`engine/src/places.rs:66-74`), which
   needs `BANDA_STATE` to reach the Harness's child if it was moved. The
   adapter's env is set in `modules/agents/engine/src/acp.rs:561`.

---

## 3. The browser today

### Services in the window's main process (Effect, ADR 0020)

- `Tabs` (`app/desktop/src/tabs.ts:27-93`): the set of tab pages
  (`WebContents` of type `webview`), a stream of attached/gone, `create(url)`,
  `created(request, id)`, `tell(news)`.
  - `create` sends `{kind: "create", request, url}` to the page and waits
    10 s for `browser.created` (`app/desktop/src/tabs.ts:22`, `:67-83`).
  - It knows no Space, Pane or Thread.
- `Cdp` (`app/desktop/src/cdp.ts:122-131`): `endpoint` and
  `stop(page: number)`.
  - Serves on `127.0.0.1:0` with a 24-byte token in the path
    (`app/desktop/src/cdp.ts:139`, `:592-616`). It refuses any request with an
    `Origin`, or with a host other than its own (`app/desktop/src/cdp.ts:620-631`).
  - It looks like a whole Chrome. Targets are the tabs only. One profile:
    `createBrowserContext` is refused (`app/desktop/src/cdp.ts:376-497`).
  - Each tab's `webContents.debugger` is attached while any client uses it,
    ref-counted (`app/desktop/src/cdp.ts:173-210`). Each client session is
    its own Chromium session via `Target.attachToTarget` with `flatten`
    (`app/desktop/src/cdp.ts:274-311`, `:695-704`).
  - A client is a scope; leaving detaches everything it used
    (`app/desktop/src/cdp.ts:553-590`).
  - A client has no identity. Its record is `send`, `leave`, `scope`,
    `discover`, `autoAttach`, `sessions`, `own` (`app/desktop/src/cdp.ts:95-109`).
  - `Target.createTarget` calls `tabs.create(url)` (`app/desktop/src/cdp.ts:476-481`).
    `closeTarget` and `Page.close` ask the Pane to close the tab
    (`app/desktop/src/cdp.ts:482-486`, `:539-544`).
- `Browser` (`app/desktop/src/browser.ts:49-110`): profile, permissions,
  downloads, keys, extensions. It registers each attached `<webview>` with
  `Tabs` (`app/desktop/src/browser.ts:129-134`).
- The layers are put together in `app/desktop/src/main.ts:109-129`.

### Three ids for one tab

| Id | Type | Who makes it | Where |
|---|---|---|---|
| Pane tab id | string `newId()` | the browser Pane; kept in its args, so it survives a restart | `modules/browser/pane/src/tabs.ts:8-12`, `:132-135` (`browserAt`) |
| Page id | number, `webContents.id` | Electron; what `BrowserNews` and IPC use | `modules/browser/pane/src/desktop.ts:25-42`; `app/desktop/src/tabs.ts:95-101` |
| CDP `targetId` | string | the tab's debugger, asked once | `app/desktop/src/cdp.ts:142-144`, `:182-188` |

Only the Pane tab id lasts across restarts. The other two die with the page.

### How a tab maps to a Pane, a Space and a Thread

- A Pane belongs to a Space: the workspaces module keeps
  `Shown { space, kind, args }` (`modules/workspaces/engine/src/model.rs:83-89`).
- The browser Pane gets `space` in its props (`app/ui/src/pane.ts:72-75`)
  but does not read it (`modules/browser/pane/src/BrowserPane.tsx:106`).
  ADR 0013 says the Space "changes nothing in it, and its header names
  none" (`docs/adr/0013-…md:58-62`).
- A tab knows no Space and no Thread. Nothing in `Tabs`, `Cdp` or
  `BrowserNews` carries one.

### How a tab is opened for an Agent

- CDP `Target.createTarget` → `Tabs.create` → news `create` to the page
  (`app/desktop/src/tabs.ts:67-83`).
- The page opens it in the "front holder": the browser Pane focused last,
  else the last Pane that holds a tab (`modules/browser/pane/src/pages.ts:398-412`,
  `:429-435`). Any Space's Pane.
- With no browser Pane, the module's `start` opener opens a new one,
  unfocused: `window.open(pane, undefined, { focus: false })`
  (`modules/browser/pane/src/index.ts:49-56`; `pages.ts:414-427`).
- With `space` undefined, the window opens it in the focused Space, else
  home (`app/web/src/shell/Shell.tsx:266-272`). The window API can take a
  Space (`app/ui/src/module.ts:24-30`), and `browser.open` already passes
  one (`modules/browser/pane/src/index.ts:29-45`).
- So today a tab an Agent of Space A opens can land in a Pane of Space B.

### The mark and the stop

- The mark is a boolean per page. `drive(page)` tells the Pane
  `{kind: "driven", from, driven}` whenever any CDP session is on it, and
  turns off background throttling (`app/desktop/src/cdp.ts:236-247`;
  `modules/browser/pane/src/desktop.ts:41-42`).
- The tab draws a bot icon with "An Agent drives this tab: click to stop
  it" (`modules/browser/pane/src/BrowserPane.tsx:489-491`, `:538-560`).
  It names no Agent and no Thread.
- A click sends `browser.stop(contents)` (`desktop.ts:80-81`;
  `app/desktop/src/main.ts:235-237`). `Cdp.stop` ends every client's
  session on that tab (`app/desktop/src/cdp.ts:604-608`, `:339-347`).
- Nothing stops a client from attaching again. Only the skill asks it not
  to (`look/skill/browser.md:102-105`).
- DevTools opened on a tab ends the sessions too (`app/desktop/src/cdp.ts:193-197`).

### How Agents reach it today

- `banda browser` prints the endpoint, and the `browser` topic tells the
  Agent to run Playwright MCP or Chrome DevTools MCP against it
  (`look/skill/browser.md:75-112`).
- So today the Agent needs a tool installed and a shell to run it.

---

## 4. Constraints from the ADRs and the glossary

### ADR 0005 (a hackable tiling workspace)

- d3: the workspaces live in the engine. "The CLI and Agents change it like
  any other module's data" (`docs/adr/0005-…md:39-45`). But today a pass is
  refused on the machine scope (`kernel/src/kernel.rs:283-290`).
- d4: "An Agent opens Panes without taking the focus. A new Pane carries a
  mark until the Person looks at it." (`docs/adr/0005-…md:47-50`).
- d6: a Space is one folder on one machine. "Where a browser Pane runs for
  such a Space is still open." (`docs/adr/0005-…md:61-69`, line 68).
- d12: no module of ours takes a path a module from elsewhere lacks;
  unstable APIs are marked and counted (`docs/adr/0005-…md:143-148`).
- d14: "The MCP module is Banda's MCP server, and that is its one job."
  "No other module speaks MCP." Nothing is written into a Harness's config
  (`docs/adr/0005-…md:155-163`). This rules out the window serving MCP
  itself, and handing a second MCP server (say Playwright MCP) to sessions
  looks against it too.
- d15: "Agents drive it through its MCP tools." (`docs/adr/0005-…md:165`).

### ADR 0012 (the skill)

- The skill's text is written once and reaches Agents through `banda skill`,
  an export, and the MCP module (`docs/adr/0012-…md:18-20`, `:36-39`).
- A topic lives beside its code (`docs/adr/0012-…md:26-29`). The browser's is
  `look/skill/browser.md`. It now tells Agents to install Playwright MCP;
  it would change to name Banda's own tools.

### ADR 0013 (the browser)

- d2: one profile for every Pane, Space and Agent (`docs/adr/0013-…md:49-56`).
- d3: the browser is the window's, not a Space's; no engine part; a Pane
  opens in a Space but the Space changes nothing (`docs/adr/0013-…md:58-67`).
- d7: every Agent reaches the whole browser through CDP; "агент видит все
  вкладки" was decided (`docs/adr/0013-…md:132-158`).
  - A tab an Agent opens goes to the browser Pane focused last, without
    taking the focus; with none, a new unfocused column (`:151-153`).
  - A tab an Agent drives shows a mark; a click stops it (`:154-156`).
  - "Banda's own browser tools for Agents (a snapshot with refs, as T3's)
    come with the MCP module, on the same endpoint." (`:157-158`)
- Consequence: any Agent with the endpoint drives any tab, the Person's
  signed-in ones too; per-tab sharing is "the way back"
  (`docs/adr/0013-…md:182-184`).
- Later: "a Space on another machine and a window in a plain browser: a
  headless Chromium where the engine is, streamed as T3 Code does"
  (`docs/adr/0013-…md:198-203`).

### ADR 0014 (the contract once, in Rust)

- Each method is declared once in `methods!`, with typed params and answer,
  and ts-rs writes the TypeScript (`docs/adr/0014-…md:28-44`).
- Any shape that crosses engine ↔ window (a request, a snapshot, a ref)
  should be a Rust type exported by ts-rs, not a TS copy.

### ADR 0019 (Agents and Threads)

- `banda mcp` is a pipe; it keeps nothing (`docs/adr/0019-…md:33-42`).
- The token names a Thread's Agent in its Space (`:44-54`).
- "A tool is a method"; "There is no other way to make a tool"
  (`:56-61`). `skill` is the one exception (`:70-73`).
- Refusals are tool errors that say nothing was done (`:66-69`).
- "Other modules give their Agents tools the same way, by marking a
  method: the terminal and the browser, when they want them." (`:83-84`)
- Rules live in code, not in a prompt (`:23-26`, `:96`). A "do not attach
  again" after a stop would be a rule, not skill words.

### ADR 0020 (main in Effect)

- Main's parts are services given as layers; Electron callbacks are the
  edge (`docs/adr/0020-…md:54-66`).
- Input from outside main (page, extension, CDP client, file) is decoded
  with `Schema` (`:68-74`). Effect does not get a second copy of the
  contract's types (`:50-52`).
- The CDP endpoint is Effect; each client is a scope (`:76-83`).
- Services are tested without Electron, with fake layers (`:85-90`).

### ADR 0022 (module manifests)

- A module's methods and tools are its `methods!` table; nothing about them
  goes in the TOML (`docs/adr/0022-…md:39-43`).
- One id is the module everywhere. A module with no engine part is always
  on (`:118-122`). If the browser gets an engine part, its window part
  runs only while the engine runs it.
- Unstable marks are counted against a ceiling
  (`docs/adr/0022-…md:124-141`). The ceiling is 2 (`engine/src/modules.rs:23`).
  The browser already holds one: `desktop-main`
  (`modules/browser/module.toml:11-14`). A new path outside the contract
  either falls under that mark or raises the ceiling, and the PR must say
  why.

### GLOSSARY.md

- **Agent**: "The AI at work in one Thread … Each Thread has its own Agent,
  with no name or settings" (`GLOSSARY.md:27-29`). So the tab should name
  the Thread, not an "Agent name".
- **Person**: the computer's user, owner of every Space (`GLOSSARY.md:22-24`).
- **Participant**: a Person or an Agent (`GLOSSARY.md:18-20`).
- **Space**: one body of work and its folder (`GLOSSARY.md:10-16`).
- **Pane**: "reaches the engine only through the API" (`GLOSSARY.md:151-153`).
- **Tab**: one page of a browser Pane (`GLOSSARY.md:155-158`).
- **Workspace**: "can hold Panes of any Spaces … the Space stays the
  boundary" (`GLOSSARY.md:165-168`).
- **Mark** is Banda's sign, three tiles, that says what the work calls for
  (`GLOSSARY.md:212-218`). The tab's "Agent's mark" uses the same word for
  another thing, and the glossary has no entry for it. A design that names
  the Thread on a tab should pick a word and add it.
- No glossary entry for tool, pass or snapshot/ref yet.

---

## 5. Design questions, with the options the code allows

### Q1. Where do the tools run?

| Option | How | For | Against |
|---|---|---|---|
| **A. Engine module + the window serves** | A `browser` engine module (Space scope) with `tool` methods. A call parks a request; the window holds a request stream and answers by a call. | Fits "a tool is a method" (ADR 0019 d3) and the contract in Rust (ADR 0014). The kernel's wall and access decision run as for any tool. Works for a remote Space later: the request goes over the window's existing engine link. Knows the AgentId, so the window can be told which Thread. | Changes ADR 0013 d3 (no engine part). Needs a request/answer path that does not exist (section 2). Who holds the stream: the page (needs IPC to main for each CDP act) or main (must become an API client). No window: the call must refuse. |
| **B. `banda mcp` speaks CDP itself (Rust)** | Like `skill`: answered in `banda mcp`. It reads `browser.json` and connects to the CDP endpoint with `tokio-tungstenite`, already a dependency (`engine/src/client.rs:10-13`). | Smallest. No new engine↔window path. The CDP client's life is the session's: when the session ends, its sessions on tabs end and the mark goes. | A second exception to "a tool is a method". The snapshot and refs must be written in Rust over raw CDP (`Accessibility.getFullAXTree`, `DOM`, `Input`), or as injected JS, not Playwright's `ariaSnapshot`. The CDP endpoint is anonymous: to name the Thread on the tab, the endpoint needs a way to learn the caller (a param or a Banda-only CDP method), and it cannot check a pass without asking the engine. Local only: fails for a remote Space. |
| **C. The window's main process runs the tools** | Main implements snapshot/act on `webContents.debugger`, or with `playwright-core` `connectOverCDP` to its own endpoint (as T3 does). It is reached through A's stream, or through the door. | The tabs and their debuggers are there. Playwright gives `ariaSnapshot` and ref resolution as T3 has them. Effect services and fake-layer tests (ADR 0020). | Through the door: async handlers, larger answers, a path outside the contract (unstable mark). Serving MCP from main is against ADR 0005 d14. Adds Playwright to main's bundle. |
| **D. A Node sidecar** | `banda mcp` (or the agents module) starts Playwright MCP / a Banda Node script against the endpoint, and proxies or hands its tools. | Reuses a tested snapshot-with-refs tool. | Needs Node at run time (the ACP adapters run through npx, so it is likely there, `settings.rs:200-215`). Tools not from `methods!`. Handing a second MCP server looks against ADR 0005 d14. Anonymous on the endpoint, as B. |

A mix is likely: the tools are declared as methods (A), and their work runs
in main (C), on the debuggers `Cdp` already holds.

### Q2. Which tab does a Thread drive?

- Today: any tab, decided in ADR 0013 d7. Tabs carry no owner.
- Options:
  - **Any tab**, as now; the tool lists every tab, each with its Pane tab id.
  - **Its own tabs**: the ones it opened, plus ones the Person hands it.
    That is the "per-tab sharing" ADR 0013 names as the way back
    (`docs/adr/0013-…md:182-184`). T3 pins each Thread to its tabs, with
    8 tabs at most and 30 minutes idle
    (`docs/research/2026-11-01-a-browser-in-the-window.md:82-84`).
- Which id the tool gives the Agent: the Pane tab id survives restarts
  (`modules/browser/pane/src/tabs.ts:8-12`); `webContents.id` and `targetId`
  do not. A Thread's tabs would need a map from Thread to Pane tab ids, kept
  in the Pane's args or in an engine table.

### Q3. Where are a Thread's tabs shown?

- Today: in the browser Pane focused last, of any Space, or a new one in
  the focused Space (`pages.ts:429-435`, `Shell.tsx:266-272`).
- Options:
  - **The Thread's Space's browser Pane.** `create` news gains `space`
    (and maybe `thread`). `frontHolder` picks a holder of that Space. The
    opener passes the Space to `window.open` (`module.ts:30` takes it). The
    Pane reads its `space` prop. This changes ADR 0013 d3 "the Space changes
    nothing in it".
  - **A browser Pane per Thread**, stacked under the Thread's Pane in its
    column, as a sign-in terminal stacks under its Thread (ADR 0005 d5,
    `docs/adr/0005-…md:52-59`).
  - **Keep the front Pane**, and only name the Thread on the tab.
- With engine-side workspaces (ADR 0025), an engine module could open the
  Pane by a command (`modules/workspaces/engine/src/lib.rs:38-40`), but
  only the owner can: a pass is refused on the machine scope.

### Q4. The tab names the Thread

- Today `driven` is a boolean (`cdp.ts:236-247`, `desktop.ts:42`).
- Options:
  - `driven` becomes a list of drivers, each with the Thread's id and title,
    and the tab's mark shows its title and opens the Thread on click.
  - With option A, the window learns the Thread from the request.
    The engine-side module knows only the AgentId; the Thread's id and title
    are the agents module's (`kernel/src/module.rs:31-33`). Options: the
    browser module follows the agents module's `ThreadStarted` facts, or the
    kernel's `Call` gains the Thread, or the window maps AgentId → Thread
    from what it already reads.
  - With option B or D, the CDP client must say who it is, which the
    endpoint does not take today (`cdp.ts:95-109`).
  - Anonymous CDP clients (the Person's own Playwright) still show the plain
    mark.

### Q5. Stop, per tab and per Thread

- Today the click stops every client on that tab (`cdp.ts:604-608`), and
  nothing stops them from coming back (`look/skill/browser.md:102-105`).
- Options:
  - Stop one Thread on one tab, or one Thread on every tab.
  - A stop the code keeps: the tool refuses that Thread on that tab until
    the Person hands it back (a rule in code, ADR 0019 style), with a
    refusal that says so.
  - Stopping the Thread's turn (`agents.stop`,
    `modules/agents/engine/src/lib.rs:200-201`) also ends its browser
    sessions. With option A this is in the engine; with B, the session's
    `banda mcp` lives longer than a turn, so it would not.

### Q6. No window open

- The engine runs without a window (`banda serve` without `--with-parent`,
  `engine/src/serve.rs:16-19`, `:66-76`). `banda browser` exits 2 then
  (`look/skill/browser.md:79-81`; `engine/src/main.rs:454-462`).
- Tools are listed once and there is no `listChanged`
  (`engine/src/mcp.rs:117-131`, `:176-182`). So the tools must always be
  listed and refuse with "Banda's window is not open. Nothing was done."
- Options: refuse; or wait a bounded time for a window; later, a headless
  Chromium where the engine is (`docs/adr/0013-…md:200-201`). Nothing can
  start the window from the engine today.

### Q7. Remote Spaces later

- A remote Space's engine, Harness and `banda mcp` run on the other
  machine (ADR 0005 d6, `docs/adr/0005-…md:66-68`). The CDP endpoint
  listens on the window's 127.0.0.1 (`cdp.ts:592-596`). B and D cannot reach
  it.
- A works through the window's engine connection. Or the remote engine runs
  a headless Chromium of its own, streamed to a Pane (ADR 0013 Later). Then
  the tools would run where the engine is, and B's Rust CDP client would
  fit, aimed at that Chromium instead.
- ADR 0005 still leaves open where a browser Pane runs for such a Space.

### Q8. The tool set and its answers

- Issue #151: snapshot with refs; act on a ref (click, type, navigate,
  read). T3's set: `preview_open`, `navigate`, `snapshot`, `act`,
  `evaluate`, `wait_for`, `screenshot`, `recording_*`, `resize`,
  `set_appearance`, `dialog`
  (`docs/research/2026-11-01-a-browser-in-the-window.md:65-81`).
- Refs: per snapshot, made stale by the next one; a stale ref fails with
  "take a fresh snapshot" (T3, same note `:73-79`). Where refs live: the
  window (per tab, per Thread) for A/C; `banda mcp` for B.
- Answers: text only today (`engine/src/mcp.rs:184-187`). A screenshot
  needs MCP image content. A snapshot needs a size cap (T3: about 20 KB).
- `call` vs `command`: a browser act is a side effect, not a write to the
  Space's log. A `call` keeps no receipt (`kernel/src/methods.rs:9-11`).
  Which right: `Write` (Agents have it), a new right, or `Run` (refused to
  Agents: "runs programs as the Person"). The tabs are signed in as the
  Person (`look/skill/browser.md:95-96`).
- Order: `banda mcp` serves one call at a time (`engine/src/mcp.rs:68-82`),
  so a long `wait_for` holds the session's other tools.

---

## Short list of what any design changes

- ADR 0019 d3, if a tool is not a method (B, D), or ADR 0013 d3, if the
  browser gets an engine part (A).
- `BrowserNews.create` and `Tabs.create` gain a Space and maybe a Thread;
  the browser Pane reads its `space`.
- `driven` gains who drives; `Cdp.stop` gains a Thread.
- A path from the engine (or `banda mcp`) to the window's tabs that is not
  CDP-anonymous.
- The `browser` skill topic names Banda's tools.
- A glossary word for the tab's driver mark.
