# Browser tools for Agents: the landscape

Companion to `2026-11-02-browser-tools-for-agents.md` (issue #151).

Research for Banda issue #151 (Banda's own browser tools in its MCP server).
T3 Code is covered in a separate document. This one covers everything else.

Legend:
- **verified**: I read it in code (shallow clone) or in the vendor's own docs.
- **inferred**: from secondary sources, from memory, or my own reasoning.

Clones read (all `git clone --depth 1`, in /tmp):

| Repo | Path | Commit | Date | Version |
|---|---|---|---|---|
| microsoft/playwright-mcp | /tmp/agent-browser-playwright-mcp | ec572ee | 2026-11-01 | @playwright/mcp 0.0.84 |
| microsoft/playwright (sparse: tools, injected, extension) | /tmp/agent-browser-playwright | 820620c | 2026-11-01 | 1.65 alpha |
| ChromeDevTools/chrome-devtools-mcp | /tmp/agent-browser-chrome-devtools-mcp | 8d009e8 | 2026-10-30 | 1.12.0 |
| browser-use/browser-use | /tmp/agent-browser-browser-use | b49a68e | 2026-10-29 | 0.13.14 |
| browserbase/stagehand | /tmp/agent-browser-stagehand | b7a4b89 | 2026-10-29 | SDK 4.3.0 |
| vercel-labs/agent-browser | /tmp/agent-browser-agent-browser | 5868f7c | 2026-10-30 | 0.41.1 |

---

## 1. Playwright MCP (microsoft/playwright-mcp)

**What it is.** The reference MCP server for browser control. The repo only ships the npm package. The server code lives in `microsoft/playwright`, under `packages/playwright-core/src/tools/` (**verified**, `CLAUDE.md`). Latest release v0.0.84, 2026-10-31 (**verified**, `gh release list`).

**Its own advice.** The README now says coding agents may do better with the sibling **Playwright CLI + Skills** (`microsoft/playwright-cli`). The reason given: a CLI avoids loading big tool schemas and big accessibility trees into the context. MCP is kept for long exploratory loops (**verified**, README).

### Tools (**verified**, README generated from code)

Core (always on):
- `browser_navigate`, `browser_navigate_back`, `browser_close`, `browser_resize`
- `browser_snapshot` (params: `target`, `filename`, `depth`, `boxes`)
- `browser_find` (search the snapshot by text or regex; returns matching nodes with a little context; "cheaper than capturing the whole snapshot")
- `browser_click`, `browser_hover`, `browser_drag`, `browser_drop`, `browser_type`, `browser_press_key`, `browser_select_option`, `browser_fill_form`, `browser_file_upload`, `browser_handle_dialog`
- `browser_evaluate`, `browser_run_code_unsafe` (runs Playwright code; the tool says it is RCE-equivalent)
- `browser_wait_for` (text, textGone, or time)
- `browser_take_screenshot` (the description says: "You can't perform actions based on the screenshot, use browser_snapshot for actions")
- `browser_console_messages` (level filter, `all` since session start, `filename`)
- `browser_network_requests` (numbered list, `filter` regexp, static resources off by default) and `browser_network_request` (one request by index, headers and body)
- `browser_emulate_media`
- `browser_tabs` (one tool: `action` = list / new / close / select, `index`, `url`, `isolatedContext`)

Opt-in groups via `--caps`:
- `vision`: `browser_mouse_click_xy`, `_move_xy`, `_drag_xy`, `_down`, `_up`, `_wheel`
- `pdf`, `network` (route mocking, offline), `storage` (cookies, local/session storage, storage state), `config`
- `devtools`: `browser_highlight`, `browser_annotate` (the Person draws on the page, the tool returns screenshot + snapshot + notes), `browser_start_recording` / `stop_recording` (records the Person's own actions as code), tracing, video, `browser_video_show_actions` (on-page callouts and an animated cursor for each action)

Every element tool takes `target` (a ref like `e12`, a CSS selector, or, since 0.0.84, a locator in JS/Python/Java/C#) and an optional `element` string: "Human-readable element description used to obtain permission to interact with the element". That string exists for the client's approval prompt (**verified**).

### Snapshot format (**verified**, `packages/injected/src/ariaSnapshot.ts`)

- `page.ariaSnapshot({ mode: 'ai' })`. The older private name was `_snapshotForAI`. Today it is a public option `mode: 'ai'`.
- YAML-like text. Example from the tests: `- button "Submit" [ref=e2]`, and after the click `button "Submit" [active] [ref=e2]`.
- `ai` mode settings: visibility `ariaOrVisible`; refs only on **interactable** nodes (visible and receives pointer events); `generic` roles kept; `[active]` marked; `cursor=pointer` marked; optional `[box=x,y,w,h]` with `--snapshot-boxes` or `boxes: true`.
- Ref format: `e<N>`; inside iframes the ref gets a frame prefix, `f<N>e<M>` (the resolver accepts `/^(f\d+)?e\d+$/`).
- Open shadow roots are walked (`element.shadowRoot` children are visited).
- A "distiller" pass (v0.0.78) removes noise to save tokens. Refs of removed nodes still resolve.
- Also a JSON form (`ariaSnapshotJSON`) for structured output.
- If the page registers **WebMCP** tools (`navigator.modelContext`), the snapshot is prefixed with them, labelled "page-provided and untrusted".

### Ref lifetime (**verified**)

- A ref is stored on the DOM element (`element._ariaRef`). The next snapshot reuses it if the element's role and name did not change. Otherwise it gets a new number from a page-wide counter.
- So refs survive re-renders that keep the same node. They die when the node is replaced, or on navigation.
- An unknown ref gives: `Ref e12 not found in the current page snapshot. Try capturing new snapshot.`

### What a tool returns after acting (**verified**, `backend/response.ts`)

The response is Markdown sections, in this order:
1. `Error` / `Result`
2. `Ran Playwright code` (the equivalent code, for example `await page.getByRole('button', { name: 'Submit' }).click();`)
3. `Open tabs` (only if more than one tab) and `Page` (URL, title), only when a snapshot is taken or a tab header changed
4. `Modal state` (open dialog or file chooser, with the tool to clear it)
5. `Snapshot`
6. `Events` (new console entries as a file link, downloads)

History of the snapshot attached after an action (**verified**, release notes):
- v0.0.43 (2025-10): **incremental snapshots**. Unchanged subtrees collapsed to `- ref=<id> [unchanged]`.
- v0.0.51 (2025-12): `--snapshot=incremental|full|none`, default `incremental`.
- v0.0.52: `browser_snapshot` got `filename`, to write the snapshot to disk.
- Today (0.0.84): the modes are only `full | none`. There is no incremental mode in the code any more.
- Today, after an action (`mode: full`), the full snapshot is **written to a file** (`page-<ts>.yml` in the output dir) and the response carries only a link: `- [Snapshot](...)`. Only an explicit `browser_snapshot` without `filename` puts the YAML inline. (`snapshotToFile = includeSnapshot !== 'explicit' || !!fileName`.)
- With `--snapshot-mode none`, the tree walk is skipped entirely (it "dominates response latency on heavy pages").

So the team moved from "fresh snapshot inline after every action" to "incremental diff" to "full snapshot on disk, link in the reply". The trend is: keep big page state out of the context unless asked.

### Size control (**verified**)
- `depth`, `target` (subtree), `filename`, `browser_find`, `--snapshot-mode none`, `--image-responses allow|omit|only`, `--mobile` ("mobile pages are usually lighter, which saves tokens"), `--output-max-size` (evicts old output files), `--console-level`.
- Network list hides successful static resources by default.

### Tabs (**verified**)
- One `browser_tabs` tool. Tabs are addressed by **index**, with one "current" tab. Every response lists open tabs when there are several.
- `isolatedContext` names a separate cookie jar for a new tab.

### Connecting to an existing browser (**verified**)
- `--cdp-endpoint <url>` (+ `--cdp-header`, `--cdp-timeout`): `chromium.connectOverCDP`. It takes **every existing page** of the default context as a tab (`for (const page of browserContext.pages()) this._onPageCreated(...)`). So pointed at Banda's endpoint, it would see every Banda tab, not one Thread's tabs.
- `--extension`: a Chrome extension relays CDP. The first time, a page opens in Chrome where the Person **picks which tab** the Agent may use. Each client gets **its own tab group**, named after the client and coloured; a client sees only the tabs in its group; the Person drags tabs in or out to change access; a status page lists connections and can disconnect each. Connection needs approval unless a per-profile token is set (`packages/extension/README.md`).

### Person's view (**verified** unless marked)
- Headed browser by default.
- Extension mode: tab group per Agent, approval dialog, status page with disconnect.
- `browser_video_show_actions`: on-page action callouts, target highlight, animated cursor.
- `browser_start_recording`: the Person demonstrates; the Agent gets the code.
- The README says plainly: "Playwright MCP is **not** a security boundary."

### Safety bits (**verified**)
- `--allowed-origins` / `--blocked-origins` (documented as *not* a security boundary), `--allowed-hosts`.
- `--secrets <dotenv>`: secret values are replaced by their names in the code shown back.
- `--redact-url-params access_token,code` (0.0.84): values replaced by `<redacted>` in results.
- File access restricted to workspace roots by default.

Links: https://github.com/microsoft/playwright-mcp · https://github.com/microsoft/playwright/tree/main/packages/playwright-core/src/tools · https://github.com/microsoft/playwright/tree/main/packages/extension · https://github.com/microsoft/playwright-cli

---

## 2. Chrome DevTools MCP (ChromeDevTools/chrome-devtools-mcp)

**What it is.** Google's MCP server (now branded "Chrome DevTools for agents"), on Puppeteer, with the real DevTools frontend behind it. v1.12.0, 2026-10-22 (**verified**, CHANGELOG). Also a CLI and Skills. Google recommends it as the base for "an integrated browser subagent" and points to the Gemini CLI browser agent (**verified**, README).

### Design principles (**verified**, `docs/design-principles.md`)
- "Token-Optimized: Return semantic summaries. 'LCP was 3.2s' is better than 50k lines of JSON. Files are the right location for large amounts of data."
- "Small, Deterministic Blocks." "Self-Healing Errors: Return actionable errors that include context and potential fixes."
- "Reference over Value: for heavy assets (screenshots, traces, videos), return a file path or resource URI."

### Tools (**verified**, `docs/tool-reference.md`)
- Input (10): `click`, `drag`, `fill`, `fill_form`, `handle_dialog`, `hover`, `press_key`, `type_text`, `upload_file`, `click_at` (coordinates, needs `--experimentalVision`).
- Navigation (6): `list_pages`, `select_page`, `new_page` (`background`, `isolatedContext`), `close_page`, `navigate_page` (url/back/forward/reload, `initScript`), `wait_for` (any of several texts).
- Emulation (2): `emulate` (CPU throttle, network, geolocation, viewport, UA, colour scheme…), `resize_page`.
- Performance (3): `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight` (named insights such as `LCPBreakdown`, `DocumentLatency`; may call the CrUX API for field data unless `--no-performance-crux`).
- Network (2): `list_network_requests` (paginated, filter by resource type, keep last 3 navigations), `get_network_request` (by `reqid`, bodies inline or to file; can return the request selected in the DevTools Network panel).
- Debugging (9): `take_snapshot`, `take_screenshot`, `evaluate_script`, `list_console_messages` / `get_console_message` (source-mapped stack traces), `get_css_styles` (cascade, paginated), `lighthouse_audit` (a11y, SEO, best practices, "agentic browsing"), `screencast_start/stop`.
- Memory (14, opt-in): heap snapshots and diffs.
- Also: extensions, PWA, WebAuthn, WebMCP, third-party tools (experimental categories).
- `--slim` mode: only `navigate`, `evaluate`, `screenshot`.

**Every page-scoped tool requires `pageId`** (`--page-id-routing`, default true, "useful for concurrent agent sessions"). Tools on different pages run in parallel (1.12.0). There is no hidden "current tab" for page tools.

### Snapshot (**verified**, `src/TextSnapshot.ts`, `src/formatters/SnapshotFormatter.ts`)
- Built from the CDP accessibility tree (not injected JS). Layout-only nodes dropped. `verbose: true` gives the full tree.
- Line format: `uid=1_1 checkbox "checkbox" checked`, indented children (`uid=1_2 statictext "text"`).
- uid = `<snapshotId>_<counter>`. It is reused across snapshots when the same `loaderId + backendNodeId` is seen again. So a uid lives as long as the DOM node and the document; a navigation (new loaderId) gives new uids.
- Errors: `Element with uid "…" was detached or no longer exists on the page. Please take a new snapshot with take_snapshot.`
- The snapshot marks the element selected in the DevTools Elements panel. This is a Person-to-Agent pointing gesture.

### After-action return (**verified**, `src/tools/input.ts`)
- Each action waits for its effects (`waitForEventsAfterAction`: navigation, DOM settle).
- Returns a short line ("Successfully clicked…"). A snapshot is attached **only** with `includeSnapshot: true` (default false).

### Connecting (**verified**, `docs/configuration.md`)
- `--browserUrl http://127.0.0.1:9222`, `--wsEndpoint ws://…`, `--wsHeaders`, `--autoConnect` (Chrome 144+, after the Person enables remote debugging at `chrome://inspect/#remote-debugging`).
- **Webviews are hidden by default.** `--experimentalIncludeAllPages`: "include all kinds of pages such as webviews or background pages as pages." This matters for an Electron app with `<webview>` tabs, unless the endpoint already presents them as pages.
- `--no-javascript-evaluation`, file: URLs can be disallowed, URL allow/block patterns (reloadable).

### Best at (**inferred**, from tool set)
Debugging and performance: traces with named insights, network bodies, console with source maps, CSS cascade, Lighthouse, memory. Weaker than Playwright for many-step form automation; much stronger for "why is this page slow / broken".

Links: https://github.com/ChromeDevTools/chrome-devtools-mcp · docs/tool-reference.md · docs/design-principles.md

---

## 3. browser-use (browser-use/browser-use)

**What it is.** A Python agent framework (0.13.14) with its own loop, a CLI ("Browser Harness"), a cloud browser, and a hosted agent API (**verified**, README).

### Element indexing: what the model sees (**verified**, `dom/serializer/serializer.py`, `agent/system_prompts/system_prompt.md`)
- The DOM is built from CDP (DOM + DOMSnapshot + accessibility), then filtered by visibility and **paint order** (elements covered by others are dropped, `paint_order.py`).
- Output is a tree of HTML-ish lines: `[index]<tagname attribute=value />`, children indented with tabs, plain text lines without index.
- The index **is the CDP `backendNodeId`** where possible (synthetic numbers only on clashes). So indices stay stable for the same node across steps.
- New elements since the last step (same URL) are marked `*[38]`. The prompt tells the model these are what its last action caused (for example autocomplete options).
- Attributes kept are a whitelist: `title type checked id name role value placeholder alt aria-label aria-expanded data-state aria-checked aria-value*` and validation attributes (`pattern min max minlength`…).
- Shadow DOM elements get indices and are directly clickable.
- The element text is **capped at 40,000 characters** per step (~10k tokens), with a "truncated" note.

### Screenshots (**verified**)
- `use_vision` default true. The screenshot has **bounding boxes with index labels** drawn on interactive elements (set-of-marks). The prompt calls the screenshot "GROUND TRUTH".
- `use_vision='auto'` adds a `screenshot` action the model calls only when needed.

### Other choices (**verified**)
- Each step the model returns JSON with evaluation of the last goal, memory, plan, and a **list of actions** (several per step).
- `sensitive_data`: the model writes `<secret>name</secret>`; the tool layer substitutes the real value. Saved histories keep the placeholder.
- `allowed_domains` / `prohibited_domains` on the browser profile.
- Replay: save a successful run, re-run it with new variables and no model calls.
- browser-use also ships a driver for **Anthropic's browser toolset** (section 5.1), implementing all 31 members over CDP.

Links: https://github.com/browser-use/browser-use · https://github.com/browser-use/browser-harness · https://docs.browser-use.com

---

## 4. Stagehand (browserbase/stagehand)

**What it is.** A TS/Python SDK, v4.3.0. Natural-language primitives on top of a CDP page (**verified**, README, CHANGELOG).

- `act("click the sign in button")`: one model call picks an element from an accessibility outline and a Playwright-style method; then it runs it.
- `observe("find the email input")`: returns candidate actions with **real selectors**, without acting. The README's login example uses it so "credentials never reach the model": the code fills the field, not the model.
- `extract(instruction, zodSchema)`: schema-validated data.

### Snapshot (**verified**, `packages/extension/understudy/a11y/snapshot/`)
- Outline lines `[<encodedId>] role: name [selected] [checked]`, child frames injected under their iframe node. `encodedId` looks like `<frameOrdinal>-<backendNodeId>` (test: `0-${backendNodeId}`). An xpath map turns ids back into selectors.

### Caching (**verified**, `docs/v4/best-practices/caching.mdx`, `services/cacheService.ts`)
- Server-side, on Browserbase only. Key = instruction + page content (DOM shaped and hashed server-side) + options. Model config is left out of the key. A hit returns the action with no model call. On by default; `cache: false` or a hit-count threshold.
- Local browsers get no cache.

### Self-healing (**verified**, `services/actService.ts`)
- `selfHeal` (default false in code). If running the chosen selector fails, it takes a fresh snapshot, re-infers the action from the step's description, and tries again.

### Notable direction (**verified**, `docs/v4/migrations/v3.mdx`)
- **v4 removed `agent()`.** Their words: it was "built for models that couldn't reliably drive a browser on their own". Now they recommend **code mode**: a coding assistant writes a Stagehand script once, using plain locators where stable and `act`/`extract` only where judgement is needed. Or tool calling with the discrete primitives.
- WebMCP on by default (4.3.0).

Links: https://github.com/browserbase/stagehand · https://docs.stagehand.dev/v4

---

## 5. Vercel `agent-browser` and the consumer agent browsers

### 5.0 Vercel agent-browser (vercel-labs/agent-browser, 0.41.1)

**What it is.** A native Rust CLI with a background daemon, made for coding agents. Also an MCP server (`agent-browser mcp`) (**verified**, README).

- Snapshot uses Playwright-style refs: `- button "Submit" [ref=e2]`; commands take `@e2`. `snapshot -i` (interactive only), `-c` (compact), `-d <depth>`, `--urls`, `--json` (tree + a refs map).
- **Ref repair:** if the ref's element was replaced, it acts on the one element with the same role and name; if that is ambiguous it fails without acting.
- **Occlusion check:** a click fails if another element covers the click point, and names the cover (`covered by <div#consent-banner>`). Clicks on hidden, disabled, or off-screen elements fail instead of "succeeding".
- `diff snapshot` (current vs last), `screenshot --annotate` (numbered labels), `screenshot --if-changed` ("recommended: skip unchanged images to save tokens").
- `read [url]`: agent-readable text; tries `Accept: text/markdown`, `.md`, nearest `llms.txt`.
- MCP **tool profiles**: default `core` keeps context small; `network`, `state`, `debug`, `tabs`, `react`, `mobile`, `all`. Tool discovery is paginated and carries read-only/open-world annotations.
- Safety, all opt-in: `--content-boundaries` (wrap page output in markers "so LLMs can distinguish tool output from untrusted content"), `--allowed-domains` (also blocks sub-resources, WebSockets, beacons, WebRTC), `--action-policy policy.json`, `--confirm-actions eval,download`, `--max-output`. **Auth vault**: credentials encrypted locally, `auth login <name>` fills them; "the LLM never sees passwords".
- **Streaming for the Person**: every session runs a WebSocket server streaming JPEG frames of the viewport and accepting input events, for "pair browsing" where a human watches and acts alongside the Agent.
- Their evals measure CLI vs MCP context footprint (`evals/context-footprint.ts`).

Links: https://github.com/vercel-labs/agent-browser

### 5.1 Anthropic: browser use tool (`browser_toolset_20260801`) and Claude in Chrome

**API toolset** (**verified**, platform.claude.com docs). GA 2026-08-19. An Anthropic-defined **client** toolset: the app runs the browser, Anthropic runs nothing.
- 31 members, 27 on by default. Navigation/capture: `navigate`, `screenshot`, `zoom`. Pointer: `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click`, `hover`, `left_click_drag`, `left_mouse_down/up`, `mouse_move`, `scroll`, `scroll_to`. Keys: `type`, `key`, `hold_key`, `wait`. Reading: `read_page`, `find`, `get_page_text`. Forms: `form_input`, `file_upload`. Tabs: `new_tab`, `list_tabs`, `switch_tab`, `close_tab`. Diagnostics: `read_console`, `read_network`, `javascript_exec`.
- **Off by default**: `javascript_exec` and `file_upload` ("widen what a manipulated page could make Claude do"), `read_console` and `read_network` ("widen what page-controlled content reaches Claude").
- Refs: `link "Getting started" [ref_2]`. Target is `{"type":"ref","ref":"ref_2"}` or `{"type":"coordinate","x":…,"y":…}`.
- Ref rules: "scoped to the tab that produced them and stay valid until that tab navigates or its DOM changes materially." "Don't renumber references you've already handed out for a tab until it navigates." The executor must answer a stale ref with an error telling Claude to re-read.
- Prefer refs; fall back to coordinates for canvas, video, cross-origin iframes. "Element references are best-effort: … virtualized lists, canvas-rendered interfaces, pages that re-render on scroll … Claude falls back to screenshots and coordinate clicks there."
- `read_page` filters: `interactive`, a container `ref`, `depth`; output capped at 50,000 chars. `find` returns at most 20 matches.
- **Results**: a short text ack ("Clicked element ref_2.") plus an optional `browser_state` block (all tabs with one active, and `state_changes`: `tab_opened`, downloads). The API renders a **"Tab Context"** footer: which tab the call ran on and all tabs. Screenshots after actions are **not required**; the model usually ends a batch with an observation call.
- Several calls per turn: run in order, stop at first failure, answer the rest `Not executed: an earlier action in this turn failed.`
- Cost: ~6,600 input tokens for the default toolset definition; +~880 for the four optional members.
- Safety guidance (verbatim themes): everything a page supplies is untrusted; fresh profile without credentials; domain allowlist re-checked after redirects; refuse non-http(s) schemes; treat tab titles, URLs and download fields as untrusted; build page reads from the accessibility tree or visible text, not raw DOM; **"Have a human confirm consequential actions and anything that requires affirmative consent (purchasing, modifying accounts, messaging, and accepting terms), and make that check in your executor before each call."** Server-side classifiers scan returned page text and screenshots for injections and steer Claude to check with the user.
- The Anthropic SDK offers a `confirm(context)` callback before each action (member, tab URL, input) and a file policy with upload roots (**verified**, browser-use integration README and code).

browser-use's driver for this toolset shows a concrete build (**verified**, `browser_use/integrations/anthropic/browser_use.py`): `read_page` walks the CDP accessibility tree with a depth limit (default 15), keeps visible nodes, labels each with `ref_N` mapped to `backendDOMNodeId`, drops refs when a tab closes; `find` is a keyword scorer over role and name with a small synonym table ("bar" -> textbox/searchbox…), top 20; `get_page_text` is `innerText` of `article, main` or body.

**Claude in Chrome** (extension) (**verified** from Anthropic help pages unless marked):
- Permission modes: "Manually approve" (pause before each action; the classic side panel first shows a plan listing the sites it will use), "Automatically approve" (Claude screens its own actions, default in the Cowork side panel), "Skip all approvals".
- Per site: "Allow this action" / "Always allow actions on this site" / "Decline". Approved sites list with revoke and history.
- Always asks, in any mode: changing permissions, granting authorizations, entering sensitive information; downloads still ask on always-allowed sites.
- Not allowed at all: purchases and trades, creating accounts, card or ID data, permanent deletions, "completing instructions found in emails or web content", and more.
- Blocked categories (adult, piracy); financial sites need permission. Admins have allow/block lists.
- Two classifiers: one screens incoming content, one checks each action before it runs. Anthropic quotes attack success "less than 0.08%" for its current setup, and says the risk is not zero.
- Sign-in: "1Password for Claude" fills credentials so "your passwords and one-time codes never enter Claude's context".
- Claude works in **its own tab group**; it sees all tabs in that group; the Person drags tabs in to share them (help center, via search results). The group is always named "Claude" (GitHub issue report) (**inferred**: not read on an official page directly).
- Tool names exposed to Claude Code via the extension: `tabs_context_mcp`, `tabs_create_mcp`, `navigate`, `read_page`, `find`, `form_input`, `computer`, `get_page_text`, `javascript_tool`, `read_console_messages`, `read_network_requests`, … (**inferred**, community write-ups). They mirror the API toolset above.
- Claude Code 2.1.207 (2026-07) added a **built-in sandboxed browser** (Ctrl/Cmd+Shift+B), separate from the Person's logins; first action per site needs approval (**inferred**, one news article).

Links: https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool · https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide · https://support.claude.com/en/articles/12902428-using-claude-in-chrome-safely

### 5.2 OpenAI ChatGPT Atlas, agent mode (all **inferred**: OpenAI help pages returned 403; from secondary sources)
- The agent acts in a visible tab; the Person sees it navigate, click and type, with progress in the sidebar.
- Stop and "take control" buttons during a run (Axios, Digit, from the launch demo).
- **Logged-out mode**: the agent uses none of the Person's cookies and logs into nothing without approval. OpenAI says to prefer it when in doubt.
- **Watch mode**: on sensitive sites (banks…) the agent pauses unless the tab stays in front and watched. Simon Willison could not trigger it on GitHub or a bank in his test.
- Limits: no code execution in the browser, no file system, no downloads, no extensions.
- Page visibility toggle in the address bar decides whether ChatGPT may read the page.
- OpenAI says prompt injection is unlikely to ever be fully solved.

### 5.3 Perplexity Comet (**inferred**, secondary sources)
- Repeated public injection attacks in 2025-2026 (CometJacking; Zenity "PerplexedBrowser"/"PleaseFix": a calendar invite with hidden text made the agent read `file://` and exfiltrate). Fix: block agent access to `file://`.
- Perplexity shipped "BrowseSafe", a detection model and benchmark for injections.
- Third-party review says the consumer default runs actions without per-action approval.

### 5.4 Dia / Arc (The Browser Company, Atlassian since 2025-10) (**inferred**)
- Dia is mainly a sidebar that **reads** tabs (chat with tabs, user-written "Skills" run by slash command). Little evidence of autonomous acting in tabs. No primary docs found on agent permissions.

### 5.5 Browserbase and Steel session viewers (**verified** from vendor docs via search; details **inferred**)
- **Browserbase Live View**: a debugger URL (`debuggerFullscreenUrl`, plus per-tab URLs) embedded in an iframe. Read-only by setting `pointer-events: none`; interactive for human-in-the-loop (credentials, CAPTCHAs). The iframe posts `browserbase-disconnected`.
- **Steel**: `debugUrl` in an iframe; `interactive=true` lets the Person click and type, `showControls=true` shows a nav bar. Their docs say to make it clear when the Person is in control, because the Person's actions change the real browser state.

---

## 6. What works best for models: evidence

### Observation format
- **Accessibility tree with refs is the default everywhere.** Playwright MCP, Chrome DevTools MCP, agent-browser, Stagehand, Anthropic's toolset and Claude in Chrome all give the model a role+name tree with short ids, and act by id (**verified**). browser-use uses an HTML-ish DOM list with indices plus a marked screenshot (**verified**).
- **Screenshots are the fallback, not the main channel.** Playwright's screenshot tool says outright you cannot act on it. Anthropic says a tree read "often costs fewer input tokens than a screenshot" and to fall back to coordinates for canvas, video and cross-origin iframes (**verified**). browser-use is the exception: vision on by default, and the screenshot is "ground truth" (**verified**).
- **Set-of-marks** (numbered boxes on the screenshot) links the two: browser-use and `agent-browser screenshot --annotate` (**verified**).
- Stronger models need less scaffolding: Stagehand removed its `agent()` loop because current models drive a browser directly (**verified**). One NEC study reported the strongest models did better on full HTML and weaker ones on the a11y tree (**inferred**, secondary source).

### Token sizes (mostly **inferred**; treat as indicative)
- Caps in code: browser-use 40,000 chars/step; Anthropic `read_page` 50,000 chars; agent-browser `--max-output` (**verified**).
- Anthropic toolset definition ~6,600 tokens; computer use ~4,500; a screenshot ~1,000-1,800 tokens (**verified** for the first, others via ecorpit summary of Anthropic docs).
- Morph / Playwright-CLI slides: ~114k tokens per task with Playwright MCP vs ~27k with the CLI (vendor-adjacent). ITNext: Playwright MCP's 25 tool schemas ≈ 17,857 chars before any work. A fork reported one `browser_wait_for` response of 284k tokens on a heavy page.
- NEC study (secondary): ~6,720 input tokens/step for a11y tree vs ~56,650 for HTML. Another write-up: full tree ≈10× plain text; filtering to interactive roles brings it near plain text.
- Takeaway: one full snapshot of a real app page is often 5k-30k tokens. Returning it after every action is what blew up context; every major tool has since moved away from that.

### Published evals (**inferred**, from paper abstracts)
- "An Illusion of Progress?" (Xue et al., COLM 2025, Online-Mind2Web, 300 tasks, 136 live sites): most agents ~30% success under human evaluation; OpenAI Operator 61%; earlier self-reported WebVoyager numbers were inflated. Proposes WebJudge (~85% agreement with humans).
- browser-use publishes "BU Bench V2" (60 hard tasks, rubric score by model and cost) (**verified** that it exists, README).
- WebArena / VisualWebArena (2023-24) found text-only a11y trees fail on visually grounded tasks; adding set-of-marks screenshots helped there (**inferred**, from memory).
- TRAP benchmark (arXiv 2512.23128): adding screenshots to the tree did not change injection success much (**inferred**).

### Failure modes and how tools handle them
| Failure | Seen where | Mitigation in tools |
|---|---|---|
| Stale refs after re-render or navigation | all | Keep the id on the node: Playwright `_ariaRef` (same role+name), CDT `loaderId+backendNodeId`, browser-use `backendNodeId` (**verified**). Clear error "take a new snapshot". agent-browser re-finds by unique role+name (**verified**). Anthropic: never renumber until navigation. |
| Element covered by banner/modal | all | agent-browser fails and names the cover (**verified**). Playwright `ai` mode only gives refs to elements that receive pointer events; browser-use drops occluded nodes by paint order (**verified**). |
| Iframes | all | Playwright `f1e3` refs (**verified**); Stagehand injects child-frame outlines (**verified**). Cross-origin: Anthropic says coordinates. |
| Shadow DOM | web components | Playwright walks open shadow roots; browser-use indexes shadow elements (**verified**). Closed shadow roots: not reachable via DOM walk (**inferred**). |
| Canvas apps (Figma, maps, games) | all a11y tools | Screenshot + coordinates (`--caps vision`, CDT `click_at`, Anthropic coordinates). |
| Virtualized lists | all | Only rendered rows exist; scroll then re-read. Anthropic lists this as a known limit (**verified**). |
| Modals/dialogs blocking | all | Playwright reports "Modal state" with the tool to clear it; CDT blocks `evaluate_script` while a dialog is open (**verified**). |
| Page went quiet / hung | heavy pages | agent-browser `page_wedged` and tab replacement; CDT bounded snapshot wait (**verified**). |
| Huge snapshots | real apps | depth, subtree root, interactive filter, find/search, write to file (**verified**). |
| Prompt injection via page text | all | Mark page text as untrusted (agent-browser boundaries, Playwright/CDT label WebMCP output untrusted), classifiers (Anthropic, Perplexity BrowseSafe), confirmations, no secrets in context (**verified**). |

---

## 7. Comparison table

| | Playwright MCP | Chrome DevTools MCP | browser-use | Stagehand v4 | agent-browser | Anthropic toolset / Claude in Chrome |
|---|---|---|---|---|---|---|
| Kind | MCP server (+CLI) | MCP server (+CLI) | Python agent loop | SDK primitives | Rust CLI (+MCP) | API client toolset / extension |
| Observation | aria snapshot `ai` mode, YAML | CDP a11y tree text | DOM list + marked screenshot | a11y outline | aria snapshot (Playwright-style) | a11y tree text + screenshots |
| Id format | `e12`, `f1e3` | `1_5` | `[123]` = backendNodeId | `0-123` | `@e2` | `ref_2` |
| Id lifetime | same node + same role/name | same node + same document | same node | per snapshot (xpath map) | same node, else unique role+name | until navigation / big DOM change |
| After action | ack + code + tabs/page + snapshot **written to file** (link) | ack; snapshot only if `includeSnapshot` | next step gets full state | result object | ack; `diff snapshot` on demand | short ack + tab context; no screenshot needed |
| Diff support | had incremental (2025-10..), removed | no | `*[n]` marks new elements | no | `diff snapshot` | no |
| Tab model | `browser_tabs` by index, current tab | `pageId` required on every call | tab ids in state | page objects | tab commands | `tab_id`, default active; full tab list in every result |
| Vision | opt-in `--caps vision` | opt-in `click_at` | on by default | via model | `--annotate` | screenshot, zoom, coordinates built in |
| Debug data | console, network, tracing | traces + insights, network bodies, console w/ source maps, CSS, Lighthouse, heap | little | little | console, network, HAR, React, vitals | console, network (off by default) |
| Size control | depth, subtree, find, file, mode none | file paths, pagination, verbose flag | 40k char cap | n/a | `-i -c -d`, max-output, profiles | filter, ref, depth, 50k cap, find ≤20 |
| Person's view | headed; extension tab group per client + approval + status page; action overlays | headed Chrome; DevTools selection shared | cloud live view | Browserbase live view | WebSocket stream with input | tab group, side panel plan, per-site permissions, stop |
| Risky actions | none built in ("not a security boundary") | none built in | domain lists, secret placeholders | observe→code fills secrets | action policy, confirm categories, vault | confirm callback; always-ask list; forbidden list; classifiers |

---

## 8. Lessons for an app that embeds the browser and gives tools to its own Agents

Plain recommendations for Banda. These are my reading of the above (**inferred**), tied to the evidence.

**Observation**
1. Use an accessibility-tree snapshot with short refs as the main view. Copy Playwright's `ai` mode format (`- button "Submit" [ref=e2]`). It is the de facto standard; Agents already know it from Playwright MCP, agent-browser and Claude in Chrome. If Banda's renderer can run Playwright's injected script, reuse it; otherwise build from CDP `Accessibility.getFullAXTree` like Chrome DevTools MCP and the browser-use Anthropic driver do.
2. Make refs **stable**: key them on the DOM node (`backendNodeId` + document/loader id), not on position. Keep a ref until navigation. Never renumber handed-out refs. Give iframe refs a frame prefix.
3. Return a clear error on a stale ref ("ref e12 is gone; take a new snapshot"). Optionally re-find by unique role+name, as agent-browser does, but fail if ambiguous.
4. Only give refs to elements that are visible and receive pointer events. Fail a click that is covered, and name what covers it.
5. Offer `find` (search the tree by text/regex) and scoping (`depth`, subtree ref, interactive-only). These are cheaper than full snapshots.
6. Keep screenshots as a second channel: `screenshot` with an optional numbered-marks overlay, and coordinate actions behind a flag for canvas pages.

**After an action**
7. Do **not** return a full snapshot after each action. Return: a short ack, the tab's URL/title if changed, new/closed tabs, an open dialog if any, new console errors count, downloads. Let the Agent ask for a snapshot. Playwright tried full, then diff, then moved full snapshots to a file; Chrome DevTools and Anthropic return only an ack.
8. If Banda wants a cheap "what changed" signal, mark new interactive elements (browser-use `*[n]`) or offer an explicit `diff` tool, rather than auto-diffing.
9. Wait for the action's effects before returning (navigation, DOM settle), with a bounded time, like Chrome DevTools MCP.
10. Cap every text result and say when it was cut. Big outputs (full snapshot, network bodies, traces) go to a file in the Thread's workspace, with a path in the reply.

**Tabs and ownership**
11. Make the tab explicit. Every page tool takes a tab id (Chrome DevTools requires `pageId`; Anthropic defaults to the active tab and appends the full tab list to every result). An implicit "current tab" breaks when two Threads share one browser.
12. A Thread should see and touch **only its own tabs**. Playwright's extension and Claude in Chrome both use a per-Agent tab group; the Person drags tabs in to share them. Banda has Panes and the Agent's mark (#144); the same model fits: a Thread owns the tabs it opened plus tabs the Person hands it.
13. Note that the raw CDP endpoint exposes **every** tab to tools like Playwright MCP (it adopts all existing pages). Banda's own tools should filter by Thread; consider a per-Thread CDP view for third-party tools too. Chrome DevTools MCP hides `webview` targets unless `--experimentalIncludeAllPages`.

**Person's view and control**
14. Always show which tab an Agent is driving (Banda's mark), and show actions live: highlight the target and a short label per action (Playwright `browser_video_show_actions`, cursor animation).
15. One obvious **Stop** per Thread that cancels the running tool call. When the Person types or clicks in a driven tab, pause the Agent (take-over), and tell the Agent on its next call that the Person acted. Atlas, Steel and Browserbase all treat "Person in control" as a visible state.
16. Let the Person point: Chrome DevTools marks the element selected in DevTools; Playwright has `browser_annotate` and records the Person's demo as code. A "send this element to the Thread" gesture is cheap and useful.

**Safety**
17. Treat all page content as untrusted data: wrap page text in boundaries, label page-registered (WebMCP) tools as untrusted, never put tab titles or URLs into instructions.
18. Confirm consequential actions in the executor, before the call: purchases, sending messages, account changes, accepting terms, uploads, downloads, permission grants. Anthropic and Claude in Chrome list these. Approval should show the action, the tab URL and the element description (Playwright's `element` param exists for this).
19. Keep secrets out of the context: fill credentials from a vault by name (agent-browser auth vault, 1Password for Claude, browser-use `<secret>`), redact token-like URL params.
20. Allow only `http`/`https` (and Banda's own dev URLs) for navigation; block `file:`, `chrome:`, `javascript:`, `data:` unless asked. Re-check after redirects. Comet's `file://` exfiltration is the cautionary case.
21. Default-off for the riskiest tools (JS eval, file upload), as Anthropic does. For a coding-agent app, console and network reading are core; keep them on but mark their content untrusted.

**Tool surface**
22. Keep the default tool set small and put the rest behind groups (agent-browser profiles, Chrome DevTools `--slim`, Playwright `--caps`). Tool schemas alone cost thousands of tokens per request.
23. Support WebMCP (`navigator.modelContext`): Playwright MCP, Chrome DevTools MCP, Stagehand and agent-browser all list page-registered tools now. For Banda's own dev pages this is a direct, structured channel.
24. Consider a CLI twin (`banda browser snapshot`, `click @e2`): Playwright and Vercel both say coding agents spend fewer tokens with a CLI that writes big output to files.
25. Align member names with Anthropic's toolset (`navigate`, `read_page`, `find`, `form_input`, `left_click`, `get_page_text`, `list_tabs`…) or Playwright's (`browser_snapshot`, `browser_click`…). Models are trained on both; inventing a third vocabulary costs accuracy.
