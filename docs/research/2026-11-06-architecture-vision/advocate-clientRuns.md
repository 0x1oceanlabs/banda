# Option A: the view runs on the client and the data comes from the host

Input to [the vision](../2026-11-06-architecture-vision.md) (2026-11-06). Roma's decisions are in its §11 and override this document where they differ.

**Thesis.** An App's view is a small program. Its only input is host answers and events plus UI events; its only output is a UI tree and calls to the host. A program like that should run next to the pixels, inside the sandbox browsers already harden. Every system that lets third parties ship UI does this: Raycast, Shopify, VS Code webviews, Figma, Home Assistant, Obsidian. Draft 0062 d7 cites Raycast and remote-dom, and both of those run the extension code **on the same device as the renderer**. Neither streams a tree over a network. Under A, the host runs no JavaScript for views: it serves bundles and answers queries. The link between a view and its host is the API every client already speaks (`call / command / follow / stream`, `contract/src/engine.ts:86-95`), so no second network protocol is needed.

---

## 1. Technical shape

### What an App ships
`banda app pack` produces content-addressed artifacts (blake3):

```
apps/habits/
  manifest.toml   # id, api, ui = "1.3", calls/listens/live/device capabilities, slots, intents
  host.wasm       # handlers (0062 d4), unchanged
  worker/         # optional effects process, unchanged
  view.js         # ESM bundle against @banda/app-sdk/view; budget 256 KB, checked by `banda app check`
  view.js.map     # served only in dev, or to the owner
```

### Where the view is loaded from
- The client loads it from **the App's own host**, by hash: `GET /apps/<app>/<hash>/view.js` on the host's listener. This is the same byte endpoint that Visuals and media must move to anyway (map refactor move; `app/desktop-kit/src/files.ts:1-5` today).
- The file is immutable and cached forever by hash: Cache Storage on the web, a file cache in Electron and on the phone.
- Two hosts running two versions of one App give two hashes. Each Pane runs its own host's bundle.

### What runs it

| Client | Runtime | Isolation |
|---|---|---|
| Electron and the web client | One **view-host frame** per client: an iframe on its own origin (`banda-view:` scheme in Electron, `views.<host>.banda.host` or an opaque `sandbox="allow-scripts"` origin on the web). It has no preload and holds no credentials. It runs one dedicated `Worker` per (host, App). Each Pane is a remote root in that worker. | The worker is served with `Content-Security-Policy: default-src 'none'`, and the bootstrap deletes `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB` and `caches` before importing App code. The frame is a separate renderer process under site isolation (check this for our Electron version). |
| Phone (React Native + react-native-reusables) | A hidden `react-native-webview` loads the **same** view-host page, so the worker code is identical. Remote-dom mutations cross WebView→RN by `postMessage`, batched per frame. RN draws the catalogue with react-native-reusables. | WKWebView/JavaScriptCore on iOS, System WebView on Android. A second Hermes runtime is a later spike, not v1. |
| Headless (`banda app check`, Agents, tests) | The same bundle under Node with remote-dom's DOM polyfill and a fake host API. It writes tree JSON. | Development only. The host already ships Node for the Harness adapters (map: ADR 0059, `list.rs:93-108`). |

A watchdog in the frame pings each worker every second and terminates it after three missed pings. The Pane then shows "the App stopped" with a Reload button.

### Messages (three links, each with one owner)

**(a) view ⇄ client renderer.** Local only, over a MessagePort with `@quilted/threads` (function proxying, as remote-dom's examples do).

| Direction | Message |
|---|---|
| client → view | `render(root, {pane, project, args, size, focused, visible, mode, locale})`, `unmount(root)`, `facts(...)`, plus element events that remote-dom routes to callbacks |
| view → client | `mutate(records)` (remote-dom `RemoteMutationObserver` records), `host.call/command/follow/stream(...)`, `intent(name, args)`, `device(act, args, gesture)` (copy, open link, pick file, share; gesture-bound and declared under `device`), `state.put(key, value)` (per-Pane view state, VS Code `setState` style), `report(error, stack)` |

Each real input event carries a one-shot `gesture` id. A `command` or `device` act from a view is refused without a gesture on that Pane in the last 5 s, the same idea as transient activation in browsers. A view therefore cannot act in the background.

**(b) view ⇄ host.** This always goes through the client's trusted bridge and is never direct. The bridge turns `host.*` into the existing frames (`ClientFrame::Call/Subscribe/Stream`, `kernel/src/api.rs:52-98`) and stamps them with the Pane's **view ticket**. The worker never sees the ticket.

**(c) client ⇄ host.** This is today's protocol plus three additions:
- `Call apps.view {app, pane}` → `{ticket, bundle: {hash, ui, bytes}, grants, first}`.
  - `ticket` is a session narrowed to `{person, app, device, grants}`. This is exactly 0081 d3: "a trade can narrow them, never widen them".
  - `first` is the answer of the App's `view.load` handler. Opening a Pane is therefore **one round trip carrying data**, like a Remix loader or the RSC first payload.
- An optional `ticket` field on `Call/Subscribe/Stream`. Access becomes `decide(Session{participant, app, device, grants, gesture}, method, project)`. The map asks for that change anyway (kernel weaknesses: "Replace decide(Participant, Right, owner)…").
- The machine event `apps.view_changed {app, hash}`, which drives hot reload.

A view talks to **one host only: the one that served it**. In v1 nothing fans out across hosts from a view. Cross-host views (Inbox, calls) are platform parts built on host-side projections (digest §2.3, map "projection primitive").

### Drawing: shadcn and the Person's theme
Drawing is the same as in 0062 d7 and d18; A changes nothing here.
- **One catalogue schema** (`sdk/ui-catalogue/catalogue.ts`) generates three things:
  - the remote elements in `@banda/app-sdk/view` (`RemoteElement` subclasses with `remoteAttributes` and `remoteEvents`);
  - the web renderer map (`@remote-dom/react/host` over `@banda/kit` shadcn components);
  - the RN renderer map (react-native-reusables).
- The receiver validates props against the schema and drops unknown ones.
- `className` accepts layout utilities only; colour comes only through variants.
- **Tokens never enter the sandbox.** The ADR 0080 resolver runs per device and gives CSS variables on the web and the RN token object on the phone. Charts and meters are catalogue elements, so a view never needs a colour value.

### Live components and first-party Apps
- `<Thread id>`, `<Terminal session>`, `<BrowserSlot tab>`, `<CodeDiff source>` and `<Markdown>` are **trusted catalogue elements**.
  - The worker passes only ids.
  - The trusted component opens its own stream (`terminal.watch`) with the view ticket, checked against `live = ["terminal"]`.
  - Heavy streams never cross the sandbox.
- **Threads, Terminal and Browser views** are DOM-heavy (composer, canvas, webview). They run as trusted built-in bundles on the main thread with `[unstable] dom-view` in their `module.toml`. This is the VS Code built-in lane, and the ceiling only falls.
- **Usage, Git's lists, Pulls, Problems and the Files tree** run in the worker and prove the SDK.
- Usage is already "pure read-and-render over host state": `modules/harnesses/pane/src/UsagePane.tsx:86, 202, 234` uses `engine.call` only. Moving it is mechanical.

### What a view looks like

```tsx
// apps/habits/view/index.tsx: runs in the worker, no DOM, no network
import { Card, Input, Table, useLive, useCommand, useViewState } from "@banda/app-sdk/view"
export default function Habits() {
  const list = useLive("habits.list", {})          // call + follow, as app/ui/src/hooks/use-live.ts:47-135
  const [q, setQ] = useViewState("q", "")         // this client's view state (0062 d13 "view")
  const check = useCommand("habits.check")        // optimistic, gesture-bound, CommandId retried
  const rows = list.view?.items.filter(h => h.name.includes(q)) ?? []   // 0 round trips
  return <Card><Input value={q} onChange={setQ} />
    <Table rows={rows} columns={[{ key: "name" }, { key: "done", kind: "check", onToggle: r => check({ id: r.id }) }]} /></Card>
}
```

This is how Banda's Panes are already written: `PaneProps {engine, project}` (`app/ui/src/pane.ts:99-141`), with `READ_AGAIN` follows in 10 of 14 sources. A keeps that model and adds a sandbox.

---

## 2. The criteria

### Latency and feel
Round trips: loopback about 1 ms, tailnet 20-80 ms, relay 100-300 ms. B means the host runs the view, as 0062 d7 is written today.

| Act | A, any network | B, localhost | B, tailnet | B, phone via relay |
|---|---|---|---|---|
| Type in a field | 1 frame | 1 frame (d7: client holds the value) | 1 frame | 1 frame |
| Filter 500 rows as you type, sort a column, expand a row, switch an App-defined tab, ↓ through a list | **1 frame** | ~2-5 ms | 40-160 ms per step, held ↓ lags 2-3 rows | 200-600 ms, visibly stepped |
| Toggle a checkbox (a command) | 1 frame optimistic, confirmed after 1 RTT | 1 RTT | 1 RTT before anything changes | 1 RTT |
| Open a Pane, bundle cached | 1 RTT (`first` data) + ~20-40 ms worker start | 1 RTT | 1 RTT | 1 RTT |
| Open a Pane, first time | 1 RTT + bundle download (50-250 KB) | 1 RTT | 1 RTT | 1 RTT |

- 0062 d7 already moves into the client the cases where B hurts: field values, popovers, tabs, "acts the tree declares (show, hide, toggle)" in the style of LiveView's JS commands, and `source=` lists that the client follows. Each of those is a small client runtime that Banda designs and versions by hand. A builds one real client runtime instead.
- The platform reached the same conclusion for its own most latency-critical part. The map's fix for tiling is "one Rust crate… client (WASM, optimistic apply)", because ADR 0025's draw-after-event ("the engine runs on this machine, so the event is there before the next frame", `docs/adr/0025-*.md:95`) fails against a remote home host.

### Offline, and a host that sleeps
- **A:** a Pane of an unreachable host keeps a **live but read-only** view. The cached bundle plus the last data stay in memory, so tabs, sorting, scrolling and reading details still work. It is stamped "as of 14:02" (digest §2.4). Commands are refused at once, or queued with an expiry the Person can see.
- **B:** the last tree stays drawn but every control is dead.
- v1 keeps the cache in memory only. A persistent cache per Pane (last `first` + seq) is deferred.
- The home host sleeping affects only the arrangement (0062 d13 fallback). It does not affect App views on reachable hosts. A and B are equal there.

### Security of third-party code
- A malicious view can:
  - draw misleading UI inside its own Pane, the same as under B;
  - read only what its grants allow, from its own host, the same as under B;
  - send a command only after a gesture, and only within its grants;
  - not reach the network (CSP plus scrubbed globals), and not reach other Panes or the DOM.
- **Where an exploit lands.** Under B, a JS engine escape lands **on the host**: the machine with the Person's repositories, Harness logins (0081 d10: the Person signs in on the VM) and the Agents' `run` capability. Under A it lands in a sandboxed renderer process that holds no ticket, no preload and no secrets. A keeps the host's only third-party runtime to wasmtime with fuel and epochs, which is small and audited, and puts JavaScript in the most attacked and most hardened JS sandbox in existence.
- This answers notes/12:41 ("third-party code in the shared Electron renderer is especially dangerous"): the code runs in a frame with its own process and no DOM, not in the shell's renderer.
- **Real cost:** browsers give no hard per-worker heap limit. The cap is the frame process (an OOM kills the frame, not the window) plus the watchdog.

### The phone
- The phone draws the same catalogue in react-native-reusables, as under B.
- The view runs in a WebView worker using the same `view-host` code as the web. Obsidian already ships community plugins downloaded at runtime this way on iOS.
- App Store guideline 4.7 allows "HTML5 and JavaScript mini apps… and plug-ins", with duties:
  - an index with universal links (4.7.4);
  - a way to report content (4.7.1);
  - age gating (4.7.5);
  - no native APIs exposed without permission (4.7.2). Views have none; device acts go through a narrow gesture-bound list.
- Guideline 2.5.2 otherwise forbids downloaded code that changes features.
- Notes/10:16 says the phone "does not need to run arbitrary third-party code, MCP servers or background agents". A runs no background code and no services on the phone, only sandboxed views while they are on screen. Showing MCP Apps on the phone needs a WebView anyway.

### Version skew between a client and N hosts
- **View vs its host part: none.** They are one package, served together from one host.
- **View vs the client's catalogue:**
  - the bundle declares `ui = "1.3"`;
  - the client advertises `ui {min, max}` in its device registration (0081 d5);
  - the catalogue only grows within a major; each new element declares a `fallback` (another element, or `hidden`); unknown props are dropped and unknown events never fire;
  - beyond `max`, the Pane says "this App needs a newer Banda" and offers the update (ADR 0072, 0081 d8).
- **N hosts:** one bundle per (host, App hash), so mixed versions coexist.
- B has the same catalogue skew. A adds one surface to version: the bridge API (`host.*`, `intent`, `device`, `state`) plus the remote-dom record format, carried as `rd = 1`.

### Developer experience
- `banda app dev` runs esbuild in watch mode **on the host**, where the source and the Agents are. Each build emits `apps.view_changed`; every client showing the App reloads the worker and restores `useViewState`. That takes 100-300 ms with a full reload, which is what Raycast does on save. React Fast Refresh in the worker is deferred.
- **Debugging:**
  - workers show in the client's DevTools with source maps served by the host, so breakpoints just work;
  - `report()` forwards render errors with mapped stacks to the host as Problems, so an Agent reads them through tools;
  - `banda app logs <app>` tails them.
- **Tests and Agents:** `banda app check` runs the bundle headless and writes tree JSON per example state. `pane.tree {pane}` over the device road returns the live tree from the client's receiver.

### Agents: Install, Customize, Share
- **Install** is the same as under B: the host stores artifacts by hash.
- **Customize** (digest §2.7: an App's source is a Project). The Agent edits `view/` and `host/` there, and `banda app dev` hot-swaps the App on that host for every client.
  - Agent-written view code gets exactly a store view's rights, so self-modified software is no more dangerous than installed software.
  - The view and the host part can only meet through the API, enforced by separate entry points (`@banda/app-sdk/view` cannot import `/host`). A customized view therefore cannot quietly depend on in-process host internals.
- **Share** is the same as under B: a signed pack, and the capability diff is shown on install.

### MCP Apps and Web Apps
- **MCP Apps:** by spec they are HTML in a sandboxed iframe on the client, talking JSON-RPC over `postMessage` (`ui/initialize`, `tools/call`, `ui/message`). Under A the client already has:
  - code loaded by hash from a host;
  - a CSP-locked sandbox on its own origin;
  - a bridge stamping a narrowed ticket;
  - theme tokens passed in.

  An MCP App frame is the same view-host machinery in its iframe form. **Level 2 comes almost free the same way.** B ends with two models for third-party UI: a host isolate plus a client iframe. A ends with one: the client sandbox, in a DOM-less worker or an iframe.
- **Web Apps:** device-side in both options, so neutral.

### Cost on the host
- **A:** per open Pane per client, one subscription (the existing `Heard`) and one `view.load` WASM call at open. No JS runtime. Bundles are static bytes.
- **B:** an isolate per open Pane, per client unless trees are shared, in which case per-client props such as size and focus complicate it.
  - A V8 isolate with React and App code is roughly 5-20 MB of heap (estimate).
  - 20 Panes × 3 clients costs ~0.3-1 GB on a host that 0081 d14 wants on small Fly Machines suspended while idle, and B's isolates must stay warm for any click.
  - Under A an idle host can sleep while clients scroll cached views.
  - B also adds a third runtime to the kernel, which the map already flags ("The kernel absorbs the App runtimes… erodes the small, deep kernel"). A removes that runtime.

### Implementation cost for one person plus Agents (rough)
- **Shared by A and B:** the catalogue schema, `@banda/app-sdk/view|ui` element names, the web renderer and later the RN renderer. This is the largest piece, roughly 60 components with generated adapters.
- **A only:**
  - the view-host frame and worker bootstrap, ~400 LOC TS;
  - the client bridge with tickets and gestures, ~400 LOC;
  - the kernel ticket session, ~300 LOC Rust, needed for capabilities anyway;
  - bundle store and serving on top of the byte endpoint the map already requires, ~300 LOC;
  - dev reload, ~200 LOC.
- **B only:**
  - a JS engine on the host (deno_core in the binary at +~30 MB, or a supervised Node sidecar);
  - isolate lifecycle (per Pane, per client, kill when nothing shows it);
  - a tree-patch and callback protocol over the network, versioned;
  - client-held state rules and the "declared client acts" language;
  - `source=` bindings, which is A's data path anyway;
  - a remote inspector for debugging.
- A reuses `Engine` and `useLive`, the best module in the window by the map's own verdict.

### Unix borders

```
host part   command                                → tables, events, effects        (WASM, in the kernel's transaction)
worker      effect / heard event                   → commands                       (process, App-scoped pass)
view        answers, events, UI events, facts      → UI tree, calls, intents        (sandbox; knows no location)
renderer    UI tree + device tokens                → pixels, UI events              (client, trusted, platform)
```

- The view is one more client of the same four verbs the CLI uses (`banda call`, `banda follow`). The window and an Agent's `banda` use them too. **One protocol for every client.**
- Apps talk to each other only on the host: `calls`, `listens`, and intents resolved by the registry. Views never talk to each other.
- A slot (`thread.details`, the Pane header) is filled by the other App's own remote root in its own worker. It receives only ids and queries its own host.
- Because the view's I/O is only (a) and (b), the same bundle could later run in a host runner, as a B-mode fallback for a client that cannot run code. **A keeps B open.** B, with the view "beside its host part", tends to grow in-process shortcuts that rule out A later.

---

## 3. Precedents and how they actually work

| System | Where extension UI code runs | How it draws | What it means for Banda |
|---|---|---|---|
| **Raycast** | A Node worker thread (V8 isolate, heap limit) in a child process **on the same Mac** | A custom reconciler produces a JSON render tree and JSON Patch, which Swift turns into AppKit | 0062's own precedent places the code beside the renderer and never pays network latency |
| **Shopify UI extensions** | A **Web Worker in the buyer's or merchant's browser**, "no access to `window` or the DOM", bundle from Shopify's CDN, 64 KB cap | remote-dom `s-*` elements drawn by Shopify's components; POS draws the same trees natively on iOS and Android | The template for A: data through the `shopify.*` APIs, network only with the `network_access` capability, API versions declared in the extension's toml |
| **VS Code** | Logic (the extension host) runs locally, remotely over SSH, WSL or a container, or in a browser worker; **webviews always run on the client** as iframes on their own origin, with `postMessage` tunnelled over the remote link | Native contributions; webviews themed by `--vscode-*` variables | Logic on the host and UI code on the client already works over SSH latency. Built-ins get proposed APIs: our unstable lane |
| **Figma** | Plugin logic in **QuickJS compiled to WASM, in the client**; UI in a null-origin iframe | Message passing | Third-party JS can be sandboxed on the device with a VM. QuickJS is A's fallback for any client without a Worker |
| **Obsidian** | The renderer, with the full DOM and no sandbox; **the same plugins run on iOS and Android** in a Capacitor WebView | DOM | Client-run plugin JS ships on iOS. Its all-or-nothing trust is what A's worker avoids |
| **Home Assistant** | Custom Lovelace cards are JS modules **served by the HA host** (`/local`, HACS) and run in the browser or companion-app WebView | Web components | Data through `subscribe_entities` and writes through `call_service`: A exactly, at community scale and on phones, minus a sandbox |
| **Zed** | GPUI draws locally; the remote server holds the project, language servers and terminals; buffers are replicated so typing is local | Native | A tool built for remote work chose local interaction. Its extensions are WASM with no UI |
| **Phoenix LiveView** | A server process per connected view, diffs over WebSocket | Server HTML patches | Every interaction costs a round trip, so LiveView added `Phoenix.LiveView.JS` and `phx-hook` client code. It is affordable because a BEAM process costs KBs where a V8 isolate costs MBs |
| **Hotwire** | First-party server HTML; Stimulus for client behaviour; Hotwire Native wraps web views | HTML | First-party only, and a client runtime still grew |
| **Blazor Server** | A "circuit" per tab in server memory, every event over SignalR | Server diff | .NET 8 added Interactive WebAssembly and **Auto** (start on the server, move to the client): the server-UI framework moved toward client execution |
| **React Server Components** | Server components produce a serialized tree; everything interactive is a `"use client"` bundle run in the browser | React | The split is data and structure from the server, interaction on the client. That is A's split |
| **Slack Block Kit / Adaptive Cards** | The App's server returns JSON blocks; every interaction is a round trip | Host-drawn blocks | **The real precedent for B**: React-authored Block Kit. Fine for cards and forms, weak for anything interactive |

**Pattern.** Systems with third-party UI run that code on the device. Systems that render UI on the server are first-party only, and each grew a client runtime.

---

## 4. The real costs of A

1. **Third-party code reaches devices.** 0062 d3 ("an App from elsewhere has no code on it") and d7 must change. On iOS, an App index brings guideline 4.7 duties: index, content reporting, age gating.
2. **The phone needs a WebView-hosted worker:** tens of MB, plus one bridge hop per frame batch. A Hermes second runtime is an unproven spike.
3. **Data crosses the network, so careless views make N+1 queries over the relay.** Mitigations:
   - `view.load` and the ticket's `first` payload;
   - a batched `call` per animation frame;
   - a lint in `banda app check` for more than 3 calls on mount.

   B colocates view and data and is naturally better here.
4. **First open over the relay downloads the bundle** (50-250 KB, once per hash). B does not.
5. **Authorization depends on the ticket path before any third-party view ships.** The kernel's `decide` must learn sessions with App grants, which is plan step 6 brought forward.
6. **No hard memory cap per worker** in browsers; only process isolation of the frame plus the watchdog.
7. **The Agent cannot see the live view on the host.** It needs log and Problem forwarding, the headless runner, and `pane.tree` over the road, which requires an open client (as screenshots already do in both options).
8. **One more versioned surface:** the bridge API and the remote-dom record format.
9. **The flagship views (Thread, Terminal, Browser) stay trusted DOM code** with an unstable mark. B has the same exemption ("live components").
10. **Phone battery:** views must stay light. The 256 KB budget is enforced, and workers of hidden Panes are suspended: no `render` while `visible: false`, terminated after 60 s.

## 5. What A changes in ADR 0062
- **d3:** "An App from elsewhere has no code on the device **outside the view sandbox**: its view runs in the client's view host with no DOM, no network and no storage, and reaches only its own host through a narrowed ticket."
- **d7:** replace "Its React runs on the host… in a JavaScript isolate" with "Its React runs on the client, in the view host (a Worker in a sandboxed frame; a WebView worker on the phone), loaded by hash from the App's host. Its data comes only through the host API; logic that changes data stays in its host part."
  - Drop "acts the tree declares for the client" and `source=`: both are ordinary view code now.
- **Consequences:** "Third-party code runs in WebAssembly on the host, in workers with a scoped pass, in the client's view sandbox, or in an MCP App's frame."
- **Plan step 10 becomes:**
  - 10a: the catalogue schema and the web renderer, with Usage moved into a worker.
  - 10b: the view-host frame, the bridge, tickets in `kernel/src/access.rs`, and bundle serving.
  - 10c: `banda app dev` reload and `banda app check` headless.
  - Step 12 (MCP Apps) then reuses the view host in its iframe form.

**Defer:**
- a host-run fallback runner (B mode) for clients that will not run code;
- a persistent offline cache;
- views across several hosts;
- React Fast Refresh in the worker;
- Hermes or QuickJS runtimes on the phone;
- one frame process per App (one per client first);
- Level 2.

Sources:
- [Shopify checkout UI extensions](https://shopify.dev/docs/api/checkout-ui-extensions)
- [Shopify engineering: remote rendering](https://shopify.engineering/remote-rendering-ui-extensibility)
- [Shopify POS UI extensions](https://shopify.dev/docs/api/pos-ui-extensions/2024-10)
- [Shopify/remote-dom](https://github.com/Shopify/remote-dom)
- [App Store Review Guidelines (2.5.2, 4.7)](https://developer.apple.com/app-store/review/guidelines/)
- Raycast, VS Code, Figma, Obsidian, Zed and MCP Apps facts as summarized in `docs/research/2026-11-01-hackable-modules.md`.