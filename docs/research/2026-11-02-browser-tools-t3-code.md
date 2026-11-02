# Browser tools for Agents: how T3 Code does it

Companion to `2026-11-02-browser-tools-for-agents.md` (issue #151).

- **Source:** github.com/pingdotgg/t3code, shallow clone at `/tmp/t3code-browser`.
- **Commit:** `47f2c8d29e981c7723467efe137ee19e91df924e`, 2026-11-02T00:18:56-08:00 ("fix(server): Claude threads no longer join the Claude session that launched T3 (#29169)").
- **How:** read-only. Nothing from T3 was run. Paths are relative to the repo root. Line numbers are at that commit.
- **Marks:** **V** = verified, read in code. **I** = inferred, our reading.
- **For:** Banda issue #151, Agent browser tools.

This note goes deeper than the tool schemas as an Agent sees them in T3 Code and section 1 of `docs/research/2026-11-01-a-browser-in-the-window.md` (Banda, T3 commit `1d626d02`). Two corrections to that earlier note:

- There is no `preview_screenshot` tool any more. A screenshot comes from `preview_snapshot` with `includeImage` or `save` (V, `apps/server/src/mcp/toolkits/preview/tools.ts:225-238`).
- `interactiveElements` is always empty. The page script returns `[]`, so the accessibility tree is the only element list (V, `apps/server/src/preview/ServerBrowserPage.ts:148-155`).

## 0. The shape in one picture

```
Agent (Claude/Codex/...)  --MCP HTTP-->  T3 server: McpHttpServer + preview toolkit
                                           |  handlers.ts -> PreviewAutomationBroker.invoke
                                           v
                          PreviewAutomationBroker (queue per host; one host: "server-browser")
                                           v
                          ServerBrowser (in the server process, Playwright 1.60 "playwright-core")
                             |                                   |
         headless chrome-headless-shell 156          desktop-rendered tab: Playwright connectOverCDP
         (remote env, web client, or no desktop)      -> ws://127.0.0.1:<port>/<secret> (DesktopBrowserChannel)
                                                      -> NDJSON over two inherited fds
                                                      -> Electron DesktopBrowserHost -> CdpRelay
                                                      -> webContents.debugger (the one debugger)
```

- Playwright always runs in the server process (V, `apps/server/src/preview/ServerBrowser.ts:66-73`, `apps/server/package.json:66`).
- The only automation host that connects to the broker is the ServerBrowser, as `clientId: "server-browser"` with `preferred: true` (V, `ServerBrowser.ts:2704-2735`). No other code calls `broker.connect` (V, by grep). The broker still supports several hosts and a "V1" operation set from older desktop hosts (V, `apps/server/src/mcp/PreviewAutomationBroker.ts:404-408`, `packages/contracts/src/previewAutomation.ts:25-54`).

## 1. Tools: the full list, inputs, outputs, limits

All tools need the thread MCP credential to carry the `preview` capability (V, `apps/server/src/mcp/toolkits/preview/handlers.ts:62`, `apps/server/src/mcp/McpInvocationContext.ts:206-216`).

- **How the capability is set.** It comes from the setting `enableAgentBrowserAccess`, which is global with a per-project override. It is set when the provider session starts (V, `apps/server/src/orchestration-v2/ProviderSessionManager.ts:357-374`).
- **What the Agent sees if it is off.** The error tells the Agent to use Playwright or curl from the shell instead (V, `packages/contracts/src/previewAutomation.ts:660-670`).

**Tool annotations.** "Acting" tools are `OpenWorld` and `Destructive`. Snapshot is not read-only "because save=true writes" (V, `tools.ts:44-51, 136`).

**How they are wired.**
- Acting tools go through `actsAsCaller`, which refuses read-only clients and dead callers. Read tools go through `readsAsCaller` (V, `handlers.ts:191-269`, `apps/server/src/mcp/McpToolAccess.ts:107-138`).
- `preview_snapshot` is registered by hand, so it can return image content (V, `apps/server/src/mcp/McpHttpServer.ts:502-616`).

### 1.1 Inputs (schemas in `packages/contracts/src/previewAutomation.ts`)

| Tool | Input (all take optional `tabId`) | Output | Notes |
|---|---|---|---|
| `preview_status` | `{tabId?}` (`:58-63`) | `PreviewAutomationStatus` (`:74-129`) | Read op. Works on any thread tab. |
| `preview_open` | `{url? (≤2048), open?=true, show? (old alias), reuseExistingTab?=true, profileId? (≤64), target?: environment-port}`. `tabId` with `reuseExistingTab=false` is refused (`:139-168`, `tools.ts:66-83`) | Status | If `target` is given, it does `open` then `navigate` (`handlers.ts:198-213`). |
| `preview_navigate` | exactly one of `url` / `target: {kind:"url",url} \| {kind:"environment-port", port 1-65535, protocol? http\|https (default http), path?}`; `readiness: load\|domContentLoaded\|none` (default load); `timeoutMs` 1..60000 (default 15000) (`:171-214`) | Status | |
| `preview_snapshot` | `{tabId?, includeImage?=false, save?}` (`tools.ts:137-158`) | bounded snapshot JSON, plus optional PNG image content | See §2. |
| `preview_act` | flat `{action: click\|type\|hover\|select\|drag\|upload\|press\|scroll, locator?, selector?, x?, y?, button?, clickCount?, text?, clear?, values?, source?, target?, paths?, key?, modifiers?, deltaX?, deltaY?, timeoutMs?}` (`:427-457`) | `{}`, or `{selected: string[]}` for select; plus `toolIcon` | The flat shape is decoded again with a strict per-action schema (`:414-424`, `handlers.ts:115-117, 227-240`). |
| `preview_evaluate` | `{expression (≤64,000 chars), awaitPromise?=true, returnByValue?=true}` (`:460-471`) | `{value}`. Non-objects are wrapped because "MCP requires object structuredContent, and Claude Code rejects invalid results" (`tools.ts:174-180`) | Result ≤64,000 bytes. |
| `preview_wait_for` | at least one of `locator`/`selector`, `text` (case counts), `urlIncludes`; `timeoutMs` (`:474-496`) | `{}` | All conditions must hold. |
| `preview_dialog` | `{accept, promptText?}` (`:132-136`) | Status | |
| `preview_resize` | `mode: fill \| freeform{width,height} \| preset{preset, orientation?}`; area ≤3840×2160 (`:216-248`) | `{tabId, setting, viewport}` | CSS size only, not the user agent. 17 presets (`packages/contracts/src/preview.ts:29-46`). |
| `preview_set_appearance` | `{colorScheme: system\|light\|dark}` (`:261-265`) | `{tabId, colorScheme}` | |
| `preview_recording_start` | `{tabId?}` | `{tabId, recording, startedAt}` | |
| `preview_recording_stop` | `{tabId?}` | `{id, tabId, path, mimeType, sizeBytes, createdAt}` (`:567-574`) | ≤50 MiB, mp4 or webm. |
| `t3_preview_list` | `{cursor?, limit?=20}` | the thread's sessions, with `runtime` | "Only `runtime:'server'` entries can be automated" (`apps/server/src/mcp/toolkits/previewControls/tools.ts:25-28`). |
| `t3_preview_close` | `{tabId}` | `{}` | Only the Agent session that opened the tab may close it (`ServerBrowser.ts:2071-2083`). |

**Per-action inputs** (V, `previewAutomation.ts:277-412`):

- **click:** exactly one target: `locator`, `selector`, or `x`+`y`. `button`: left/right/middle. `clickCount`: 1-3.
- **type:** `text`, plus at most one of `locator`/`selector`, and `clear`. With no target it types into the focused element.
- **select:** `values` (≤100; an empty list clears). Needs exactly one of `locator`/`selector`.
- **drag:** `source` and `target` locators.
- **upload:** `paths` (≤20), optional `locator`/`selector`. `[]` cancels the open picker.
- **press:** `key`, plus `modifiers` from Alt, Control, Meta, Shift.
- **scroll:** `deltaX` and/or `deltaY`, plus an optional container locator.

**Status fields** (V, `previewAutomation.ts:74-129`, built in `ServerBrowser.ts:1556-1616`):
- `available`, `visible`, `tabId`, `url`, `title`, `loading`.
- `control: {owner: agent|human|unclaimed, ownedByCaller, generation}`.
- `dialog: {type, message, defaultValue}` (each cut to 4000 chars).
- `viewportSetting`, `viewport`, `fileChooser: {multiple, accept}`.
- `downloads[]` (`fileName`, `path`, `sizeBytes`, `url`, `completedAt`).
- `tabs[]`: every tab in the thread, with `owner`, `ownedByCaller`, `visible`, `openerTabId`, `profileId`.
- `profiles[]` and `defaultProfileId`.

### 1.2 Timeouts and limits

| What | Value | Where (V) |
|---|---|---|
| Broker default per request | 15 s, plus 1 s grace for the host's own timeout reply | `PreviewAutomationBroker.ts:44, 556-557, 646-648` |
| First `open` on the preferred host | 660 s ("First open may install Chromium for ten minutes") | `PreviewAutomationBroker.ts:555-557` |
| Background status read after each act (for the favicon icon) | 500 ms; never evicts the host | `handlers.ts:80-89`, `PreviewAutomationBroker.ts:652-655` |
| Per-tool `timeoutMs` | 1..60,000; default 15,000 | `previewAutomation.ts:21-23` |
| Navigation | 15 s; `open` uses min(request, 15 s) | `ServerBrowser.ts:128, 1981` |
| Snapshot | 10 s overall; 1 s per out-of-process frame read; one retry | `ServerBrowserPage.ts:207-208, 604-628` |
| Evaluate | the request timeout, then `Runtime.terminateExecution` | `ServerBrowserPage.ts:810-852` |
| wait_for | polls every 100 ms | `ServerBrowserPage.ts:854-882` |
| Recording stop | 120 s | `previewAutomation.ts:565`, `handlers.ts:262` |
| Desktop attach wait / CDP connect | 10 s / 15 s | `ServerBrowser.ts:99, 750-758`; `ServerBrowserContexts.ts:203` |
| Agent tabs | 8 per Agent session, 32 per server | `ServerBrowser.ts:354-355, 1378-1395` |
| Idle Agent tabs | closed after 30 min idle, swept each minute; only headless tabs with no viewer | `ServerBrowser.ts:356-357, 1444-1455, 2697-2700` |
| Console and network buffers | 200 entries each, console text 2000 chars | `ServerBrowserPage.ts:30`, `ServerBrowser.ts:966-972` |
| Action timeline | 50 entries | `ServerBrowser.ts:130` |
| Downloads | 20 per tab, 1 GiB each, folder mode 0700, file mode 0600 | `ServerBrowser.ts:359-361, 1057-1110` |
| Recording | 50 MiB (`PROVIDER_SEND_TURN_MAX_FILE_BYTES`) | `packages/contracts/src/chatAttachment.ts:17` |

### 1.3 Errors

The errors are tagged and written as recovery advice for the model (V, `previewAutomation.ts:721-983`). The useful ones:

| Error | Message (short) |
|---|---|
| `ControlInterrupted` / `agentMismatch` | "This browser tab belongs to another agent session or a human. Open your own tab." |
| `ControlInterrupted` / `humanControl` | "A human controls this browser tab. Wait until they release control." |
| `ControlInterrupted` / `tabRequired` | "Multiple browser tabs belong to this session. Pass a tabId…" |
| `ControlInterrupted` / `dialogPending` | "A browser dialog is pending. Read preview_status and resolve it with preview_dialog." |
| `ControlInterrupted` / `tabLimit` | "Too many server browser tabs are open. Close one with t3_preview_close…" |
| `ControlInterrupted` / `interrupted` | "Browser control changed. Take a fresh snapshot before trying again." |
| `InvalidSelector` with `staleRef` | "This element ref is stale. Navigation, dialogs, and new snapshots replace refs; take a fresh snapshot and use its refs." |
| `TargetNotEditable` | type/select on a wrong element |
| `ResultTooLarge` | evaluate result over 64,000 bytes |
| `NoAvailableHost` | "…may be starting or reconnecting. Retry preview_status, then call preview_open…" |
| `Timeout` | "…timed out after N ms." |

**Where page text may and may not leak into errors.**
- Messages from the host are reclassified on the server. Only the server-browser host's free-text reason passes through, cut to 500 chars (V, `PreviewAutomationBroker.ts:208-347`).
- A snapshot failure returns only server-authored text: "Preview errors contain server-authored recovery guidance, never page output" (V, `McpHttpServer.ts:465-500`).
- Playwright errors map to tags by regex. "strict mode violation" counts as an invalid selector (V, `ServerBrowserPage.ts:43-71`).

## 2. The snapshot

### 2.1 How it is built (V, `ServerBrowserPage.ts:524-628`)

1. **Size.** Read the render scale and CSS viewport. A desktop page is read in an isolated world, because page script can reassign `devicePixelRatio` and `innerWidth`. The read is bracketed by `Page.getLayoutMetrics` to reject a read torn by a zoom change (`:413-445, 506-522`).
2. **Revoke old refs.** All earlier refs are revoked, and a new ref generation starts (`:532-534`).
3. **First secret read.** Open a CDP "reader" for each frame owner and read every password or `-webkit-text-security` value, through open shadow roots, in an isolated world named `t3-preview` (`:211-238, 256-352`).
4. **Page state and screenshot, in parallel.**
   - `page.evaluate(SNAPSHOT_SCRIPT)` returns `url`, `title`, `loading`, and `document.body.innerText` (`:148-156`).
   - `Page.captureScreenshot` returns a PNG.
5. **Tree.** `page.ariaSnapshot({ mode: "ai", boxes: true })`. This is Playwright's own AI snapshot, not a custom walker (`:551-555`).
6. **Second secret read.** If any secret value changed, the snapshot fails with "The page changed while capturing its snapshot" (`:556-559`).
7. **Unread frames.** If a frame could not be read and its content shows in the tree, the snapshot fails with "too busy" rather than risk a leak (`:561-570`).
8. **Clean the tree.** Strip `data:` payloads from `/url:` lines. Mask secret values. Cut to 20,000 chars. Rename refs (`:574-584`).
9. **Mask text.** Visible text is masked, then cut to 20,000 chars. "Mask text before truncating so a value crossing the cut cannot leak its prefix" (`:587-588`).
10. **Retry once.** On failure, retry once, but only before the deadline and only if no newer snapshot has started, since a later retry would revoke the newer refs (`:604-628`).

While a snapshot runs, live viewer screencasts and any recording screencast pause (V, `ServerBrowser.ts:1735-1755, 2165-2171`).

### 2.2 Refs (V, `ServerBrowserPage.ts:75-125, 579-583`)

- **Native refs** are Playwright's `e12`, or `f1e3` inside a frame.
- **Public refs** look like `t3-<ns>-<gen>-e12`:
  - `ns` is 8 hex characters of a random UUID per server run. "A compact runtime namespace prevents old refs from aliasing after a server restart" (`:76-80`).
  - `gen` is a base-36 counter, one per snapshot.
- **Use.** The Agent passes `locator: "aria-ref=t3-…"`. The server maps it back to `aria-ref=<native>` through a per-Page `WeakMap` (`:107-123`).
- **Stale refs.** A missing ref throws `InvalidSelector` with `{staleRef: true}` ("stale or belongs to another tab") (`:114-121`).
- **Refs die when:**
  - a new snapshot starts (`:532-534`);
  - **any** frame navigates or detaches, including subframes (`:96-97`);
  - control changes hands (SessionControl's `onGenerationChange`, `ServerBrowser.ts:820-822`, and after an action if the generation moved, `:2123`);
  - a dialog is resolved (`ServerBrowser.ts:557-565`).
- **I:** because a subframe navigation (an ad iframe, say) kills every ref, busy pages may give stale-ref errors often.
- **Raw selectors.** The legacy `selector` field passes a raw Playwright selector of any engine. Strict mode rejects ambiguous matches "rather than acting on row one" (`:124-125`).

### 2.3 Frames

- The `mode:"ai"` tree covers iframes. Frame refs carry an `f` prefix. The tool description says refs work "even in frames" (V, `tools.ts:140`, `ServerBrowserPage.ts:389`).
- Each out-of-process frame gets its own CDP session for secret reads. The sessions are reused across snapshots (V, `ServerBrowserPage.ts:244-276`).
- The desktop relay refuses child targets. Those frames fall back to `frame.evaluate` in the page world, which is less spoof-proof (V, `:255, 266-270, 330-336`; `apps/desktop/src/preview/CdpRelay.ts:161-166`).

### 2.4 Diagnostics (V)

| Field | Content | Source |
|---|---|---|
| `consoleEntries` | `{level, text (≤2000), timestamp}`, every console message | `ServerBrowser.ts:966-972`, Playwright `page.on("console")` |
| `networkEntries` | `{url, method, status \| null, failed, errorText?, timestamp}`: every response and every failed request. No headers, no bodies, no timing. `data:` payloads stripped | `ServerBrowser.ts:917-965` |
| `actionTimeline` | `{id, action, status: running\|succeeded\|failed\|interrupted, startedAt, completedAt?, error?}` for navigate/click/hover/select/drag/upload/type/press/scroll | `ServerBrowser.ts:1851-1874` |

- Page exceptions (`pageerror`) are not collected separately (I, from the listeners present).
- There is no diff between snapshots. Each one is a full dump.

### 2.5 Image (V, `McpHttpServer.ts:543-605`, `ServerBrowserPage.ts:447-504`)

- A PNG is always captured. Scaling:
  - It is shrunk to at most 1280 px wide, on a canvas in an isolated world of the page itself ("the server has no image library").
  - It never uses a CDP clip scale: "Chromium mirrors the top-left of the page into a `backdrop-filter` in any capture it shrinks."
  - The size is read from the PNG header.
- `includeImage` defaults to false. "Providers replay images on later requests, and some reject them; include images only when requested" (`:556`).
- The JSON always carries `screenshot: {mimeType, width, height}`, never the data.
- `save=true` writes `browser-screenshot-<host-slug>-<time36>-<uuid8>.png` to `browserArtifactsDir`.
  - Without `includeImage`, the result is only `{url, screenshotPath}` (`:409-451, 558-568`).
  - The description tells the Agent to embed `![alt](screenshotPath)` to show it.

### 2.6 The ~20 KB cap (V, `McpHttpServer.ts:251-407`)

**Caps on each field first:**
- whole result 20,000 UTF-8 bytes;
- `visibleText` 8,000 chars;
- tree 20,000 chars;
- each element name 200 chars;
- `url` and `title` 2,048 chars;
- each log list keeps its newest 40 entries, and each string in them 500 chars.

**Then, while the JSON is still over 20,000 bytes, it halves in this order:**
1. `actionTimeline`, `networkEntries`, `consoleEntries`, keeping the newest entries;
2. then `visibleText`;
3. then `interactiveElements`;
4. then `accessibilityTree`.

"Elements carry the locators, so they go last" (`:364`). In practice the tree, which holds the refs, is cut last.

**What the Agent gets back:**
- Every cut is listed in `omitted`. A text line "Snapshot text was bounded. Omitted: …" is added, for example "visibleText after N characters (use preview_evaluate for more)".
- The content has two text parts: `{url}` and the bounded JSON. Structured content mirrors them, because "Some clients show only the text content and others only structuredContent" (`:492`).

## 3. Acting

### 3.1 How each action is done (V, `ServerBrowserPage.ts:630-806`, `ServerBrowser.ts:2130-2221`)

| Action | Mechanism |
|---|---|
| click | `locator.click({button, clickCount, timeout})`, with Playwright's actionability checks. Coordinates use `page.mouse.click`. It returns early if a dialog opens, since "waiting for the action to finish would block until dialog resolution" (`:630-655`). |
| type | With `clear` and a locator: `locator.fill`. Otherwise it checks that the target (or the innermost `:focus`) is an enabled, focused text field or contentEditable, then calls `keyboard.insertText`. One insert, not one event per key. It refuses with `TargetNotEditable` "to avoid losing input or sending it to the previous field" (`:657-715`). |
| hover | `locator.hover` or `mouse.move`. |
| select | Reads the `<select>` options, matches by value then by trimmed label, then `selectOption`. A custom dropdown gets "click it open, then click the option" (`:732-765`). |
| drag | `source.dragTo(target)`. Its rejection is observed at once, because "an unhandled rejection during cursor movement exits the server" (`:767-786`). |
| upload | With a locator: `setInputFiles`. Otherwise it answers the intercepted file chooser. Paths must be absolute; the picker is single or multiple (`ServerBrowser.ts:1192-1217`). |
| press | `keyboard.press("Mod+…+Key")` to the focused element (`:794-796`). |
| scroll | JS `scrollBy` on the window or on the container element. This is not a wheel event, so `wheel` listeners do not fire (I) (`:798-806`). |
| evaluate | Raw CDP `Runtime.evaluate` in the main world. Over the time limit it calls `terminateExecution` "so a hung expression cannot block the tab's control queue" (`:808-852`). |
| wait_for | Polls every 100 ms: locator `count() > 0` (present, not visible), `innerText.includes(text)`, `url.includes`. |

- **Agent cursor.** Before a pointer action, the server sends the point to every viewer, to the desktop and to the recording. It waits 160 ms on a move and 40 ms more before a click. This deliberately slows every pointer action so the Person can follow it (V, `ServerBrowser.ts:103-104, 1819-1849`).
- **What an action returns.** `{}`, plus `toolIcon: {_tag:"website", pageUrl}` taken from a 500 ms status read (V, `handlers.ts:75-95`). `select` returns `{selected}`.
- **No fresh snapshot and no diff after acting.** The Agent must call `preview_snapshot` again. The outcome appears later in `actionTimeline` (V, `ServerBrowser.ts:2173-2179`).
- **Navigation inside an action** is tracked with `control.track` so later actions wait for it (V, `SessionControl.ts:58-61`, `ServerBrowser.ts:1645-1648`).

### 3.2 Queueing and waiting

- `SessionControl` keeps one promise chain per tab. Agent actions, human viewer input and system work all run in order. An action checks the control epoch again just before it runs. A request whose deadline passed while it waited is refused (V, `SessionControl.ts:48-97`).
- Read operations (`status`, `snapshot`, `waitFor`) skip the queue through `observe` when the Agent may not act ("so agents can observe without delaying human input") (V, `ServerBrowser.ts:348-352, 2093-2105`, `SessionControl.ts:119-123`).
- `dialog` and `close` run outside the queue, so they can unblock a click that is stuck on a dialog (V, `ServerBrowser.ts:2069-2090`).

## 4. Tab ownership

### 4.1 Who owns what (V)

- **Agent session key** = `environmentId + providerSessionId + threadId`. "Codex/OpenCode share sessions across threads; include thread id to isolate tabs and ownership" (`PreviewAutomationBroker.ts:165-167`). The broker supplies it from the authenticated scope, "never from tool input" (`previewAutomation.ts:616-617`).
- **Owner fixed at creation.** A tab gets `automationOwner = <agent session key>` when an Agent opens it. `SessionControl.agentId` is fixed when the tab is created (`ServerBrowser.ts:820`, `SessionControl.ts:22, 35-38`, `apps/server/src/preview/Manager.ts:192-194`).
- **Three owner states** (`ServerBrowser.ts:1471-1476`):
  - `human`: a viewer holds control;
  - `agent`: the tab has an owning Agent session;
  - `unclaimed`: the Person opened it, and no viewer holds it.
- **Who may act** (`SessionControl.ts:99-117`):
  - the owning Agent, or any Agent on an unclaimed tab;
  - and only while no human holds control.
  - Other Agents may still read (`ServerBrowser.ts:1876-1905`).
- **No implicit claim.** An Agent never claims a tab. To reuse another tab it must pass `tabId` explicitly: "Reusing another session's tab requires explicit tabId; reading it grants no implicit takeover" (`ServerBrowser.ts:1976-1980`).
- **Current tab.** The broker remembers each Agent session's current tab, so `tabId` can be left out. With more than one owned tab and no explicit `tabId`, the call fails with `tabRequired` (`PreviewAutomationBroker.ts:558-574, 661-690`; `ServerBrowser.ts:1880-1885, 1939-1950`).
- **Default tab** with no `tabId`: the newest tab this session owns, else the thread tab that has a viewer or was used last (`ServerBrowser.ts:1457-1469`).

### 4.2 Human in control and handoff (V, `SessionControl.ts`, `ServerBrowser.ts:2447-2655`)

- **What counts as the human driving.** A streamed viewer that holds control. Only the web canvas viewer (`ServerBrowserSurface`) is such a viewer.
- **Taking control:**
  - The Person presses "Take control", which sends `{type:"takeControl"}`.
  - A viewer that attaches with `canOperate` to an **unclaimed** tab takes control at once (`:2544-2546`). So a Person watching their own tab blocks Agent actions automatically.
  - On an Agent's tab the Person must press "Take control".
- **What a take does.** It reserves control at once: the epoch goes up and refs die. It waits for running work to finish before the human's first input runs: "Reserves control immediately, but drains running work before the new owner can act" (`SessionControl.ts:20, 75-80, 154-161`). A queued Agent action then fails with `interrupted`: "take a fresh snapshot".
- **Releasing.** `releaseControl`, or a viewer disconnecting, releases control. Release waits for the viewer's own navigations ("trackUntilHandoff"), then lifts any keys and mouse buttons the Person still held (`SessionControl.ts:63-69, 163-179`; `ServerBrowser.ts:2291-2309, 2532-2541`).
- **Another viewer** cannot take control from the viewer that holds it (`SessionControl.ts:154-158`).
- **Hovers** coalesce: only the latest waiting hover runs (`SessionControl.ts:137-152`).
- **Pitfall: the native desktop webview has no human-control lock.**
  - When the T3 desktop app shows a local server tab, it renders a native `<webview>`, not the streamed canvas (V, `apps/web/src/browser/previewRuntime.ts:44-56`).
  - Desktop input only marks `controller: "human"` for 750 ms, to style the cursor in recordings (V, `apps/desktop/src/preview/Manager.ts:1377-1392, 841-873`).
  - The desktop-to-server channel carries only `attached`, `detached` and `cdp` events, never human input (V, `packages/contracts/src/desktopBrowser.ts:10-35`).
  - **I:** so on desktop-rendered tabs the server always sees `owner` as `agent` or `unclaimed`. An Agent can act while the Person clicks in the same page. Nothing blocks it.

### 4.3 Parallel subagents (V)

- Subagents in one provider session share one Agent session key, so they share ownership.
- The tool text requires each one to use `reuseExistingTab=false` and then its own `tabId` (`tools.ts:72`).
- Actions on one tab are serialized by its SessionControl. Different tabs run in parallel.

### 4.4 Lifetime and cleanup (V)

- **Tab ids** carry a server epoch suffix, so "Persisted client surfaces must not bind to a different tab after a server restart" (`apps/server/src/preview/Manager.ts:177-179`). Sessions live in memory.
- **Closing a tab:**
  - `t3_preview_close`, which only the owning Agent may call;
  - the Person closing it;
  - the page closing or crashing (`ServerBrowser.ts:986-987`);
  - the 30-minute idle sweep, for headless Agent tabs with no viewers only (`:1444-1455`).
- **Thread deletion** queues a `preview.cleanup` effect that closes every tab of the thread (`apps/server/src/orchestration-v2/ThreadDeletion.ts:227`, `EffectWorker.ts:518-519`, `ResourceCleanupService.ts:73-82`).
- **Turn end.** There is no automatic close. The orchestration instructions say "Close a tab you opened before you reply, unless the user asked for it or uses it" (`packages/provider-core/src/server/orchestrationInstructions.ts:24`).
- **Popups** become new tabs owned by the same Agent and keep `window.opener` "so sign-in popups can report back" (`ServerBrowser.ts:979-980, 1305-1338`).

## 5. How tools reach the browser

### 5.1 Server side (V)

- **MCP to broker.** The MCP handler calls `broker.invoke`. The broker keeps a `pending` map and offers `{type:"request", request}` on the host's queue; the host answers with `broker.respond` (`PreviewAutomationBroker.ts:475-691`).
- **Host pinning.** A thread is pinned to one host: "Pin interactions to one desktop runtime so cookie/DOM state cannot jump between hosts" (`:522-550`).
- **Timeouts.** "Never replay possibly applied actions." On a timeout the broker evicts the host, and the ServerBrowser reconnects one second later (`:651-656`; `ServerBrowser.ts:2729-2735`).
- **Headless Chrome:**
  - The server downloads chrome-headless-shell 156.0.8078.80 from Chrome for Testing, with pinned hashes. "Never pin below 156.0.8078.70: the shell has no CRLSet…" (`apps/server/src/preview/PreviewBrowser.ts:24-29`).
  - It launches through an "agent scope" launcher, so Chrome sits outside the server's OOM protection (`ServerBrowser.ts:491-502`).
  - The sandbox is on unless the operator opts out (`ServerBrowserContexts.ts:88-104`). `t3 browser setup` writes an AppArmor profile on Ubuntu (`PreviewBrowserHost.ts:8-30`).
- **Contexts and profiles** (`ServerBrowserContexts.ts:139-191`):
  - Persistent profiles use `launchPersistentContext` in `stateDir/server-browser/profiles/<id>`.
  - Incognito tabs, and Agent tabs opened with no profile, get a fresh context in a shared browser.
  - **I:** `resolveOpenProfile(undefined)` returns the client-reported default profile once any client has reported. So Agent tabs normally share the Person's default profile, cookies and logins included. The text "Default: the user's" agrees (`ServerBrowser.ts:1540-1554`, `previewAutomation.ts:19-20`).
- **Anti-bot look.** The headless UA is rewritten to a Chrome UA, with Sec-CH-UA changed to match: "sites block mismatches". Also `--disable-blink-features=AutomationControlled` and no `--enable-automation` (`ServerBrowserContexts.ts:38-75, 94-99`).

### 5.2 Desktop side (V)

- **Transport.** The desktop starts the local backend with two extra fds: `desktopBrowserFd` (desktop to server events) and `desktopBrowserControlFd` (server to desktop commands). Both carry NDJSON (`apps/desktop/src/backend/DesktopBackendManager.ts:405-433, 500-518`; `apps/server/src/preview/DesktopBrowserChannel.ts:57-135`).
  - Events: `attached`, `detached` (webview gone, crashed, or DevTools took the debugger), `cdp`.
  - Commands: `cdp`, `release`, `pointer`, `turn`.
  - **I:** WSL backends get their bootstrap on stdin because "wsl.exe drops extra file descriptors", so they likely get no desktop browser (`DesktopBackendManager.ts:444`).
- **Loopback relay.** For each tab the server opens a WebSocket on `127.0.0.1:<random port>/<24-byte random secret>`. It serves one Playwright connection only, because "a second would see the first's sessions". Playwright calls `chromium.connectOverCDP` on it (`DesktopBrowserChannel.ts:137-194`, `ServerBrowserContexts.ts:201-210`).
- **One debugger per webContents.** The desktop preview Manager owns the single `wc.debugger.attach("1.3")` and shares it with the relay:
  - If DevTools are open, or another debugger is attached, automation is refused (`PreviewAutomationDevToolsOpenError` / `DebuggerAttachedError`) (`Manager.ts:1007-1044, 1102-1118`).
  - Opening DevTools detaches the control session. Closing DevTools reattaches it and re-applies media emulation (`Manager.ts:2022-2037, 2275-2300`).
- **`CdpRelay`** fakes a one-page browser for Playwright (`CdpRelay.ts`):
  - It answers `Browser.getVersion`, `Target.getTargets`, `setAutoAttach` and similar itself.
  - It announces a single page session (`:120-189`).
  - It refuses other targets: "Only this preview tab's page can be attached" (`:161-166`).
  - It maps `Browser.setDownloadBehavior` to the page (`:123-135`).
  - Messages are capped at 64 MiB. An oversized reply becomes an error. An oversized event closes the relay, because "A dropped event would leave Playwright out of step with the page" (`:39-99`).
- **`DesktopBrowserHost`** forwards CDP and handles Electron's quirks:
  - **Focus emulation.** It turns on `Emulation.setFocusEmulationEnabled` while the server drives or streams the tab, and keeps it on until the Agent's turn ends (`turn` command from `PreviewAgentActivity`) (`DesktopBrowserHost.ts:173-218, 290-299`; `ServerBrowser.ts:2680-2684`; `apps/server/src/orchestration-v2/RunExecutionService.ts:1324`).
  - **Painting.** Electron composites no offscreen guest, so the client paints the guest behind the app while a capture waits (`:220-234`).
  - **Screenshots one at a time.** "Chromium below 157 crashes the whole app when a guest's renderer exits with a screenshot copy in flight (crbug.com/567321049)" (`:131-171`).
  - **Downloads.** It records the time of each Agent input. A download within 5 s of Agent input is not moved to the user's Downloads (`:23-27, 481-488`; `Manager.ts:3601-3602`).
- **`GuestInput`** routes input around focus problems:
  - CDP key input follows window focus, so keys for an unfocused guest go through `sendInputEvent`.
  - A CDP pointer press steals focus from the app, so it saves and restores the app's focused element (`apps/desktop/src/preview/GuestInput.ts:1-150`).
  - "insertText crashes when a cross-site frame has focus" (`:10-18, 24-25`).

### 5.3 Which browser a tab uses, and the desktop closing

- **Choosing the renderer.** A server tab is rendered by the desktop when a desktop is attached and the tab is not headless. The server waits up to 10 s for the webview to attach. Otherwise it marks the tab headless for good: "Otherwise a desktop that attaches late shows its own page, and the agent drives another" (V, `ServerBrowser.ts:750-796`; `Manager.ts:45-47, 273-298`).
- **Webview detaches.** `dropTab(tab, false)` runs, and viewers get `reconnect` (V, `ServerBrowser.ts:729-748, 2671-2679`).
- **Webview attaches again.** A new backend makes the desktop re-announce all tabs, and the server reconnects them (V, `DesktopBrowserHost.ts:490-501`; `ServerBrowser.ts:2686-2696`).
- **Desktop app closed.** The desktop runs the local backend as a child process with SIGTERM (V, `DesktopBackendManager.ts:435-446`).
  - **I:** closing the app ends the local server and its tabs.
  - For a remote server there is no desktop channel (`available: false`, `DesktopBrowserChannel.ts:66-87`). Tabs run headless on the server and keep running without any client. Recording keeps the last client's frame rate "which lets agents record while no client is connected" (V, `ServerBrowser.ts:1484-1486`).
- **Desktop-runtime tabs.** Non-server tabs, the old desktop-only runtime, cannot be automated. The error says "This tab belongs to the desktop runtime…" (V, `ServerBrowser.ts:1962-1974`, `previewControls/tools.ts:28`).

## 6. The Person's view (V unless marked; from `apps/web`, read by a helper and spot-checked)

- **Control bar** on streamed tabs (`apps/web/src/browser/ServerBrowserSurface.tsx:749-770`):
  - One status line: "Connecting...", "Read-only", "You have control", "Agent has control", "Another viewer has control", or "Watching" (`packages/client-runtime/src/preview/serverBrowserStream.ts:29-40`).
  - One button: "Take control" / "Release control". It is disabled when another viewer holds control.
  - No banner, no dimming, no overlay. Input is simply dropped unless you hold control.
  - The server computes the controller per viewer (`ServerBrowser.ts:538-555`).
- **Agent cursor.** A lucide `MousePointer2` in the primary colour, with a ping ring on click. It fades after 700 ms and has no text label (`apps/web/src/components/preview/AgentBrowserCursor.tsx:58-94`). The same cursor is drawn into recordings (`ServerBrowserPage.ts:915, 943-961`).
- **Dialogs.**
  - In the web viewer: a card with the message. If you hold control you get "Dismiss"/"Accept" and a prompt field; otherwise "Take control to respond."
  - The Agent sees the same dialog in `preview_status` and answers it with `preview_dialog`.
- **File chooser.** Offered only to the viewer in control ("The page asks for a file."). Otherwise it is intercepted for the Agent. On desktop tabs it is intercepted only while the Agent operates or a viewer holds control, so a native view uses the OS picker (`ServerBrowser.ts:529-536, 1133-1162`).
- **Downloads.** A toast "Downloaded {file}" with "Save", shown to the viewer in control.
- **Auto-reveal.** When an Agent opens a tab, the floating mini player opens unless `open:false` is passed. Setting: "Auto-show floating preview" (`browserAutoShowFloatingPreview`) (`apps/web/src/components/preview/agentOpenedPreviews.ts:37-57`; `ServerBrowser.ts:2010-2018`).
- **Work log.** Each browser tool row shows the site's favicon through `toolIcon`.
- **No marker in the sidebar or thread list, and no notification,** for an Agent using the browser.
- **Desktop native tabs** have no control bar and no take-over button. The web side uses the controller value only for cursor opacity (`apps/web/src/components/preview/PreviewView.tsx:221, 1027-1031`).
- **Recording.** A red pulsing dot in the mini player. It was not checked whether Agent-started recordings light it.
- **Settings.** "Agent browser access" ("Allow agents to use the shared browser. Projects can override it."), applied at the next session start (`apps/web/src/components/settings/IntegrationsSettings.tsx:1030-1068, 1573-1586`).

## 7. Security

| Rule | Where (V) |
|---|---|
| Only `http:` and `https:` URLs. A bare host gets `https`; a loopback host gets `http`. `file:`, `javascript:` and others are refused. | `packages/shared/src/preview.ts:41-50, 183-211` |
| `environment-port` becomes `http(s)://localhost:<port><path>` **on the machine where the server and its browser run**, so it reaches that environment's dev server, also for remote environments. | `ServerBrowser.ts:1618-1625` |
| `evaluate` is not a read. It needs your own tab, or an unclaimed tab with no human in control. "evaluate requires control because scripts can mutate the page." To read a tab the Person drives, use `preview_snapshot`. | `ServerBrowser.ts:347-352`, `tools.ts:185` |
| Snapshot masks password and `-webkit-text-security` values everywhere in the text and tree. It refuses a snapshot if a value changed mid-capture, or if a value is too long to mask. | `ServerBrowserPage.ts:211-241, 355-404, 556-590` |
| `data:` payloads are stripped from URLs, the tree and Chromium console text. | `ServerBrowserPage.ts:158-205` |
| Metrics and secrets are read in isolated worlds, so page script cannot spoof them. Tree attribute parsing is strict, so name text cannot spoof a `[ref=…]`. | `ServerBrowserPage.ts:255, 387-389, 413-436` |
| Page and remote text are kept out of error messages. | `McpHttpServer.ts:480, 628`, `PreviewAutomationBroker.ts:338-345` |
| The CDP relay exposes only the one page target, on a loopback socket with a random secret path, for one client. | `CdpRelay.ts:161-187`, `DesktopBrowserChannel.ts:137-194` |
| No automation while DevTools are open. | `apps/desktop/src/preview/Manager.ts:1029-1035` |
| Profiles: server profile folders under `stateDir/server-browser/profiles`. Desktop partitions `persist:t3code-preview-profile-<sha256 hex 20>`. Profile ids are free of control characters, at most 64 chars, at most 24 profiles. | `ServerBrowserContexts.ts:185-191`, `apps/desktop/src/preview/BrowserSession.ts:14-17, 274`, `packages/contracts/src/browserProfile.ts:4-34` |
| Upload paths must be absolute. **I:** they are read from the server's own disk, so an Agent can upload any file the server user can read. | `ServerBrowser.ts:1192-1198` |
| The Agent's MCP credential carries capabilities. Browser access is off per project if the Person turns it off. | `ProviderSessionManager.ts:357-374` |

## 8. Worth copying

1. **Write errors as recovery steps for the model.** "Take a fresh snapshot", "Pass a tabId", "Wait until they release control" (`previewAutomation.ts:796-846`).
2. **Never replay an action that may have run.** On timeout, evict the host instead (`PreviewAutomationBroker.ts:651-656`).
3. **Refs are namespaced per run and per snapshot,** mapped on the server, and checked on use. A stale ref gets a clear error (`ServerBrowserPage.ts:75-123`).
4. **Control is reserved at once and drained before use.** A handoff bumps a generation that kills refs and fails queued Agent work with "interrupted" (`SessionControl.ts`).
5. **Reads go around the queue,** so the Agent can watch the Person's tab without slowing their input (`SessionControl.ts:119-123`).
6. **Masking and redaction happen before truncation** (`ServerBrowserPage.ts:574-588`).
7. **Reads that matter happen in isolated worlds** (`ServerBrowserPage.ts:211-238, 413-436`).
8. **A deterministic byte budget** with a fixed shedding order and an `omitted` list that tells the model what to call next (`McpHttpServer.ts:292-407`).
9. **No image unless asked,** because providers replay images later and some reject them. `save=true` gives a file path to show (`McpHttpServer.ts:556-568`).
10. **Click returns when a dialog opens,** and a pending dialog blocks other actions with a clear error (`ServerBrowserPage.ts:630-655`, `ServerBrowser.ts:1997-2008`).
11. **`type` refuses when focus is not an editable field,** so text never lands in the wrong place (`ServerBrowserPage.ts:657-709`).
12. **A visible Agent cursor,** slowed down a little, in the live view and in recordings (`ServerBrowser.ts:1819-1849`).
13. **The tool text and orchestration text steer use:** "Never use it unasked to verify your own edit", "preview_status first", "Close a tab you opened before you reply" (`tools.ts:140`, `orchestrationInstructions.ts:24, 36`).
14. **Models pass a dev server as both `url` and `target`;** the handler lets `target` win (`handlers.ts:198-206`).
15. **Answer MCP results as both text and structuredContent,** and wrap scalar results in an object (`McpHttpServer.ts:492`, `tools.ts:174-180`).

## 9. Pitfalls to avoid or plan for

1. **No human lock on native webviews** (§4.2). If Banda shows pages in a native `<webview>`, it must decide itself what "the Person is driving" means: input in the last N ms, focus, or an explicit button. T3 only does this for streamed views.
2. **Any frame navigation kills all refs.** Simple, but noisy on pages with live iframes (I).
3. **`interactiveElements` is dead weight in the schema.** It is always `[]`.
4. **There is no post-action snapshot or diff.** Every step costs the Agent a full snapshot of up to 20 KB.
5. **`scroll` uses JS `scrollBy`,** so wheel-driven UIs (virtual lists, maps) may not react (I).
6. **Agent tabs normally share the Person's default profile** and its logins (I, §5.1). That is convenient but a large blast radius.
7. **Electron quirks T3 had to handle** (`DesktopBrowserHost.ts`, `GuestInput.ts`):
   - only one debugger per webContents;
   - DevTools takes the debugger;
   - offscreen guests never paint, so captures hang;
   - concurrent screenshots crash Chromium below 157;
   - CDP input steals app focus;
   - `insertText` crashes with a cross-site frame focused.
8. **Never shrink screenshots with a CDP clip scale,** because of the backdrop-filter mirroring bug (`ServerBrowserPage.ts:447-448`).
9. **The first `open` may download Chromium for minutes.** Hence a 660 s timeout and progress errors (`PreviewAutomationBroker.ts:555-557`, `PreviewBrowser.ts:126-145`).
