# Banda refactoring plan: deep modules, Unix borders, PRs in order

Input to [the vision](../2026-11-06-architecture-vision.md) (2026-11-06). Roma's decisions are in its §11 and override this document where they differ.

Code is cited from `arch-review` at `9916fff9`. "0062" means the draft in `app-sdk-adr`. "Borders" means the borders-and-protocols design. "0082" means the Tasks/Units design. "Isolation" means the Project-isolation design. `[W]` marks a step the web client needs. `[H]` marks a step several hosts need.

## 0. Rules every PR follows

- **One concern per PR, and `scripts/check.sh` stays green.**
  - No visible UI change. If a step must change what the Person sees, it goes mockup-first as a separate PR.
  - A move is a pure `git mv` in its own commit. The content change comes in the next commit, so blame and rebases survive.
- **Each step adds the guard that keeps it.** The guards are small tests:
  - "kernel names no App" already exists. Add: "platform names no App" (grep of App ids under `platform/`).
  - No `Command` spawn outside `banda-environments`.
  - `banda-settings`, `banda-look` and `banda-keys` depend on no App crate (`cargo metadata` test).
  - View packages import only `@banda/sdk`, `@banda/kit` and their own App (eslint).
  - The `client/desktop` main process reads no Project path.
  - Released fact schemas only add (CI).
  - The unstable count only falls (already there: `engine/src/modules.rs`, `CEILING = 2`).
- **Data is never rewritten.**
  - Renames keep old names readable through aliases (the ADR 0069 rule).
  - Table prefixes stay as they are.
  - Logs keep old kinds.
- **Docs move with the code.** Each PR fixes the lines of `architecture.md` and `GLOSSARY.md` it makes untrue. ADRs are history, and their paths are not edited.
- **How to check a module is deep.** Its interface is a few calls with data in and data out, and `banda call …` can drive it from the CLI (the Unix test).

---

## 1. Target tree

### `kernel/`: crate `banda-kernel`

There is one kernel per host. It names no App. Target: about 6k lines, down from 7.1k plus 1.2k of product code.

| File | One job | In → out | Comes from |
|---|---|---|---|
| `router.rs` | Dispatch a frame | `Session` plus a frame (`query`, `command`, `subscribe`, `stream`, `cancel`) → result, receipt, events, pieces or a refusal | `kernel.rs:534-712` (call, stream, follow, place) |
| `scopes.rs` | Open scopes and their stores; epochs; the move fence | `open`, `close`, `freeze`, `receive`, `hand_off` → `Arc<Scope>`; `projects.located@1` | `kernel.rs:18-310` (builder, open); `project.rs:39-151` (Manifest); the `moving` lock (`kernel.rs:566`). `Scope{Project, Machine}` (`module.rs:19-27`) becomes `{Project, Host, Person}`. |
| `store.rs` | Single writer, transactions, receipts, migrations | Tx operations → commit, facts, receipts | `store.rs` (kept), plus a SQLite authorizer, a reader pool, and migrations by hash |
| `events.rs`, `cursors.rs` (new) | The log; durable listener cursors | `listen(name, filter)` → events, acked in the transaction | `events.rs`; `project.rs:806-829` (`react` from head) |
| `outbox.rs` | Effects by key | `enqueue(kind, key, payload, until?)` → runs; `settle(outcome as data)` | `outbox.rs` core kept. Added: leases, garbage collection, a retry policy per kind. `DoneWriting(Writing)` (`:47-63, 306-311`) becomes data. |
| `access.rs` | The one decision | `decide(Session, Method{right, capability}, resolved scope)` → ok or `forbidden` | `access.rs:31-48` (Person or Agent × Right only) |
| `identity.rs`, `passes.rs` | Who is calling | `challenge`; `hello{sig \| pass}` → `Session{person, actor, via, scopes, only, expires}` | Identity in `api.rs:151-169`; `passes.rs`, which today is an in-memory `HashMap`, becomes hashed, expiring rows in the Host store |
| `registry.rs` (new) | What this host's Apps provide and need | manifests → `apps.describe` (JSON Schema); `resolve(intent)`; check on `listen` | The hand chains `serve.rs:60-88`, `modules.rs:43-111` and `methods.ts:26-38` become generated |
| `devices.rs` | Devices, their capabilities, presence, pending requests | `register`, `presence`, `answer` → `request(cap, target, within)` | `window.rs`, which has one holder (`:135-139`) |
| `api.rs` | Frame codec plus the session loop over any transport | `Transport: Sink + Stream<Frame>` → a session | `api.rs:286`, hard-wired to axum's `WebSocket` today |
| `methods.rs`, `app.rs` | The App contract: `methods!`, `facts!`, `intent`, and the host API (the Rust binding of the syscall table) | — | `methods.rs`; `module.rs` (14 hooks); `Tx` (`store.rs:82-149`) |
| `environment.rs` (new) | The port for where a Project's programs run | `Program{argv, env, cwd}` → `Child` or `PtyChild`; `ports()` | Isolation design; `Program` from `harnesses/engine/src/model.rs:93-97` |
| `ids.rs` | Ids, plus `HostKey`, `DeviceId`, `AppId` and `Address{scope, app, id}` | — | `ids.rs`. One `Address` type serves both borders' `Address` and 0082's `Ref`. |
| `tasks.rs` (Phase 4) | The `task@1` rows | `Tx::task_open` / `task_set` → `task.changed@1` | new (0082) |

**What leaves the kernel:**
- `sign.rs` (684 lines), `kernel.rs:801-1230` (Project CRUD), and `:1001-1021, 1289-1316` (browse) go to `platform/projects`.
- `reach.rs` and `watching.rs` go to `platform/fs`.
- `old.rs` goes to `engine/src/old.rs` as a one-shot migration.

**One reconciliation across the designs.**
- Isolation's `Environment` trait sits in the kernel.
- `platform/environments` implements it.
- `platform/supervisor` spawns only through it.
- Borders' `Place` and 0082's `Spec.place` both mean "which Environment this Project has". There is one chokepoint.

### `engine/`: the `banda` binary (composition root and CLI)

This stays `engine/`, the word 0081 uses.
- `serve.rs` builds the kernel from a generated `apps.rs`, made by a build-time scan of `apps/*/app.toml` and `platform/*/app.toml`. Each crate exports `fn build(&HostContext) -> Arc<dyn Module>`.
- The CLI takes a host context and a route, not a local file (`client.rs:22-25`).
- `mcp.rs` moves into `platform/gateway`; the `banda mcp` entry stays here.

### `platform/`: services

They run on the host, may hold rights no App gets, and name no App.

| Part (crate) | One job | Interface (in → out) | Comes from |
|---|---|---|---|
| `projects` (`banda-projects`) | Host scope: this host's Projects, signs, browse. Person scope (later): the directory. | `projects.{list, create, add, update, remove, locate, browse, sign}` → receipts plus `projects.added/updated/removed/located@1` | `kernel.rs:801-1230`; `sign.rs`; browse at `kernel.rs:1001-1021, 1289-1316` |
| `fs` (`banda-fs`) | Walled file reach and folder watching | `reach(folder, path)` → `OwnedFd` (openat2 / `O_NOFOLLOW`); `watch(folder)` → a `Changed` stream | `kernel/src/reach.rs`, `watching.rs` |
| `git-cli` (`banda-git-cli`) | Hardened, read-only git for bookkeeping | `git(dir, args)` → output; it runs nothing a Project's config names | `git/engine/src/run.rs:351-373`; the runners in `files/lib.rs:233-249` and `pulls/lib.rs:233-260` |
| `environments` (`banda-environments`) | Where a Project's programs run: `local` (now), `container` and `sandbox` (later) | The `Environment` port | New. Every spawn site moves onto it. |
| `settings` (`banda-settings-core`, `banda-settings`) | Core: a file, its schema, its problems, the comment-keeping writer. Service: read, follow and write each file through its owner. | `settings.{read, follow, set, reset, rename}{file}` → `settings.changed@1{file, text, problems}` | `look/src/file.rs`, `keyed.rs`, `settings.rs` (machinery); `settings/src/write.rs` (763 lines, deep, kept) |
| `look` (`banda-look`) | A pure resolver (ADR 0080) | `resolve(theme files, device facts)` → `Tokens` | `look/` minus keys, sidebar, snooze and the settings machinery |
| `keys` (`banda-keys-core`, `banda-keys`) | Core: the actions in force (pure, also runs on the client). Host: `keys.toml` in Person scope, `keys.bind` (delegable). | `in_force(manifests, keys.toml, device)` → map; `keys.{bind, unbind, list}` | `look/src/keys.rs` (1331 lines); `modules/keys/engine` (506 lines) |
| `sidebar` | `sidebar.toml` (Person), generic over `item@1` | resolve → arrangement rules | `look/src/sidebar.rs` (985 lines) |
| `workspaces` | The arrangement (Person scope, home host); the model stays pure | `open`, `move`, `size`, `group`, `close` with look values as args and `expect{seq}` → `workspaces.changed@1`, `pane.left@1` | `modules/workspaces/engine`; `Display` and `share` from `look/src/columns.rs` |
| `calls` (`banda-calls`) | The Inbox projection, who is told, push | `call.*@1` from every local Project plus device presence → `calls.inbox`; `device.request notify`; Web Push | `notifications/pane/src/teller.ts:113-172`; `agents/pane/src/marks.ts:19-96`; `app/web/src/bar/Watches.tsx` |
| `harnesses` | Harness list, accounts, limits, usage journals, process pool; `adapters/` is a host Node package | `sessions.open` (Phase 4); `limits`; `usage`; `sign_in` | `modules/harnesses/engine`; `harnesses/desktop/{adapters.mjs, claude-sdk.mjs, src/sessions.ts}`; `src/usage.ts` goes to `limits/claude.rs` |
| `gateway` (`banda-gateway`) | Agents' MCP: session passes, `banda mcp` now, HTTP later (also isolation's door) | `session{thread, agent, project, tools}` → `McpServer`; MCP JSON-RPC → kernel calls as `Agent{thread}` | `engine/src/mcp.rs`; `Pipe` at `agents/engine/src/lib.rs:103-128`; pass minting from `passes.rs` |
| `bytes` (`banda-bytes`) | Byte URLs as capabilities | `bytes.issue{scope, app, path\|blob, ttl, device}` → `banda://<host>/b/<token>`; `stream bytes.read{token, range}` | `app/desktop-kit/src/files.ts:128-243` (`FileLinks`, ported as is), `preview.ts` |
| `supervisor` (Phase 4) | Units: wanted state against observed state | `ensure(Spec)` → `Lease`; `units.*` | `harnesses/engine/src/hosts.rs`; `terminal/engine/src/servers.rs` as observer |
| `routes` | Transports and pairing on the host side | `ws`, `ssh-stdio`, `direct` (TLS), `iroh` → `Transport` | new (0081 d4) |
| `runtime`, `views`, `installer` (Phase 4) | wasmtime and workers; `views.follow`; install, grant, enable | as the borders and view-placement designs say | new |
| `problems`, `sharing`, `skill` | As today | `problems.record` from clients; sharing posts from the host; skill topics from manifests | the modules of the same name |

### `apps/`: first-party Apps

Each App has `app.toml`, `host/` (crate), `view/` (client code until Level 1) and `skill/`.
- The device part is not code in the App. It is a list of the device capabilities the App uses (`device = [...]` in `app.toml`). Their code lives in `client/*/device/`.
- A first-party `device/` folder may stay only as a temporary exception, with an unstable mark.

| App | Host part keeps | Leaves it | View |
|---|---|---|---|
| `threads` (from `modules/agents`) | `store`/`model`, `rules` and `writer`, `acp/`, the runtime (live, effects, drive, transcript, between, questions, aside), snooze. Publishes `threads.*@1`, `item@1`, `call@1`, `task@1`. Intents `compose.text@1`, `notice.post@1`. | Pipe and passes → `gateway`. `visuals.rs` and `visual_page.rs` → MCP App cards (Phase 4). `issues.rs` → `problems`. notify → `calls`. `old_agents.rs` → a migration. The harness settings UI → the `harnesses` view. | From `agents/pane`, plus the Thread features of `Shell.tsx`: snooze, archive, wake, solo, the woke-told note, `ThreadMenu`, `ThreadMark` |
| `git` | Engine, checkpoints; the `git_runs` workflow (from `pane/src/chain.ts`); `pane_upgrade("agents.diff")` (from `workspaces/model.rs:159-172`); queries `remote@1`, `ignored`, `last_commit` | — | `git/pane` |
| `pulls` | As today, but it listens to `threads.tool.ran@1` and `git.pushed@1` | `pulls_agents` (`store.rs:39-41`); its own git runner | — |
| `files` | Engine; `files.activity` (the join done on the host) | Bytes → `platform/bytes` | `files/pane` minus `live.ts` |
| `terminal` | PTYs; listens to `pane.left@1` | `servers.rs` → supervisor observer (Phase 4) | `terminal/pane` |
| `browser` | Tools; the site policy (from `browser/desktop/src/drive.ts:266-286, 853-862`); a `Tabs` port with two backends: a device lease now, a host Chromium later (0062 d12) | — | `browser/pane`. Device code → `client/desktop/device/webview/` (browser, extensions, popup, blocker, dialogs, tabs, keys, CDP lease). |
| `usage` (Phase 4) | — (view only; calls `harnesses.usage@1`) | — | `harnesses/pane` UsagePane and Spend |

### `client/`

| Package | One job | Comes from |
|---|---|---|
| `core` (`@banda/client-core`, new) | The Hosts router (key → route list → `Engine`), `AddressSource`, the directory cache, staleness, the Inbox merge, the closed device vocabulary (`Device`), view state (`kept`), the pane-kind registry; later the Level 1 renderer | `app/ui/src/desktop.ts`, `lib/kept.ts`; the `BRIDGE` (`app/web/src/host.ts:119-261`) |
| `web` (`@banda/web`) | The page (bar, sidebar, menu, tiling view, settings). The same page runs in Electron and in a browser tab. | `app/web` |
| `desktop`, `desktop-kit` | Electron main = window chrome plus `device/<cap>.ts` | `app/desktop`, `app/desktop-kit`; inline answers at `main.ts:296-476` |
| `ghostty` | Terminal renderer, a catalogue live component | `app/ghostty` |
| `ui` | Temporary home, until it is split into `sdk/kit` and `sdk/ts` | `app/ui` |
| `mobile` | Later | — |

### `sdk/`

| Package | One job | Comes from |
|---|---|---|
| `contract` (`@banda/contract`) | Generated types, the TS `Engine` client, and `released/<app>/` fact snapshots | `contract/` (the `Engine` client in `engine.ts` stays deep and unchanged) |
| `ts` (`@banda/sdk`) | `module.ts`, `pane.ts`, `use-live`, intents, `Item` | `app/ui/src/{module,pane}.ts`, `hooks/use-live.ts` |
| `kit` (`@banda/kit`) | shadcn plus the generic components, with an explicit export list (the seed of the Level 1 catalogue) | `app/ui/src/components/*` minus the App-owned ones |
| `intents` (`banda-intents`) | The schemas of the `banda.*` verbs | new |
| `app`, `wit`, `ui` (Phase 4) | `banda-app` (the Rust binding), the WIT world, `banda-ui` (Tree, diff) | new |

### `cloud/` and `infra/`

Later (0081 step 9). Nothing moves now.

---

## 2. Deep-module verdicts

| Module today | Verdict and evidence | Target shape | Step |
|---|---|---|---|
| `kernel.rs` (1323 lines) | **Mixed.** Its routing core (`:534-712`) is deep. The rest is a Project registry outside the log and receipts: `projects.*` commands keep no receipts, and `create` finds earlier work by scanning manifests (`:836-845, 873-879`). Browse and sign wiring sit there too. Clients re-read on focus (`use-projects.ts`). | `router.rs` plus `scopes.rs` in the kernel (about 500 lines). `platform/projects` is a Host-scope module through `Store::command`, with `projects.*@1` facts. It is privileged: it gets a `Scopes` handle. | A1, A2 |
| Module host API (`module.rs`, `project.rs:691-964`, `Tx`) | **Shallow and leaky.** Raw rusqlite (`store.rs:94-96`); the reader is only `query_only` (`:170`); untyped mpsc streams (`module.rs:16`); closures in `DoneWriting` (`outbox.rs:47-63`); a 14-hook trait. It cannot become WIT. | The syscall table as data. In the transaction: `sql.exec`, `sql.query`, `emit`, `enqueue`, `caller`, `now`. Outside it: the pass. Rust sugar sits on top. The trait shrinks to name, migrations, generated handlers and effects. | A4, D1 |
| `look` crate (7.6k lines, 17 files) | **Grab-bag.** Theme, keys, sidebar, snooze, sound and notify, plus the settings machinery. Ten crates link it only for `OneFile` and `Problem` (`agents sending.rs:14-15`; the `settings.rs` files in browser, files, terminal and sharing; `harnesses list.rs:8`; `keys lib.rs:13`). Workspaces links it for `columns::Display` (`lib.rs:22`). | `look` = `resolve(theme, device facts)` → tokens. `keys.rs` → `platform/keys/core`. `sidebar.rs` → `platform/sidebar`. `snooze.rs` → `apps/threads/host`. File, keyed and settings machinery → `settings-core`. Column math → `workspaces`. | B2, L1 |
| Settings inversion | **Inverted.** `banda-settings` depends on 6 App crates (`settings/Cargo.toml:11-17`) and `include_str!`s 8 `window.json` files written by a TS test (`settings/src/lib.rs:19-26, 65-87`). `banda-keys` pulls in 10 crates. | `banda-settings-core` is a leaf with no banda deps. The settings service gets its file list from the generated `apps.rs` at the composition root. Apps declare `[[settings]]` in `app.toml`. | B1, B2 |
| `Shell.tsx` (1562 lines, one function at `:274-1562`) | **Shallow god object.** Change queue, key router, WindowApi, Thread features (`:568-690` snooze and archive), drawer (`:695-737`), peek (`:739-764`). It calls `agents.*` by name (`:589, 598, 720, 1154, 1174`). | `tiling/controller.ts` (`apply(key) → command`, `onEvent`), `keys/router.ts`, `device/desktop.ts`, peek and drawer hosts. The Thread features go to the threads view through actions and slots. Shell becomes composition only (≤ 400 lines). | B4, B5, B9 |
| `@banda/ui` | **No surface.** Wildcard exports `./lib/*`, `./hooks/*`, `./components/*`, `./desktop` (`app/ui/package.json`) mix the contract, the kit, Thread-domain parts (`prompt-*.tsx`, `thread-details`, `harness-logo`, `message-scroller`), localStorage helpers and Electron. | `@banda/sdk` plus `@banda/kit` with explicit export maps. App-owned components move to their views; device code to `client/core`. A lint bans deep imports. | L3 |
| Agents engine (33 methods, `lib.rs:225-366`) | **A deep core with a wide, mixed surface.** `rules` and `writer`, `acp/` and the runtime are deep and stay. Non-Thread jobs: Visual hosting, `issues.rs`, notify, touching for Files, the Pipe and passes (`lib.rs:103-128`), `old_agents.rs`, the Flow setting (`sending.rs:69-93`). | Threads = threads, turns, items, Questions, marks, snooze. Public: `threads.*@1`, `item@1`, `call@1`, `task@1`, and the intents `compose.text@1` and `notice.post@1`. The rest leaves (see §1 `apps/`). | B3, E7, E8, D7 |
| Browser engine (918 lines) | **Shallow pass-through.** Each tool is `call.ask_window(...)` (`lib.rs:271-291`). The real work is about 6.8k lines in the device, including the policy. | A deep host part: a `Tabs` port with two backends (a device lease, a host Chromium), the policy on the host, and the intent `open.address@1`. The device part is the `webview` capability only. | E3, then 0062 d12 (D9 / isolation step 7) |
| `keys` engine (506 lines) | **Shallow.** In Machine scope (`lib.rs:321-323`), it rebuilds the manifests from compiled-in JSON on every call (`:100-125`) and writes the device's file from the host. | `platform/keys` in Person scope, with manifests from the registry. `banda-keys-core` is the pure `in_force`, shared with the client. | B1, L1 |
| `window.rs` road | **Deep, but the wrong abstraction.** One holder: the last window to subscribe wins (`:135-139`). Requests name no device. Host work runs through it: usage (`limits/claude.rs:46`), Visual layout (`agents lib.rs:1111, 1150`), browser tools. | `devices.rs`: `register{caps}`, `request(cap, target)`. Host work leaves it. | S2, E3 |
| Watches and notifications | **Deep rules, shallow delivery.** N×M invisible React subscriptions (`bar/Watches.tsx:54-70`); policy in each client (`teller.ts:160-172`); seen marks in localStorage (`seen.ts:12`). | `platform/calls` projection; the client subscribes once per host. | E7, E8, E9 |
| `harnesses/desktop` | **Three unrelated jobs** (adapters, session shim, usage token), all host runtime. | Adapters → `platform/harnesses/adapters`; usage → `limits/claude.rs`; the folder is deleted. | S1, S2 |
| `engine/src/modules.rs`, `serve.rs` chain | **Shallow hand registries.** About 13 lists, from `Cargo.toml:3` to `app/desktop/src/modules.ts:9-56`. | Generated from a scan, as `modules/skill/build.rs:16-34` already scans. | B1 |
| Electron `main.ts:296-476` and the `BRIDGE` (about 70 leaves) | **Shallow forwarders.** Device code holds the full owner `Engine` (`desktop-kit/src/engine.ts:374-376`). | One `device/<cap>.ts` per capability, a closed vocabulary, no owner client. | E3 |
| `passes.rs` (62 lines) | **Shallow.** A `HashMap` in memory. | An identity implementation backed by the Host store: hashed, expiring, revoked when the session ends. | S3, B14 |
| Client tiling `model.ts` (1065 lines) plus `arrange.ts:343-524` | **Duplicated rules and a lossy diff planner.** | Intent commands against the engine's `model.rs`. The client keeps view helpers (`focused`, `entries`, `widthIn`). | E12 |

**Deep modules to leave alone.** Only move them.
- Kernel core: `store.rs` (single writer and receipts), the outbox core, Heard, `methods!`.
- Clients and protocols: `contract/src/engine.ts`; `banda mcp`'s pipe shape.
- Threads internals: `rules` and `writer`, `acp/`.
- App and platform engines: `Hosts<H>`, the git engine, the files engine, terminal, ghostty, the workspaces `model.rs`.
- Client and tools: the menu, `FileLinks` logic, `tools/fake-agent`.

---

## 3. PR plan

### 3.0 The rename: first, mechanical, after draining open PRs

**Decision.** Do it as step R0, right after Phase 0's drain. It is a pure move with no id, crate or package renames.

**Why first:**
1. **Phase 1 creates about 10 new platform crates** (`projects`, `fs`, `git-cli`, `settings-core`, `gateway`, `bytes`, `calls`, `environments`, `keys-core`, `sidebar`, `routes`). Before the rename they would be born in `modules/` or at the top level, then moved again.
2. **The buckets are already decided** at module level (0062 d2):
   - platform: workspaces, harnesses, keys, notifications, problems, sharing, skill, look, settings;
   - apps: agents, browser, files, git, pulls, terminal.

   The splits inside modules (Usage, the gateway, the adapters, Visuals) happen whenever the rename does, so it guesses nothing.
3. **The main builders are Agents, and paths steer them.** One vocabulary in the tree, the docs and the skill cuts wrong-place code.
4. **Pure moves are what git's rename detection handles best.** Moving folders inside content PRs, one by one, breaks blame and leaves two layouts for months; the `app.toml` scan would need both.
5. **Now is the cheapest point.** The open-PR count only grows once Phase 1 starts. ADR 0080's steps already wait for it (0062 Consequences).

**Rejected alternatives:**
- "After the borders": every new crate and every doc moves twice.
- "Incremental": two layouts, and scans that must know both.

**Costs and how they are handled:**
- **13 PRs are open** (#660, #646, #640, #574, #550, #538, #536, #522, #510, #503, plus #557, #460, #385).
  - Drain first.
  - Ship the rename as an idempotent `scripts/layout.sh` (git mv plus sed over a fixed list). A branch that is still open runs the same script and then rebases, so its remaining diff is only its own change.
- **Packaging paths** (electron-builder, asar): a packaged-build smoke test.
- **Ids stay** (`agents`, `banda-agents`, `@banda/agents-pane`), so there is no data risk. The `agents` → `threads` id rename is step T0, done before facts are published, because published names are the expensive ones.

### Phase 0: clear the ground

| ID | PR | Size | Notes |
|---|---|---|---|
| 0.1 | **Drain.** Merge or close the 10 open feature PRs. Close #385 (superseded by 0062). Give #460 the next free ADR number. | — | Not a code PR. #536 and #538 add client-side notification policy that E9 will port; merge them anyway, since they are small. |
| 0.2 | **ADRs (docs only, S each).** (a) 0062 accepted, with a Changes section, d7 replaced by "a tree worked out on the host" (the view-placement verdict) and the `sessions` row. (b) A borders-and-protocol ADR: 3 scopes, 4 kinds, receipts for every command, published facts, durable listeners, intents, Session access, `item`/`call`/`task@1`, frames, bytes, the device road. (c) 0082: Tasks, Units, data lifecycle (proposed). (d) Project environments. | S×4 | (b) gates A3, A5, B7, B8, B14 and H2. (c) gates Phase 4. (d) gates only the container steps. |
| R0 | **Rename.** <br>• `app/{web,desktop,desktop-kit,ui,ghostty}` → `client/…`. <br>• `modules/{agents,browser,files,git,pulls,terminal}` → `apps/…`. <br>• `modules/{workspaces,harnesses,keys,notifications,problems,sharing,skill}` → `platform/…`. <br>• `look/` and `settings/` → `platform/look` and `platform/settings`. <br>• `contract/` → `sdk/contract`. <br>• Subfolders: `engine` → `host`, `pane` → `view`, `desktop` → `device`. <br>Edits follow: Cargo members and paths, pnpm globs, tsconfig, eslint fences, `include_str!` (`engine/src/modules.rs`, `settings/src/lib.rs:65-87`), the skill scan, the `.cargo/config.toml` `TS_RS_EXPORT_DIR`, CI, electron-builder, scripts, `AGENTS.md`, `architecture.md`, and an old→new table in GLOSSARY. | L lines / S risk | **Verify:** `check.sh` (all parts); `banda modules` output byte-identical before and after; `contract/src/generated` unchanged; packaged desktop smoke test. |

### Phase 1: the base architecture

Five tracks.
- A (kernel) and B4/B5 (client) touch disjoint files and can run in parallel.
- Steps that touch the same files go one after another:
  - `Shell` (B4 → B5 → B9);
  - the agents engine (T0 → B7 → B10 → B11);
  - `api.rs` and identity (H1 → H3 → H4).

#### Track A: kernel deepening

None of these change behaviour, unless noted.

**A1 · `kernel.rs` splits; projects, fs and old data leave** · M · deps R0 · leads to A2, H2, H6
- Moves:
  - `kernel.rs:534-712` → `router.rs`; builder, open and `place` → `scopes.rs`.
  - `kernel.rs:801-1230` and `sign.rs` → `platform/projects`. It is a privileged machine-scope module; the method names stay.
  - `reach.rs` and `watching.rs` → `platform/fs`.
  - `old.rs` → `engine/`.
- Verify: tests unchanged; `banda modules` lists `projects`; an arch test checks the kernel has no `sign` or `browse` symbols.

**A2 · The Project list becomes commands and facts** · S-M · deps A1 · `[H]`
- `projects.*` goes through `Store::command` on the machine scope, with receipts. That deletes the ad hoc matching at `kernel.rs:836-845, 873-879`.
- Facts: `projects.added/updated/removed@1`.
- `use-projects.ts` subscribes instead of re-reading on focus.
- Verify: a retried `create` returns the same receipt; two windows see an add.

**A3 · A receipt for every command** · S-M · deps R0, 0.2b
- The rule at `kernel.rs:569` (`right != Read`) becomes the method's kind (`methods.rs:287-297`).
- Inline-IO methods (`files.write`, `rename`, `trash`) keep a receipt; a crash between the IO and the receipt answers `may_have_run`.
- Verify: per App, the same `CommandId` twice gives one effect; reuse for another method is refused (`store.rs:355-387`).

**A4 · Tables by prefix** · S-M · deps R0 · 0062 step 3
- A rusqlite authorizer on the writer and reader connections (`store.rs:74-80, 170`), keyed by the calling module.
- `kernel_*` tables are reachable only through the kernel API.
- A legacy-prefix list per manifest.
- Risk: hidden cross-table reads surface as test failures. Each one is fixed or marked unstable.
- Verify: a test module that reads `kernel_receipts` or `agents_threads` is refused.

**A5 · Durable listeners** · M · deps R0, 0.2b
- `kernel_cursors(listener, source_scope, seq)`.
- `listen(name, filter)` resumes from the stored seq. The ack is written in the same transaction for the same scope; across scopes it uses `CommandId::derive(listener, event_id)`.
- git (`lib.rs:187`), agents, pulls and sharing move off `react(head)` (`project.rs:806-817`). Sharing's private cursor and outbox (`sharing/engine/src/outbox.rs`) are deleted.
- Verify: a crash test (emit, kill before the reaction, restart) shows the reaction runs once.

**A6 · Outbox garbage collection; safe `banda mcp` retries** · S
- Done rows and receipts older than 30 days are deleted (`store.rs:44-68` has no `DELETE` today).
- `mcp.rs:321` uses `CommandId = derive(pass, MCP request id)`.
- Tools are listed again when `welcome` changes (`mcp.rs:280-293`).

**A7 · One place starts programs** · M · deps R0
- `kernel/src/environment.rs` and `platform/environments::Local`. `Program` gains `cwd`.
- Spawn sites that move onto it:
  - harnesses: `acp.rs:89-91`, `cli.rs`, `limits/codex.rs`;
  - terminal: `terminal.rs:59-78`, `servers.rs`;
  - git: `run.rs:351`;
  - files, pulls and problems: `files/lib.rs:233-249`, pulls' `lib.rs` and `github.rs`, problems' `issue.rs`.
- Bookkeeping git goes through the hardened `platform/git-cli`.
- Leads to the D3 supervisor and the D9 container.
- Verify: an arch test bans `std`/`tokio`/`pty_process` `Command` outside `banda-environments`.

#### Track S: the engine outlives the window `[W][H]`

**S1 · Harness adapters run on the host's Node** · M · deps R0
- `platform/harnesses/device/{adapters.mjs, claude-sdk.mjs, src/sessions.ts}` → `platform/harnesses/adapters` (a host package).
- `banda serve` finds Node and the adapters itself (`list.rs:93-110, 627-645`). Electron stops passing them (`client/desktop/src/main.ts:145-153`).
- Verify: `banda serve` started from a shell, with no Electron, runs fake-agent turns and one real smoke turn with the ADR 0078 session store.
- Risk: which Node a headless install ships.

**S2 · Host work leaves the window** · S + S · `[H]`
- (a) `harnesses/device/src/usage.ts` → `limits/claude.rs`, using HTTPS and the host's credentials. Delete the `claude_usage` road request (`limits/claude.rs:46`).
- (b) `sharing/device/src/post.ts` → a host effect in the kernel outbox (`net`). Delete sharing's device part.
- Verify: limits and sharing work with the window closed.

**S3 · The engine is the machine's service** (#460, 0062 d19, 0081 step 1) · L, as S3a, S3b and S3c · deps S1, A6
- (a) A systemd or launchd unit, a stable port, a verified binary with a build id, `banda status|stop|open`. Electron attaches; `--with-parent` (`engine.ts:86`) stays for dev and e2e only. The device picks its own sockets and files (`serve.rs:96-105`).
- (b) Passes are persisted, hashed and expiring.
- (c) Every call an Agent makes to Banda carries the Agent's own pass, and owner access is narrowed.
- Verify: close the window and a turn goes on; restart the engine and Agents' passes survive.

#### Track B: borders

**B1 · One list of Apps** · M · deps R0 · leads to B2, B5, B7, B14, H1
- `module.toml` → `app.toml`, adding `kind = app|platform`, `api` and an empty `[needs]`.
- `engine/build.rs` scans and generates `apps.rs`: the serve list, `banda modules` `FILES` (`modules.rs:43-111, 367-381`), the settings files and the `window.json` includes.
- It also generates the client lists (`client/web/src/modules.ts:6-23`, `client/desktop/src/modules.ts:9-56`) and `sdk/contract/src/methods.ts:9-38`.
- Cargo dependencies stay explicit; a test checks they match the scan.
- Verify: drift tests.

**B2 · Settings stand on a leaf crate** · M · deps B1 · `[W][H]`
- `banda-settings-core`, built from `look/src/{file,keyed}.rs`, `theme::Places` and `settings/src/write.rs`.
- The 10 crates switch from `banda-look` to the core.
- `banda-settings` drops its 6 App deps and the `include_str!` list.
- Verify: a cargo-metadata test shows settings, look and keys have no App deps; a `banda settings` snapshot is identical.

**B3 · The Agents' bridge is the platform's** · S-M · deps R0 · leads to B11, B14, D7
- `platform/gateway`: `Gateway::session{thread, agent, project, tools}` → `McpServer` wraps the `Pipe` (`agents lib.rs:103-128`) and pass minting.
- `acp/opening.rs:75-90, 129` asks the port.
- Passes carry `thread`.

**B4 · `Shell.tsx` splits** · M-L · deps R0 · client only
- The split as in §2.
- Thread features move to `apps/agents/view` through actions and a "listed thing" menu slot: `actions.ts:740-797` and `titles/ThreadMenu.tsx`.
- Verify: window e2e, `motion.spec.ts` timings unchanged, `Shell.tsx` ≤ 400 lines, and the shell imports no `apps/*/view`.
- Coordinate with the flow (ADR 0079) and snooze PRs.

**B5 · Extension points any App can fill** · M · deps B4
- `threadDetails` becomes a general `details` slot of typed rows.
- A Pane header slot: `ThreadMark` leaves the `PaneFrame.tsx:53` and `Overview.tsx:21` imports of `sidebar/Row`.
- `[[settings]]` in `app.toml` replaces the hard-coded `sections.ts:145-200`.
- The harness list and sign-in move to the `harnesses` view; `settings/Agents.tsx` is deleted.
- Verify: `CEILING` goes from 2 to 1.

**T0 · `agents` becomes `threads`** · M · deps B1, A4 · before B7
- New id, folder `apps/threads`, crate `banda-threads`.
- Old names stay readable:
  - methods: `agents.*` is an alias for one release (CLI, `keys.toml`, the skill);
  - events: module `agents` is read as `threads` (`was = ["agents"]`);
  - tables: `agents_*` stay, as a declared legacy prefix;
  - Panes: `agents.thread` is upgraded through the pane-upgrade hook.
- Verify: a fixture of an old state folder opens, with its Threads, Panes and keys.

**B7 · Published facts** · M · deps T0, A5
- `facts!` with `kind@major`, `private` and `gate`.
- The registry keeps the schemas; `[needs] listens` is checked; a `listen` on an undeclared or private kind is refused.
- `sdk/contract/released/<app>/` snapshots, with a CI check that changes only add.
- The kernel-owned `item@1`, `call@1` and `task@1` types.

**B8 · Intents; the tiling names no App** · M-L · deps B7 · leads to B9, B10, E10, H7
- `sdk/intents`: `show.thread`, `show.diff`, `show.file`, `open.address`, `open.file`, `run.command`, `thread.new`, `notice.post`, `compose.text`, `task.cancel` (all `@1`).
- Registry resolution: the target's App, then `intents.toml`, then the only handler, then `ambiguous`, then `no_handler`.
- Agents' `open_pane` becomes `show(verb, args)` → `PaneSpec`.
- Deleted: `AGENT_KINDS` and `web_address` (`workspaces lib.rs:117-139, 739-747`), and the upgrade at `model.rs:159-172`, which becomes git's hook.
- The `http(s)` check moves into `browser.open_address`.
- `runs_as_person` refuses Agents.
- Verify: no App ids under `platform/`; e2e where an Agent opens a diff, a file and a page.

**B9 · The client calls by intent** · M · deps B8
- String calls are replaced in the shell, `actions.ts`, `menu.ts` `ROOT_ACTIONS`, `Mod.tsx` and the panes (`browser.open`, `terminal.open`, `files.find`, `agents.*`).
- Module singletons (`git ended.ts`, `browser threads.ts`, `teller`) get a handle from `start()`.
- Verify: a lint bans other Apps' method strings in views.

**B10 · git and Threads stop knowing each other** · M · deps B7, B8, A5
- `threads.turn.began@1` with `gate 5s`, which replaces `REACTED` (`effects.rs:170, 225-228`).
- `Scope::Turn` becomes `Span{origin}` (`git model.rs:136`), with ref paths by origin hash; old refs are read both ways.
- `git.acted` becomes `git.committed@1` and `git.pushed@1`; notices go through `notice.post@1`. The `notices.rs:16-42` hearing is deleted.
- Verify: checkpoint e2e; the threads crate's `listens` names no git kind.

**B11 · pulls hears one fact per tool call** · S-M · deps B10, B3
- `threads.tool.ran@1` is normalised in `acp/`.
- `heard.rs:121-176` is rewritten against it.
- `link` reads the Thread from the Session; `pulls_agents` is dropped; the remote comes from the query `git.remote@1`.

**B12 · Deltas leave the log** · M · deps B7 · needed before relay (H10)
- `transcript/output.rs:97-101` → the `threads.live` stream; the log keeps one complete item at the end.
- `thread.ts` folds the live stream plus log items, and the parity checkpoints are updated.
- Risk: medium (resuming mid-turn). This step may slide to D7.

**B13 · `item@1`** · M · deps B7, B5 · `[H]`
- `Listed` (`pane.ts:229-268`) becomes `Item` plus an App extras slot.
- Groups are keyed by `owner` (`groups.ts:119-134`).
- threads emits `item@1`.

**B14 · One access rule** · M-L · deps B1, B3, B8 · `[W][H]`; it is the wall that matters once the listener leaves loopback.
- `Session{person, actor, via, scopes, only, expires}`; access = right ∩ capability ∩ scopes ∩ wall.
- An Agent pass's scopes are its namespaced tool list.
- The wall is checked on the resolved ProjectId; the self-filtering at `kernel.rs:700-710` goes; tool names are checked unique (`kernel.rs:201`).
- First-party capabilities are declared and granted silently.
- Verify: one test for each access item tracked privately (see SECURITY.md).

#### Track E: a host that may be elsewhere `[W][H]`

**E1 · The byte host** · M · deps A1
- `platform/bytes`, a Rust port of `FileLinks` and its tests (`files.test.ts`, `preview.test.ts`).
- `bytes.read` streams over the same connection.
- `app://files` becomes a proxy.
- Verify: Quick Look e2e.

**E2 · Thread media and paths come from the host** · M · deps E1
- `apps/threads/device/src/index.ts:26-43` and `paths.ts` → `threads.media` and `files.{resolve_paths, exists}`.
- `folderOf` and `wholeIn` are deleted (`files.ts:274-290`).
- Device actions take `{host, project, path}`; drag-out is offered for a local host only.
- Verify: an arch test that `client/desktop` reads no Project path.

**E3 · The device road** · M-L · deps S3
- `window.rs` → `devices.rs`.
- `road.ts` registers capabilities.
- `main.ts:296-476` → `device/{files,edit,folder,update,menu}.ts`; the `BRIDGE` → `client/core/device.ts`.
- Browser tools are sent by target, and the site policy moves to `apps/browser/host`.
- Verify: with two windows, requests reach the targeted one; with no device, the refusal is `no_device`.

**E4 · Settings through the API, each file by its owner** · M-L · deps B2, E3
- `settings.*` methods.
- `client/desktop/src/settings.ts:159-212` stops spawning the CLI for host and Person files.
- A device store keeps zoom, the device theme and the Person's browser.
- `agents.toml` is cut in two (`flow` and `enter` go to the Person's file; `start.*` stays the host's), and so is `browser.toml`.

**E5 · The look from the API** · M · deps E4
- `look.follow{device facts}` is resolved on the host by the same pure crate.
- `banda look --follow` (`look.ts:256-275`) is kept for the device overlay only.
- The resolver as WASM is deferred.

**E6 · Two small moves** · S + S
- `problems.record` from clients (`problems lib.rs:44-45` tails `window.log` today).
- `pane.left@1` emitted on the host: `Shell.tsx:425-433` and `TerminalPane.tsx:96-101` go, and so does `PaneKind.closed`.

**E7 · The Person's marks live on the host** · M · deps B13
- `seen.ts:12`, `archived.ts:18, 78` and `snoozed.ts:35` become threads commands, stored in the Project (borders, open question 1: Roma confirms Project versus Person).
- localStorage marks are imported once.

**E8 · Calls on the host** · M-L · deps E7, B7, A5 · 0081 step 7
- A host-wide listener over every local Project's published facts (amends ADR 0040 d3).
- threads emits `call.raised` and `call.cleared` in the same transaction, using `markOf` and `attentionOf` ported to Rust; the TS tests are ported too.
- `platform/calls` serves `calls.inbox`.
- `Watches.tsx` and the `Watch` type are deleted.

**E9 · Who is told is decided on the host** · M · deps E8, E3
- `teller.ts:113-172` → `platform/calls`.
- `device.presence{front, sight, quiet}`; device `notify` and `sound`.
- The notifications package becomes a device adapter.

**E10 · The commit run lives on the host** · M · deps B8, B10
- `git_runs` plus outbox steps with `derive(run, step)`, `compose.text@1` and `notice.post@1`.
- `chain.ts` is deleted.
- Verify: close the window mid-commit and the commit still completes.

**E11 · `files.activity` on the host** · S-M · deps B11
- Replaces `files/view/src/live.ts`.

**E12 · The tiling's rules move into the engine, one key at a time** · L, as a series of S PRs · deps B8 · `[H]` latency only
- `arrange.ts:343-524` → `workspaces.{open, move, size}` with look values as args and `expect{seq}`; pipelined.
- `model.ts` shrinks to view helpers.
- Verify: `motion.spec.ts` is no slower; a property test checks client view = engine state over random key sequences.

#### Track H: several machines

**H1 · Versions are agreed** · S · deps B1 · `[W][H]` · 0081 step 3
- A range in `hello`; `welcome.apps[{id, version, api}]`.
- `PROTOCOL` comes from ts-rs: today `api.rs:293` matches exactly and `engine.ts:12-13` copies it by hand.

**H2 · Three scopes** · L · deps A1, A5, B1, 0.2b · `[H]`
- `state/machine` splits:
  - `state/host`: harnesses, problems, sharing, passes;
  - `state/person`: workspaces, keys, sidebar, `intents.toml`, the directory, with an epoch.
- The migration copies tables by owner and keeps the old machine log read-only.
- Verify: an old state folder fixture opens.

**H3 · Keys and pairing; `hello` by signature** · L · deps S3, B14 · `[W][H]` · 0081 step 2
- `authenticate(hello, challenge)` → `Session`, with three implementations: the owner secret, passes, and Ed25519 device keys.
- Pairing by code or QR; one PersonId; WebCrypto keys for browsers.

**H4 · A transport port, and routes beyond loopback** · M-L · deps H3, B14 · `[W]` (remote) `[H]`
- `api::serve` takes a generic `Sink + Stream<Frame>` (`api.rs:286`).
- Routes: ws, `ssh-stdio`, `direct` TLS.
- Credits, `ping`/`pong` with heads; the CSP is built from the host list.

**H5 · The client's Hosts router** · M-L · deps H1, then H4 · `[W][H]`
- `client/core/hosts.ts`.
- An `AddressSource` replaces `window.banda.engine()`.
- `PaneProps.engine` = `hosts.for(address)` (`pane.ts:99-141`).
- Each host is `live`, `stale(as_of)` or `away`; commands to a stale host fail fast.

**H6 · The directory** · M · deps H2, A2 · `[H]`
- `ProjectId → {host key, …, epoch}` in Person scope, filled from `projects.located@1`; tombstones answer `moved{to, epoch}`.

**H7 · Host to host** · L · deps H2, H3, H4, B8 · `[H]` · 0081 step 6
- A paired-host session.
- Every host follows the Person log into a read-only replica (`not_home`).
- The home host follows `show.*@1` and places Panes with `PaneId = derive(event)`.
- `delegable` methods travel by delegated pass.
- Verify: a two-`banda serve` test harness.

**H8 · The merged Inbox and push** · M · deps E8, H5, H7 · `[H]`; `[W]` for push
- The client merges `calls.inbox` per host; Web Push from the host.

**H9 · The CLI names its host** · M · deps H3, H4
- `hosts.toml`, `banda hosts …`, `--host`.
- `banda project add` and `banda files` resolve on the host; `banda menu` goes through the device road.

**H10 · iroh routes** · L · deps the 0081 step 4 spike · `[H]`; `[W]` remote
- `platform/routes` over iroh, plus iroh-in-WASM or the SNI edge for browsers.

### Phase 2: the look

**L1 · The look crate is only the look** · M-L · deps B2, E5
- Waits until ADR 0071 step 5 (the key sheet by scope) lands, to avoid fighting #660's follow-ups.
- Splits as §2 describes. The keys host part goes to Person scope with registry manifests.
- Verify: snapshots of `banda look` and `banda keys` are identical.

**L2 · ADR 0080's steps** (feature PRs, cited as they are)
- `theme.toml` `extends`, one token list generating CSS and a TS object, the radius ladder check, glass as a variant, platform adapters out of `theme.rs`.

**L3 · `@banda/ui` becomes `@banda/sdk` and `@banda/kit`** · M-L · deps B4, B5, B13
- The split from §2. View packages are renamed (`-pane` → `-view`) in this same sweep of import specifiers.
- A lint bans deep imports.

### Phase 3: the web client (0081 step 8)

**W1 · The page runs without Electron** · M · deps E1–E5, H5
- `client/web/src/main.tsx` (`:16`, `:59-64`) starts from an `AddressSource` and a `Device`.
- About 30 files' `window.banda?.x` calls become `WindowApi.device`, whose capabilities are visibly present or absent.

**W2 · The host serves the client** · M · deps W1, H4 (direct)
- Hashed assets, a web manifest, a Service Worker turning `banda://` into `bytes.read`, and a pairing page.

**W3 · The browser device adapter and Web Push** · M · deps W2, E9, H8
- `notify`, `clipboard`, `pick_file`, `open_outside`; `device.register{push}`.

**Shortest path to the web client** (one host; a tab on the LAN):

R0 → S1 → S3 → H1 → E1 → E2 → B2 → E3 → E4 → E5 → B14 → H3 → H4 (direct) → H5 → W1 → W2 → W3

E7–E9 are needed for the Inbox and push.

H2, H6, H7, H10 and E12 are not needed for the web client. If Roma wants the web client sooner, they can slide after Phase 3 without breaking anything.

**Path to several hosts:** the web-client path minus W, plus A2, A5, B7, B8, B13, H2, H6–H9. B12 is needed for relay bandwidth, H10 for NAT, and E12 for a remote home host's latency.

### Phase 4: the SDK road (0062 steps 9–13, 0082, isolation)

| ID | PR | Size | Deps |
|---|---|---|---|
| D1 | A data-shaped `Tx`. Outcome as data. `#[derive(Module)]` (right, tools, call, stream). Lifecycle hooks become listeners. | L | A4 |
| D2 | Outbox leases (`worker_id`, `lease_until`); a policy per kind (`until`); workers as processes with a `via = app` pass | M | D1 |
| D3 | `platform/supervisor` from `hosts.rs` (host → Unit); `servers.rs` becomes an observer; `units.*` | M | A7 |
| D4 | Migrations by hash (`kernel_migrations`); a refusal blocks one App, not the Project (`store.rs:435-439`) | M | — |
| D5 | `sdk/wit`, `platform/runtime` (wasmtime), `sdk/app`. **Usage** becomes `apps/usage`, the first App on the outside road. | L | D1, D2, D4 |
| D6 | Level 1: `sdk/ui` (Tree, diff), the `view` kind, `platform/views`, the `client/core` renderer, Usage's view; `UsagePane.tsx` is deleted | L | D5 |
| D7 | Harness sessions as a capability (`sessions`) served by harnesses: Threads drops the in-process `Harnesses` value (`serve.rs:44, 63, 68`). HTTP gateway (isolation's door). Visuals become MCP App cards. `client/frame` from `visual-frame.ts`. Issues go to problems. | L | B3, D2 |
| D8 | Tasks (`kernel_tasks`, `task@1`); turns and git runs become Tasks | M | E10 |
| D9 | Isolation: the container adapter, device browser profiles per Project | L | A7, D3, D7 |
| D10 | Web Apps, the installer, export and import, compositions | later | — |

---

## 4. What not to refactor now

- **The Threads pane's fold** (`thread.ts:158-519`, about 30 kinds). It stays until host view patches or the `<Thread>` live component (D6/D7). Parity tests keep it honest.
- **`model.ts` wholesale, or a Rust model compiled to WASM.** Move rules one command at a time (E12), and only when a remote home host is measured. Tiling motion and input stay untouched (the perf plan).
- **The deep internals.** `rules` and `writer`, `acp/`, the store and outbox cores, git, files and terminal engines, ghostty, `FileLinks` logic (port it, don't redesign it).
- **The Person's browser in Electron** (webviews, extensions, blocker, downloads). It is correctly device code. Only Agents' driving and policy move.
- **Merging pulls into git** (borders, open question 7), or splitting the files pane (13.9k lines) beyond bytes and activity.
- **Data at rest.** Table prefixes, logs and old event kinds are not renamed, and SQLite stays. Promise export, not Postgres.
- **The runtime before its contract.** No WIT, wasmtime, ComponentizeJS, JS isolates, CBOR or Level 2 frames before D1's data-shaped `Tx` runs first-party Apps.
- **Generic live queries or a reactive engine.** 10 of 14 sources already "read again on event" cheaply.
- **The reader pool** (R3-31), unless contention is measured.
- **Cross-host scope creep.** No Agent-to-Agent work across hosts, no cross-Project delegation, no Person-scope Apps from elsewhere, no namespaced third-party ids, no composition language. All of these are deferred in 0082 and the borders design.
- **Splitting `look.toml` by owner** beyond `agents.toml` and `browser.toml`. That comes with ADR 0080, not before.
- **Banda Cloud services, and `infra/`.** Nothing until 0081 step 9.