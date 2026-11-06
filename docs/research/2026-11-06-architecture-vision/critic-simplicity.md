# Critique: simplicity, product fit and cost

Input to [the vision](../2026-11-06-architecture-vision.md) (2026-11-06). Roma's decisions are in its §11 and override this document where they differ.

## Summary

The core in the code is sound. The proposed architecture around it is built for a distributed OS platform that has no users yet.

- **Keep:** the store, the outbox, `methods!`, one writer per record, the engine signing its own sessions, calls worked out on the host, and the device road.
- **Cut or defer:** the Person-scope replica with epochs, WASM handlers inside the transaction, the host view-diff service, the intents governance, and Tasks/Units/delegation. All of these are two-way doors that the designs build now as if they were one-way.
- **The most serious problem is in today's code:** an Agent with a shell works with the Person's own Unix rights. Every access design is moot until a fence or a box keeps Banda's state, keys and owner access out of its reach (W1).

### The cost is not lines of code

| Measure | Value |
|---|---|
| First commit | 2026-10-31 |
| Commits | 627, about 100 a day (`git log`) |
| Accepted ADRs | 77 |
| Code | about 190k lines (modules 102k, app 66k, `kernel/src` 7.5k) |
| Open PRs | 13 (`gh pr list`) |
| GLOSSARY terms today | about 69 |
| New nouns the four designs add | about 45 (Person scope, epoch, handoff, replica, directory, tombstone, Address, Ref, intent, verb namespace, `intents.toml`, published/private fact, gate, cursor, `item@1`/`call@1`/`task@1`, via, grant, enable, Place, Environment, door, `banda-run`, Unit, Task, delegation, the `peer` and `delegable` marks, view kind, Tree, catalogue, slot, client act, PaneSpec, presence, `not_after`, `expect`, `as_of`, credit, Automation…) |
| PRs in the refactor plan | about 70, about 15 of them L |

What is actually scarce:
1. Roma's decisions.
2. Coherence between ADRs. Draft 0062 already reverses six ADRs with no Changes section, and PR #460's number collides with an ADR on main.
3. Correct distributed and concurrent behaviour. Agents write this subtly wrong, and it is hard to test.
4. How the tiling feels.

Every cut below follows from those four.

---

## 1. Strengths to keep

| Strength | Evidence | Why keep it |
|---|---|---|
| The store: one writer, receipts, events and outbox in one transaction | `kernel/src/store.rs`; refused commands keep their receipt (`kernel.rs:582-586`) | A deep module. Everything else stands on it. |
| An outbox ordered per key, with settle and recovery | `outbox.rs:97`, `:306-311` | Already a job queue. No workflow engine is needed. |
| `methods!` as the one declaration (right, dispatch, TS, tool, schema), with a drift check | `kernel/src/methods.rs` | It is what keeps a one-person team coherent. |
| The TS `Engine` client: resume by seq, safe retries | `contract/src/engine.ts:85-95` | Already the "stateless resume" the protocol wants. |
| One writer per record, no CRDT (0081 d1) | — | The right simplification. Do not dilute it with replicas (see §2). |
| The engine signs its own sessions; a route list (0081 d2-d4) | — | T3 Code proves the route list: direct, Tailscale, SSH and Connect "change how the client reaches that server; they do not introduce another execution model" (`t3code/docs/internals/remote.md:3-6`). |
| Addresses have no host | A Pane is `{project, kind, args}` (`modules/workspaces/engine/src/model.rs:147-157`) | A one-way door that is already right and costs nothing. |
| The Harness process pool | `modules/harnesses/engine/src/hosts.rs:1-30`, 366 lines | Deep. Leave it as is; do not grow it into a systemd clone. |
| Terminal split: PTY on the host, ghostty WASM on the client | — | The pattern every live component should copy. |
| `FileLinks` byte design: HMAC, inode, Range, nosniff | `app/desktop-kit/src/files.ts:128-243` | Port it unchanged. |
| Fail fast offline, `as_of`, `not_after` (borders §5) | — | Small and exactly right for a phone. |
| "A view is a read method whose answer is a tree" (verdict §3.2) | — | The best idea in the view design: no new runtime concept, and `banda call … \| jq` prints it. |
| "Bookkeeping never runs Project content" (isolation §2) | — | Cheap hardening (F2). Do it now. |
| Unstable marks under a ceiling that only falls | `CEILING = 2` | Makes platform debt visible at almost no cost. |

## 2. Weaknesses, ranked

**W1 · Critical (today's code). On a non-isolated host, Banda's access checks are rails, not a wall.**
- An Agent with a shell works with the Person's own Unix rights on the computer.
- So `Right ∩ capability ∩ scopes ∩ wall` (borders d8, plan B14) is theatre on a non-isolated host.
- A security item about this is tracked privately (see SECURITY.md); its fix is F0.
- **Fix:**
  - State the trust model in an ADR: on a non-isolated Project, an Agent has the Person's Unix power. Banda's checks are rails for correctness and UX, not a wall.
  - Put the security budget into the box: run Harness CLIs and terminals in a container with the state folder not mounted.
  - Give every `banda` call an Agent makes the Agent's own pass. That narrows accidents, not attacks.
  - Cut B14 down to two things: passes limited to tools, and the Project wall. Nothing more until the box exists.

**W2 · High (borders §5, d1, d12; plan H2/H6/H7, sizes L+M+L). Database replication before a second host exists.**
- The designs build a Person-scope log, read-only replicas, epoch handoff, `take --force`, host sessions, delegated passes and a replicated directory.
- Roma's own notes say the opposite: "federate control, not databases … at first no DB sync between nodes" (`notes/13:7,14`), and "avoid prematurely implementing full headless or distributed support" (`notes/01:17`).
- It will break: the laptop is the default home and is the host most often asleep. A forced take loses arrangement edits made offline (the borders design admits "may be lost").
- **Fix: the client is the only integrator in v1. Hosts never talk to each other.**
  - The client merges `calls.inbox` per host and keeps the ProjectId→host map from each host's `projects.list`, plus `moved{to}` tombstones.
  - It reads `show.*@1` from host B after a cursor kept on the home host, and sends `workspaces.place{event_id}` to the home host. `PaneId = derive(event_id)` keeps it idempotent.
  - A Pane is only visible while a client is open, so placing it when a client connects loses nothing.
  - Person data (themes, `keys.toml`, the arrangement) lives only on the home host, marked `owner = person` in the manifest. Changing the home host is an explicit export and import.
  - The door stays open: the facts and event ids are the same when host-to-host follows arrive later.

**W3 · High (0062 d4, d14; plan D1, D5). Outside App code as WASM inside the single writer's transaction.**
- This means wasmtime, a WIT world, ComponentizeJS (a SpiderMonkey per TS App) and fuel and write budgets (borders open question 4).
- Every command of an outside App would hold the Project's only writer, which Threads' turns also queue on.
- Handlers may not do IO, so any check against another App's data has to move to a worker anyway.
- **Fix: the handler runs out of process and returns data.**
  - The kernel forwards a command to the App's worker. The worker speaks the public protocol with an App pass, the same mechanism as the device road (register, request, answer with a deadline).
  - The worker answers `tx{statements, emit, enqueue}`. The kernel commits it with the receipt under the prefix authorizer.
  - Commands are queued one at a time per (App, scope). Since only the App writes its own tables, no read-then-write race exists.
  - This is the "syscall table as data" the designs already want. WASM can come later as a second binding of the same contract.
- Precedent: VS Code's out-of-process extension host made Remote cheap years later. Zed's WASM-first API is still narrow (languages, themes, slash commands, context servers) and has no panels.

**W4 · High (plan Phase 4; 0062 plan 9-13). The SDK is fully specified but built last.**
- About 20 SDK decisions would be frozen with no outside App using them.
- Roma's notes propose the opposite test: "create a tiny app through an agent, install it, customize it… then connect two with a composition" (`notes/09:7`).
- **Fix:**
  - Build a tracer-bullet App now: Habits or Usage, as a worker using `tx` and a tree view.
  - Accept 0062 only for its words, layers and places. Leave d4, d5, d7, d14 and d15 "proposed" until the tracer passes.

**W5 · High (verdict §3.3-3.5, 10a-10e). Level 1 as a wire catalogue of the whole of shadcn, plus a host diff service.**
- The work: `banda-ui` diff and fallback, `platform/views` (cache, debounce, a fallback per client), about 35 renderer components, client acts, pending marks, the focused-field rule, and RN parity later.
- That is about 50 prop schemas to version for one Pane: Usage (`UsagePane.tsx`, 477 lines, view state is one `useState` at `:103`).
- Raycast succeeded with about 6 primitives (List, Grid, Detail, Form, ActionPanel, MenuBar).
- **Fix:**
  - v1 view = a query that returns a Tree. The client reads it again on each event; `use-live`'s read-again pattern already serves 10 of 14 sources.
  - Start with a Raycast-sized catalogue. No patches, views cache or host fallback until a measured tree is large or fast.
  - The frame host already speaks MCP Apps words (`modules/agents/pane/src/visual-frame.ts:1-8`). Make it the rich-UI path from day one: an SDK App that wants HTML ships an MCP server with `ui://`.

**W6 · High (plan §3). The order puts renames and borders ahead of what the Person feels.**
- R0 is a dependency of A1-A7, S1 and B1. "Drain 13 PRs, then rename" stalls a factory that commits about 100 times a day.
- **Fix:**
  - Remove R0 as a dependency. New crates are born in `platform/` and `apps/`; scans glob both layouts.
  - Skip T0 unless facts get published under the module id. It means aliases forever, for a name the UI can show anyway.
  - Critical path: S1 → S3 → W1 mitigation → E7-E9 (calls and push) → E3 → E1 bytes over HTTP → E4 → H1 → H3 → H4 (ws, ssh, direct) → H5 → W1-W3.

**W7 · Medium-high (borders §3.2, d7). Intent governance for about 6 first-party verbs, each with one handler.**
- Namespaces, `intents.toml`, `ambiguous` pickers, major negotiation, and `compose.text` and `notice.post` as intents, where only Threads can provide either.
- **Fix:**
  - `show(verb, args) → PaneSpec`, resolved to the only handler from the manifests. That deletes `AGENT_KINDS` (`workspaces/engine/src/lib.rs:117`).
  - git → Threads becomes a named call with `requires`.
  - Defaults and pickers come when a second handler exists.

**W8 · Medium (0082 A-F). Seven subsystems with one consumer or none.**
- `kernel_tasks` plus the boot rule, delegation through a `peer` mark, Units and the supervisor, migrations by hash, NDJSON export, the `compose` interpreter, App replace and fork.
- **Fix:** defer all of it, but keep two small pieces:
  - per-App migration refusal (`store.rs:435-439` refuses the whole Project);
  - the `banda mcp` CommandId derived from the request (`engine/src/mcp.rs:159` uses `CommandId::new()`).
- When cross-host delegation comes, copy T3: the linking host becomes an MCP client of the other host's `/mcp`, with a mode-limit header and namespaced idempotency keys (`t3code/docs/internals/remote.md:70-100`). No new peer protocol or mark.

**W9 · Medium (isolation §8). Isolation v1 is too wide, and the plan schedules it last (D9).**
- Its v1 includes the HTTP door, `banda-run` (static musl in CI), environment sign-ins with transcript over-mounts, the devcontainer sanitizer, and git one-time grants.
- **Fix: v1 isolation is**
  - A7 (one spawn chokepoint, 10 `Command::new` sites today);
  - a Linux docker/podman adapter with `--network host` and same-path mounts;
  - Harness CLIs and terminals inside the box;
  - the `banda` binary mounted read-only, so stdio `banda mcp` inside reaches 127.0.0.1 with a pass;
  - the state folder not mounted, which closes W1 for isolated Projects;
  - the account folder mounted as an opt-in.

  Ship `persist:project-<id>` on its own as an S-sized PR.

**W10 · Medium (0081 d4; borders §4). The transport is built before the routes that already work.**
- iroh, iroh in WASM or the SNI edge, one QUIC stream per Banda stream, and `bytes.read` through a Service Worker. A Service Worker cannot use the page's WebSocket, so it needs its own authenticated connection.
- **Fix:**
  - ssh and direct routes first. A tailnet with `tailscale cert` gives the PWA a secure context and Web Push. T3 ships a `tailscale` package.
  - Bytes are a plain `GET /b/<token>` on the host, so `<img>` and `<video>` Range just work.
  - iroh comes after the phone works on a tailnet.

**W11 · Medium (plan E12). Moving tiling rules into the engine one key at a time.**
- This costs local feel, or brings back a WASM duplicate of the model. It only pays off for a remote home host.
- **Fix:**
  - v1 home host = the machine you sit at.
  - Keep `model.ts`.
  - Fix the lossy diff (`arrange.ts:343-524`) by sending intent plus result with `expect{seq}`.

**W12 · Medium (borders §2, §4). "Commands from one connection to one scope commit in order".**
- The API spawns a task per call (`kernel/src/api.rs:364-378`), so no order exists today.
- Enforcing order per scope would make a slow `git.act` or `files.write` block the next tiling key.
- **Fix:** `expect{seq}` on `workspaces.*` only.

**W13 · Medium (borders d5). Version governance for 3 first-party couplings in one repo.**
- `down` functions, released snapshots, a CI additive check, and gates declared on both sides.
- **Fix:**
  - Keep `kind@major` names, typed payloads, durable cursors (they fix a real loss: `git/engine/src/lib.rs:187` reacts from head) and gates (they replace `REACTED`, `agents/effects.rs:170,227`).
  - Add snapshots when the first outside consumer appears.

**W14 · Low (0081 d15).** Enterprise from the first day: organisations in `api`, a Helm chart, region as a setting. It costs only attention while unbuilt. Make sure no engine design pays for it now.

### How comparable products grew

| | How it grew | Lesson for Banda |
|---|---|---|
| **T3 Code** | Server plus web app from the start: `t3` starts the server and opens the web app, `t3 service install`. Desktop and mobile are clients. No plugin SDK ("fork and build the editor that you want", README). Cross-environment work is an MCP peer link. | Web-first client and service first. Hackability by source. MCP for cross-host Agent work. |
| **Zed** | Core and feel first. SSH remote with a headless server. WASM extensions with a narrow surface. | WASM-first grows slowly: every extension point is a WIT change. |
| **VS Code** | Out-of-process Node extension host, unsandboxed. TreeView as data, webviews as frames. Remote came about 3 years in, cheap because extensions already spoke RPC. In a container, VS Code's server runs inside the box. | Out-of-process plus the public protocol is remote-ready from day one. Data views plus frames. |
| **Raycast** | Node plus React with a tiny native catalogue. A reviewed public monorepo store. No sandbox. | A small catalogue is what made it work. Start Level 1 small. |
| **Home Assistant** | A tiny core: event bus, state machine, services. Unsandboxed Python integrations. Custom UI as client-side web components. Add-ons as containers that talk to the API with a token. Remote access as an optional paid service (Nabu Casa). | Low ceremony grew the ecosystem. Containers for isolation. A worker with a token is the add-on model. |

## 3. Contradictions between the designs

1. **Task.**
   - A kernel table, `kernel_tasks` with a boot rule (0082 A1, plan D8).
   - A fact language Apps emit with no table, `task@1` (borders §3.1, d9).
   - "An SDK shape, not kernel content" (digest §2.1).
2. **Work across hosts.**
   - Borders d12: hosts link only by two follows; no App calls another host's App; Agent-to-Agent waits for Person-scope grants; a `delegable` mark.
   - 0082 A4-A5: peer sessions, `peer`-marked Threads methods, a Project-level `threads.allow`, resolving a Project by asking peers.
   - So there are two marks, two places for grants and two resolvers.
3. **The host-to-host session.** Borders: a host pairs as a device of kind `host` with follow scopes. 0082: a peer session signed by the host key. 0081 defines neither. Notes/13:14 forbid database sync in the first stage, and the Person replica is database sync.
4. **Isolates.** Borders `runtime` still supervises "view isolates" (§1 platform table, §8 Q8). The verdict says "no JavaScript isolate on the host". 0062 d7 still reads "React runs on the host in a JavaScript isolate (Roma, 2026-11-06)". Roma's own wording is being overturned and must be decided explicitly.
5. **Three supervisors.** Borders `runtime` ("one supervisor", `Place`), 0082 `platform/supervisor` (`Spec.place`), and isolation `platform/environments` (a pool keyed `(ProjectId, "env")`). The plan reconciles them in prose but keeps three crates.
6. **Sandboxing Apps.** Isolation §6 says Apps are isolated "by WASM and capabilities, not by environments". Borders §7 defers "OS sandboxes for third-party workers". That OS sandbox is isolation's own `sandbox` adapter, and neither design reuses it.
7. **Compositions.** Borders §3.6 and §7 defer a declarative language. 0082 E1-E2 specifies `compose.toml` and an interpreter (plan step 8).
8. **When isolation lands.** The isolation plan's v1 is steps 0-4, near-term. The refactor plan puts it at D9, after D7 (the `sessions` capability, the HTTP gateway, Visuals as MCP cards). That dependency is not real with a shared network.
9. **Kernel size.** The plan targets "about 6k lines, down from 7.1k" while adding a registry, cursors, devices, three scopes with epochs, the environment port, challenge identity and tasks.
10. **The first SDK proof.** The verdict's 10b makes Usage a Rust view in process. Plan D5 makes Usage "the first App on the outside road" in WASM.
11. **The tiling model.** Borders §4 wants "the shared Rust model compiled to WASM" for optimistic apply. The plan's §4 says do not compile the model to WASM now, and E12 moves rules to the engine.
12. **Agent scope against the CLI.** Borders d8 says "an Agent's scope = its tool list". The rule must also cover the `banda` CLI, which the skill teaches Agents (W1).
13. **A Pane's host.** 0062 d13 says "a Pane names its host". Borders d11 says addresses carry no host. 0062's text must change.
14. **Stale citations.**
    - The plan and the map cite `engine/src/mcp.rs:321` and `:280-293`, but the file has 278 lines; the fresh CommandId is at `:159`.
    - Borders cites `outbox.rs:256-265` for the `DoneWriting` closure; it is at `:47-63` and `:306-311`.

    Docs that drift this fast are a sign the docs pipeline is saturated.

## 4. Cut or defer, and the door each keeps open

| Cut or defer | What stays (the open door) |
|---|---|
| Person scope as its own replicated log, epochs, handoff, `take --force` | `owner = person\|host` in the manifest; Person data only on the home host; export and import to move it |
| Host-to-host sessions, follows, delegated passes | `show.*@1` facts with event ids; the client relays them |
| Directory in Person scope | A client cache from `projects.list` per host, plus `moved{to}` |
| WASM, WIT, ComponentizeJS, JS isolates, fuel | The data-shaped `tx` contract; workers on the public protocol |
| `platform/views` patches, host fallback, RN renderer, whole-shadcn catalogue | The `view` kind returning a Tree, read again on events; a small catalogue; MCP-App frames |
| `intents.toml`, `ambiguous`, namespaces, version negotiation | `verb@major` in manifests; single-handler resolution |
| `item@1` (until a second lister, i.e. Web Apps), `task@1` and `kernel_tasks`, Units, supervisor, delegation, `compose`, export, migrations by hash, grants and enable per Project | Turns as the work; `hosts.rs`; per-App migration refusal; capabilities declared but not yet enforced |
| iroh, iroh in WASM, SNI edge, push gateway, Better Auth, all of Banda Cloud, 0081 d15 | The route-list port; ssh and direct; Web Push from the host |
| Isolation: the door, `banda-run`, private and allowlist networks, egress proxy, credential broker, environment sign-ins, Landlock/Seatbelt | The `Environment` port (A7); the container adapter with shared network |
| R0 as a big-bang rename gated on a drain; T0 | New crates born in `platform/` and `apps/`; moves done when a crate is touched anyway |
| E12, B12 (deltas out of the log; only relay bandwidth needs it), D7 (the `sessions` capability) | Gateway extraction (B3) only |

**The smallest architecture that keeps every door open:**
- **Kernel:** store, receipts for every command (A3), durable cursors (A5), outbox GC (A6), a device road with capabilities and front/away presence (E3), a transport port, identity by challenge and keys (H3), a version range (H1). Session = `{actor, only, scopes}`; `via` comes with the first outside App. Scope `{Project, Host}`.
- **Platform:** `projects` out of the kernel (A1, A2), calls and push (E7-E9), `harnesses` with adapters on the host (S1), gateway, bytes over HTTP (E1, E2), settings through the API (E4), `environments` (local, then container).
- **Then the product-fit wins**, which are cheap and which enthusiasts feel:
  - the MCP gateway over HTTP;
  - MCP Apps through the existing frame host;
  - Web Apps (a manifest plus a partition);
  - one tracer App on the outside road.

## 5. The three decisions Roma must make

1. **Several hosts in v1: the client integrates, or hosts replicate the Person?**
   - **Recommendation: the client is the only integrator.** Hosts never talk in v1. The Person's data lives only on the home host. The client merges the Inboxes, keeps the directory and relays `show.*` placements by event id.
   - This removes H2's replica, H6 and H7 (about 3 L-sized PRs), every epoch and handoff, and a whole class of split-brain bugs. It matches `notes/13:7-14`, and T3's model shows it works.
   - Revisit when the home host becomes always on (Banda Cloud "Person's home").

2. **Where an outside App's code runs, including its view (Roma's question 2).**
   - **Recommendation: on its host, as a worker process speaking the public protocol with an App pass.**
     - Handlers return a `tx` as data, which the kernel commits atomically.
     - A view is a query that returns a Tree; the client draws it from a small catalogue and reads it again on events.
     - Rich UI is an MCP-App frame.
     - No WASM, no JS isolate and no view-diff service in v1.
   - This keeps the verdict's best rule: no App code on devices, except what a spec frame walls in. It drops its most expensive machinery.
   - First-party Apps stay in-process Rust.
   - Prove it with one tracer App before accepting 0062 d4, d5, d7 and d14.

3. **The trust model, and when isolation comes (Roma's question 3).**
   - **Recommendation:**
     - Write down that a non-isolated Agent has the Person's Unix power, so Banda's checks are rails and not a wall.
     - Ship minimal isolation right after the machine service and before fine-grained capabilities: A7 plus a Linux container for Harness CLIs and terminals, host networking, state folder not mounted, and a separate per-Project browser partition.
     - Enforce App capabilities only for code inside a box.
   - This fixes the one critical hole (W1) for Projects that need it, and saves building access machinery that an Agent with the Person's Unix power would get around.

These three together set the order: service → isolation v1 → calls and push → bytes, settings, device road → pairing and ssh/direct → Hosts router → web PWA as phone v1. The SDK tracer App runs alongside.

Sources read: origin/main at `9916fff9`, `PR #557: docs/adr/0062-banda-is-a-kernel-a-platform-and-apps-built-on-one-sdk.md`, the code map and the brainstorm digest, and the local T3 source at `t3code/docs/internals/remote.md`.