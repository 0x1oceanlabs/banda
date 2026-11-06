# Option C: an App's view runs in one of four places, chosen by its kind and by who we trust

Input to [the vision](../2026-11-06-architecture-vision.md) (2026-11-06). Roma's decisions are in its §11 and override this document where they differ.

## 0. The case in five lines

1. Under ADR 0081 d1 every record has one writer, and that writer is on the host (0081:36-40). Every act that changes work is therefore a round trip to the host, whichever option runs the view. Running view code on the client only speeds up **presentation state**: tabs, popovers, a field while the Person types, a section that opens. A fixed catalogue of client components can hold that state itself.
2. Banda's first-party views are about 50k lines of React (agents/pane alone is 14.9k lines). They are streams and per-frame interaction: the composer, the terminal, the browser, tiling. Rewriting them as host-rendered trees (Option A in full) is the most expensive path, and it gains nothing.
3. Third-party code on the phone is a security problem and an App Store problem (guideline 2.5.2). Third-party code in the shared Electron renderer is what notes/12:41 warns against. A tree of data has neither problem.
4. MCP Apps and Web Apps already come with a sandbox, decided by their spec or by the browser. Banda already draws the MCP Apps frame: `modules/agents/pane/src/Visual.tsx:1-8` and `visual-frame.ts:1-8` speak `ui/notifications/host-context-changed`. Banda already has webviews (`modules/browser/pane/src/desktop.ts:31`).
5. So: keep all four places, and let **one rule** pick the place mechanically from the manifest. VS Code makes the same split and it holds up for remote hosts: native workbench views, TreeView data from a remote extension host, and webviews.

## 1. The rule

> **Code runs only where its author is trusted. Everything else crosses the wire as data.**
> - Code shipped in Banda's client release is trusted on the device. These are the **Catalogue** components (T0).
> - An App's own code is trusted only on the host, inside its sandbox (wasmtime). Its view reaches a client only as a **Tree** of catalogue components (T1). It never reaches a client as code.
> - HTML that someone else already sandboxes, by spec (MCP Apps) or by origin (a site), runs in the device's browser sandbox. It may speak only that spec's messages. These are **Frame** (T2) and **Site** (T3).

The tier is decided by the manifest. An App does not choose it.

| The manifest has | Tier | Where the code lives | What runs it | Phone (React Native) |
|---|---|---|---|---|
| nothing: a Banda client component (`Thread`, `Terminal`, `BrowserCast`, `FileView`, `Diff`, tiling, bar) | **T0 Catalogue** | the client release (Electron asar; the web bundle served by the host; the RN bundle) | the client | an RN port of a short list |
| `[view]` in an SDK App, third-party or first-party | **T1 Tree** | the App package on the host (`apps/<id>/<hash>/app.wasm`) | the host part's `render` export, in wasmtime, read-only | the RN catalogue renderer |
| an MCP server with `_meta.ui.resourceUri` | **T2 Frame** | the `ui://` resource, read by the host gateway and stored by hash | a sandboxed iframe on the device | `react-native-webview` (WKWebView) |
| `kind = "web"`, `url = …` | **T3 Site** | the site | a device webview with its own partition | in-app webview, or the site's own app (0062 d9) |

**Admission to T0 is the only judgment call.** A component enters the catalogue when both of these hold:
- it needs per-frame interaction (typing with suggestions, drag, synced scrolling, canvas) or high-rate streams (terminal, Thread deltas, screencast);
- two or more Apps can use it, or it is the live component of a first-party App.

Every T0 entry is a node that T1 trees may reference, gated by capability (0062 d7: "live components need their capability"). So **T0 is the vocabulary T1 draws with**, not a kind of App. A first-party Thread Pane is a one-node tree, `<Thread id>`. A third-party CRM can embed `<Thread id>` next to its own `<DataTable>`. React Server Components follow the same rule: the server can reference client components but cannot define them.

**Placement of first-party Apps:**
- **T0:** Threads, Terminal, Browser, Files' viewer.
- **T1:**
  - Usage first (0062 plan 9 already picks it);
  - then Pulls, settings sections, Git's list and commit form (built around the T0 `Diff`), Problems.
- A first-party Pane that stays T0 without being catalogue-worthy gets an unstable mark. That count only falls (0062 d2).

## 2. Technical shape

### T1 Tree, the part that is new

**Where the code comes from and what runs it.**
- The App's host part exports `render` next to its handlers, as one component:
  - Rust: `banda-app` builders or a `view!{}` macro;
  - TS: TSX through the `@banda/app-sdk/ui` JSX runtime, compiled to the same component with ComponentizeJS (0062 d14).
- `render` is **a pure, read-only handler**: it reads the App's own tables through the host API, and has no writes, no effects, no network, and a fuel cap. It is **not** React in a long-lived isolate. It works like a Figma widget function: it runs again whenever state changes, and the state lives elsewhere (here, in the App's tables and in client-held component state).
- WIT has no recursive types, so the tree crosses as JSON bytes:

```wit
interface view {
  record request { view: string, args: string, local: string }
  render: func(req: request) -> result<list<u8>, refusal>;   // Tree as JSON
}
world app { import host-api; export handlers; export view; }
```

**Node format.** It lives in a new crate `ui/` (`banda-ui`). The Rust types use serde + ts-rs, which gives `contract/src/generated/ui.ts` and JSON Schema the same way `methods!` does today.

```ts
type Node = { k: string /*stable key*/, c: CatalogueName, p: Props, ch?: Node[] }
type On =
  | { method: string, params?: Json }                 // a command of this App (manifest-marked `ui`)
  | { intent: string, args: Json }                    // 0062 d6, via the intent registry
  | { client: "show"|"hide"|"toggle", target: string } // LiveView-JS-style, no round trip
  | { client: "copy"|"open", value: string }           // device road capability
type Source = { method: string, params: Json, page?: number }  // DataTable/List/Chart fetch it themselves
```

- Props carry semantic variants only (`variant: "destructive"`, `tone: "muted"`) plus a closed set of layout utilities. There are no colours and no free `className` (0062 d7).
- Images use `{byte: "sha256:…"}`, served by the host's byte route. The App's worker fetches a remote image on the host, so the device never loads a tracking pixel.

**Messages.** The only new verb is a stream, and it reuses the existing frames (`contract/src/engine.ts:86-95`).
- `stream views.follow {project, app, view, args, local}` → `{tree, at}`, then `{patch:[replace|set|insert|remove by key], at}`.
  - `at` is the log seq. It is the "as of" from brainstorm §2.4.
- **An act is an ordinary `command`.** A button is a pre-filled command: `{method:"habits.toggle", params, command_id}`, sent as the Person, from this device.
  - The control shows the Person's value as *pending* at once.
  - It clears when a patch arrives with `at ≥` the receipt's seq. The tiling already reconciles this way (ADR 0025:93-100).
  - If the command is refused, the control rolls back.
  - Mosh's predictive echo is the precedent.
- Forms send one command. Fields are validated on the client against the method's JSON Schema, which the `methods!`/schemars path already emits for tools (`kernel/src/methods.rs:274-281`), so validation costs no round trip.

**Host side.** This is a platform service `platform/views`, not part of the kernel, which answers the map's "kernel absorbs App runtimes" weakness.
- It renders on subscribe and on the App's own and `listens` events, debounced to one frame.
- It diffs by key once and fans the patch out to every client.
- **There is no isolate per Pane per client.** The tree cache is keyed by `(app, view, args, local)` and shared across clients. That is correct because a host has exactly one Person (0081 d10; `kernel/src/access.rs:31-35`).
- wasmtime keeps a pooled instance per App. TS components are heavier (StarlingMonkey), but the cost is paid per App, not per Pane.

**Drawing.**
- `client/catalogue` is a registry `{name → {component, propSchema, since}}` over `@banda/kit` (today's `app/ui/src/components`, 64 files).
- `client/remote` checks the tree against the schema and applies patches.
- Theme tokens are resolved on the device (0062 d18, ADR 0080) and become CSS variables. The RN renderer maps the same names to react-native-reusables, with tokens as a NativeWind object.
- Catalogue v1 is the **intersection** of shadcn and reusables, plus Banda's components.

### T0 Catalogue

- It draws from data, using the four verbs: `call`, `command`, `follow`, `stream`. That is what Panes do today (`app/ui/src/pane.ts:99-141`, `use-live.ts:40-60`).
- Precondition, already on the map's list: the host streams `ThreadView` patches, so no client folds about 30 fact kinds any more (`modules/agents/pane/src/thread.ts:158-519`, with `withCan` copying `rules::can`). Without this, the phone has to port the reducer, and Hermes has no WASM.
- The terminal stays as it is: PTY on the host, `terminal.watch` (`TerminalPane.tsx:290`), Ghostty WASM painting it. On the phone, Ghostty WASM runs inside a WebView, or the terminal is deferred.
- The Agents' browser is `BrowserCast`: CDP screencast frames plus input from the host's Chromium (0062 d12). It is only images and touch, so it ports to RN.

### T2 Frame

This generalises `Visual.tsx` and `visual-frame.ts` into `client/frame`:
- an origin of its own;
- `sandbox="allow-scripts allow-forms"` (`visual-frame.ts:22`);
- a CSP built from `_meta.ui.csp`, following the pattern in `app/desktop-kit/src/preview.ts:32-41`.

The look reaches the frame as the spec's host context, which `visualLook` already builds (`visual-frame.ts:91-171`).

`tools/call` and `ui/message` travel client → host gateway → access decision (0062 d10). C adds one restriction: **a frame may call only its own server's tools.** That settles digest Q6 for frames.

- **Web client:** each frame needs a separate sandbox origin. The double-iframe proxy that MCP Apps hosts use on the web is one way to get it.
- **Phone:** a WKWebView with a shim that maps `window.parent.postMessage` to the RN bridge.

### T3 Site

The browser module's webviews, with one partition per Web App (`persist:webapp-<id>`). Only the badge and notification shim is preloaded. Banda draws only the Pane chrome (ADR 0066).

## 3. The criteria

**Latency.**

| | localhost | Tailscale, 20–80 ms | phone via relay, 100–300 ms |
|---|---|---|---|
| Client-held state (T0 and T1: typing, tabs, popover, scroll, show/hide) | under a frame | under a frame | under a frame |
| T1 act | pending at once; tree in about 2–5 ms | pending at once; RTT + render | pending at once; 100–300 ms |
| T1 navigation (new `args`) | about 5 ms | RTT; prefetch on hover | skeleton, then 100–300 ms |
| T0 Thread send | pending at once | same, settles after RTT | same |
| Terminal echo | ms | RTT, **in every option** | RTT; predictive echo later |
| T2 frame internals and T3 | native | native | native |

- What changes the work costs the same RTT in A, B and C.
- C pays a round trip only where A pays it too (T1).
- B saves only presentation transitions, and the catalogue already holds those.
- Drag, canvas and games in a T1 App do not work. That is real, and §6 covers it.

**Offline and a host that sleeps.**
- T1 keeps the last tree and the last `source` pages per Pane, keyed `(host, project, app, view, args)` with `at`. It draws them read-only: "as of 14:02", acts disabled, commands fail at once.
- T0 Thread keeps the cached view and drafts. Its send queue shows an expiry the Person can see.
- A T2 frame draws from cached HTML (by hash), and its tool calls fail visibly.
- **T3 needs no host at all.**
- B's "offline" buys nothing more. With one writer and no CRDT (0081 d1), offline writes do not exist in any option.

**Security on the device.**
- No third-party code ever runs in Banda's renderer or on the phone's JS runtime.
- The T1 renderer is a parser of untrusted input, so it is hardened:
  - schema validation, size and depth caps (for example 5k nodes, 1 MB);
  - Markdown without raw HTML, Mermaid with `securityLevel:"strict"`, KaTeX with `trust:false`;
  - no direct URLs;
  - acts limited to the App's own `ui`-marked methods and to intents;
  - drawing only inside its Pane; the Pane header is the platform's.
- T2 and T3 rely on browser sandboxes and nothing else.

**The phone.** The RN client is small:
- one T1 renderer;
- T0 screens for Inbox, Thread plus composer plus Questions, Projects, and BrowserCast;
- a WebView for T2;
- links out for T3.

Pure data covers every SDK App, including ones an Agent wrote yesterday. The phone needs no JS sandbox and adds no App Store risk beyond HTML in WebKit for MCP frames, which still needs checking against guideline 4.7.

**Version skew, client against N hosts.**
- Each host draws its own Apps' trees with its own App versions. The client's catalogue is the only shared language, so skew is always pairwise between a client and one host, never between hosts.
- `hello` carries the catalogue range `ui@1.0–1.7` (0081 d8).
- Each catalogue component added after 1.0 defines `fallback(props) -> Node` once, in `banda-ui`. `views.follow` replaces newer components with their fallbacks for an older client: one cheap pass over the cached tree.
- New props are additive only, and the client ignores unknown ones.
- T0 against a newer host: the client ignores unknown fact kinds. An unknown Thread item kind can come with a **T1 fallback subtree** (`item.tree`), so T1 is the safety net for T0 skew. That matters because the phone trails the App Store.

**Developer experience** (`banda app dev`).
- Each save rebuilds the component (`cargo component` or jco). The host swaps the App's instance and re-renders the followed views. Patches keep node keys, so **field values and open tabs survive a hot reload**. No client reload happens, because clients hold no App code.
- `banda app dev --print main '{"id":3}' | jq` prints the tree.
- `--latency 150` adds the relay's delay locally, as LiveView's `enableLatencySim` does.
- `render` is pure, so `render(view, args, fixtureDb)` snapshot tests run in vitest or `cargo test` with no client.
- WASM breakpoints are weak. To compensate, `banda app dev --node` runs the TS view in Node against the same host API over WebSocket. That is a dev-only placement, and it is possible because render does not depend on where it runs.
- T0 keeps Vite HMR. T2 uses the MCP Apps tooling.

**Agents customising Apps.**
- **Install:** from a folder, git or the index, showing the capability diff (0062 plan 13).
- **Customize:**
  - The App's source is a Project (digest §2.7).
  - Agents write shadcn JSX against a closed catalogue very well.
  - **The tree is text, so the Agent reads its own output**, while pixels and HTML are opaque to it.
  - `banda app check` validates against the catalogue and method schemas.
- **Share:** whatever an Agent builds is ready for the phone and cannot harm a device.
- **Limit:** T0 Apps (Threads) can be customised only through slots, settings and swapping intent handlers. Their compiled code cannot be changed in place.
- For a one-off UI, an Agent still has Visuals (T2). A Visual made as a T1 tree works on the phone.

**MCP Apps:** T2, as their spec requires. Most of the work is already built, in the Visual frame.

**Web Apps:** T3, the only tier that works while every host sleeps. A browser-tab client cannot show them (0062 d9).

**Cost on the host:** per open T1 view, one cached tree of a few KB and one subscription. Render runs only on an event and only while someone follows the view. Instances are pooled per App. LiveView keeps a process per client and Blazor Server a circuit per client; C keeps neither.

**Implementation cost.** Rough figures for one person plus Agents:

| Work | Estimate |
|---|---|
| `banda-ui` schema, web `client/remote`, `views.follow`, Usage written in Rust | 3–4 weeks |
| WIT `render`, the JSX runtime, `banda app dev` hot swap | about 3 weeks |
| Frame host generalised | about 1 week (the MCP gateway itself is 0062 plan 12, in every option) |
| Web App partitions | 1–2 weeks |
| RN: T1 renderer | about 2 weeks |
| RN: T0 screens | 4–6 weeks |

- No V8 or QuickJS in the kernel, and no rewrite of the 50k lines of first-party TSX.

## 4. Unix borders

Each piece is a small program with a clear input and output, testable from the CLI:

```
host  app.wasm        render(view,args,local) → Tree           read-only, fuel   `banda call habits.view …`
      app.wasm        handle(command) → events + effects       one transaction
      platform/views  follow(pane) → Tree, Patch*              cache, diff, fan-out, fallbacks
      mcp gateway     resources/read ui:// → bytes(hash);  tools/call ← frame (own server only)
      byte route      GET signed|hash → bytes
client catalogue      Tree, Patch* → pixels;  gestures → command | intent | client-act
      frame host      HTML(hash) + hostContext → iframe;  JSON-RPC ↔ gateway
      site host       URL + partition → webview;  badge, notify → device
      live (T0)       call/command/follow/stream ↔ its App's methods
```

- **Apps inside one view:**
  - A `<Slot name="threads.details" subject=…>` is filled by other Apps' subtrees. Each subtree is drawn by its own App on its own host, with errors contained per subtree. This replaces `threadDetails` (0062 d6).
  - Buttons fire intents through the registry.
- **Across hosts:**
  - A Pane is `{project, app, view, args}`, with no host in it (`modules/workspaces/engine/src/model.rs:149-157`).
  - The client's Hosts router resolves project → host through the home host's directory (digest §2.3).
  - A `<Thread id>` inside a tree from host A, for a Thread on host B, connects to B by itself.

## 5. Precedents, as they really work

- **VS Code** is the closest match to C:
  - The editor, terminal and SCM are native to the workbench (T0).
  - `TreeDataProvider` runs in the extension host, which can be remote under Remote-SSH, and the workbench draws the tree natively (T1).
  - Webviews are iframes with `postMessage`, and their resources come through `asWebviewUri` (T2).
  - `extensionKind: ui | workspace` is a placement rule declared by kind.
  - It works over SSH because only data crosses the network.
- **Figma:**
  - Widgets are declarative JSX that runs again on `useSyncedState` changes, with state kept in the document and drawn by Figma. They are multiplayer by construction (T1).
  - Plugin UI is a `showUI` iframe (T2).
  - Plugin logic ran in a client sandbox that Figma had to rebuild on QuickJS-in-WASM after the Realms flaw. C never needs a client code sandbox.
- **Raycast:** React runs in a Node process that Raycast manages, a custom reconciler sends JSON to Swift, and the vocabulary (List, Detail, Form, ActionPanel) is fixed. That proves "fixed vocabulary, uniform look", but Raycast is always local with zero RTT. C moves presentation state into the components so the same idea survives a remote host.
- **Shopify remote-dom:** third-party code runs **on the device** in a worker or iframe, and the receiver draws it with host components, natively on POS too. The wire does not care where the code runs. Shopify puts the code on the device because it has no server per merchant. Banda has one per Person.
- **Obsidian:** unsandboxed plugins in the renderer, and in a Capacitor WebView on mobile. This is what C refuses.
- **Phoenix LiveView:** one process per client per view, HEEx diffs, `JS.show/toggle` with no round trip. T1 takes its shape but shares the render across clients, which one Person per host allows.
- **Hotwire:** HTML over the wire, and Hotwire Native wraps WebViews. Banda's phone is RN, so the wire has to be component data, not HTML.
- **Blazor:**
  - Server mode keeps a circuit per client and is sensitive to latency (reconnect UI, memory per circuit).
  - WebAssembly mode downloads the runtime.
  - .NET 8 "Auto" uses one component model with placement as a mode. C keeps `render` pure for the same reason.
- **React Server Components:** the server payload references client components by module id and cannot define them. That is T1 over T0 exactly.
- **Home Assistant:**
  - Integrations are Python on the server.
  - Lovelace cards are YAML/JSON drawn by the frontend.
  - Community custom cards are **unsandboxed** JS loaded into the frontend.
  - The companion apps are WebViews.
  - Declarative cards carried a huge community. C's T2 is the sandboxed answer to the custom-card demand.
- **Zed:**
  - Extensions are wasmtime components with WIT: languages, themes, slash commands, context servers.
  - There is **no extension UI**. GPUI is first-party.
  - Remote development keeps the UI local.
  - That is the case for keeping T0 first-party.
- **Slack Block Kit:** JSON blocks drawn natively on desktop, iOS and Android, with actions posted to the app's server (3 s ack). Declarative trees work on phones with real RTT.

## 6. The real costs of C

1. **Four drawing paths instead of one:** catalogue, frame, site and live components, each on web, Electron and RN. Frame and site already exist in Electron, but RN adds WebView and bridge work.
2. **T0 is duplicated on the phone.** Thread, composer and Inbox exist twice, in React and in RN. This is only bearable if `ThreadView` patches move to the host first, which the map wants anyway.
3. **The catalogue becomes a gate.** A T1 App gets nothing the catalogue lacks: no drag, canvas or per-frame interaction. Someone has to rule on additions, and the fallbacks are kept forever. The tree schema becomes a public API with semver.
4. **Two authoring models.** First-party T0 uses React with hooks. T1 is a pure JSX render without `useState`/`useEffect`, so state lives in tables or in components. React developers have to adjust (Figma widgets show they do). First-party Apps do not test T1 through Threads.
5. **Threads cannot be customised by Agents in place.** Third parties cannot build a Thread-quality UI with T1 alone.
6. **Every T1 act or navigation costs one RTT,** and 100–300 ms on the phone. Pending controls hide this for toggles and fields, but not for drill-down.
7. **Untrusted trees widen the renderer's attack surface:** Markdown, Mermaid, URLs.
8. **TS views go through ComponentizeJS:** heavy components and weak debugging, which is why `--node` dev mode exists.
9. **Frames need a separate sandbox origin on the web client** (DNS and certificates), plus App Store guideline 4.7 checking on iOS.

**Defer:**
- client-run third-party code (Option B), all of it;
- Level 2 for SDK Apps: under C it is almost free later, as "an SDK App's own `ui://` in the frame host";
- optimistic patches beyond controls;
- drag in trees;
- the terminal on the phone;
- running `render` on the client as WASM.

**When C is wrong:**
- if the first ten real third-party Apps mostly need interaction the catalogue lacks: bring Level 2 forward;
- if RN parity for T0 Thread is too costly: move the Thread's message list to a host-side T1 subtree on the phone.

**First step if Roma picks C:**
1. Amend 0062 d7: "React in a host isolate" becomes "a pure `render` export with a shared cache".
2. Add the rule and the T0 admission criteria to 0062 d8.
3. Build `banda-ui`, `views.follow` and Usage in Rust, all before the WIT.