# Option B: the host runs every App's view, and clients only draw the tree

Input to [the vision](../2026-11-06-architecture-vision.md) (2026-11-06). Roma's decisions are in its §11 and override this document where they differ.

## 0. The argument

1. **Level 1 already turns the client into a tree renderer.** Roma decided that clients draw shadcn/ui from a component tree. 0062 decisions 3 and 7 forbid third-party code in the shared renderer. So a safe Option A is Shopify's remote-dom: the App's React runs in a Worker or iframe on each device and posts a tree to the page.
   - A and B therefore share the catalogue, the reconciler, the wire format and the renderer.
   - They differ in one thing: where the isolate that writes the tree runs. Under A it runs on every device and sends patches by `postMessage`; under B it runs once on the host and sends them over the WebSocket that already exists.
2. **B puts the isolate on the host.** That is where everything the view reads already is: the App's tables, its host part, the files, the Agents, and the wasmtime sandbox that 0062 decision 4 already brings in for handlers. One sandbox instead of three (Electron, browser, React Native). One App version instead of a version matrix per client.
3. **The client becomes a terminal for a closed vocabulary. Banda already has one.**
   - The terminal Pane draws a host stream (`terminal.watch`: a snapshot, then pieces) and sends typed input (`modules/terminal/pane/src/TerminalPane.tsx:244-290`).
   - ghostty draws VT, and the program runs where the files are.
   - B generalises this from VT to shadcn.
4. **Scope.** B decides where view logic written by an App's author runs. It does not move what is client-side by nature in every option:
   - live components (the Thread timeline, the composer, the terminal, a page);
   - Web Apps;
   - MCP frames;
   - the tiling's motion;
   - working out the theme.
5. **B's one real loss:** a view-only interaction the author did not declare as a client act costs a round trip. Most of the design below exists to make that rare.

## 1. Technical shape

### 1.1 The package, and where code is loaded from

```
habits/                     the App's source is a Project, so Agents edit it with Threads, Git and Terminal
  banda-app.toml            id, version, api = "1", ui = ">=1.2", capabilities, panes, intents, events
  host/  → host.wasm        handlers (0062 d4; Rust or TS)
  view/  → view.wasm        TSX against @banda/app-sdk/ui, bundled, engine + snapshot
  workers/                  optional
```

- **Packing.** `banda app pack` bundles `view.js` with esbuild: ESM, React, `react-reconciler` and the SDK's host config, about 150 KB.
  - Wizer pre-evaluates it inside a JS engine compiled to wasm. Fastly runs StarlingMonkey this way; Shopify Functions run QuickJS (Javy) this way.
  - A spike picks the engine: QuickJS with a heap of about 1–2 MB, or StarlingMonkey through ComponentizeJS, which 0062 decision 14 already names for TS handlers.
- **Installing.** The package is installed only on hosts, at `$DATA/apps/<id>/<version>-<sha256>/`. Clients never download App code, so there is nothing to sign for a client, no cache to bust, and nothing for Apple to review.

```tsx
import { Card, Checkbox, Button, DataTable, act, useLive, useCommand } from "@banda/app-sdk/ui"
export default function Today({ args }: PaneProps<{ week: number }>) {
  const today = useLive("habits.today", { week: args.week })  // read + follow on the host; Suspense until it answers
  const done = useCommand("habits.done")
  return (
    <Card title={`Week ${args.week}`}>
      {today.items.map(h => (
        <Checkbox key={h.id} label={h.name} checked={h.done} optimistic
                  onChange={c => done({ habit: h.id, done: c })} />))}
      <Button variant="ghost" act={act.toggle("more")}>More</Button>
      <DataTable id="more" hidden source="habits.history"
                 columns={[{ key: "day", kind: "date" }, { key: "count", kind: "number" }]} />
    </Card>)
}
```

The first render waits for its reads (Suspense), so the first piece the client gets is complete and nothing flickers over the network.

### 1.2 On the host: `platform/views`, a client of the kernel and not part of it

- **A platform module.** It takes the `view.` prefix in the kernel's router (routing by prefix exists today, `kernel/src/kernel.rs:534-712`).
  - It holds a wasmtime pool. The pooling allocator with copy-on-write memory images instantiates an instance in microseconds.
- **An instance is a client of the kernel API, holding an App pass.** This needs a new `Participant::App`; today access knows only the owner and Agents (`kernel/src/access.rs:12-26`).
  - It never runs on a Project's writer thread or inside a transaction. It calls `call`, `command` and `follow` the way the CLI does.
  - The kernel therefore keeps only the handler ABI, which answers the map's weakness that "the kernel absorbs the App runtimes".
- **An instance is an actor with a mailbox.** One export, so WIT async is not needed:

```wit
package banda:view@0.1.0;
world view {
  import host: interface { send: func(msgs: list<string>); }  // call · command · follow · unfollow · set-args · log (JSON, matched by id)
  export pump: func(inbox: list<string>);                     // mount{pane,args,state,catalogue} · act{handler,payload,rev} · result · event · unmount
}
```

  - The reconciler's host config (`appendChild`, `insertBefore`, `removeChild`, `commitUpdate`, `commitTextUpdate`) records mutation operations directly, as remote-dom does, with no JSON diff. Each pump flushes them as one patch.
- **Granularity.** One instance per (Pane, client) while that client shows the Pane, as LiveView keeps one process per connected view.
  - An instance hidden for 30 s, or under memory pressure, is evicted.
  - `useViewState(key, init)` copies its JSON into the views service, kept 10 minutes per (Pane, client).
  - State that should follow the Person across devices goes into the Pane's args. `PaneProps.update` exists at `app/ui/src/pane.ts:112-113`, and args already live in the arrangement (`modules/workspaces/engine/src/model.rs:149-157`).
  - So an evicted or crashed instance comes back by rendering again. A reconnect is a new subscription; the Engine client already hears a stream again from its start after a reconnect (`contract/src/engine.ts:85-95`).
- **Limits per instance:**
  - a memory cap of 32 MB;
  - a fuel or epoch deadline of 50 ms per pump;
  - a cap on patch size;
  - calls only to the methods the manifest lists under `calls`.

  A view that runs away gets a `view.error` piece and a Problems entry. Agents and other Panes are not affected.
- **The host owns the lifecycle.** When the stream ends, the view unmounts. This removes the class of bug where every client diffs the arrangement and fires `closed` (`app/web/src/shell/Shell.tsx:425-433`).

### 1.3 The wire: two methods on today's socket, no new protocol

A view is a stream, like a terminal. The frames use today's shapes (`kernel/src/api.rs:49-145`):

```
→ {"type":"stream","id":41,"project":"01JC…","method":"view.watch",
   "params":{"pane":"pn_7c","app":"habits","kind":"habits.today","args":{"week":45},
             "client":{"device":"dev_phone","catalogue":"1.3"}}}
← {"type":"piece","stream":41,"data":{"rev":1,"as_of":{"seq":8812,"at":"…"},"tree":{"id":"n1","type":"Card","props":{…},"children":[…]}}}
→ {"type":"call","id":77,"project":"01JC…","method":"view.act",
   "params":{"stream":41,"rev":1,"handler":"h3","payload":{"checked":true}}}
← {"type":"result","id":77,"ok":{"rev":2}}
← {"type":"piece","stream":41,"data":{"rev":2,"ops":[["set","n9",{"checked":true}],["text","n12","2 left"],
                                                     ["insert","n4",3,{…}],["remove","n4",7]]}}
```

- **`view.act` answers with the `rev` that will show the act.** The client clears the node's pending mark once it has drawn that rev. This is the tiling's existing rule: answer with the event's place in the log, then draw past it (ADR 0025:93-103).
- **Backpressure costs nothing new.** Each stream already has one piece in flight (`kernel/src/api.rs:263-269`). The views service merges operations while a piece is unacknowledged, so a slow phone gets fewer, larger patches and never a queue.
- **Over iroh, each view can be its own QUIC stream,** so one heavy Pane does not hold up the others.
- **Size:** a first tree is typically 5–30 KB of JSON (1–5 KB compressed); a patch is 50–500 bytes.

### 1.4 On the client: a renderer with a closed vocabulary

- **The catalogue, `@banda/app-sdk/ui`.** It is shadcn/ui as `@banda/ui` has it, plus Banda's own components: Markdown with Mermaid and KaTeX, Diff, CodeDiff, FileTree, Console, Message, Kbd, the Mark, meters and Chart.
  - For an App's author these are type stubs only.
  - `catalogue.json` is generated from the TS prop types, as `methods!` generates TS through ts-rs. It lists each component's prop schema and the version that added it.
- **Props carry no functions and no colours.**
  - Handlers become `{"h":"h3"}`.
  - Style is `variant`, `size` and `tone` (`default`, `muted`, `accent`, `danger`, `success`, `warning`) only.
  - `className` is checked against a generated allowlist of layout utilities (flex, grid, gap, padding, width).
  - Icons are Lucide names.
  - Images are either `asset:` (from the App's package, through the host's byte endpoint) or signed byte URLs from the host. Arbitrary `https:` is refused: it would leak the device's IP and bypass the `net` capability.
- **Theme.** Each client works out the Person's theme for its own display (ADR 0080 tokens, 0062 decision 18) and draws real shadcn with its CSS variables.
  - React Native draws react-native-reusables, with NativeWind fed the same token object.
  - The host never sees a colour, so the tree is the same for every display, and a theme change on the phone costs the host nothing.
  - Chart series are numbered and map to the `chart-1..5` tokens.
- **What the client holds, never waiting for the host:**
  - a field's value while it has focus (LiveView's rule: a patch never overwrites the focused input);
  - open popovers, menus and dialogs;
  - the state of Tabs, Accordion and Collapsible;
  - hover and scroll;
  - a Slider or drag until it is released (the tiling's drag rule, ADR 0025);
  - list filtering when `filter="client"` (Raycast's `filtering`).
- **Client acts.** A fixed list of verbs, as data, not code (the equivalent of `Phoenix.LiveView.JS`):
  - `toggle(id)`, `show(id)`, `hide(id)`, `select(tabs, value)`, `focus(id)`, `copy(text)`, `open(intent, args)`, `push(handler)`;
  - they can be listed together;
  - `open` resolves the intent from manifests the client has cached and sends one `workspaces.open` to the home host.
- **Optimistic and pending states.**
  - `Checkbox`, `Switch`, `Toggle` and `Select` with `optimistic` apply at once; a later rev that disagrees wins.
  - A node whose act is in flight gets `data-pending` and dims after 150 ms. No spinner.
- **`Form`.** It validates on the client from JSON Schema (`required`, `pattern`, `min`), the same schema Banda's Actions already carry (`app/ui/src/module.ts:198-247`), and sends one act with every value.
- **Large data by `source`.** `<DataTable source=…>`, `<Chart source=…>` and `<Combobox source="contacts.search" param="q">` follow that method or stream directly, a page at a time (0062 decision 7). Bulk rows never pass through the isolate.
- **Unknown or newer components.** Any node may carry a `fallback` subtree, and the SDK fills in defaults (CodeDiff falls back to Code, then to Text). A phone that ships part of the catalogue degrades instead of crashing.

### 1.5 Live components are catalogue entries, and any App may embed one

- **The list:** `<Terminal>`, `<ThreadView>`, `<Composer>`, `<Page>` (a screencast or a device webview), `<McpFrame>`, and `<Site>` for a Web App.
- **The shape:** each is a client widget written by Banda, plus a host stream, plus typed input methods, behind a capability (0062 decision 7).
- **The Thread takes the terminal's shape.** The Threads App's host part streams view patches (`agents.thread.watch`). That deletes the client's second projection of about 30 fact kinds (`modules/agents/pane/src/thread.ts:158-519`) and leaves one reducer, on the host.
- **One principle across all of them: the host projects, the client draws a vocabulary.** Only the vocabulary changes:
  - bytes for the terminal;
  - typed view patches for a Thread;
  - a component tree for Level 1.

### 1.6 Several hosts

- **Where an instance runs.** A view runs on the host of its Pane's Project. A Person-level App runs on the home host.
  - The client sends `view.watch` to the host that the Project→host directory names (brainstorm §2.3).
  - No host talks to another host for views.
- **A Project that moves** (0081 decision 11): the client subscribes again on the new host, and the state comes back from args, tables and view state.
- **A host the client cannot reach:**
  - the client draws the last tree it cached for that Pane on this device (IndexedDB or AsyncStorage);
  - the tree is dimmed and its acts are off;
  - it is marked "as of 14:02", taken from the piece's `as_of` (brainstorm §2.4).

### 1.7 Borders

| Part | Where | Input | Output |
|---|---|---|---|
| Host part (handlers) | host, wasm, inside the transaction | commands, `listens` events | events, effects, answers |
| View instance | host, wasm actor with an App pass | mount(args, state), acts, results and events of its own reads | tree patches; calls and commands as the App; `set-args` |
| Views service | host, platform | `view.watch` and `view.act` | pieces; lifecycle; limits; Problems |
| Renderer | client | pieces, the device's tokens, the Person's input | acts; client acts done locally; `workspaces.*` to the home host |
| Live component | client widget + host stream | its stream | typed input methods |
| Device | client, platform | requests through the road (0081 d5) | presence, answers |

**How Apps talk to each other.** Only on the host:
- **Data:** through `calls`, checked by access.
- **UI:**
  - intents open another App's Pane;
  - slots take contributions as typed rows (`Item {title, mark, value, act}`) computed by the contributing App's host part.

No App's code touches another App's tree.

**The Unix picture is tmux.**
- A server on the host holds the panes.
- Clients attach and detach from anywhere.
- `capture-pane` and `send-keys` let scripts read and drive them.
- B gives Banda the same pair: `banda view dump <pane> | jq` and `banda view act <pane> h3 '{…}'`.

## 2. The case, dimension by dimension

### Latency and feel

These are estimates that the spike measures. "Isolate" means one pump plus a React render of about 300 nodes in an interpreted engine, 1–8 ms.

| Interaction | localhost | Tailscale, 20–80 ms | Phone via relay, 100–300 ms | Compared with A |
|---|---|---|---|---|
| Type, open a menu, switch a tab, toggle a section | 0 | 0 | 0 | same |
| Checkbox marked `optimistic` | drawn at once | drawn at once; confirmed after 1 RTT | drawn at once | same |
| A click that changes App data | 3–10 ms | 1 RTT + isolate | 1 RTT + isolate | A: 1 RTT for the command, then another if the Pane reads again |
| An Agent changes data the Pane shows | ~3 ms | ½ RTT, the patch is pushed | ½ RTT | A today: ½ RTT for the event + 1 RTT to read again (`READ_AGAIN` in 10 of 14 sources, `app/ui/src/hooks/use-live.ts:24-28`) |
| Open a Pane (first paint) | 5–15 ms | 1 RTT + isolate | 1 RTT + isolate | A: the bundle + reads, often in a chain: `useTurned` waits on `useThreads` (`modules/files/pane/src/live.ts:17-36, 59-104`), so 2–3 RTT |
| View-only state the author kept in `useState` and did not declare | ~3 ms | 1 RTT | 100–300 ms | **A: 0. This is B's real loss.** |

- **On localhost,** today's main case and the default home host, B stays under one frame everywhere.
- **Over a tailnet,** B equals or beats A on every interaction that touches data, because the view reads beside the data. This is the React Server Components argument: no chains of client-to-server reads.
- **On a phone through a relay,** B is faster at the phone's job, "starting, monitoring and controlling" (notes/10:12): one round trip for a first paint and half a round trip for live updates. It is slower only for view logic the author did not declare.

### Offline, and a host that sleeps

- ADR 0081 decision 1 settles this for both options: one writer per record and no CRDT, so no client may write to a host it cannot reach. Offline means read-only last-known state in every option.
- B gives that with no App code: the cached tree, dimmed, marked "as of", with acts off.
- A needs App code plus a data cache per App to show the same thing.
- A sleeping host is equally dark in both. The cure is on the host side: a home host that never sleeps or a cloud host (0081 decisions 9 and 10), plus Web Push for calls (0081 decision 6).

### Security of third-party code on the device

- **B puts no third-party code on any device:**
  - not in the page;
  - not in Electron main, which holds the Keychain path and the Person's browser profile;
  - not on the phone.
- **What reaches the device is data, checked against schemas:**
  - component types from a closed list;
  - props checked against their schema;
  - `className` from an allowlist;
  - URLs only from the host's byte endpoint;
  - sanitised Markdown;
  - intents resolved by the platform.
- **Third-party code runs once, on the host,** in wasmtime with fuel, a memory cap and the App's declared capabilities. That is the same wall and the same audit as its handlers (0062 decisions 4 and 5).
- **A needs a sandbox for each kind of client:**
  - an iframe or Worker in Electron and in the browser;
  - on React Native, a JS engine or hidden WebView per App.
- **App Store guideline 2.5.2** makes downloading executable code into a native app a review risk. A component tree is data, like any server-driven UI.

### The phone (React Native with react-native-reusables)

- **The phone is a renderer plus device adapters:**
  - catalogue components on reusables and NativeWind;
  - the token object from the Rust theme resolver, as WASM or a library;
  - live components such as ThreadView, Composer and Terminal.
- **No App code on it:**
  - no JS bundle per App;
  - no store release when an App changes;
  - an App updated on the host is updated on the phone the next time a Pane opens.
- **Missing components** fall back through `fallback`.
- **Precedent:** Shopify's POS, a React Native app, draws extensions' remote trees with its own native components.

### Version skew between a client and N hosts

- **B shrinks the skew to one contract:** the catalogue, together with the `view.*` frames inside 0081 decision 8's protocol range.
- **An App's view and host part ship in one package on one host,** so the interface between them never skews.
  - Under A, Habits' view v3 on a client talking to Habits' host part v4 forces every App to version every method it calls.
- **The catalogue only grows:**
  - the client sends `catalogue: "1.3"`;
  - the SDK on the host drops newer props and swaps unknown types for their fallback;
  - so a host on SDK 1.5 and a host on SDK 1.2 both draw correctly on a 1.3 client.
- **With N hosts at N App versions,** A's client must load and sandbox N bundles side by side. B's client opens N streams.

### Developer experience

- **`banda app dev [--host server]`** (0081 decision 13 contexts):
  - esbuild rebuilds the view in about 50 ms;
  - the dev install swaps it into the running instances with `react-refresh`, which runs in any JS engine, so `useState` survives;
  - handlers reload between transactions;
  - every client showing the Pane updates on save, the phone included.
- **When something breaks:**
  - `console.*` output streams to the dev terminal;
  - a render that throws shows as an error card in the Pane, with a stack mapped through the source maps the host keeps.
- **Testing the phone's latency:** `--rtt 250` delays acts so the author feels the phone on a laptop.
- **`banda app check`** flags:
  - `useState` that only drives visibility (use `act.toggle`);
  - props outside the catalogue;
  - DOM APIs.
- **`banda app test`** renders headless on the host and checks the tree, like Raycast's evals.
- **The honest gap:** an interpreted wasm engine has no DevTools.
  - `--inspect` runs the same bundle in Node on the developer's machine, with the `send` and `pump` imports forwarded over the WebSocket.
  - Production debugging is logs, tree dumps and mapped stacks.

### Agents customizing Apps (Install, Customize, Share)

- **Everything is on the host already:** the Agent, the App's source (a Project, brainstorm §2.7), its host part, its view runtime and the Person's live Panes.
- **Customize is one loop:**
  1. Edit `view/`.
  2. `banda app dev`.
  3. `banda view dump <pane>` to see the result as data, with no screenshot and no device.
  4. `banda app test`.
- **Install** happens once per host.
- **Share** is `banda app pack`, then a folder, git or the index. The last good version is kept for rollback.
- **Under A,** every customised view must reach each of the Person's clients, and the Agent cannot see the result without driving a device.
- **Later, with a capability,** an Agent could read and press any Level 1 App the way a screen reader does. Defer this, but nothing has to change to allow it.

### MCP Apps

- **The spec puts `ui://` HTML in a sandboxed iframe on the client.** B keeps this as the one frame (0062 decision 10), drawn as the live component `<McpFrame>`.
- **The bytes come from the host's gateway,** never from the MCP server directly.
- **The client builds the sandbox:**
  - a null-origin, double iframe with the resource's CSP;
  - the Person's tokens passed as the spec's host-context style variables;
  - `tools/call` and `ui/message` relayed to the gateway through access.
- **On the phone** it is a WebView.
- The only HTML on any device is in the web's standard sandbox, under an open standard rather than a frame API of Banda's own.

### Web Apps

- **A site runs on the device in every option.** It holds the Person's sessions, camera and media (0062 decision 9).
- **In B:**
  - the host keeps the manifest, which is plain data;
  - `<Site>` is a live component;
  - badges and notifications come through host-side projections (0081 decision 6).
- B changes nothing here and costs nothing.

### First-party live components (Thread, terminal, browser)

- They are client code under either option.
- B makes them public catalogue entries behind a capability, so an outside App can embed `<Terminal>` or `<ThreadView>`. Banda's flagship Apps then prove the SDK through the same catalogue.
- The heavy first-party Panes are not rewritten to run on the host:
  - **their heavy widgets become live components:** FileTree, PdfView, CodeDiff, ThreadView;
  - **their plain chrome moves to Level 1 a piece at a time:** headers, menus, settings sections, lists.
- Each client-only Pane that remains is an `[unstable] client-pane` mark whose count only falls (ADR 0022).

### Cost on the host

These are estimates to measure.

| | QuickJS in wasm | StarlingMonkey in wasm |
|---|---|---|
| Instantiate from the snapshot | microseconds | microseconds to 1 ms |
| Memory written per instance | 1–3 MB | 5–10 MB |
| Render of 300 nodes | 2–8 ms | 1–5 ms |

- **Instances = SDK-App Panes on screen, per client.** One Person with 4 visible on a laptop, 4 on a second screen or web client, and 1 on a phone has about 9 instances: 10–90 MB.
- **Idle CPU is near zero,** because instances wake only for acts and events.
- **Most things hold no instance:** hidden Panes, other desks, and bar widgets. Widgets and calls are host-side projections, not views.
- **Scale is per Person.** A cloud host is one VM per Person (0081 decision 10), so Blazor's problem of many tenants on one server does not arise.

### Implementation cost for one person working with Agents

- **Shared by A and B,** because a safe A also renders remotely:
  - the catalogue and its schema generation;
  - the reconciler's host config;
  - the web renderer, with client-held state, client acts, pending marks and fallbacks;
  - the React Native renderer later;
  - the live components.
- **B only:**
  - `platform/views`: the pool, the pump, limits, eviction, `view.watch` and `view.act`;
  - the pack step (bundle plus Wizer).

  This reuses the wasmtime, WIT and process supervision that 0062 decision 4 needs anyway.
- **A only:**
  - three client sandboxes;
  - delivering, signing, caching and pinning App bundles to every client from N hosts;
  - loading code from host X into a web page served by host Y (cross-origin);
  - a data cache per App if A is to beat B offline.
- **Net:** B is one runtime the team owns on a machine it controls. A is three runtimes on machines it does not control.

## 3. Precedents, and how they really work

| System | How it really works | Lesson for B |
|---|---|---|
| **Raycast** | Extensions run in one Node child process, one worker thread (V8 isolate) each. A custom React reconciler serialises a JSON render tree and diffs it with JSON Patch; Swift builds AppKit views from it. Only registered messages are allowed. `filtering` is done natively. | React works as a description while the host owns every pixel, and authors accept a closed kit. It is local IPC with no sandbox; B adds the wasm wall and the network. |
| **Shopify remote-dom** (formerly remote-ui) | Code runs in a Web Worker or sandboxed iframe on the buyer's device. Mutations of a DOM-like tree are batched over `postMessage`, and functions are proxied with retain/release. The host maps them to Polaris, or to native components in POS on React Native. | The wire format of mutation records, and one tree drawn on web and native. It is A's placement with B's rendering, and it proves the renderer half. The transport is independent of it. |
| **VS Code** | In Remote (SSH, WSL, Codespaces), workspace extensions run on the remote host. Tree views, quick picks, the status bar, hovers and completions are data drawn by the local workbench. Webviews are iframes in the local renderer, fed by `postMessage`, and discouraged "unless you absolutely need them". The text buffer is copied locally, so typing is local. | The strongest proof that logic beside the files, with UI drawn locally from data, works at 20–200 ms. It is exactly B's split: typing local, frames as the escape hatch. |
| **Figma plugins** | Plugin logic runs beside the document in a JS VM written in C and compiled to WebAssembly, which replaced the Realms shim, behind an audited API. The UI is a null-origin iframe, and the two talk by messages. Figma rejected an iframe-only design partly because copying documents into it was slow. | JS in wasm is a workable sandbox, and code belongs where the data is. |
| **Obsidian** | Plugins are full-trust JS in the renderer with the DOM. `isDesktopOnly` marks plugins that break on mobile. Restricted Mode is all or nothing. | What App code on the client becomes: a compatibility matrix per client and one trust switch. |
| **Phoenix LiveView** | Each connected view is a BEAM process holding its assigns. Templates are diffed into static and dynamic parts. `phx-*` events go to the server; `LiveView.JS` commands run only on the client. A focused input is never overwritten. A reconnect mounts the view again from its params, and forms recover automatically. | B's client acts, the focused-input rule, mounting again after a reconnect, and one instance per view all come from here. It works at about 100 ms with that discipline. |
| **Hotwire** | The server sends HTML; Turbo Frames and Streams patch parts of the page; Stimulus adds small client behaviours. Hotwire Native is a webview plus native bridge components. | Declare small client behaviours instead of writing App JS. B sends components, not HTML, so a phone can draw natively. |
| **Blazor Server** | .NET components run on the server, with a SignalR circuit per tab holding their state. Every UI event goes to the server and back. A disconnect shows an overlay, and state is lost if the circuit is evicted. Microsoft's own answer to its latency and scale limits is the WebAssembly and Auto render modes. | **The failure B must avoid.** B keeps typing and view-only state on the client, keeps view state outside the instance, and has one Person per host. |
| **React Server Components** | Server components render per request into a payload that refers to client components by module id. Client components hold state and events; Server Actions go to the server and back. | Level 1 is RSC with a closed set of client components, the catalogue. It removes chains of reads. Unlike RSC, B lets no author ship client components; that waits for Level 2. |
| **Home Assistant** | The Python core and integrations run on the host. The Lit frontend draws entity state over a WebSocket (`subscribe_entities`). Dashboards are YAML cards. Custom cards are JS loaded onto the device. Remote access goes through Nabu Casa's SniTun. | State owned by the host plus UI described as data is enough for monitoring and control at phone latency. Its weak spot is third-party JS on the device, which B removes. |
| **Zed** | Extensions are wasm (wasmtime, WIT) with capabilities and no custom UI. Remote development runs a headless server beside the files, with the UI local and buffers copied. | wasmtime with WIT is proven in production. Zed chose no extension UI over extension code on the client. |
| **tmux and mosh** | tmux keeps panes on a server that clients attach to, with `capture-pane` and `send-keys`. mosh predicts local echo on high-latency mobile links. | The views service is tmux for App views. Fields held by the client and optimistic toggles are mosh's local echo. |
| **X11** (counter-example) | Low-level drawing calls over the network, chatty and bad at latency. | Send semantic components and keep interaction-level behaviour on the client. |

## 4. Real costs, ranked

1. **A round trip for every view interaction the author did not declare.**
   - Examples: a wizard step, a custom picker, a drag to reorder whose result the view computes. Each costs 100–300 ms on a phone through a relay.
   - Mitigations: client-held state, client acts, `optimistic`, `Form`, `--rtt`, the lint.
   - What remains: authors must learn what the client holds, which plain React does not teach, and some interfaces will feel late on a phone.
2. **React, but not npm's React.** There is no DOM in the isolate.
   - These do not work: `react-hook-form`, `framer-motion`, chart and editor libraries, `useRef` to an element, `window`. `fetch` exists only in a worker, under the `net` capability.
   - Only pure-logic packages work, such as zod and date-fns.
   - An App can show only what the catalogue has. Maps, canvases, rich editors and 3D wait for a live component from Banda, an MCP frame, or Level 2.
3. **Banda owns a JS-in-wasm runtime.** This is the largest new piece of code and the riskiest.
   - It includes the pack and snapshot pipeline, the pump scheduler, limits, eviction, source maps, and an engine choice: QuickJS is slow; StarlingMonkey is heavy.
   - That is a second runtime on the host beside the handlers, unless TS handlers move to the same engine.
   - Production has no DevTools.
4. **Every component is two or three implementations:** shadcn for the web, reusables for React Native, and a fallback, plus a schema and a version. The catalogue is a contract that only grows.
5. **The client is not small, only closed.** Heavy first-party Panes stay client code as live components. B removes third-party code from devices, not first-party weight.
6. **A dead host means a frozen Pane.** This is equal to A under one writer per record. But a cached tree can look current, so the "as of" mark must be impossible to miss.
7. **Host memory and CPU grow with clients × Panes on screen.** That is fine for one Person on one VM. A shared team host later (ADR 0001's teams) multiplies it; this is Blazor's lesson.
8. **Input needs rules and tests:**
   - a value from the host against a field that has focus;
   - a server-side validation that arrives after the Person has moved on;
   - two clients showing one Pane, each with its own `useViewState`.
9. **Motion and gestures exist only as component props.** `Collapsible` animates and React Native rows can have `swipe` actions, but an App cannot invent motion.
10. **Until first-party chrome moves to Level 1, Threads does not prove Level 1.** Usage, settings sections and outside Apps do.

## 5. Build order, gates, and what to defer

These steps belong inside 0062 plan step 10, after the base, the look and the web client.

1. **Spike (small).**
   - Add `view.watch` and `view.act` on today's socket.
   - Build a 15-component catalogue and the web renderer.
   - Write the Usage Pane as a view; it is pure read-and-render over host state today. Run it in wasmtime with QuickJS inside `platform/views`.
   - Measure on a laptop, on a server over a tailnet, and through `iroh-relay`.
2. **Gates to keep or drop the runtime** (p95, network excluded):
   - mount to first tree ≤ 15 ms;
   - act to patch ≤ 8 ms for 300 nodes;
   - ≤ 4 MB per instance;
   - 30 instances ≤ 150 MB;
   - save to pixel ≤ 300 ms in `banda app dev`.

   If memory fails: render once per event with pooled instances; the design allows this because view state lives outside the instance's heap. If speed fails: use V8 isolates (deno_core) behind the same `pump` port. The tree, the wire and the catalogue stay the same either way.
3. **Then (medium).**
   - Catalogue 1.0, about 35 components:
     - client acts, `Form`, lists by `source`, slots as typed rows;
     - fallbacks, the `className` allowlist, `catalogue.json`.
   - Tools: `banda app dev`, `check` and `test`, and `banda view dump`.
   - Settings sections declared by Apps as views. This deletes `app/web/src/settings/Agents.tsx`'s import of module internals.
4. **With the phone:** the React Native renderer for part of the catalogue on reusables, and the tree cache per device.
5. **Defer:**
   - Level 2 frames (MCP frames cover custom HTML until an App proves the need);
   - a V8 runtime with an inspector beyond `--inspect`;
   - snapshotting an instance's memory to resume it exactly;
   - nested view streams in slots (typed rows come first);
   - Agents pressing views as a tool;
   - optimistic logic beyond toggles.

## 6. When B is the wrong default

B is the wrong default in two cases:
- the phone's main job becomes heavy interactive editing in third-party Apps over a relay, rather than starting, watching and steering Agents;
- most outside authors want to bring their existing npm React interfaces.

Even then, B stays the default and Level 2 (an App's own frame on the device, A's placement) becomes the escape hatch. Adding Level 2 later changes nothing in B's wire or catalogue. Starting from A cannot later take back code that is already on every device.