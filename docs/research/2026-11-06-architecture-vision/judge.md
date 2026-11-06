# Where an App's view runs: the verdict

Input to [the vision](../2026-11-06-architecture-vision.md) (2026-11-06). Roma's decisions are in its §11 and override this document where they differ.

**Pick C.** It runs a pure `render` on the host and the client draws the tree. Take B's rules for what the client holds. Allow A's placement only later, as Level 2, inside the MCP Apps frame.

For Roma, in plain words:
- **An App's code stays on its host.** Its view is a read method. It reads the App's data and returns a tree of components.
- **The client ships one fixed set of shadcn components.** It draws whatever tree arrives and handles typing, popovers, tabs, sorting and scroll by itself.
- **Only HTML that a standard already walls in runs on the device:** MCP Apps and websites.

B and C are the same family. C is B without the per-client React process on the host, and that process is B's riskiest and most expensive part.

## 1. Precedent check (the claims I doubted)

| Claim | Verdict |
|---|---|
| Raycast: React in Node worker threads on the same Mac, custom reconciler, JSON tree drawn in AppKit | True. Raycast's FAQ confirms the reconciler and AppKit; worker heap limits and JSON Patch are only secondhand. It proves a closed vocabulary works. It says nothing about running across a network. |
| Shopify remote-dom and POS | Code runs **on the device**: POS UI extensions are "client-side JavaScript applications" in a worker. B's POS citation proves only the renderer half, as B admits. A is right about where the code runs. |
| VS Code Remote | True. Workspace extensions run on the remote host. TreeView, QuickPick and the status bar arrive as data and the local workbench draws them. Webviews are always iframes on the client. **This is the closest match to C**, and it holds up over SSH latency. |
| Figma plugins | Logic runs in QuickJS compiled to wasm, with the UI in a null-origin iframe. Both are on the **client**, because Figma's document lives on the client. "Code goes where the data is" points to the host for Banda, whose clients hold no replica (0081 d1). |
| A: "every system with third-party UI runs it on the device; server-rendered UI is first-party only" | **False.** Slack Block Kit, Teams Adaptive Cards, Discord components and VS Code TreeView are all third-party UI sent as data, with a round trip per act, drawn natively on phones. The true version of the claim: *rich interactive* third-party UI runs on the device. That is Level 2. |
| B and C: App Store 2.5.2 blocks A | Overstated. 4.7 allows "HTML5 and JavaScript mini apps … and plug-ins", with duties: content filtering, reporting and blocking of abusive users (4.7.1), no native APIs without permission (4.7.2), consent each time (4.7.3), an index with universal links (4.7.4), and age restriction by verified or declared age (4.7.5). That is a cost, not a wall, though heavier than A lists. |
| A: "under B, a JS engine escape lands on the host" | Wrong as B and C are designed. The JS engine runs *inside* wasmtime, so an escape lands in the instance's memory, behind the same wall as handlers. |
| MCP Apps: a frame on the client, a sandbox proxy on the web, and C's "own server only" rule | True. The spec says a web host MUST wrap the View in a sandbox proxy on a different origin. Tools visible to an app are callable "from the same server connection only". |
| Blazor .NET 8 "Auto" | True. It needs one component model that can run in both places. A pure render keeps that option open; a stateful React process per client does not. |

**Code claims verified:**
- one piece in flight per stream (`kernel/src/api.rs:263-266`);
- the frame set: `Call/Subscribe/Stream` in, `Result/Piece/Ended` out (`api.rs:52-100`);
- `READ_AGAIN` (`app/ui/src/hooks/use-live.ts:24-28`), and `useThreads` reads again on every event (`modules/files/pane/src/live.ts:17-36`);
- access knows only Person and Agent (`kernel/src/access.rs:31-45`);
- a Pane has no host (`modules/workspaces/engine/src/model.rs:147-157`);
- the Visual frame already speaks MCP Apps words with `allow-scripts allow-forms` (`modules/agents/pane/src/visual-frame.ts:1-8, 22, 27-37`);
- Usage reads only through `engine.call`, keeps its view-only state in one `useState` (`off`, the hidden chart series, `UsagePane.tsx:103`), and puts its tab and period in args (`:129-160`);
- methods already emit JSON Schema (`kernel/src/methods.rs:273-279`);
- first-party client code (non-test lines): about 38.5k in `modules/*/pane`, 22k in `app/web`, 14k in `app/ui`.

## 2. Scores (5 is best)

| | A: view on the client | B: React isolate on the host | C: tiers, pure render on the host |
|---|---|---|---|
| Feel / latency | **5**: view-only state is instant on every network | **3**: under a frame locally; state the author did not declare costs 100–300 ms on a phone; data updates are pushed | **3**: same as B |
| Offline, sleeping host | **4**: the cached bundle and data keep tabs and sorting working, read-only | **3**: the last tree, dimmed | **3**: the last tree plus the last `source` pages |
| Security | **3**: third-party JS on every device; no heap cap per worker; gesture rules; 4.7 duties | **4**: one wasm wall, but a long-lived JS heap per client holding an App pass | **5**: the handlers' wall; render is read-only and keeps no state; acts are the Person's commands to declared methods |
| Phone | **2**: a WebView worker per App, a bridge hop, battery cost, 4.7.1–4.7.5 | **5**: a renderer only | **5**: a renderer only |
| Version skew over N hosts | **2**: N bundles side by side; the bridge API, the remote-dom record format and the catalogue all versioned | **4**: the catalogue only, but fallbacks live in each App's bundled SDK | **5**: the catalogue only; fallbacks live once in the host's `banda-ui` |
| DX | **5**: plain React, DevTools, source maps | **3**: React without DOM or DevTools; authors must learn what the client holds | **3**: TSX without hooks; `--print` and snapshot tests; weak wasm debugging |
| Customize by Agents | **3**: the Agent must drive a client to see the result | **4**: everything on the host; the isolates hold state | **5**: a pure function; `banda call` prints the tree; tests over a fixture database are deterministic |
| MCP Apps fit | **4** | **4** | **4**. The spec decides this one: a frame on the device in every option. |
| Host cost | **5** | **2**: an instance per (Pane, client), kept warm | **4**: one tree per (view, args, local); one pooled instance per App |
| Build cost (one person and Agents) | **3**: remote-dom is free, but three client sandboxes, bundle delivery from N hosts across origins, tickets and gestures | **2**: JS in wasm, a reconciler, the pump, eviction, a view-state store, react-refresh | **4**: tree types and a diff in Rust, one more method kind; starts in process with no new runtime |
| Unix borders | **4**: the view is one more client of the four verbs, but across three links | **3**: a stateful actor (the tmux picture) | **5**: `render(args, local, tables) → Tree`; `views.follow` is watch plus diff |
| **Total out of 55** | **40** | **37** | **46** |

**Why this weighting is right for Banda:**
- C wins where a mistake cannot be undone later: security, skew across hosts, and the phone. Roma's own notes say the phone "does not need to run arbitrary third-party code" (notes/10:16).
- A's wins can be recovered: feel through a richer catalogue, DX through Level 2 frames.
- B's point stands: starting with code on devices cannot be taken back. Starting with data can add frames later.

## 3. The recommendation in concrete form

### 3.1 The rule, and four places

> **Code runs only where its author is trusted. Everything else crosses the wire as data.**

The App's kind picks the place. The App does not choose.

| Place | What | Code comes from | Runs in | Phone |
|---|---|---|---|---|
| **Catalogue** | shadcn/ui as `@banda/ui` has it, plus Markdown/Mermaid/KaTeX, Diff, CodeDiff, FileTree, Console, Message, Kbd, the Mark, meters, Chart, and the live components `<Thread>`, `<Composer>`, `<Terminal>`, `<Page>`, `<FileView>` | the client release (asar, the web bundle, the RN bundle) | the client | react-native-reusables, plus RN screens for Thread, Composer and Inbox |
| **Tree** | an SDK App's view, first-party or third-party | the App's package on the host | the host part, in wasm or in process | the RN catalogue renderer |
| **Frame** | an MCP App's `ui://` page; later, Level 2 | the host's gateway, by hash, through the byte route | a sandboxed iframe with its own origin | WKWebView |
| **Site** | a Web App | the site | a device webview with its own partition | an in-app webview, or the site's own app |

### 3.2 A view is a read method whose answer is a tree

This is the deep idea: no new runtime concept. A view is a `methods!` entry of a new kind, so routing, access, ts-rs, the CLI and Agent tools all come for free.

```rust
// apps/habits/host/src/module.rs: one more kind beside call / command / stream
view today(ViewAsk<TodayArgs, TodayLocal>) -> Tree, Read, follows ["habit.done", "habit.added"];
command done(Done) -> (), Write, ui;     // `ui`: a view of this App may fire it
```

```tsx
// apps/habits/view/today.tsx. The JSX runtime builds plain objects: no React on the host, no hooks.
import { view, read, command, client, Card, Checkbox, Button, DataTable } from "@banda/app-sdk/ui"
export const today = view<{ week: number }, { open?: string }>(({ args, local }) => {
  const t = read("habits.week", { week: args.week })                  // a read on the host, at t.at
  return <Card title={`Week ${args.week}`}>
    {t.items.map(h => <Checkbox key={h.id} label={h.name} checked={h.done}
        on={command("habits.done", { habit: h.id }, "done")} />)}     // the new value goes in params.done
    <Button variant="ghost" on={client.toggle("more")}>More</Button>  // no round trip
    <DataTable key="more" hidden source={{ method: "habits.history" }} filter="client"
      columns={[{ key: "day", kind: "date" }, { key: "count", kind: "number" }]} />
  </Card>
})
```

**Three inputs, matching 0062 decision 13's three levels:**
- **the work:** the App's tables, on the Project's host;
- **`args`:** the arrangement, on the home host, through `PaneProps.update` (`app/ui/src/pane.ts:112-113`);
- **`local`:** the view, kept by this client.

**Rules for `render`:**
- It is read-only: `read` for its own tables, plus `call` for other Apps' methods with the Read right that it declares under `calls`.
- It writes nothing, starts no effects and keeps nothing between calls.
- Limits: fuel, a 50 ms epoch deadline, at most 5k nodes and 1 MB.
- Anything that collects data is a command. Example: Usage's `harnesses.usage {read: true}` becomes a Refresh button.

**Where the code loads from:**
- First-party: compiled in. The `view` arm sits in the `methods!` dispatch, in process. This is d4's "one contract, two bindings".
- Third-party: `$DATA/apps/<id>/<blake3>/app.wasm`, installed **per host**.
  - The host part's component exports `view.render(name, ask) -> result<list<u8>, refusal>`. The tree crosses as JSON bytes, because WIT has no recursive types.
  - It uses the same instance pool as the handlers.
  - TS goes through ComponentizeJS (d14). There is no second JS runtime.
- Clients never download App code. They fetch only assets, through the byte route, and `ui://` pages, through frames.

### 3.3 `platform/views`: a deep module with a two-method interface

It is a **client** of the kernel API, as the CLI is, so the kernel keeps only the handler ABI. That answers the map's "kernel absorbs App runtimes" weakness.

```
views.follow {app, view, args, local, ui}  → Piece {at, tree} then Piece {at, ops}*   (a Stream frame)
views.local  {stream, local}               → {at}                                     (a Call frame)
```

**Inside:**
- A cache keyed by `(project, app, view, args, local)`, shared by every client with the same key. This is safe because a host has one Person (0081 d10).
- `Subscribe` with the view's `follows` filter. The default is the App's own events plus its `listens`.
- Events are debounced to one frame and merged while a piece is in flight (`api.rs:263-266`), so a slow phone gets fewer, larger patches.
- `banda_ui::diff` by key produces `set | text | insert | remove | replace`.
- A fallback pass per client for its `ui` version.
- A tree is dropped 30 s after its last follower leaves.
- A throwing render becomes a `view.error` piece plus a Problems entry.

### 3.4 The wire: today's frames, nothing new

```
→ {"type":"stream","id":41,"project":"01JC…","method":"views.follow",
   "params":{"app":"habits","view":"today","args":{"week":45},"local":{},"ui":"1.3"}}
← {"type":"piece","stream":41,"data":{"at":8812,"tree":{"k":"r","c":"Card","p":{…},"ch":[…]}}}
→ {"type":"call","id":77,"project":"01JC…","method":"habits.done","command":"01JD…","params":{"habit":"h3","done":true}}
← {"type":"result","id":77,"ok":{"at":8813}}
← {"type":"piece","stream":41,"data":{"at":8813,"ops":[["set","h3",{"checked":true}],["text","left","2 left"]]}}
```

**An act is an ordinary command from the Person.**
- The control shows the new value at once and stays pending until a patch arrives with `at ≥` the receipt's place.
- A refusal rolls the control back. This is ADR 0025's rule (`docs/adr/0025-…:96-101`), generalised.
- The kernel change this needs: every command answer carries its event's `at`.
- The renderer refuses any `On.method` that is not the App's own `ui`-marked method. The client is trusted and the tree is not.
- Intents go as `workspaces.open` to the home host through the intent registry.
- Over iroh, each view is its own QUIC stream.

### 3.5 What the client holds, which never waits for the host

- **Code:** the catalogue code and the device's tokens (ADR 0080, resolved per display).
- **Per Pane:** the last tree with its `at`, in memory, persisted later on the phone; `local`, at the view level (`lib/kept.ts`); pending marks.
- **Inside components:** the value of the focused field (no patch overwrites it); popovers and menus; Tabs, Accordion, Collapsible; hover and scroll; DataTable sort and filter when `filter="client"`; Chart series, which is how Usage's `off` state disappears; a slider or drag until release.
- **Client acts:** `show | hide | toggle | select | focus | copy | open(intent)`.
- **Forms:** checked against the method's JSON Schema, sent as one command.
- **Cached:** the manifests needed to resolve intents.

### 3.6 First-party Apps

| App | Today | Under C |
|---|---|---|
| Threads | 12.3k-line pane; the client folds about 30 fact kinds (`modules/agents/pane/src/thread.ts:158-519`) | `<Thread>` `<Composer>` `<Questions>` become catalogue entries; **the host streams ThreadView patches** (needed for the phone in every option); its chrome (menus, details rows, settings) moves to views and slots |
| Terminal | already `terminal.watch` + ghostty | `<Terminal>`, no change |
| Browser | device webviews | `<Page>`: a device webview or the host's screencast |
| Files, Git | large panes | the viewer and diff stay catalogue entries (`<FileView>`, `<Diff>`); lists and the commit form become views |
| Usage, settings sections, Problems, Pulls | client React | views, Usage first (delete `UsagePane.tsx`) |

- A manifest may declare a Pane as a live component directly (`pane = { live = "Thread" }`). The client then draws it without asking the host to render anything.
- Every Pane still in client React carries `[unstable] client-pane`, and that count only falls (d2).

### 3.7 MCP Apps, Web Apps, Level 2

- **MCP Apps (the Frame place):** generalise `Visual.tsx` and `visual-frame.ts` into `client/frame`.
  - The bytes come from the gateway by hash through the byte route.
  - The CSP comes from `_meta.ui.csp`.
  - The look reaches the frame as `host-context` (`visualLook`).
  - `tools/call` goes client → host gateway → access, **on the same server only**, as the spec says. `ui/message` goes into its Thread under the Thread's mode.
  - The web client uses the spec's sandbox proxy on another origin.
- **Web Apps (the Site place):**
  - one partition each, `persist:webapp-<id>`;
  - the manifest is the Person's data on the home host;
  - badges and notices go through the device adapter into host calls (0081 d6);
  - a browser-tab client shows none.
- **Level 2 (deferred):** an SDK App's own `ui://` page, served by its host into `client/frame`, speaking MCP Apps messages that reach its own host part. That is A's placement, but only inside the standard sandbox, and it comes almost free once the frame host exists.

### 3.8 Several hosts, and how Apps talk to each other

- **Where a view runs:** on its Project's host. Person-scope Apps run on the home host.
- **Routing:** the client's Hosts router resolves `ProjectId → host` through the directory on the home host. No host fetches another host's view.
- **Embedded live components:** a `<Thread project=P>` inside a tree from host A connects by itself to P's host B.
- **A Project that moves (0081 d11):** the client follows the view again on the new host. `args` and `local` survive; the tables move with the Project.
- **A host the client cannot reach:** the last tree, dimmed, acts off, marked "as of 14:02" from `at`.
- **How Apps talk, on the host only:**
  - `calls` (methods through access);
  - `listens` (events);
  - intents (the registry);
  - **slots as typed rows** `Item {title, mark, value, on}`, from a contributor's read method `slot.<name>(subject) -> Item[]`.
- Views never talk to each other, and no tree holds another App's tree in v1.

### 3.9 Borders, Unix-style

| Program | Input | Output | From the CLI |
|---|---|---|---|
| handler (host) | command | events, effects, receipt `at` | `banda call habits.done '{…}'` |
| view (host) | args, local, tables | Tree at `at` | `banda call habits.today '{…}' \| jq` |
| `platform/views` | follow (view, args, local, ui), log events | Tree, then Patch* | `banda follow views.follow …` |
| worker | effects, heard events | commands | `banda app logs` |
| renderer (client) | Tree, Patch*, tokens, input | pixels, commands, intents, client acts | `pane.tree` over the device road |
| live component | its own stream | typed input methods | as `terminal.watch` today |
| frame host | `ui://` bytes, host context | JSON-RPC to the gateway | the MCP Apps tooling |

### 3.10 Build first, gates, defer

Inside 0062 plan step 10, after the base, the look and the web client:

| Step | What | Gate |
|---|---|---|
| 10a | `banda-ui` crate: `Node`, `On`, `Source`, catalogue names and prop schemas (serde, ts-rs, schemars), `diff`, `fallback`, limits. Pure, tested with `cargo test`. | |
| 10b | The `view` kind in `methods!`; `platform/views` in process; **Usage's view in Rust**; delete `UsagePane.tsx` (477 lines) | render p95 ≤ 5 ms; tree ≤ 30 KB; a usage tick ≤ 1 KB of patch; act to patch on localhost ≤ 10 ms |
| 10c | `client/remote` web renderer: 15 components, growing to about 35 over `@banda/kit`; client acts, pending marks, the focused-field rule, fallbacks, "as of" | still usable at `--latency 150` |
| 10d | Settings sections and Problems as views; deletes `app/web/src/settings/Agents.tsx`'s import of module internals | |
| 10e | With step 9's runtime: the WIT `view` export, `@banda/app-sdk/ui/jsx-runtime`, `banda app dev --print/--latency`, hot swap | ComponentizeJS: instantiate from the pool ≤ 1 ms; 300 nodes ≤ 10 ms; ≤ 20 MB per App |
| 12 | `client/frame` from the Visual frame, with the MCP gateway | |
| phone | the RN renderer for part of the catalogue; RN screens for Thread, Composer and Inbox | |

**If the TS runtime fails 10e's gates:**
1. Try Javy (QuickJS).
2. Otherwise run TS views in the App's worker process under a **read-only** pass. The `render` contract stays the same; only the binding changes.

**Defer:**
- Level 2;
- running `render` on the client as wasm;
- a persisted tree cache (memory first, the phone later);
- subtrees in slots (typed rows first);
- drag and canvas inside trees;
- optimistic updates beyond controls;
- Agents pressing views as a tool.

## 4. ADR 0062 decision 7: the exact replacement

Replace the whole of decision 7 with:

> 7. **What an App shows is a tree its host part works out and each client draws from Banda's components (Level 1).**
>    - **Code runs only where its author is trusted; the rest crosses the wire as data.** Banda's client release is trusted on a device. An App's code is trusted only on its host, in its sandbox. HTML that a spec or an origin already walls in runs in the device's browser sandbox. So what a Person sees runs in one of four places, and the App's kind picks it:
>
>      | Place | What | Runs on |
>      |---|---|---|
>      | Catalogue | the whole of shadcn/ui, as `@banda/ui` has it; Banda's own components (Markdown with Mermaid and KaTeX, Diff, CodeDiff, FileTree, Console, Message, Kbd, the Mark, meters, charts); the live components (a Thread with its composer, a terminal, a browser's page, a file's view), each behind its capability | the client, in Banda's release |
>      | Tree | an SDK App's view | its host part, on the host |
>      | Frame | an MCP App's `ui://` page (decision 10) | the device, in a sandboxed frame |
>      | Site | a Web App (decision 9) | the device, in a webview |
>
>    - **A view is a read method whose answer is a tree.** An App declares it beside its handlers (`view today(…) -> Tree`) and writes it in TSX against `@banda/app-sdk/ui`, or in Rust with `banda-app`. It takes the Pane's args (the arrangement's, decision 13) and this client's local state (the view's). It reads its tables and the methods it `calls`, and answers the tree with the log's place it shows. It writes nothing, starts nothing, keeps nothing between calls, and has a fuel cap; `banda call` prints it. No React and no JavaScript isolate run on the host for views: a TypeScript view runs in its host part's WebAssembly (decision 14).
>    - **The platform's views service follows it.** `views.follow` answers the tree, works it out again when the events it follows arrive (at most once a frame), and sends each client a patch by key. One tree serves every client with the same args and local state. A client older than the tree gets each newer component's fallback, worked out on the host.
>    - **What the client holds never waits for the host:** a field's value as the Person types (no patch overwrites the field in focus), an open popover or menu, a tab, an accordion, hover, the scroll, a table's sort and filter, a chart's series, and the acts the tree declares for the client (show, hide, toggle, copy, open by intent), as LiveView's JS commands. Large lists and charts name their data (`source = "habits.list"`) and the client follows it a page at a time.
>    - **An act is the App's own command**, one it marks for its views, sent as the Person from this device. The control shows the new value at once and stays pending until a patch at or past the command's place in the log; a refusal puts it back (ADR 0025's rule). A form is checked on the client against the method's schema and sent as one command. Setting the view's local state is one round trip.
>    - Props carry no functions and no colours. A table's cells are typed columns or a subtree; `className` takes layout utilities only; colour comes through variants; images come only through the host's byte route.
>    - So no App's code reaches a device. Every client, a phone included, draws every App with its own components (shadcn, react-native-reusables) in its own theme (decision 18); each shows the host's version of the App; and an Agent reads what a view shows as text. Any act that is not the client's costs one round trip: nothing on this computer, tens of milliseconds to a server, more to a phone through a relay.
>    - Banda's own Apps draw the same way. What needs every frame (Threads, the terminal, the browser, the Files viewer) is in the catalogue, for any App to embed by capability. The rest of their Panes move to views one at a time; each one still drawn by client React carries an unstable mark until it does.
>    - **Level 2**, an App's own HTML, waits for an App that needs more than the catalogue. It will be a `ui://` page from the App's host in the Frame place, speaking the MCP Apps messages, so the only App code a device ever runs is in the browser's sandbox, under an open spec.

**Edits that follow from it:**
- **d2:** the Kernel row goes from "· the App runtimes" to "· the handlers' runtime". The Platform row adds "· views".
- **d8:** the SDK App row's "What it shows" becomes "Level 1: a tree from its host part".
- **d10:** add "A frame calls only its own server's tools (the spec's `app` visibility)."
- **Consequences:** "Third-party code runs in WebAssembly on the host (handlers and views), in workers with a scoped pass, or in a sandboxed frame on the device; none of it runs in the window's page, in Electron main or in the phone's own runtime."
- **Plan step 10:** becomes 10a–10e as in §3.10.
- **d3:** stands unchanged.

## 5. The three strongest objections, with answers

**1. "Every interaction outside the catalogue is a round trip. On a phone through a relay that is 100–300 ms. This is the Blazor Server trap."**
- Every *write* costs a round trip in all three options (0081 d1). Only presentation state differs, and the catalogue holds it.
- The test case is the current code. Usage's only view-only state, `off` (`UsagePane.tsx:103`), becomes Chart's own legend state. Its tab and period are already args (`:129-160`).
- What remains is drill-down and wizard steps: `local` or args, with a skeleton. That is what Slack Block Kit and VS Code TreeView do over SSH, at scale, on phones.
- Blazor failed through *state per client* on the server: a circuit lost on eviction, plus memory per tab. C keeps no state per client on the host. A tree can always be rebuilt from (args, local, tables).
- **When to revisit:** if the first ten real Apps keep needing what the catalogue lacks, bring Level 2 forward. The wire, the catalogue and the renderer stay as they are.

**2. "Authors lose real React (hooks, the DOM, npm, DevTools), and A's DX is clearly better."**
- True, and it is the price.
- Level 1's first authors are Agents. They write correctly against a closed, schema-checked catalogue, and with `banda call … | jq` they see their own output as text.
- The view is still TSX with shadcn names. Testing is deterministic: render over a fixture database.
- Developers who need the whole DOM get it under Level 2, in the frame, without Banda shipping three client sandboxes, delivering signed bundles from N hosts across origins, and versioning a bridge API.
- VS Code made the same trade: data views by default, webviews "only when necessary".

**3. "The flagship Apps don't prove Level 1, and the catalogue becomes a gate Banda must staff forever, with two or three implementations per component."**
- The catalogue exists in **every** option. A and B also draw a closed vocabulary through remote-dom or a tree, so this cost does not separate them from C.
- C contains it:
  - **admission:** a component enters the catalogue only if it needs per-frame interaction or a high-rate stream, *and* two Apps use it or it is a first-party live component;
  - **fallbacks:** written once in `banda-ui`, applied on the host;
  - **the RN port:** follows the phone's needs, not parity.
- Threads proves Level 1 where it can: its chrome, details rows and settings go through views and slots, and its live component is public for any App to embed.
- The `[unstable] client-pane` count makes the rest visible, and it only falls.

Sources:
- [Apple App Review Guidelines (2.5.2, 4.7)](https://developer.apple.com/app-store/review/guidelines/)
- [MCP Apps spec (ext-apps)](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- [Shopify engineering: remote rendering](https://shopify.engineering/remote-rendering-ui-extensibility)
- [Shopify POS UI extensions](https://shopify.dev/docs/api/pos-ui-extensions/latest)
- [Raycast developer FAQ](https://developers.raycast.com/misc/faq)
- [Raycast blog summary (secondary)](https://www.plushcap.com/content/raycast/blog/raycast-how-the-raycast-api-and-extensions-work)
- [AI SDK: MCP Apps](https://ai-sdk.dev/docs/ai-sdk-core/mcp-apps)