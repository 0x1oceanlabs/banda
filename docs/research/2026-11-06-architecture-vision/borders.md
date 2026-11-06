# Banda: borders between parts, and how the parts talk

Input to [the vision](../2026-11-06-architecture-vision.md) (2026-11-06). Roma's decisions are in its §11 and override this document where they differ.

Design for ADR 0062 and 0081. 2026-11-06. Code is cited from the `arch-review` worktree at `9916fff9`.

## 0. The model in eight rules

1. **Every record has one writer, and the writer is a scope.**
   - Today there are two scopes: `Project` and `Machine` (`kernel/src/module.rs:19-27`). The machine scope is a fake Project.
   - The model needs three:
     - **Project**: moves between hosts.
     - **Host**: never moves.
     - **Person**: written on the home host, kept as a read-only copy on every other host, and moved by a handoff.
2. **Each part is a program with a manifest.**
   - What it *provides* is declared in code: methods, facts, the intents it handles, Panes.
   - What it *needs* is declared in `app.toml`: capabilities, `listens`, `calls`, `intents`, `device`.
3. **There are four kinds of message: query, command, fact, stream.**
   - An **intent** is a name bound late to one of the four.
   - A **device request** is a command sent to a device.
   - **cancel** is the only signal.
4. **The kernel checks every hop**: the actor's rights ∩ the acting App's capabilities ∩ the session's scopes ∩ the wall.
   - No hop raises rights: not an intent, not a composition, not an MCP frame.
   - Each host decides for its own scopes and never trusts another host's decision.
5. **An address has no host**: `{scope, app, id}`. The host is resolved by route, through the Person's directory, the way DNS resolves a name.
6. **In v1, hosts talk to each other only by two durable follows, not by RPC.**
   - Every host follows the Person log.
   - The home host follows the `show.*` facts of every host's Projects.
   - Everything else goes from a client to a host.
7. **A client holds only the view and the device.** It routes, merges and marks stale hosts. It never reads a host's disk: a byte URL is a capability.
8. **The kernel owns three published languages.** Any App may speak them, and the shell reads them:
   - `item@1`: what a listing is, like `ls`;
   - `call@1`: what calls the Person, like mail;
   - `task@1`: what is running, like `ps`.

---

## 1. The parts as programs

### Who calls

- **P**: the Person, through a device session.
- **A**: an Agent. Its pass names `{agent, thread, project, tools}`.
- **App**: an App's code acting as itself: a handler, worker, view or composition. The session marks it `via = app`.
- **H**: a paired host's session. It carries follow scopes only.
- **D**: a device answering device requests.

### Kernel

There is one kernel per host, inside `banda serve`. It names no App, and a test already enforces that.

| Program (today) | Owns (only writer) | Input | Output | Who may call |
|---|---|---|---|---|
| `router` (`kernel/src/kernel.rs:534-712`) | nothing | frames: `query`, `command`, `subscribe`, `stream`, `cancel` | dispatch to an App or a kernel handler; refusals | transport sessions |
| `identity` (`api.rs` Identity, `passes.rs`) | the host key; paired keys (Person, devices, hosts); sessions; passes, stored hashed with expiry and revocation (today in memory, `passes.rs:6-7`) | `challenge`, `hello{sig}`, pass, `pair.*` | `Session{person, actor, via, scopes, only, expires}` | transport. `gateway` mints Agent passes (capability `passes.mint`). P pairs. |
| `store`, one per scope (`store.rs`, `events.rs`, `outbox.rs`) | the log, receipts, outbox, `kernel_cursors`, and App tables, kept on each App's behalf | in-transaction operations: `exec`, `query`, `emit`, `enqueue` | facts after commit; effects to workers; receipts | the kernel only. Apps reach it through the syscall table below. |
| `access` (`access.rs:31-48`) | nothing | `decide(Session, Method{right, capability}, Scope)` | allow, or `forbidden` | `router`, `registry`, `devices` |
| `registry`, lookup half (today four hand-kept lists: `serve.rs:60-88`, `modules.rs:43-111`, `methods.ts:26-38`, …) | the manifests loaded on this host | `apps.load` / `apps.unload` from the platform's `apps` | `apps.describe` (JSON Schema for every method, fact and intent); `resolve(intent, target)`; schema check on `listen` | any session (describe); the kernel |
| `devices` (`window.rs` becomes `devices.rs`) | live device registrations and pending requests, in memory | `device.register`, `device.presence`, `device.answer` | `device.request` to a chosen device; presence to `calls` | App (capability `device.<cap>`); D answers |
| `scopes` | the Projects on this host with their epochs; the Person epoch | `scope.open`, `close`, `freeze`, `receive`, `hand_off` | `projects.located@1`, `person.handed_off@1` | the platform's `projects`; P |

### Syscall table for an App's host part

This is one contract with two bindings: Rust in process today, WIT later.

- **In the transaction** (handler: deterministic, no IO):
  - `sql.exec`, `sql.query` (the authorizer allows only the App's table prefix);
  - `emit(kind@v, subject, payload)`;
  - `enqueue(effect, key, payload)`;
  - `caller()`, `now()`.
- **Outside the transaction** (worker or view, through a pass marked `via = app`):
  - `query`, `command`, `subscribe`, `stream`, `intent`;
  - `listen(name)`, which yields an event plus an ack;
  - `effects.next`, `effects.settle(outcome as data)`;
  - `bytes.issue`;
  - `device.ask(cap, target, params, within)`;
  - `secret(name)`;
  - `run` and `net`, only as declared.
- **What changes in the code**:
  - `Outcome::DoneWriting` stops being a closure (`outbox.rs:256-265`) and becomes data: events plus a command.
  - `Tx::sql` stops handing out raw rusqlite (`store.rs:94-96`).

### Platform

Platform parts run on the host. They may hold rights no App gets. They name no App.

| Program (target folder ← today) | Scope | Owns | Input | Output | Who may call |
|---|---|---|---|---|---|
| `workspaces` (`platform/workspaces` ← `modules/workspaces`) | Person (home host) | the arrangement: workspaces, columns, Groups, widths, set-aside | P's commands `open`, `move`, `size`, `group`, `close`, with values that depend on the look as args and an optional `expect` seq; a durable listener on `show.*@1` from every host | `workspaces.changed@1` (the whole arrangement, as today, `lib.rs:833-866`); `pane.left@1` | P and the CLI. A only through `show.*` facts. An Agent's `panes` read is answered from its host's Person replica. |
| `projects` with its directory (← `kernel.rs:812-1230`, `sign.rs`) | Host: this host's list, signs, browse. Person: the directory `ProjectId → {host key, name, sign hash, pinned, epoch}`. | — | `projects.create`, `add`, `move`; `projects.located@1` from every host | directory query; `projects.moved@1` | P, CLI, H |
| `settings` + `keys` + `look` (← `settings/`, `look/`, `modules/keys`) | Host files: `harnesses.toml`, MCP servers, the Agents' browser. Person files: themes, `keys.toml`, `sidebar.toml`, flow, `[notify]`, `intents.toml`. Device files stay on the client. | the files' text | `settings.set`, `settings.reset`; a hand edit on the writer host | `settings.changed@1{file, text, problems}`; the look is a pure resolver run on the device (ADR 0080) | P, CLI. A uses the `keys.*` tools, which go to the home host (§5). An App reads its own section (capability `settings`). |
| `calls` (← notifications `teller.ts`, agents `marks.ts`) | Host. The projection can be rebuilt from facts. It also holds push registrations. | — | `call.*@1` facts from every App in this host's Projects; device presence; the Person's `[notify]` from the replica | `calls.inbox` (query plus facts); `device.request notify`; Web Push or the push gateway | P's devices. Apps only emit `call@1`. |
| `harnesses` (← `modules/harnesses`, plus the adapters and session shim moved out of `harnesses/desktop`) | Host | Harness entries, accounts, the process pool `Hosts<H>`, limits, usage journals | `sessions.open{project, harness, mcp: {url, pass}}` (capability `sessions`); `sign_in`, `sign_out` | a session handle (a stream of `Said`); `harnesses.account_changed@1`; `limits` and `usage` queries | Threads (`sessions`), Usage (query), P |
| `gateway` (← `engine/src/mcp.rs`, Pipe at `agents lib.rs:103-128`) | Host | session passes; MCP servers for the host and each Project; `ui://` cache | MCP JSON-RPC over HTTP for each pass; `gateway.session{thread, agent, project, tools}` from Threads | kernel calls as `actor = Agent{thread}`; tool results; `delegable` Person-scope tools sent on to the home host | Harness processes (holding a pass), Threads (to mint), MCP App frames (P, `via = mcp:<server>`) |
| `bytes` (← `desktop-kit/src/files.ts:128-243`, ported as is) | Host | an HMAC key, nothing else | `bytes.issue{scope, app, path or blob, ttl, device}` | a token URL; the `bytes.read{token, range}` stream | Apps with `files` (or their own blobs) issue. A session holding the token reads. |
| `runtime` | Host | desired and observed state of workers, WASM handlers, view isolates, MCP servers and Harness processes (one supervisor); where each Project runs (`Place`) | manifests; `runtime.restart` | `runtime.status@1`; processes | the kernel, `harnesses`, `gateway`, P |
| `apps`, the installer | Host: code by hash. Person: grants. Project: what is enabled. | — | `apps.install{source, hash}`, `apps.grant`, `apps.enable{project}` | `apps.installed@1`; loads the registry | P, CLI |
| `problems` | Host | `problems_kept` | `problems.record`: clients send their own log tail, where today the host reads `window.log` (`problems lib.rs:44-45`) | `problem.recorded@1` | any session records; P reads |
| `sharing` | Host | `sharing_*` tables | listens to `problem.recorded@1` and kernel tallies | a worker posts (`net = ["us.i.posthog.com"]`) instead of `ask_window` (`outbox.rs:229`) | P |

### First-party Apps

Each App has a host part and views. Scope is Project unless the row says otherwise.

| App (← today) | Owns | Provides | Needs | Who may call |
|---|---|---|---|---|
| `threads` (← `modules/agents`) | threads, turns, items, Questions; the Person's marks on them (seen, archived, snooze, written by P but stored in the Project, so they move with it) | commands (`send`, `answer`, `stop`, `rewind`, `seen`…); facts `turn.began@1` (gated), `turn.ended@1`, `thread.rewound@1`, `tool.ran@1`, plus `item@1`, `call@1`, `task@1`; the stream `threads.live` (reply, thought and tool deltas); intents `thread.new@1`, `show.thread@1`, `notice.post@1` (for `threads/thread`), `compose.text@1`, `task.cancel@1` | `sessions`, `passes.mint`, `files:read`; listens to `harnesses.account_changed@1` | P; A through tools; Apps through intents |
| `git` (← `modules/git`) | checkpoint refs; commit runs (`git_runs`) | queries `status`, `diff`, `remote@1`…; commands `stage`, `commit`, `act`; facts `git.committed@1`, `git.pushed@1`, `checkpoint.made@1`, `task@1`; intents `show.diff@1`, `git.commit@1` | listens to `threads.turn.*@1`; intents `notice.post@1`, `compose.text@1`; `run = ["git"]`; `files:rw` | P, A, Apps |
| `pulls` (← `modules/pulls`) | `pulls_links`, `pulls_made`, `pulls_read` (not `pulls_agents`) | `pull.linked@1`; tools `link` and `unlink` | listens to `threads.tool.ran@1` and `git.pushed@1`; calls `git.remote@1`; `run = ["gh"]`; `net = ["api.github.com"]` | P, A |
| `files` (← `modules/files`) | `files_recent`, thumbnails | 24 methods; `files.activity`, a join done on the host that replaces `pane/src/live.ts`; intents `show.file@1`, `open.file@1` | `files:rw`; listens to `threads.tool.ran@1` and `checkpoint.made@1`; `bytes` | P, A, Apps |
| `terminal` | PTYs and their history, in memory | intent `run.command@1` (marked `runs_as_person`); the stream `watch` | `run`; listens to `pane.left@1` (replacing the client's `closed`, `Shell.tsx:425-433`) | P only: A is refused by `Right::Run` |
| `browser` | Agents' tabs in a Chromium on the host; site rules (Host settings). The Person's tabs are device state. | intent `open.address@1`; `browser_*` tools; the stream `screencast` | `device.webview` (Person tabs); `net`; `lease` (a device tab handed to an Agent) | P; A (host tabs, or a device tab only by lease) |
| `usage` (← `harnesses/pane` UsagePane) | nothing: a view only | Pane `usage` | calls `harnesses.usage@1` | P |

### Clients

| Client | Owns | Input | Output |
|---|---|---|---|
| desktop (Electron) | the view; the device key; route lists; device files (zoom, device theme, the Person's own browser profile) | frames from N hosts; OS events | frames; device capabilities: `notify`, `sound`, `clipboard`, `pick_file`, `open_outside`, `open_editor`, `drag_out` (only for the local host), `webview`, `lease`. Electron main is device-only. |
| web (PWA) | the same, without `webview`, `drag_out` and `open_editor` | frames over iroh-in-WASM or the SNI edge | Web Push |
| mobile | its view: one Group to a screen | frames | native push through the gateway |
| CLI `banda` | `hosts.toml` contexts only | argv, JSON | stdout JSON or NDJSON; exit 0, 1 or 2. `--host`. Inside a Harness it uses its pass to its own host (0081 d13). |

### Banda Cloud

The cloud is never a writer of work.

| Service | Owns | Input to output |
|---|---|---|
| `auth.banda.so` | accounts | OIDC flows → id tokens, used only to broker pairing |
| `api.banda.so` | the lists of hosts and devices; the pairing broker; push registrations; a home-host hint (`{key, epoch}`), which is a hint and not authority | a device asks → a host mints a DPoP-bound bootstrap |
| relay (`iroh-relay`) | nothing | QUIC packets, passed through unopened |
| push gateway | APNs and FCM keys | a sealed blob plus a device token → a push |
| backup and moves | sealed log segments | a host pushes them, a host pulls them |
| hosts (VMs) | a whole `banda serve` | — |
| webhooks | a stable address → a host | HTTP → `command webhooks.received` on that host |

### Diagram

```
                    Banda Cloud (optional; connects, never writes work)
  ┌──────────┬───────────────────┬──────────────────┬──────────────┬───────────┐
  │ auth OIDC│ api: hosts,devices│ relay (iroh, sees│ push gateway │ backup,   │
  │          │ pairing, home hint│ only ciphertext) │ (sealed)     │ VM hosts  │
  └────▲─────┴────────▲──────────┴────────▲─────────┴──────▲───────┴───────────┘
       │ broker pairing│                  │ any route       │ sealed push
┌──────┴───────────────┴── Host A = HOME (banda serve) ────┴─────────────────────┐
│ KERNEL   router · access · identity · registry(lookup) · devices · scopes      │
│          stores: [Person*] [Host] [Project P1] …  (log·receipts·outbox·cursors) │
│ PLATFORM workspaces* · projects/directory* · settings/keys* · calls · harnesses │
│          gateway(MCP) · bytes · runtime(Place: local | container) · apps ·     │
│          problems · sharing                                                     │
│ APPS     threads · git · pulls · files · terminal · browser(host) · usage       │
└──▲────────────────────────▲─────────────────────────────────────────────────────┘
   │ query/command/          │  H session (one QUIC conn, both ways):
   │ subscribe/stream/       │   B ──follows──► A's Person log   (replica on B)
   │ device.*                │   A ──follows──► B's show.*@1, projects.located@1
   │                    ┌────┴──── Host B (Projects P2, P3) ─────────────────────┐
   │                    │ same kernel/platform/apps; Person store = read-only    │
   │                    │ replica (epoch); calls computed for P2, P3 here         │
   │                    └────▲───────────────────────────────────────────────────┘
┌──┴───────────────────────────┴── Client (desktop | web | phone | CLI) ───────────┐
│ Hosts (key → route list → conn) · Directory cache · Router · Inbox merge ·       │
│ view state · first-party views + Level 1 renderer · look resolver · device caps  │
└───────────────────────────────────────────────────────────────────────────────────┘
 * Person scope: written only on the home host; every other host keeps a replica.
```

---

## 2. The kinds of message

### Mapping to Unix

| Unix | Banda | Already in the code |
|---|---|---|
| `stat`, `read(2)` | **query**: a read, with an answer and `as_of` | `call` kind; the reader is `query_only` (`store.rs:170`) |
| argv + exit status | **command**: a write, answered with a receipt | `command` kind, `CommandId` receipts (`store.rs:210-242`) |
| journal or syslog, plus inotify | **fact**: typed, versioned, committed with the data | `Event{seq, kind, version, …}` (`events.rs:11-30`); `Heard` (`project.rs:476-503`) |
| a pipe with flow control | **stream** | one piece in flight (`api.rs:263-269`); `mpsc` (`module.rs:16`) |
| `xdg-open`, mailcap | **intent**: a verb resolved to a handler, which then runs as one of the four kinds | none: strings such as `run("browser.open")` |
| `/dev` + `ioctl` | **device request**: a command whose target is a device | `ask_window` (`module.rs:176`), with one holder |
| SIGINT, SIGTERM | **cancel** for a stream, a query or a Task | streams only end when dropped |
| an fd as a capability | a byte URL token; a pass | `app://files` HMAC (`files.ts:128-243`) |
| `ps` | `task@1` | none |

### The kinds in detail

| | Query | Command | Fact | Stream |
|---|---|---|---|---|
| **Shape** | `{id, scope, method, params}` → `{ok, as_of{seq, at}}` | `{id, scope, method, params, command: CommandId, not_after?, expect?}` → `receipt{ok or refusal, seq, task?}` | `{seq, id: EventId, app, kind, version, subject, author: Actor, via?, at, payload}` | `{id, scope, method, params, credit, from?}` → `piece{n, data or bytes}`, `ended{reason}` |
| **Delivery** | none needed: safe to repeat | runs at most once. A repeat with the same id replays the receipt, so the outcome is exactly once for each scope. **The kernel stores a receipt for every command**, not only for handlers that opt in (`methods.rs:287-297`). | Subscription: no gap and no repeat within it; resume by seq; `resync` on lag. Durable listener: see §3.4. | at most once, in order, while connected. It resumes only if the producer accepts `from` (terminal history, byte range). |
| **Order** | a snapshot at `as_of.seq` (one read transaction); then `subscribe{after: as_of.seq}` with no gap | serialised per scope by the single writer. **Commands from one connection to one scope commit in the order sent**, so a client may pipeline tiling keys. | total within a scope's log; none across scopes or hosts. A client merges by `at` for display only. | within the stream |
| **Versioning** | method params and answers: additive within the App's API major; `apps.describe` serves the schemas | the same; a receipt refuses an id reused for another method or author (`store.rs:355-387`) | `kind@major`. Additive only within a major: consumers ignore unknown fields. A break is a new major, and the publisher ships a `down(vN) → vN-1` for one App release. Released schemas are kept in `contract/released/<app>/`, and CI refuses a change that is not additive. | piece schema for each method |
| **Access** | the kernel: `decide` per method | the kernel at receipt; the handler checks domain rules; `expect` gives the refusal `stale{now}` | the kernel at `subscribe` or `listen`: own facts, or `listens` in the manifest. **Private facts are visible only to their own App** (views included). | the kernel when the stream opens; revoking a session ends it (`ended{revoked}`) |
| **Across hosts** | client → owning host only | client → owning host. Host → host only for `delegable` Person-scope methods (§5). Offline: fails fast unless the Person queues it (`not_after`). | host → host only through the two follows (§5) | client → owning host. On iroh, one QUIC stream per Banda stream, so there is no head-of-line blocking. |

- **Intent.** `intent{verb@major, args, target?: Address, prefer?: AppId}` is resolved by the registry on the host that owns the target's scope. It becomes a command, a query, or a `show` (which returns a `PaneSpec`), and takes that kind's guarantees. No delivery rules of its own exist.
- **Device request.** `device.request{id, cap, params, within, target: device_id or "where_person_is"}`. It runs at most once, has a deadline, and refuses with `may_have_run` (the `window.rs` rules are kept). With no capable device present, it is refused with `no_device`, or for `notify` it becomes a call plus a push (0081 d5).
- **Long work.** A command that starts long work answers at once with `task: Address`. Progress arrives as `task.changed@1` facts. Cancel is the intent `task.cancel@1`, resolved to the Task's App.

### How the methods! table, ts-rs and the manifest express each kind

| Kind | In code (`methods!`, new `facts!`, `intent`) | ts-rs output (per-App package `@banda/app-<id>`) | `app.toml` (what the App needs) | Registry at runtime |
|---|---|---|---|---|
| query | `query diff(DiffAsk) -> Diff, Read;` (`call` kept as an alias) | `QueryMethod<P,A>` (today `CallMethod`, `methods.rs:146-158`) | another App's query: `calls = ["git.remote@1"]` | JSON Schema of P and A (schemars, today only for tools, `methods.rs:274-281`) |
| command | `command act(ActAsk) -> Acted, Write, task, delegable?;` | `CommandMethod<P, Receipt<A>>` | the same `calls` | plus flags |
| stream | `stream watch(WatchAsk) -> Status, Read, credit 8, resume;` | `StreamMethod<P, Piece>` | the same | |
| fact | `facts! { turn.began@1(TurnBegan) gate 5s; tool.ran@1(ToolRan); delta@1(Delta) private; }` | a `ThreadsFacts` union of `{kind, version, payload}` | consumer: `listens = ["threads.turn.began@1", { fact = "…", gate = true }]` | schema for each `kind@v`; refuses a `listen` on an undeclared or missing kind |
| intent | provider: `intent "show.diff@1" for "git/diff" => show_diff;`. Verb schemas live in the crate `banda-intents` (`sdk/intents/`). | an `Intents` map from verb to args, from `banda-intents` | caller: `intents = ["show.diff@1", "notice.post@1"]` | handlers per verb; the Person's defaults from `intents.toml` |
| tool | `…, tool "git_status"` stays, and now **is** the Agent's scope | — | — | the gateway lists them, namespaced by App |
| device | the platform's closed vocabulary `device! { notify(Notice) -> Shown, within 5s; … }` | `DeviceRequests` | `device = ["notify", "open_outside"]` | the client lists its capabilities in `device.register` |

`app.toml` also carries `[[panes]]` (kind, `shows = ["show.diff@1"]`, `runs_as_person`, `upgrades`), `[[settings]]`, `requires = { threads = "^1" }`, `api = "1"` and `[unstable]`. The `apps.rs` and `apps.ts` registries are generated from a scan of `apps/*/app.toml`, which replaces the about 13 hand-kept lists.

### Session and access

```rust
struct Session {
    person: PersonId,                 // one owner per host (0081 d10)
    actor: Actor,                     // Person{device} | Agent{agent, thread, project} | App{app} | Host{key}
    via: Option<AppId>,               // whose code acts: a view, handler, worker, composition, mcp:<server>
    scopes: Scopes,                   // narrowed set; an Agent's = its tool list
    only: Option<ProjectId>,          // the wall
    expires: Timestamp,
}
// allowed = right_ok(actor, method.right, owner)        // today's 5 Rights stay
//         ∧ cap_ok(via, method.capability)              // the manifest
//         ∧ scopes ∋ method ∧ wall(only, resolved ProjectId)
```

This fixes two things today:
- Access items that are tracked privately (see SECURITY.md). This rule is their fix (refactor B14).
- Machine-scope modules filter by themselves (`kernel.rs:700-710`).

---

## 3. App ↔ App

### 3.1 Published languages

- A fact is **private** unless it is listed in the App's `facts!` without `private`.
- Names follow `<app>.<noun>.<past-verb>@<major>`.
- A published payload refers to other things only by `Address`, never by another App's internal field.
- The kernel owns three languages that every App may emit with no declaration. The shell, the sidebar, the Inbox and the bar read only these:
  - `item@1`: `{id: Address, title, mark{state, tone}, changed_at, owner?: Address, pane: PaneSpec}`. Replaces the Thread-shaped `Listed` (`app/ui/src/pane.ts:229-268`). Groups are keyed by `owner`, so the tiling stops needing Thread identity.
  - `call@1`: `call.raised{id, about, level: answer|look|fyi, title, line, answers[]}` and `call.cleared{id}`. Emitted in the same transaction as the state change behind it.
  - `task@1`: `task.changed{id: Address, parent?: Address, title, state: queued|running|waiting|done|failed|cancelled, progress?, cancellable}`.

### 3.2 The intents registry

- **Who owns a schema.**
  - Verbs in the `banda.*` namespace (`show.thread`, `show.diff`, `show.file`, `open.address`, `open.file`, `run.command`, `thread.new`, `notice.post`, `compose.text`, `task.cancel`) live in `sdk/intents/`, versioned like freedesktop specs and changed by PR.
  - Anyone may publish verbs under their own namespace (`com.acme.crm.contact.show@1`). A shared verb such as `calendar.event.create` is proposed into `sdk/intents/`.
- **Resolution, in order:**
  1. **The target's own App**, if it handles the verb. `notice.post{about: threads/thread/…}` goes to Threads. This is dispatch by type, like `xdg-open` by MIME type.
  2. The Person's default in `intents.toml` (Person scope, like `mimeapps.list`):
     ```toml
     [default]
     "open.address" = "browser"
     "show.file"    = "files"
     "run.command"  = "terminal"
     ```
  3. The only installed handler.
  4. **Several handlers:**
     - With a client in the loop, refuse `ambiguous{candidates}`. The client shows a picker, may write the default, and sends again with `prefer`.
     - Inside a host-side workflow, refuse `ambiguous` and raise a `call@1` to the Person.
  5. **No handler:** refuse `no_handler{verb, schema}`. The client offers an install.
- **Versions.** A handler declares the majors it accepts; the registry picks the highest one both sides know.
- **Rights.** **An intent never raises rights.** The handler runs with `actor = the original actor` and `via = the handler App`. So an Agent's `run.command` reaches Terminal and is refused by `Right::Run`, exactly as a direct call would be.

### 3.3 Capabilities (git's `app.toml`)

```toml
id = "git"; api = "1"; version = "0.2.0"
[needs]
listens  = [{ fact = "threads.turn.began@1", gate = true }, "threads.turn.ended@1", "threads.thread.rewound@1"]
intents  = ["notice.post@1", "compose.text@1"]
files    = "read-write"
run      = ["git"]
[[panes]]
kind = "diff"; shows = ["show.diff@1"]; runs_as_person = false; upgrades = ["agents.diff"]
```

- Banda's own Apps declare capabilities too. They are granted without asking, but nothing undeclared is granted (0062 d5).
- Use a **named call** (`calls`, `requires`) when the caller needs that App's data; use an **intent** when any provider will do.

### 3.4 Durable listeners

- **The cursor.** `kernel_cursors(listener PK, source_scope, seq)`. `listen(name, filter)` resumes from the stored seq, not from head. Today git, agents and pulls start at head (`project.rs:810-817`), so events committed just before a crash are lost.
- **Same scope** (a handler in the transaction): the ack is written in the reaction's own transaction, so the reaction runs **exactly once**.
- **Another scope, or a worker:** **at least once**. The reaction's writes are commands with `CommandId::derive(listener, event_id)`, a UUIDv5. Repeats fall onto the receipt. This is the outbox keyed by event id, using machinery that already exists.
- **Gates.** A publisher marks a fact `gate 5s`. A listener opts in with `gate = true`. `reacted()` (`project.rs:894`) waits only for gated listeners, and a timeout records a problem instead of logging a warning. This replaces the implicit 5 s `REACTED` barrier (`agents effects.rs:170, 227`). Gates work only within one scope.
- **Every Project on this host.** `listen` may target all local Projects, with one cursor per Project, for **published facts only**. That primitive is what `calls` and `files.activity` need. It amends ADR 0040 d3, whose wall allows only `tally` (`project.rs:856-860`).

### 3.5 Cross-App workflows run on the host

A workflow is the App's own table of runs plus outbox effects. Each step's command id is `derive(run, step)`. No client keeps run state; today the git pane's `chain.ts:1-9` does. The commit flow, before and after:

```
P: command git.commit{about: threads/thread/T}        → receipt{task: git/run/R}
git handler: INSERT git_runs(R, drafting); enqueue draft(R); emit task.changed(running)
worker draft: intent compose.text@1{about, prompt}    id=derive(R,"draft") → Threads aside run
worker:  command git.step{R, message}                 → committing; enqueue act(R)
worker act: git commit/push; command git.acted{R}     → git.committed@1, task.changed(done)
worker:  intent notice.post@1{about, text}            id=derive(R,"notice")
client:  only follows task R; closing it loses nothing; the CLI sees the same run
```

### 3.6 Compositions

- A composition is an ordinary App with no view. Its handler or worker turns facts into intents.
- It acts as `actor = App{comp}`, with the capabilities the Person granted at install, never the Person's full rights.
- It is installed on a host and enabled per Project, and it runs in each Project where it is enabled.
- A declarative file that compiles into such an App is deferred.

### 3.7 Three of today's couplings, rewritten

**(1) git ↔ Threads: checkpoints and notices**

- Today:
  - git hears `module "agents"`, kinds `turn.started`, `turn.ended`, `thread.rewound` by string (`git/engine/src/checkpoint.rs:17-29`) and reads `payload["turn"]` (`:142`).
  - Agents block up to 5 s on reactions (`agents effects.rs:170, 225-228`).
  - git emits `git.acted` with `thread` as its subject (`git/engine/src/act.rs:53`), and Agents hear it by name and read `payload["thread"]` and `payload["notice"]` (`agents notices.rs:16-42`).
  - git's public types say `Scope::Turn{thread, turn}` (`git model.rs:136`).
- After:
  - Threads publishes `threads.turn.began@1{thread: Address, turn: Address}` (with `gate 5s`), `turn.ended@1` and `thread.rewound@1{thread, to: Address}`.
  - git declares `listens` with `gate = true` on `began`.
  - Checkpoints are keyed by an opaque **origin** address: `refs/banda/checkpoints/<hash(origin)>/{before,after}`. `Scope::Turn{thread, turn}` becomes `Scope::Span{origin: Address}`, and `ActAsk.thread` becomes `about: Option<Address>`.
  - When an act is done, git's worker calls `intent notice.post@1{about, text}`. Threads handles it because the target is `threads/thread/*`.
  - `git.acted` is replaced by `git.committed@1` and `git.pushed@1`, which name no Thread. **Threads listens to nothing of git's, so the cycle is gone.**

**(2) The workspaces' `AGENT_KINDS`**

- Today:
  - `const AGENT_KINDS = ["agents.thread","git.diff","files.file","browser.browser"]` (`workspaces/engine/src/lib.rs:117`), checked at `:739-747`.
  - A browser URL check is copied into workspaces (`web_address`, `:121-139`).
  - git's Pane migration lives in the tiling (`Shown::upgrade`, `workspaces/engine/src/model.rs:162`).
- After:
  - The Agent tools `open_pane`, `move_pane` and `close_pane` become `show(verb, args)`, for example `show.diff@1{scope}` or `open.address@1{url}`.
  - On the Agent's host, the registry resolves the verb to git's `show_diff(args) -> PaneSpec{app, kind, args}`, which also validates the args. The `http(s)` check moves into Browser's `open_address`.
  - The kernel refuses a `PaneSpec` whose `[[panes]]` says `runs_as_person = true` when the actor is an Agent.
  - Threads writes `show.requested@1{pane, by: agent, owner: threads/thread/T, beside?}` into **the Project's log**, as 0062 d13 says. The home host's `workspaces` listener places the Pane in the Group of `owner`, with `PaneId = derive(event_id)` so a repeat is idempotent.
  - Moving and closing become `show.moved@1` and `show.closed@1`. The kernel checks that the Agent opened that Pane (`by`).
  - git registers `pane_upgrade("agents.diff")` through the registry. The workspaces crate names no App.

**(3) pulls parsing Agents' tool payloads**

- Today:
  - pulls hears `tool.started`, `tool.changed`, `tool.output`, `turn.*` (`pulls/engine/src/heard.rs:16-32`).
  - It matches `payload["tool"] == "execute"`, adds up output deltas to find a URL, and reads `status` and `exit` (`:121-176`).
  - It keeps its own `pulls_agents(agent, thread)` table (`store.rs:40`), because a call carries no Thread.
  - It runs `git remote` itself (`lib.rs:233-260`).
- After:
  - Threads publishes `threads.tool.ran@1{thread, turn, item, class: shell|edit|read|fetch|other, command?, exit?, status, output_tail ≤ 64 KiB}` **once per finished call**. The ACP layer normalises it across Harnesses.
  - Deltas move to the `threads.live` stream (today they are durable facts, `transcript/output.rs:97-101`).
  - pulls `listens` to `threads.tool.ran@1` and `git.pushed@1` through a durable cursor, so after a crash it misses no PR.
  - Its `link` tool reads the Thread from `Session.actor`, because gateway passes carry `thread`. `pulls_agents` is dropped.
  - The remote comes from the published query `git.remote@1`, which removes the third git runner.

---

## 4. Host ↔ client protocol

### Frames

The encoding stays JSON, which keeps the protocol readable as text. Bytes, PTY output and screencast pieces travel as binary messages: binary WebSocket frames, or raw data on a QUIC stream.

| Client → host | Fields | Answer |
|---|---|---|
| `hello` | `protocol{min,max}`, `device{id, kind}`, `sig` over (nonce ‖ host key ‖ TLS exporter), or a `pass` (Agents); `client{build, apis{app: ver}}` | `welcome`, or `goodbye{unsupported{range} or forbidden}` |
| `query` | `id, scope, method, params` | `result{id, ok, as_of}` |
| `command` | `id, scope, method, params, command, not_after?, expect?` | `receipt{id, ok or error, seq, task?}` |
| `subscribe` / `unsubscribe` | `id, scope, after, filter{kinds@v, subject?}` | `event`s, `resync{head}` |
| `stream` / `credit` | `id, scope, method, params, credit, from?` / `stream, n` | `piece`s, `ended` |
| `cancel` | `id` (a stream, subscription or query) | `ended{cancelled}` |
| `device.register` | `kind, caps[], presence, push?{endpoint, pubkey}` | `result` |
| `device.presence` | `state: front, awake or away; sight{scope, pane}?; quiet` | — |
| `device.answer` | `request, ok or error` | — |
| `ping` | `t` | `pong` |

| Host → client | Fields |
|---|---|
| `challenge` | sent first on connect: `nonce, host{key, name}, time` |
| `welcome` | `protocol` (picked), `host{key, name, version, time}`, `person{id, home{key, epoch}}`, `session{scopes, expires}`, `apps[{id, version, api, hash, publishes[], intents[], panes[], catalogue?}]` |
| `result` / `receipt` / `event` / `resync` / `piece` / `ended{done, cancelled, revoked or error}` | as above |
| `device.request` | `id, cap, params, within, by` |
| `pong` | `t, time, heads{scope: seq}` |
| `goodbye` | `reason` |

### Rules

- **Version range.**
  - The host picks the highest common protocol, replacing the exact match (`api.rs:293`, `lib.rs:88`; the constant is copied by hand into `engine.ts:13`).
  - The client checks each App's `api` major: it uses its own view, falls back to Level 1, or offers an update when the host is newer (0081 d8).
  - PROTOCOL is exported by ts-rs.
- **`as_of` everywhere.**
  - Every event carries its seq; every `pong` carries the heads of the subscribed scopes; every query result carries `as_of`.
  - The client computes how fresh each host is.
- **Heartbeat.**
  - `ping` every 15 s. After two missed `pong`s the host is **stale**: its rows are dimmed and show "as of 14:02", and commands to it fail fast.
  - On iroh, QUIC keepalive holds the NAT open; `pong` is Banda's own freshness signal.
- **Credits.**
  - Each stream has a window: 1 piece locally (today's behaviour), 16 pieces or 256 KiB remotely, refilled by `credit`.
  - Each subscription has a bounded buffer; overflow sends `resync`, which already falls back to the log.
  - At most 64 unanswered commands per connection, then `busy`.
- **Resume is stateless on the host.** A reconnect is a new `hello` (the challenge is signed again), then:
  - `subscribe{after: last seq}` for each subscription;
  - `stream{from}` where the producer allows it;
  - unanswered commands sent again with the same `CommandId` and `not_after`.

  The TS client already does the first and third (`contract/src/engine.ts:85-95, 154-172`). The host keeps no per-connection state worth resuming.
- **Pipelining.** Commands from one connection to one scope commit in send order, and `expect{seq}` gives a precondition. Together they let the tiling apply a key optimistically against a remote home host, using the shared Rust model compiled to WASM, and roll back on `stale`.
- **The byte host.**
  - `bytes.issue` returns `banda://<host-key>/b/<token>`. The token is an HMAC over `{scope, app, path or blob, dev+inode, exp, device}`. The existing `FileLinks` rules move to the host: realpath, `O_NOFOLLOW`, Range, nosniff, sandbox CSP.
  - The client fetches by `stream bytes.read{token, range}` **on the same connection to that host**, so it works over local, SSH, direct and relay alike.
  - Electron's `app://` handler, a Service Worker on the web, and a native loader on the phone turn the URL into that stream for `<img>` and `<video>`.
  - Plain HTTPS through the SNI edge can come later.
  - `folderOf` and `wholeIn` are removed from Electron main (`desktop-kit/files.ts:270-279`).
- **Level 1 (placeholder; another agent decides where views run).**
  - A view that runs on the host is a stream: `stream ui.render{pane, catalogue: "1.x"}` → pieces `{rev, ops[]}`. Events go back as `query ui.event{view, node, event, value, rev}`. `source = "habits.list"` uses an ordinary query or stream.
  - **This rule holds wherever views run:** a third-party view's session is always `via = app`, so the kernel bounds it by the App's capabilities.

### One client, N hosts

```
route(addr):
  host = match addr.scope { Person → welcome.person.home
                            Host(k) → k
                            Project(p) → directory[p] }         // Person-scope cache
  conn = hosts[host]          // first route in its list that answers *as that key*
  if conn.stale: refuse unreachable{host, as_of}  (or queue; see §5)
  send → on refusal moved{to, epoch}: directory.note(p, to, epoch); retry once
```

- **Panes carry an Address, never a host.** `PaneProps.engine` becomes `hosts.for(address)`; today there is one Engine per window.
- **Inbox.**
  - The client subscribes to `calls.inbox` once per host, instead of N × M React Watches (`bar/Watches.tsx:54-70`).
  - Rows are a union; call IDs are unique because each call belongs to one Project.
  - Order: those that want an answer first, then by `at`.
  - Each row keeps its host, so an answer routes back to it.
  - Each host shows one of three states: `live`, `stale(as_of)` or `away`.
- **Sidebar.** The same pattern over `items.list` and `item@1` facts.

---

## 5. Several hosts

- **Addresses.**
  - `Address{scope: Project(ProjectId) | Person | Host(HostKey), app, id}`. Text forms: `p:<uuid>/threads/thread/<uuid>`, `person/workspaces/pane/<id>`, `h:<key>/harnesses/account/<id>`.
  - Only Host-scope things name a host, because they cannot move.
  - The first part of `id` is the type, which intents dispatch on.
- **The directory.**
  - `projects` keeps `ProjectId → {host key, name, sign hash, pinned, epoch}` in the Person scope.
  - It is filled from the `projects.located@1{epoch}` facts that each host publishes and the home host follows. A higher epoch wins.
  - A host that has handed a Project away keeps a tombstone and answers `moved{to, epoch}`.
- **Home host and the Person scope.**
  - `Scope::Person` has its own store, log, receipts, outbox and cursors, at `state/person`.
  - Person-scope parts are **event-sourced**, so a replica rebuilds them by applying facts. In v1 only platform parts live there: workspaces, settings and keys, directory, intents, grants. Person-scope Apps from elsewhere are deferred.
  - Every other host follows the home log into a read-only replica. Writes there are refused with `not_home{home, epoch}`.
  - **Handoff:**
    1. `person.hand_off{to}` on the old home.
    2. It freezes Person writes.
    3. The new home follows to head.
    4. The old home commits `person.handed_off{to, epoch: n+1, at_seq}`.
    5. The new home starts writing at n+1.
  - Every Person-scope write and follow carries the epoch, so a returning stale home sees a higher epoch from any peer (or the cloud's hint) and becomes a replica.
  - If the old home is lost, `person.take --force` on the new one raises the epoch, after the Person confirms that an unreplicated tail may be lost.
- **Host to host.**
  - A host pairs as a device of kind `host` (0081 d2). Its session holds only `follow:person` and `follow:facts[show.*@1, projects.located@1]`.
  - Each host dials the home host, and both follows run over that one connection: a star around the home host.
  - Cursors live in the follower's store; delivery is at least once, with EventId dedupe.
  - **No App on host A calls an App on host B in v1.**
- **May an Agent on A act on B?**
  - **Reads of Person data** (`panes`, keys in force): yes, from A's replica, filtered by the wall.
  - **What it opened**: yes, as `show.*` facts in its own Project, which the home host places.
  - **Writes to Person data** (ADR 0071's `keys.bind`):
    - Only methods marked `delegable` in `methods!`.
    - The gateway on A forwards them with a **delegated pass**: `{origin host key, agent, thread, project, scopes:[keys.bind], exp}`, signed by A's host key.
    - The home host checks that A is a paired host of the Person and that the scope is delegable. Then it decides under its own rules, as `actor = Agent`.
  - **Agent to Agent across hosts** (Arc on a server starting Codex on a laptop): **deferred**. When it comes, the rights come from a Person-scope grant that every host reads from its replica, such as `{from: project or agent template on A, to: project on B, intents: [thread.new@1], until}`. The transport identity is A's host key; B decides under its own rules; the result returns as facts in B's Thread.
- **Offline.**
  - A query shows the last data, marked with `as_of`.
  - A command **fails fast** with `unreachable{host, as_of, may_have_run: false}`. The Person may choose "send when back": the client then keeps the command in a visible queue with `not_after` (default 10 minutes, at most 7 days) and sends it again with the same `CommandId`.
  - **The host refuses `expired` past `not_after`**, measured in host time, with the offset taken from `welcome` and `pong`. A phone's command therefore never runs hours late without the Person having chosen that.
  - Follows catch up from their cursors.
  - With the home host away, the client draws a plain arrangement from the work and changes none (0062 d13).
  - A device request with no device either fails or becomes a push.
- **Project moves** use the same fencing:
  1. `projects.move{project, to}` freezes writes (the `project.moving` lock exists, `kernel.rs:~570`).
  2. The source bundles the log, the App tables (SQLite backup), the data folders, a git bundle and a patch.
  3. The bundle goes over the H session to `scope.receive`.
  4. The destination opens it at epoch + 1 and publishes `located`.
  5. The source keeps the tombstone.
- **Where an App is installed, granted and enabled.**
  - Code is installed **per host**, by hash.
  - Grants are **per Person**, in the Person scope and replicated, so one decision covers every host.
  - An App is enabled **per Project**, in the Project's manifest.
  - A move first installs the missing Apps on the destination from the source's package, or refuses and lists them.
- **A Project in a container** (Roma's question 3, the border only).
  - `runtime` has a `Place` port, `Local` or `Container{image, mounts}`, per Project.
  - Inside the box: Harness processes, PTYs, workers with `run`, and the Agents' Chromium profile.
  - **Outside the box: the kernel, the stores, `gateway` and `bytes`.** The authority never runs where an Agent has a shell.
  - The box reaches the gateway through a mounted socket with a pass per session. `bytes` reads through the bind mount.

---

## 6. Decisions

1. **Three kernel scopes.**
   - `Scope::{Project, Host, Person}` replaces `{Project, Machine}`.
   - **Host**: harnesses, the gateway, problems, sharing, installed code and host settings.
   - **Person**: the arrangement, the directory, Person settings and keys, `intents.toml` and grants. It lives on the home host, is replicated read-only to every paired host, and its handoff is fenced by an epoch.
   - **Project**: moves on command, fenced by its own epoch.
   - The fake machine Project goes.

2. **Each part is a program that declares what it provides and what it needs.**
   - Code (`methods!`, `facts!`, `intent`) declares what a part provides.
   - `app.toml` declares what it needs: `listens`, `calls`, `intents`, capabilities, `device`, `[[panes]]`, `requires`.
   - The registry, `apps.rs`, `apps.ts` and `apps.describe` are generated from one scan of `apps/*/app.toml`.
   - The kernel and the platform name no App, and a test proves it.

3. **Four kinds of message.**
   - The kinds are query, command, fact and stream.
   - An intent is a name resolved to one of them.
   - A device request is a command sent to a device.
   - `cancel` is the only signal.
   - No other kind is added: a new need must fit one of these, or it shows a missing part.

4. **The kernel keeps every command's receipt.**
   - Every `command` kind gets a receipt, whatever the handler does. The rule moves from `right != Read` (`kernel.rs:569`) to the method's kind.
   - Commands carry an optional `not_after`, checked against host time, and an optional `expect{seq}`, refused with `stale`.
   - Reactions and workflow steps use `CommandId::derive(source, step)`.
   - Receipts are kept 30 days, longer than the 7-day ceiling on `not_after`.
   - Inline IO without a receipt either becomes an honest `query` or moves to the outbox.

5. **Facts are published or private.**
   - Names follow `<app>.<noun>.<past-verb>@<major>`, and a version only adds within a major.
   - A breaking change comes with a `down` function for one release. Released schemas are snapshots, and CI checks them.
   - Only an App's own code sees its private facts.
   - Token deltas leave the durable log for a live stream; the log gets one complete item at the end.

6. **Durable listeners with kernel cursors.**
   - Within one scope, the ack is written in the reaction's transaction: exactly once.
   - Across scopes, or from a worker: at least once, with ids derived from the event.
   - A gate is declared by both publisher and listener, and replaces the 5 s `REACTED` barrier.
   - A host-wide listener over every local Project's published facts is allowed. This amends ADR 0040 d3 for published facts only.

7. **A registry of intents.**
   - Banda's verbs live in `sdk/intents/`; anyone else uses their own namespace.
   - Resolution goes: the target's App, then the Person's default in `intents.toml`, then the only handler, then `ambiguous` (a picker, or a call to the Person), then `no_handler`.
   - An intent never raises the actor's rights.

8. **One access rule, checked on every host.** `Session{person, actor, via, scopes, only, expires}`:
   - Access = Right(actor) ∩ capability(via) ∩ scopes ∩ wall, with the wall checked on the resolved ProjectId.
   - An Agent's scope is its tool list, namespaced by App.
   - No host acts on another host's decision.

9. **Three kernel-owned languages: `item@1`, `call@1`, `task@1`.**
   - The sidebar, the Inbox, the bar, `ps`-like lists and push read only these, so the platform needs no App concept.
   - Groups are keyed by `item.owner`.

10. **Cross-App workflows run on the host.**
    - A run table plus outbox steps with derived ids replaces client chains (`chain.ts`, terminal `done` lists).
    - Compositions are ordinary Apps acting under their own granted capabilities.

11. **Addresses carry no host.**
    - The host is resolved through the Person-scope directory, and `moved{to, epoch}` corrects stale routes.
    - Panes, intents and published facts refer to things only by Address.

12. **Host to host is two follows.**
    - In v1, hosts link only by the Person-log replica and the home host's follow of `show.*@1` and `projects.located@1`.
    - Agents read Person data from their replica. They write it only through `delegable` methods carried by a pass signed by their host.
    - Agent-to-Agent across hosts waits for Person-scope grants.

13. **Offline means fail fast.**
    - A command to a host that does not answer is refused at once.
    - A queue on the client, with `not_after`, exists only when the Person asks for it, and the host enforces the expiry.
    - Every stream and every answer carries `as_of`, and a stale host is shown as stale.

14. **The protocol.**
    - The host's `challenge` comes first. `hello` carries a range and a signature; `welcome` carries the Apps with their versions.
    - Commands are pipelined in order per scope.
    - Credits are per stream, with heartbeats every 15 s carrying the heads.
    - Resume is stateless: sign again, subscribe again, send again.
    - The transport is a generic frame `Sink + Stream` (instead of the `axum::WebSocket` in `api.rs:286`), with ws, ssh-stdio and iroh behind it, and one QUIC stream per Banda stream.

15. **The byte host.**
    - Byte URLs are signed tokens issued by `bytes`, read with `bytes.read` over the same connection to that host.
    - A client never reads the host's disk.

16. **The device road.**
    - `devices` holds many devices, each registered with a fixed vocabulary of capabilities and its presence.
    - A request names a capability and a target: a device, or wherever the Person is.
    - With no device present, it is refused or becomes a call and a push.
    - Host work leaves the road: the Agents' Chromium, the Claude usage scan, the Visual layout check, and posting telemetry.

17. **Placement does not change the rules.** Wherever an App's view runs, its session is `via = app`, and the kernel bounds it by the App's capabilities.

18. **Install, grant and enable.**
    - Code is installed per host, by hash.
    - Grants are per Person, replicated.
    - An App is enabled per Project.
    - A Project move installs or refuses.

19. **A Project's `Place`.**
    - Each Project has a `Place`, `Local` or a container, for its programs.
    - The kernel, the stores, the gateway and the byte host always stay outside it.

20. **Threads gets a `sessions` capability, served by `harnesses`.**
    - This gives the host API a row for opening, prompting and cancelling Harness sessions, so Threads is an SDK App with one unstable mark at most.
    - The gateway takes over the Pipe and the passes from Threads.

## 7. Deferred

- Agent-to-Agent across hosts.
- Task trees across hosts beyond the `parent` link.
- Person-scope Apps from elsewhere.
- A declarative composition language.
- `expect` preconditions beyond workspaces.
- CBOR frames.
- HTTPS byte serving through the SNI edge.
- OS sandboxes for third-party workers. Until then, first-party workers and WASM handlers only.
- Level 2 frames.
- Several Persons on one host.

## 8. Open questions

1. **Seen and archived marks.** I put them in the Project, written by the Person and moving with the Project, so `calls` needs no data from another host. The alternative is the Person scope, which needs a join across hosts. Confirm.
2. **One phone, some hosts.** When a phone is connected to only some hosts, should the home host also forward push for the others? I propose that each host pushes its own calls.
3. **Log size.** Person-log compaction: the arrangement logs its whole state on every change, and the receipt and outbox GC need numbers.
4. **Reactions in the writer's transaction.** Do WASM listeners that run in the writer's transaction need a write budget (fuel, deadline) now? And do gates ever cross scopes? I propose not.
5. **`compose.text`.** Is it a `banda.*` verb, or Threads' own? It is how any App gets "a few words from this Thread's Harness".
6. **Breaking a published fact.** When `threads.tool.ran` must break, is a `down` function enough, or should the publisher write both versions for a release?
7. **pulls.** Fold it into git as its GitHub part, or keep it as its own App?
8. **Where views run.** Whichever placement is chosen, check that host-side view isolates, if chosen, are counted per Pane and not per client, and that `ui.event` round trips stay out of keystrokes.