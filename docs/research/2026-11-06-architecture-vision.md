# Banda's architecture: the vision

Research, 2026-11-06, accepted the same day as Banda's main architecture document. Written after a read of the code, Roma's brainstorm of 2026-11-04, draft ADR 0062 and ADR 0081.

## 0. Status and sources

- **Status:** Accepted by Roma on 2026-11-06 as the main architecture document; every recommendation in §11 is his decision. Nothing here is built.
- **Code** is cited as `path:line` from the `arch-review` worktree at origin/main `9916fff9`.
- **Sources:**
  - the map of today's code: six areas, each with evidence (`code-map.md` in the same folder);
  - Roma's brainstorm of 2026-11-04 (`notes/NN:line`, kept outside the repository);
  - designs written for this review, in `docs/research/2026-11-06-architecture-vision/`: `borders.md` (parts, messages, protocol, several hosts); `advocate-clientRuns.md`, `advocate-hostRenders.md`, `advocate-tiered.md` and `judge.md` (where an App's view runs); `isolation.md`; `work.md` (proposed ADR 0082); `refactor.md`;
  - three adversarial critiques: `critic-security.md`, `critic-distributed.md`, `critic-simplicity.md`;
  - draft ADR 0062 (`app-sdk-adr` worktree), accepted ADR 0081, `docs/architecture.md`, `GLOSSARY.md`.
- Where the inputs disagree, this document picks one side and names the other briefly.

---

## 1. The vision on one page

Banda is a personal environment where people and Agents work. **Hosts run the work. Clients show it and ask for changes. Apps, Banda's own and anyone's, are built on one SDK.** Two lines from the brainstorm hold everywhere below: *unite control, not databases* (notes/13:7) and *the UI is not the runtime* (notes/12:32).

```
                 Banda Cloud (optional: finds hosts, relays, pushes, backs up; never writes work)
   ┌─────────────┬──────────────────┬────────────────┬───────────────┬────────────────┐
   │ auth (OIDC) │ api: hosts,      │ relay (iroh,   │ push gateway  │ backup · hosts │
   │             │ pairing broker   │ ciphertext)    │ (sealed blobs)│ (one VM/Person)│
   └──────▲──────┴────────▲─────────┴───────▲────────┴───────▲───────┴────────────────┘
          │               │ broker only      │ any route      │ sealed push
┌─────────┴───────────────┴──────┐   ┌───────┴────────────────┴──────────────┐
│ Host A = HOME   (banda serve)  │   │ Host B, a server     (banda serve)    │
│ KERNEL router·access·identity· │   │ KERNEL the same                       │
│   registry·devices·scopes      │   │ stores [Host] [Project P2] [P3]       │
│ stores [Host] [Person docs]    │   │ PLATFORM calls·harnesses·gateway·     │
│   [Project P1] …               │   │   bytes·environments                  │
│ PLATFORM workspaces·keys·      │   │ APPS threads·git·files·terminal·…     │
│   settings·calls·harnesses·    │   │                                       │
│   gateway·bytes·environments   │   │  no host-to-host link in v1           │
│ APPS threads·git·files·…       │   │                                       │
└──────────▲─────────────────────┘   └───────────▲───────────────────────────┘
           │ query · command · subscribe · stream · device.*  (one session per host)
┌──────────┴─────────────────────────────────────┴──────────────────────────────┐
│ Client (desktop · PWA = phone v1 · CLI)                                        │
│ Hosts router · directory cache · merged Inbox · show.* relay to home ·         │
│ catalogue renderer · tiling model (WASM) · look resolver · device capabilities │
└────────────────────────────────────────────────────────────────────────────────┘
```

The layers and places of 0062 stay. The **kernel** holds scopes and stores, the log, receipts, outbox, cursors, access, identity, the registry, devices and the API. The **platform** holds the shared services (projects, the tiling, settings, keys, look, calls, harnesses, gateway, bytes, environments) and may hold rights no App gets. **Apps** (threads, git, pulls, files, terminal, browser, usage, Apps from elsewhere) are built on the SDK. Kernel and platform name no App. The places are **host**, **view** and **device** (0062 d3).

**The rules.** Rules 1, 2, 4, 5 and 6 are Roma's decisions of 2026-11-06; each names its decision in §11.

1. **Every record has one writer, and the writer is a scope.** *Decided: decision 4.*
   - **Project:** moves between hosts on command.
   - **Host:** this machine's programs, accounts, installed code and settings. It never moves.
   - **Person:** a few versioned documents (the arrangement, keys, sidebar, themes, notify, seen marks; intent defaults later, §4.4). They live **only** on the home host. Clients cache them. No other host keeps a copy. They move by export and import.
   - Today's machine scope (`kernel/src/module.rs:19-27`), a fake Project at `state/machine`, splits into Host and Person.
2. **Code runs only where its author is trusted; everything else crosses the wire as data.** *Decided: decisions 1 and 2.* Banda's client release runs on devices. An App's code runs on its host. HTML that a spec or an origin already walls in (MCP Apps, sites) runs in the device's browser sandbox.
3. **There are four kinds of message: query, command, fact, stream.** An intent is a verb bound late to one of them. A device request is a command sent to a device. `cancel` is the only signal.
4. **Every hop checks access:** the actor's rights ∩ the App's capabilities ∩ the session's scopes ∩ the Project's wall. Only a gesture on one of the Person's devices acts as the Person. *Decided: decision 6.*
5. **In v1 the client is the only integrator between hosts.** *Decided: decision 3.* Hosts never talk to each other. The client merges Inboxes, routes by a cached directory and carries Agents' Pane placements to the home host.
6. **The recorder sits outside what it records.** *Decided: decision 5.* No Agent's shell reaches Banda's state, keys or owner access (the fence, §8).

> **Decisions at a glance.** Each line is Roma's decision of 2026-11-06. The numbers are those of [§11](#11-decisions-for-roma).
>
> | # | Question | Decided |
> |---|---|---|
> | [1](#11-decisions-for-roma) | Where an App's view runs | C: four places (Catalogue, Tree, Frame, Site); first-party Rust views first, read again on events |
> | [2](#11-decisions-for-roma) | Third-party code in v1 | a worker process on the host with an App pass, returning a tx as data; only Apps the Person made or trusts until the `sandbox` adapter; a tracer App decides |
> | [3](#11-decisions-for-roma) | Hosts in v1 | the client is the only integrator; no host-to-host traffic |
> | [4](#11-decisions-for-roma) | The Person scope | a few versioned documents, only on the home host; the always-on host is home when there is one |
> | [5](#11-decisions-for-roma) | The full-access Agent | the F0 fence by default; Supervised where it cannot hold; containers for foreign code |
> | [6](#11-decisions-for-roma) | Who acts as the Person | only a gesture on one of the Person's devices; the rest act as themselves, with `on_behalf` |
> | [7](#11-decisions-for-roma) | The root of trust | a minimal Person key with a recovery code; a cloud-brokered pairing needs an existing device |
> | [8](#11-decisions-for-roma) | The tiling model | one Rust model crate: authority on the home host, WASM prediction in clients, intent commands, a bounded overlay |
> | [9](#11-decisions-for-roma) | Rename timing | first, by an idempotent script, after draining the open PRs |
> | [10](#11-decisions-for-roma) | A generic Task | later; the Turn stays the unit of work; `task@1` reserved |
> | [11](#11-decisions-for-roma) | Isolation timing | any time after the fence; v1 = a Linux container on the `shared` network |
> | [12](#11-decisions-for-roma) | Where the web client's code comes from | the home host's signed binary; a hash-published build once Banda Cloud exists |
> | [13](#11-decisions-for-roma) | Seen marks | Person data on the home host, joined by the client |
> | [14](#11-decisions-for-roma) | Agents and the Person's tabs | the F1 wall now; per-Project profiles later |
> | [15](#11-decisions-for-roma) | The phone in v1 | the PWA, over a tailnet or a LAN with a certificate; a native app later |
> | [16](#11-decisions-for-roma) | `agents` → `threads` (T0) | rename the id before facts are published |
> | [17](#11-decisions-for-roma) | Intents in v1 | one handler per verb; defaults, pickers and namespaces when a second handler exists |
> | [18](#11-decisions-for-roma) | The isolation door | the same HTTP routes and passes on a unix socket mounted into the box, if the I2 spike passes |

> **New words.** Terms this document uses that GLOSSARY does not have yet.
>
> - **receipt:** the kernel's record that a command ran, kept under its CommandId, so a resend gets the same answer and never runs twice.
> - **outbox:** a table of effects (work outside the store, such as a push or a post), written in the same transaction as the change and run after the commit.
> - **cursor:** how far a listener has read a log. The kernel keeps it and moves it in the listener's own transaction.
> - **projection:** a table worked out from events, such as the Inbox from `call@1` facts. It can be rebuilt and writes nothing back.
> - **intent:** a verb with typed args (`show.diff@1`), resolved late to the one App that handles it.
> - **published fact:** an event other Apps may hear, named `app.noun.past-verb@major`, to which a major only adds. Every other fact is private to its App.
> - **gate:** a short wait a publisher declares (`gate 5s`) so a listener can act before the next step goes on, as git checkpoints before a turn runs.
> - **`via`, `on_behalf`:** whose code acts (an App, a frame, a worker), and the Person it acts for. `on_behalf` is recorded and never gives rights.
> - **Catalogue:** the fixed set of components in Banda's client release.
> - **Tree:** data that names catalogue components and their props; what an App's view answers.
> - **Level 1, Level 2:** Level 1 is an App's UI drawn by the client from the catalogue (a Tree). Level 2 is an App's own HTML page in a Frame, later.
> - **Frame:** a sandboxed iframe on an origin of its own, for HTML a spec already walls in (MCP Apps).
> - **Site:** a Web App, a website in a browser partition of its own.
> - **slot:** a place in another App's thing that any App fills with typed rows, such as the Pane header or a Thread's details.
> - **fence (F0):** OS walls around every Agent's shell that hide Banda's state, keys and owner access.
> - **door:** the one way from an isolated Project's box back into Banda; each route needs a scoped pass.
> - **epoch:** a counter that goes up each time a Project moves. The higher one wins, so a host that gave a Project away cannot keep writing it.
> - **overlay:** the client's bounded list of tiling changes not yet saved while the home host is away.
> - **home host:** the host that keeps the Person's documents.

---

## 2. What is strong today and must be kept

| Strength | Evidence | Keep it by |
|---|---|---|
| The store: one writer; receipt, events and outbox rows commit in one transaction; events go out only after commit | `kernel/src/store.rs:205-242`; append-only triggers `store.rs:26-41` | making every new "exactly once" (reactions, workflows) a derived CommandId landing on this receipt check |
| The outbox: order per key, backoff, settle, replay-or-abandon chosen by the module | `kernel/src/outbox.rs:124-166`; `modules/agents/engine/src/lib.rs:1253-1256` | keeping boot ownership for effects run inside the engine |
| Subscriptions with no gap and no repeat; resume by seq | `store.rs:22` (`SUBSCRIBER_LAG`); `kernel/src/api.rs:377-397`; `contract/src/engine.ts:85-95` | making resume stateless on the host for N hosts |
| `methods!` as the one declaration: right, dispatch, TS types, tool schema; CI fails on drift | `kernel/src/methods.rs:273-297` | extending it to `facts!`, `view` and intents instead of adding registries |
| The TS `Engine` client (four verbs, reconnect, safe retries); a Unix-shaped CLI; a thin `banda mcp` pipe | `contract/src/engine.ts:154-172`; `engine/src/mcp.rs` | keeping them; "`banda call` can drive it" is the test of a deep module |
| Addresses carry no host: a Pane is `{project, kind, args}`; `ProjectId` is a global UUIDv7 | `modules/workspaces/engine/src/model.rs:147-157`; `kernel/src/ids.rs:24-27` | never putting a host into an address |
| Deep modules: `Hosts<H>` pool; the git engine with private-index checkpoints; the workspaces model as pure functions; Threads' `rules` and `writer`; ACP quarantined in `acp/` | `modules/harnesses/engine/src/hosts.rs:1-30` (366 lines); `modules/workspaces/engine/src/model.rs` | moving them, not redesigning them |
| The terminal split (PTY on the host, ghostty WASM in the client); `FileLinks` (HMAC, inode, `O_NOFOLLOW`, Range, sandbox CSP) | `app/ghostty`; `app/desktop-kit/src/files.ts:128-243` | copying the split for live components; porting `FileLinks` to the host as it is |
| The Visual frame already speaks MCP Apps words, with `allow-scripts allow-forms` and no same origin | `modules/agents/pane/src/visual-frame.ts:1-8, 13-22` | growing it into the Frame place |
| Most Panes treat an event as "read again" | `app/ui/src/hooks/use-live.ts:24-28`; 10 of 14 sources (map) | making v1 views "read again on events" |
| An Agent never answers for the Person; secrets typed into a Question stay out of the log | `kernel/src/access.rs:41-43`; `modules/agents/engine/src/questions.rs:15-16` | keeping the Decide right as is |
| The kernel names no App (a test), and unstable marks sit under a ceiling that only falls | `engine/src/modules.rs` (`CEILING = 2`) | adding "platform names no App" beside it |
| 0081: one writer and no CRDT; the engine signs its own sessions; a route list | ADR 0081 d1-d4 | building the client integrator on it (§4.6) |

---

## 3. What is weak today, ranked

| # | Weakness | Evidence | Fix (§9) |
|---|---|---|---|
| 1 | **Critical. A full-access Agent works with the Person's own rights on the computer.** Full access is the default, with no OS sandbox. The fence (F0) keeps Banda's state, keys and owner access out of its reach. A security item is tracked privately (see SECURITY.md). | `modules/agents/engine/src/model.rs:60-70` (the default mode) | **F0**; a stopgap first (§10) |
| 2 | **Critical.** A security item is tracked privately (see SECURITY.md). | tracked privately | **F1** |
| 3 | **High.** A security item is tracked privately (see SECURITY.md). | tracked privately | **F2** |
| 4 | **High. Passing errors become permanent answers.** Every refusal is kept as the receipt, `internal` included, though `store.rs:205-208` says engine failures get none. Receipts ignore params; `banda mcp` makes a new CommandId per tool call. | `kernel/src/kernel.rs:569, 584-588`; `store.rs:355-387`; `engine/src/mcp.rs:157-160` | **A3**, **A6** |
| 5 | **High. The engine is the window's child; host work runs through the window.** The road has one holder; usage, sharing, Visual layout and browser tools wait for a window. | `kernel/src/window.rs:133-140`; `harnesses/engine/src/limits/claude.rs:44-47`; `agents/engine/src/lib.rs:1111, 1150` (`heights`, `lay_out`) | **S1**, **S3**, **E3** for usage, sharing and the road; **E13** for the Visual layout (after I7 or V6); **I7** for browser tools (row 6) |
| 6 | **High. Agents' browser tools need a desktop client open**, and will until the host's Chromium (I7). Every tool asks the window; with no window it refuses. On a remote host, an Agent's browser stops whenever the laptop sleeps. | `modules/browser/engine/src/lib.rs:271-353` (`ask_window` per tool); ADR 0029 d2 | **E3** (a named device), then **I7** |
| 7 | **High. The client reads the host's disk** for media, file links, paths, open and drag. | `app/desktop-kit/src/files.ts:274-279`; `modules/agents/desktop/src/index.ts:26-43` | **E1** |
| 8 | **High. Settings and the look are written on the device's `~/.config/banda`** by spawning the CLI in Electron main, while the host reads its own files. | `app/desktop/src/look.ts:1-5, 35`; `app/desktop/src/settings.ts:1-7, 20-45` | **E4**, **E5** |
| 9 | **High. Attention and the Person's marks live in each window**: a React Watch per module per Project; `seen` in localStorage; policy per client. | `app/web/src/bar/Watches.tsx:54-70`; `agents/pane/src/seen.ts:10-14`; `notifications/pane/src/teller.ts:113-172` | **E8**, **E9** |
| 10 | **High. Access is coarse.** B14 brings one access rule and scoped passes. A security item is tracked privately (see SECURITY.md). | tracked privately | **B14** |
| 11 | **High. The host API leaks its implementation**: raw rusqlite; any module can read receipts or drop triggers; closures end effects; a 14-hook trait. | `store.rs:94-96, 170`; `outbox.rs:47-63`; `kernel/src/module.rs:36-118` | **A4**, **A9** |
| 12 | **High. Apps know each other by strings**: git ↔ Threads both ways, four Pane kinds in the tiling, pulls parsing payloads, settings depending on six App crates. | `git/engine/src/checkpoint.rs:17-29`; `agents/engine/src/notices.rs:16-42`; `workspaces/engine/src/lib.rs:117`; `pulls/engine/src/heard.rs:121-176`; `settings/Cargo.toml:11-17` | **B1-B10** |
| 13 | **High. The client re-folds the Thread log**: about 30 fact kinds the engine also folds into its view, plus a TS copy of `rules::can`, so a native phone would need a third copy. | `modules/agents/pane/src/thread.ts:158-519` (`apply`), `:165-217` (`withCan`) | deferred (§9.4) until `<Thread>` streams host updates |
| 14 | **Medium. Reactions are not durable**: they start from the head, so events just before a crash are lost; a 5 s barrier stands in for gates. | `kernel/src/project.rs:815-817`; `git/engine/src/lib.rs:186-188`; `agents/engine/src/effects.rs:170` | **A5**, **B10** |
| 15 | **Medium. The tiling's rules exist twice and need a local engine**: one key per round trip; a task per call, so pipelined commands have no order. | `app/web/src/workspaces/model.ts` (1065 lines) vs `model.rs` (1703); `arrange.ts:343-524`; `kernel/src/api.rs:364-377` | **T1-T2**, **A8** |
| 16 | **Medium. Workflows run in the client**; closing the window loses a commit run. | `modules/git/pane/src/chain.ts:1-9` | **E10** |
| 17 | **Medium. `Shell.tsx` is a 1562-line god function** calling `agents.*` by name. | `app/web/src/shell/Shell.tsx:274-1562` | **B4**, **B8** |
| 18 | **Medium. Effects give up after about 7.5 s; nothing is collected.** | `outbox.rs:97`; `store.rs:44-68` | **A6** |
| 19 | **Medium. One newer App refuses the whole Project** (migrations are counted). | `store.rs:430-439` | **D4** |
| 20 | **Medium. Project CRUD sits in the kernel**, outside receipts and events. | `kernel.rs:801-1230`; `kernel/src/sign.rs` | **A1** |
| 21 | **Medium. Every reply and thought chunk and every tool output delta goes into the durable log**, which never shrinks and which every reader, a phone through a relay included, replays. | `modules/agents/engine/src/transcript/output.rs:97-101` | **B12** |
| 22 | **Low. The protocol version is matched exactly and copied by hand.** | `api.rs:293`; `contract/src/engine.ts:12-13` | **H1** |
| 23 | **Process.** 0062 reverses ADRs with no Changes section; PR #460 is numbered 0049, which main gave to another; 13 PRs are open. | 0062 d19; `refactor.md` §3.0 | **Phase 0** |

---

## 4. Borders, Unix-style

### 4.1 The parts as programs

Who calls: **P**, the Person, by a gesture on a device; **A**, an Agent holding a pass `{agent, thread, project, tools}`; **App**, an App's own code (`via = app`); **D**, a device answering a request. The CLI is P or A by its session.

**Kernel** (one per host, inside `banda serve`, names no App):

| Program | Owns | In → out | Callers |
|---|---|---|---|
| `router` (`kernel.rs:534-712`) | nothing | frames → dispatch or refusal; one FIFO per (session, scope) for commands | sessions |
| `identity`, passes (`api.rs:151-169`, `passes.rs`) | host key, paired keys, passes (hashed, audience, expiry) | `challenge`, `hello{sig or pass}`, the owner socket → `Session` | transport; `gateway` mints |
| `store`, one per scope | log, receipts, outbox, cursors, App tables | `sql`, `emit`, `enqueue` in one transaction → facts, effects, receipts with `at` | the kernel; Apps via the host API |
| `access` (`access.rs:31-48`) | nothing | `decide(Session, method, resolved ProjectId)` → allow or `forbidden` | router, registry, devices |
| `registry` (generated from `app.toml`) | this host's manifests | load → `apps.describe` (JSON Schema), `resolve(intent)`, `listen` checks | any session reads |
| `devices` (from `window.rs`) | devices, capabilities, presence, pending requests | `register`, `presence`, `answer` → `device.request` to a device or "where the Person is" | App with `device.<cap>`; D |
| `scopes` | Project, Host and Person stores; Project epochs | `open`, `freeze`, `receive` → `projects.located@1`, `project.handed_off@1` | `projects`; P |

**Platform** (on the host; may hold rights no App gets; names no App):

| Service (scope) | Owns | In → out | Callers |
|---|---|---|---|
| `projects` (Host; from `kernel.rs:801-1230`, `sign.rs`) | this host's Projects, signs | commands with receipts → `projects.*@1` facts | P, CLI |
| `workspaces` (Person, home host) | the arrangement | intent commands (`open`, `move`, `size`, `group`, `close`), `workspaces.place{event}` → `workspaces.changed@1`, `pane.left@1` | P, CLI; A only via `show.*` facts |
| `settings`, `keys`, `look` (Host and Person files) | file text, problems | `settings.set` → `settings.changed@1`; the look is a pure resolver, run on the host for v1 (E5) and on the device later (ADR 0080) | P, CLI; an App reads its own section |
| `calls` (Host) | the Inbox projection, push registrations | `call.*@1` from local Projects, presence → `calls.inbox`, `notify`, Web Push | P's devices; Apps only emit |
| `harnesses` (Host) | entries, accounts, `Hosts<H>`, limits, usage; adapters as a host Node package | `sessions.open` → a session stream; `limits`, `usage` | Threads, Usage, P |
| `gateway` (Host; from `mcp.rs`, `agents lib.rs:103-128`) | session passes, MCP servers, `ui://` by hash | MCP over HTTP per pass → kernel calls as `Agent{thread}` | Harnesses; frames as `mcp:<server>` |
| `bytes` (Host; port of `FileLinks`) | an HMAC key | `bytes.issue` → a signed URL the host serves | Apps with `files` |
| `environments` (Host) | where each Project's programs run | `Program{argv, env, cwd}` → child, PTY, ports | platform; Apps' `run` |
| `problems`, `sharing` (Host) | their tables | `problems.record` from clients; posts as host effects | any session records; P reads |

**First-party Apps** (Project scope):

| App | Provides | Needs |
|---|---|---|
| `threads` (from `modules/agents`) | `send`, `answer`, `stop`…; `threads.turn.began@1` (gated), `turn.ended@1`, `tool.ran@1`, `item@1`, `call@1`; stream `threads.live`; intents `thread.new@1`, `notice.post@1` | `sessions`, `passes.mint`, `files:read` |
| `git` | `status`, `diff`, `remote@1`, `commit`; `git.committed@1`, `git.pushed@1`; `show.diff@1` | listens `threads.turn.*@1`; `run=["git"]` |
| `pulls` | `pull.linked@1`; tools `link`, `unlink` | listens `tool.ran@1`, `git.pushed@1`; `git.remote@1`; `net` |
| `files` | 24 methods; `files.activity`; `show.file@1` | `files:rw`; `bytes` |
| `terminal` | stream `watch`; `run.command@1` (`runs_as_person`) | `run`; listens `pane.left@1` |
| `browser` | `open.address@1`; `browser_*` tools | `device.webview`, `lease`, `net` |
| `usage` | a view | calls `harnesses.usage@1` |

**Clients and Cloud:**

| Part | Owns | In → out |
|---|---|---|
| desktop | view, device key, route lists, directory cache, device files | frames from N hosts → pixels, commands, device answers (`notify`, `clipboard`, `pick_file`, `open_outside`, `webview`, `drag_out` for a local host) |
| web PWA (phone v1) | the same, minus `webview` and `drag_out` | frames → Web Push |
| CLI | `hosts.toml` | argv, JSON → JSON/NDJSON, exit 0/1/2; inside a Harness, its pass to its own host (0081 d13) |
| Cloud | accounts, host and device lists, push registrations; ciphertext only | brokers pairings an existing device approves (§8); relays; sealed pushes and backups; one VM per Person |

### 4.2 The kinds of message, mapped to Unix

| Unix | Banda | Today |
|---|---|---|
| `stat`, `read(2)` | **query**: a read with an answer and `as_of{seq, at}` | the `call` kind; a `query_only` reader (`store.rs:170`) |
| argv plus exit status | **command**: a write answered by a receipt that carries its log place `at` | `command` kind; `CommandId` receipts (`store.rs:205-242`) |
| syslog plus inotify | **fact**: typed, versioned, committed with the data | `Event{seq, kind, version…}` (`kernel/src/events.rs:11-30`); Heard |
| a pipe with flow control | **stream** | one piece in flight (`api.rs:263-269`) |
| `xdg-open`, mailcap | **intent**: a verb resolved to one handler, then run as one of the four | strings such as `run("browser.open")` |
| `/dev` plus `ioctl` | **device request**: a command whose target is a device | `ask_window` with one holder |
| SIGINT | **cancel** for a stream, subscription or query | streams end only when dropped |
| an fd as a capability | a byte token; a pass | `app://files` HMAC |

Rules for commands (kernel, `A3`, `A8`):
- **The kernel keeps a receipt for every command**, chosen by the method's kind, not by `right != Read` (`kernel.rs:569`).
- **Only final refusals are kept.** `internal`, `busy`, `moving`, `moved` and `unreachable` are not, so a passing error never becomes the permanent answer (`critic-distributed.md` W1).
- The receipt stores `hash(params)` and refuses a mismatch as `conflict`.
- Optional `not_after` (checked in host time) and `expect{rev}` (only where a whole-state rewrite needs it).
- Commands from one session to one scope commit in send order: a FIFO in the router, one ordered control stream on QUIC.
- Work longer than one write answers at once and reports through facts. A command never hangs.

Facts are **private** unless declared in `facts!`. Published names are `<app>.<noun>.<past-verb>@<major>`, additive within a major; until third-party Apps ship, a break is a new kind, not a new major.

### 4.3 The access rule

```rust
struct Session {
    person: PersonId,          // one owner per host (0081 d10)
    actor: Actor,              // Person{device} | Agent{agent, thread, project} | App{app}
    via: Option<AppId>,        // whose code acts: handler, worker, view, frame "mcp:<server>"
    on_behalf: Option<PersonId>, // recorded, never a source of rights
    scopes: Scopes,            // an Agent's = its tool list, namespaced by App
    only: Option<ProjectId>,   // the wall
    aud: Audience,             // ws | gateway | door
    expires: Timestamp,
}
// allowed = rights(actor, method.right) ∩ capability(via, method.capability)
//         ∩ (method ∈ scopes) ∩ wall(only, resolved ProjectId)
```

- **No hop raises rights:** not an intent, not a composition, not a frame, not a worker.
- **Only a gesture on one of the Person's devices acts as the Person.** A click in a view sends the App's own `ui`-marked command as the Person from that device. Everything else (handlers, workers, views rendering, frames, compositions, intent handlers) acts as itself, `via = app`, with the Person recorded as `on_behalf`. This rewrites 0062 d10 ("a call the UI makes with no model is the Person's act"); decided, decision 6.
- **Every `via = app` session is walled** to the Project it runs for. A host-wide listener is the platform's only.
- **The wall is checked on the resolved ProjectId**, in one place (B14).
- **Text sent to an Agent counts as running a program (the Run right).** An App may prompt an Agent (`sessions`, `thread.new{ask}`) only by a loud grant; what an Agent writes into the Person's data (key lines with args, intent defaults, MCP server lists) lands as a proposal the Person accepts (`critic-security.md` W8; step B15).

### 4.4 App ↔ App

- **Published facts.** A consumer declares `listens = ["threads.turn.began@1"]` in `app.toml`; the registry refuses a `listen` on a private or undeclared kind. Payloads name other things only by Address.
- **Durable listeners** with kernel cursors:
  - **acting listeners** (git, pulls, later compositions) keep their cursor in the source Project's store and ack it in the transaction that creates their command or effect: exactly once in a scope, and the cursor moves with the Project;
  - **projections** (calls, items) live in the Host store with their own seq, so a client resumes with one number per host;
  - **gates:** the publisher marks `gate 5s`, the listener opts in. This replaces the implicit `REACTED` barrier (`modules/agents/engine/src/effects.rs:170`).
- **Intents** are `verb@major` with typed args, resolved to the target's own App (`notice.post{about: threads/thread/…}` goes to Threads) or to the **one** handler in the manifests. Banda's verbs live in `sdk/intents/`. A Person's defaults file and a picker come when a second handler exists (decided, decision 17). An intent never raises rights.
- **Slots are typed rows** from a contributor's `slot.<name>(subject) → Item[]`. `threadDetails` and the Pane header's `ThreadMark` become slots.
- **Cross-App workflows run on the host, never in a client**: a run table plus outbox steps with `CommandId::derive(run, step)`.
- **Platform languages:** the kernel owns `item@1` (a listing, like `ls`) and `call@1` (what calls the Person, like mail). The sidebar, Inbox, bar and push read only these. `task@1` (like `ps`) is reserved (§7).
- **Compositions, later:** an App with no view whose worker turns facts into intents, acting as itself with its own grants.

**Today's three couplings, rewritten:**

| Coupling | Today | After |
|---|---|---|
| git ↔ Threads | git hears `turn.started` by string and reads `payload["turn"]` (`git/engine/src/checkpoint.rs:17-29`); Threads hears `git.acted` and reads `payload["notice"]` (`agents/engine/src/notices.rs:16-42`); `Scope::Turn{thread, turn}` in git's types | Threads publishes `threads.turn.began@1` (gated), `turn.ended@1`, `thread.rewound@1`. git keys checkpoints by an opaque origin (`Scope::Span{origin}`) and posts notices by `intent notice.post@1`. `git.acted` becomes `git.committed@1` and `git.pushed@1`. Threads hears nothing of git's: no cycle. |
| `AGENT_KINDS` | four Pane kinds named in the tiling (`workspaces/engine/src/lib.rs:117`), a copied URL check, git's Pane upgrade | `open_pane` becomes `show(verb, args)`; the registry resolves `show.diff@1` to git's `show_diff → PaneSpec`. The URL check moves into Browser. `runs_as_person` Panes are refused for Agents. Threads writes `show.requested@1{pane, by, owner}` into the Project's log; the home host places it (§4.6). |
| pulls parses tool payloads | matches `payload["tool"] == "execute"` and sums deltas (`pulls/engine/src/heard.rs:121-176`); own `pulls_agents`; own `git remote` | Threads publishes `threads.tool.ran@1{thread, turn, class, command?, exit?, output_tail}` once per call, normalised in `acp/`. pulls listens with a cursor, reads the Thread from its session, asks `git.remote@1`. |

### 4.5 Host ↔ client protocol

Today's frames stay (`api.rs:52-149`: `ClientFrame` at 52-98, `EngineFrame` at 103-149), in JSON; bytes, PTY output and screencast travel as binary messages. Added:

| Frame | Direction | Fields |
|---|---|---|
| `challenge` | host → client, first | `nonce, host{key, name}, time` |
| `hello` | client → host | `protocol{min, max}`, `device{id, kind}`, `sig` or `pass`, `client{build, ui}` (`ui`: the client's catalogue version) |
| `welcome` | host → client | picked protocol; host key, version, time; `person{id, home}`; `session{scopes, expires}`; `apps[{id, version, api, hash}]`; `ui`, the catalogue version the host's `banda-ui` writes |
| `query` / `command` | client → host | a command adds `command, not_after?, expect?` |
| `result{as_of}` / `receipt{at}` | host → client | `at` is the command's place in the log |
| `subscribe{after}`, `stream{credit}`, `credit`, `cancel` | client → host | streams answer with `as_of` |
| `device.register{caps, presence, push?}`, `device.presence`, `device.answer` | client → host | the device road replaces the one-holder window road |
| `device.request{cap, params, within}` | host → client | at most once, deadline; `no_device` or a push when none |
| `ping` / `pong{time, version, heads}` | both | freshness, clock offset |
| `goodbye{reason}` | host → client | `unsupported{range}`, `forbidden`, `revoked` |

- **Versions are a range**; `PROTOCOL` is exported by ts-rs instead of copied (`engine.ts:12-13`); each App's `api` major is checked (0081 d8); the catalogue's `ui` version is checked per tree (§5.4).
- **Freshness:** after two missed `pong`s (15 s apart) or a path loss, a host is **stale**: rows dim with "as of 14:02", queries answer from cache, commands fail fast.
- **Resume is stateless:** a new `hello`, `subscribe{after}`, unanswered commands resent with the same CommandId (`engine.ts:85-95` does most of it).
- **Routes in v1** (H4): `local`; `ssh`, which forwards a port (a desktop browser that opens it as `localhost` has a secure context); and `direct`, plain TLS over a LAN or a tailnet, with `tailscale cert` giving a tailnet name a certificate browsers accept. iroh and the relay come later, in H10. This amends 0081 d4, where `direct` is an iroh route.
- **The phone's route.** A PWA needs a secure context and a certificate the browser accepts, for its Service Worker and for Web Push. So the phone's v1 route is `direct` over a tailnet (or a LAN name with a trusted certificate). Every host the PWA joins needs a browser-valid certificate too, because the page opens a `wss://` to each.
- **Bytes** come from signed, device-bound URLs that `platform/bytes` issues and the host serves: a plain `GET /b/<token>` on `direct` (TLS) and `ssh` routes, so `<img>` and `<video>` ranges just work; a `bytes.read` stream through a relay once H10 brings one (`borders.md` uses the stream everywhere). Electron main stops reading Project paths (`files.ts:274-279`).

### 4.6 Several hosts

*Decided: decisions 3, 4 and 13.*

- **Addresses carry no host:** `Address{scope: Project(id) | Person | Host(key), app, id}`. Only Host-scope things, which cannot move, name a host.
- **The directory is a client cache**, built from each paired host's `projects.list` with epochs; the higher epoch wins; a host that handed a Project away answers `moved{to, epoch}`. (`borders.md` kept a directory in the Person scope.)
- **The home host keeps the Person documents**, each read whole with a `rev`, fields only added; clients cache them. An Agent's `panes` read is answered on its own host from its own `show.*` facts. An Agent writes Person data (ADR 0071's `keys.bind`) on the home host, as a proposal (§4.3); elsewhere it gets `not_home` and may raise a `call@1` proposal.
- **When the home host is away.** The home host is the always-on host when the Person has one, asked at pairing (`critic-distributed.md` W3); otherwise the laptop, 0062 d13's default and the host most often asleep. While home is away:
  - a write to Person data (keys, settings, sidebar, themes) fails fast, or waits in the visible queue with `not_after` if the Person chooses "send when back";
  - seen marks stay on the device until home answers, then go as ordinary commands;
  - the tiling keeps its bounded overlay (§4.7);
  - reads come from the client's cache, marked "as of".
- **The client integrates:**
  - **Inbox:** one `calls.inbox` per host, merged; a row keeps its host so the answer routes back; each host shows `live`, `stale(as_of)` or `away`; seen marks are joined from the Person document.
  - **Placements:** seeing `show.requested@1` on host B, the client sends `workspaces.place{source event}` to the home host, which applies only events past `placed_through[project]`, with `PaneId = derive(event_id)`. Several clients are idempotent; placements already closed are skipped. A Pane appears once a client is open, the only time anyone sees it.
  - **The home host checks every relayed placement again**, since host B is only semi-trusted and the client only carries it: the Pane kind is in the home host's registry, it is not `runs_as_person`, and the Browser's URL check passes. Anything else is dropped and recorded in Problems.
- **No host-to-host traffic in v1.** An Agent on host A does not act on host B. Cross-host delegation (notes/18:24) waits for store-and-forward peer commands with a receiver-side grant (`work.md` A4). This replaces 0062 d13's "the home host follows other hosts' Projects".
- **Offline:** a command to an unreachable host fails fast with `unreachable{as_of, may_have_run: false}`, or, if the Person chooses "send when back", waits in a **visible queue** with `not_after` (default 10 minutes, at most 7 days); the host refuses `expired` past it. Streams show "as of". The tiling keeps a bounded overlay (§4.7).
- **A Project move is fenced:** every App's `can_move` passes; the source commits `project.handed_off{to, epoch}` as its **last event**, then ships a SQLite online backup, a git bundle with `refs/banda/*` and the data folders; the destination opens only a bundle that names it. `projects.move --check` lists what stays behind and refuses an older target (`critic-distributed.md` W8):
  - Harness sessions and their transcripts: the ADR 0078 store is keyed by path, so the Thread says "this session starts fresh" on the new host;
  - Problems, and the Project's rows in the Host store;
  - the Agents' browser profile, environment sign-ins and volumes;
  - absolute paths that differ between the hosts (`/home/roma` against `/root`), which ACP's cwd and same-path mounts assume equal.

  Apps are installed and granted per host, enabled per Project.

### 4.7 The tiling across hosts

*Decided: decision 8.*

```
key ─► client: model.wasm predicts ─► frame drawn now
         │ intent command workspaces.move{pane, dir}  (FIFO; same CommandId on resend)
         ▼
  home host: model.rs applies it to its current state ─► workspaces.changed@1
         │
  client reconciles by seq; a refusal rolls the frame back
```

- One Rust crate, the workspaces model, serves both sides. Clients send **intents**, not computed states, so `model.ts`'s rules and the lossy diff planner (`arrange.ts:343-524`) go.
- With the home host away, the client keeps a **bounded "not yet saved" overlay**: at most 1 h and 200 commands; a command whose target is gone is dropped on replay.
- This replaces both client `model.ts` and 0062 d17's "rules into the engine one command at a time" (`refactor.md` §4 preferred that; `critic-distributed.md` W2 shows a round trip per key cannot keep up with a remote home host).
- Gate: key press to frame p95 ≤ 16 ms at `--latency 150`; `motion.spec.ts` no slower.

---

## 5. Where an App and its view run

### 5.1 The verdict, in plain words

**The judge picked C, and this document follows it: code runs only where its author is trusted; the rest crosses the wire as data.** *Decided: decision 1. It overturns Roma's earlier wording of 2026-11-06 (B below).*

Roma asked: "does a view run on the client with data from the host, or does everything come from the host?" Neither extreme.

- **The components run on the client.** Banda's release ships one fixed set: shadcn, Banda's own pieces, and live components (a Thread, a terminal, a page, a file view). Typing, scrolling, hover, popovers, tabs, sorting and charts are handled on the device, with no round trip.
- **The App's logic and data stay on the host.** An App's view is a read method there. It reads the App's tables and answers a *tree*: which components, with which props.
- **What crosses is a description, never code.** The client draws the tree with its own components, in its own theme. This is **Level 1**. An App's own HTML page in a frame is **Level 2**, later (§5.4).

**What stays instant on the device**, never waiting for the host:
- the catalogue's code and the device's tokens (ADR 0080);
- per Pane, the last tree with its `at`, the view's `local` state and the pending marks;
- inside components: the focused field (no update overwrites it), popovers and menus, tabs, hover, scroll, table sort and filter, chart series;
- client acts the tree declares: `show | hide | toggle | select | copy | open(intent)`;
- forms checked against the method's JSON Schema before they are sent.

**Why not A, each App's view code on the client:**
- **The phone** would need a JavaScript sandbox per App, a bridge, battery, and App Store 4.7 duties. Roma's notes say the phone "does not need to run arbitrary third-party code" (notes/10:16).
- **Security:** third-party JavaScript would run on every device that holds sessions to all the Person's hosts.
- **Version skew:** one client talks to N hosts with N versions of an App. With code on the client it loads N bundles and versions a bridge API too. With trees only the catalogue is versioned, once (§5.4 says how).

**Why not B, Roma's own wording** ("React runs on the host in a JavaScript isolate", 0062 d7, 2026-11-06):
- B keeps a live JavaScript instance per Pane per client on the host, kept warm, each holding memory and an App pass for as long as the Pane is open.
- When the host evicts one to save memory, the Pane's state is gone. Blazor Server fell into this trap: state kept per client on the server.
- C gives the same "no App code on devices" with a pure read that keeps nothing per client: a tree is always rebuilt from the args, the `local` state and the tables.

Every write is a round trip in any option, because the host is the one writer (0081 d1); client code would speed up only presentation, which the catalogue already holds.

### 5.2 Four places

| Place | What | Code from | Runs in | Phone |
|---|---|---|---|---|
| **Catalogue** | shadcn; Markdown, Mermaid, KaTeX, Diff, FileTree, Console, Kbd, the Mark, meters, Chart; live `<Thread>`, `<PromptEditor>`, `<Terminal>`, `<Page>`, `<FileView>` | the client release | the client | PWA: the web catalogue; native later |
| **Tree** | an SDK App's view, first- or third-party | the App's package | the host | PWA: the web renderer; native later |
| **Frame** | an MCP App's `ui://` page; Level 2 later | the gateway, by hash | a sandboxed iframe, own origin | PWA: the same iframe; native later |
| **Site** | a Web App | the site | a device webview, own partition | PWA: a new browser tab; native later |

`<PromptEditor>` is the Thread's message box, which ADRs 0015 and 0031 call "the composer". This document avoids that name: Roma's «композер» is the tiling (§13).

The App's kind picks the place. A component enters the catalogue only if it needs per-frame interaction or a high-rate stream, **and** two Apps use it or it is a first-party live component.

### 5.3 Scores (from `judge.md`; 5 is best)

These are the judge's scores for the full C: WASM handlers and views, patches by key, and a views service with a cache. The v1 decided here is smaller (first-party Rust views, read again on events, third-party code in workers), so its build and host costs are lower and its security score holds only for the Apps decision 2 lets run.

| | A: view on the client | B: React isolate on the host | C: tiers, render on the host |
|---|---|---|---|
| Feel / latency | **5** | 3 | 3 |
| Offline, sleeping host | **4** | 3 | 3 |
| Security | 3 | 4 | **5** |
| Phone | 2 | **5** | **5** |
| Version skew over N hosts | 2 | 4 | **5** |
| Developer experience | **5** | 3 | 3 |
| Customize by Agents | 3 | 4 | **5** |
| MCP Apps fit | 4 | 4 | 4 |
| Host cost | **5** | 2 | 4 |
| Build cost | 3 | 2 | **4** |
| Unix borders | 4 | 3 | **5** |
| **Total of 55** | 40 | 37 | **46** |

C wins where a mistake cannot be undone: security, skew, the phone. A's wins can be recovered later, through a richer catalogue and Level 2 frames. Code on devices cannot be taken back.

### 5.4 The shape

**A view is a read method whose answer is a tree**, one more kind in `methods!`, so routing, access, ts-rs, the CLI and Agent tools come free.

```rust
view today(ViewAsk<TodayArgs, TodayLocal>) -> Tree, Read, follows ["habit.done"];
command done(Done) -> (), Write, ui;     // `ui`: this App's views may fire it
```

- **Inputs:** the App's tables (the work), `args` (the arrangement's) and `local` (this client's): 0062 d13's three levels.
- **Rules:** read-only; keeps nothing between calls; limits on time, nodes and size. Collecting data is a command.
- **v1 delivery:** the client follows the App's facts and **reads the whole view again**, as 10 of 14 sources already do. Patches and a views cache come when measured (`critic-simplicity.md` W5).
- **Access:** rendering runs as `App{app}`, walled to its Project; a cached tree is keyed by Project and caller.
- **Versions across N hosts.** A host on a newer Banda can write a tree that names a component or a prop the client's catalogue lacks. So:
  - `hello` carries the client's catalogue version (`client.ui`, §4.5), and every tree names the `ui` version it needs;
  - when the client is older, the host's `banda-ui` replaces each newer component or prop by its declared fallback before sending (`judge.md` §3.3);
  - where no fallback exists, the client draws "Update Banda to see this" in that node's place, and the rest of the tree still works.

  The fallback logic lives once, on the host, in `banda-ui`, not in every client or every App.

What the client holds, so a Pane feels instant, is listed in §5.1.

**Acts are commands.** A control shows its new value at once and stays pending until an update at or past the receipt's `at`; a refusal or a deadline rolls it back (ADR 0025's rule). The renderer refuses any method that is not the App's own `ui`-marked command: the client is trusted, the tree is not.

**First-party Apps:** Threads, Terminal, Browser and the Files viewer are live components; their chrome (menus, details rows, lists, settings) moves to views and slots one at a time. **Usage is the first view** (`UsagePane.tsx`, 477 lines, one view-state `useState` at `:103`). Each Pane still in client React carries `[unstable] client-pane`; the count only falls.

**MCP Apps (Frame):** `Visual.tsx` and `visual-frame.ts` grow into `client/frame`: bytes by hash from the gateway, CSP from `_meta.ui.csp`, the look as `host-context`, `tools/call` to the same server only (§8).

**Web Apps (Site):** a manifest is Person data; one partition each (`persist:webapp-<id>`); a browser-tab client shows none.

**Level 2, later:** an SDK App's own `ui://` page served by its host into `client/frame`, speaking MCP Apps messages.

### 5.5 Where a third-party App's code runs

- **First-party Apps** stay Rust, in process; their views come first.
- **Third-party in v1: a worker process on the host** speaking the public protocol with an App pass (`via = app`, walled to its Project). *Decided: decision 2.*
  - The kernel forwards a command; the worker reads at seq N and answers **a tx as data**, `{statements, emit, enqueue, expect: N}`. The kernel commits it with the receipt under the prefix authorizer, or refuses `stale` and the worker retries.
  - A view is a query the worker answers with a tree, under a read-only pass.
  - `run`, `net` and prompting Agents are loud grants.
  - **In v1 a worker has no real wall of its own.** Under F0 alone it still runs as the Person's Unix user, so it can read `~/.ssh`, every Project folder and the network. "Its capabilities ∩ its Project's wall" then binds only its calls to Banda, not the process. So:
    - in v1 a worker runs only Apps the Person made or trusts. The tracer App qualifies, because an Agent builds it for the Person;
    - an App from elsewhere needs the `sandbox` adapter (I5) or a container, which also walls its files and network (`borders.md` §7 and `critic-security.md` §4 defer third-party workers until such a sandbox).
- **WASM handlers inside the writer's transaction** (0062 d4, d14; ComponentizeJS in `judge.md`) wait until an App needs them. The data-shaped tx keeps the door open: WASM becomes a second binding of one contract.
- **A tracer App decides**: a small App built by an Agent on the worker road, installed, customised and tested, as notes/09:7 proposes. 0062 d4 and d14 stay proposed until it passes; d7 is replaced (decision 1) and d5 holds (decision 2).

### 5.6 Three objections, answered

1. **"Every act outside the catalogue is a round trip, 100–300 ms on a phone through a relay: the Blazor Server trap."** Every write is a round trip in all options; only presentation differs, and the catalogue holds it. Blazor failed by keeping state per client on the server; C keeps none, and a tree is always rebuilt from (args, local, tables). If the first ten real Apps keep missing components, bring Level 2 forward.
2. **"Authors lose real React."** True; it is the price. Level 1's first authors are Agents, who write well against a closed, schema-checked catalogue and see their output with `banda call … | jq`. Those who need the DOM get a frame (Level 2). VS Code made the same trade.
3. **"The catalogue becomes a gate Banda staffs forever."** A catalogue exists in every option; A and B draw a closed vocabulary too. Start Raycast-sized (List, Detail, Form, Actions, Table, Chart) and grow by measured need.

### 5.7 Build gates

| Step | What | Gate |
|---|---|---|
| V1 | `banda-ui` crate (`Node`, `On`, `Source`, catalogue names and prop schemas); the `view` kind; **Usage's view in Rust**; `UsagePane.tsx` deleted | render p95 ≤ 5 ms; tree ≤ 30 KB |
| V2 | the client renderer, about 15 components; client acts; pending marks; focused-field rule; "as of" | usable at `--latency 150` |
| V3 | settings sections and Problems as views | `settings/Agents.tsx` deleted |
| V4 | the tracer App on the worker road | an Agent builds, installs and changes it |
| V5 | patches by key, a views cache | only when a measured tree or update rate needs it |

---

## 6. Project isolation

*Decided: decisions 11, 14 and 18.*

**Concept.** An environment is where a Project's programs run. The kernel names it as a port, `Environment` (`spawn`, `pty`, `ports`, `forward`, `door`, `paths`, `status`), beside `Identity`. `platform/environments` provides the adapters `local` (today), `sandbox` (Landlock and seccomp; Seatbelt on macOS) and `container` (Docker or Podman, driven by devcontainer.json). Every program Banda starts for a Project goes through it; a test bans `Command` outside `banda-environments` (about 10 spawn sites today).

**A container is not a host.** The engine, store, passes, Harness accounts and Usage stay outside; otherwise a malicious repo would run as the same user as the store. A remote machine is a host (0081), never an environment; a microVM is a runtime choice of the container adapter.

| Inside the box | Outside, on the host |
|---|---|
| Harness CLIs (`claude`, `codex app-server`), so every Agent tool call runs in the box | engine, store, log, passes, outbox; ACP adapters on the host's Node |
| the Project's own MCP servers (`.mcp.json`) | Banda's tools for Agents, through the door; Person-level MCP servers in the gateway, off by default for an isolated Project |
| terminal PTYs by default ("Open host shell" for the Person) | git bookkeeping (status, diff, checkpoints), hardened, never running Project content |
| dev servers and their ports | Files and Visual images, read with `openat2` |
| git acts (commit, push) and their hooks | the Agents' browser |

**Same-path mounts:** the Project folder, account folders and the Project's temp folder sit at the same absolute path inside, because paths are what ACP, the CLIs and Banda pass to each other.

**One door inward:** the MCP gateway's HTTP endpoint, each route gated by a pass with `aud = door` (`mcp`, `open`, `credential`, `secret`); passes end with the box. Where it listens is decision 18: on a unix socket mounted into the box if the I2 spike shows both Harnesses reach Banda's tools through it, otherwise on loopback (`isolation.md`).

**Browser profiles:**

| Profile | Where | Used by |
|---|---|---|
| Person, `persist:browser` | device | the Person's own tabs |
| Project, `persist:project-<id>` (later, decision 14) | device | the Person's tabs opened from that Project; on by default when isolated |
| Web App, `persist:webapp-<id>` | device | Web Apps |
| Agents of Project P | host Chromium profile under `projects/<id>/browser/agents/` (0062 d12); until then `persist:agents-<project>` on the device (F1) | P's Agents only |

Agents drive only their own Project's tabs, or a tab the Person lends (decided, decision 14). This reverses two of Roma's own browser decisions: ADR 0029 d1 (which tabs an Agent may drive) and ADR 0013 d2 (one browser profile). Agents' profiles never move with a Project: cookies are secrets.

**Network and secrets.**
- Modes per Project: `shared` (v1, the host's network), `private` (own bridge, ports forwarded with the same number), `allowlist` (an egress proxy). `shared` protects disk and processes, not services on loopback; the UI says so, and Banda Cloud hosts never use it.
- Harness credentials: a separate **environment sign-in** per Harness by default (same subscription, own token, revocable alone); the Person's own sign-in is a Linux opt-in.
- Git: no `~/.ssh` or `gh` token inside. Banda's git App pushes with a one-time grant consumed before `pre-push`; an Agent's own push becomes a Question.

**Lifecycle.** devcontainer.json is **untrusted until the Person approves its sanitized hash**: `initializeCommand` (it runs on the host), host mounts, privileged flags and the Docker socket are stripped and shown. Lazy start, idle stop, rebuild only on the Person's word, reconcile by labels after a restart. A move carries the definition; tokens, profiles and volumes stay.

**Security model.**

| Threat | Protected | Not protected |
|---|---|---|
| Agent mistakes (`rm -rf ~`) | the host's home and processes | the Project folder (checkpoints and git do that) |
| Injection that steals secrets | `~/.ssh`, cookies, Keychain, Banda's state, other Projects | the environment's own token; exfiltration through allowed egress |
| Malicious repo | hooks, `postinstall`, git filters run in the box; `.git/hooks` and `.git/config` read-only when untrusted | the Person's own tools in that folder on the host (changes to executable config are flagged) |
| Container escape | — | use `runsc` or Kata; `docker` group membership is root |

**UX.** One switch per Project, **Isolated**: "Agents, terminals and this Project's scripts run in a container. Your files stay where they are." Add Project asks once when a folder looks foreign ("Code you didn't write? Run it isolated"), which sets the Project's trust flag too. Quiet text lines and a log; no spinners.

**Plan.** Isolation can start any time after Phase 1's fence.

| Step | What | Size |
|---|---|---|
| I1 | the port and `local` adapter (= A7) | M |
| I2 | the door: the gateway's HTTP endpoint with door passes; `banda-run` | M |
| I3 | `container` adapter on Linux: devcontainer driver, sanitizer and approval, same-path mounts, `shared` network, environment sign-in, terminal and git acts inside; the switch (mockup first) | L |
| I4 | device profile per Project; Agents walled to their tabs (with F1) | M |
| I5 | `sandbox` adapter | M |
| I6 | `private` and `allowlist` networks; macOS parity | L |
| I7 | host Chromium per Project; credential broker | M |

---

## 7. Unit of work, resources and data lifecycle

| Question | Decided now | Deferred |
|---|---|---|
| The unit of work | **The Turn**, in Threads (`agents_turns.state`). Outbox effects stay bookkeeping (`outbox.rs:9-11`). A workflow is an App's run table plus outbox steps. | A generic **Task** row (`work.md` A1), when a second App has work a Person must see or the phone needs one "Work" list. `task@1` is reserved now so Apps do not invent their own. |
| Supervising processes | **`Hosts<H>`** stays the supervisor (backoff, idle sweep, process groups). | **Units** with desired and observed state; `units.start` for Agents (`work.md` C2). |
| Cross-store work | Delegation inside one Project as today (`send`, `from_thread`). | Store-and-forward delegation across Projects and hosts with a receiver grant (`work.md` A4). |
| Resource kinds | **None in the kernel**; domain data stays in App tables; uniformity through Address, `apps.describe`, `item@1`. | App-defined scopes (`contacts.read`). |
| Compositions | An ordinary App with no view (§4.4). | A declarative file; the name "Automation" ("composer" is the tiling). |
| Outside resources | Usage reads Harness sessions made outside Banda. | Importing a Claude Code or Codex session as a Thread; never attaching to an outside process. |

**Data lifecycle: Apps are disposable, data is durable.**
- The Project owns an App's data: its tables, its events, its files folder.
- **Uninstall keeps the tables and events, read-only.** Purge always writes an export first.
- **A migration refusal blocks one App, not the Project.** Today a newer ledger refuses the whole Project (`store.rs:430-439`); after D4 the App shows `app_unavailable` and the Project still opens.
- **Migrations by hash come later**, when forks and upstream updates need them.
- Backup and move are one artefact: a SQLite online backup, a git bundle with `refs/banda/*`, the data folders. NDJSON export is only for replacing or purging an App. (0081 d9's "sealed log segments" cannot restore App tables.)
- SQLite stays, on the Project's host, which may be one's own server or a cloud host (notes/11:8 lets storage be local, on one's own server or with a managed provider). Banda promises export, not portability to PostgreSQL (notes/11:15 asks how to stay portable between SQLite and PostgreSQL without false promises).

---

## 8. Security model

**Trust levels.**

| Principal | Today | Target |
|---|---|---|
| The Person, by a device gesture | root | root; adding a device needs the Person key |
| An Agent with a shell | the Person (weakness 1) | the fence plus a scoped pass |
| App code, own or first-party | first-party modules in process | in process, or a worker under the fence; its capabilities ∩ its Project's wall bind its calls to Banda; only data reaches devices |
| App code from elsewhere | — | a worker inside the `sandbox` adapter (I5) or a container, so the wall binds its files and network too; not before I5 (§5.5) |
| MCP frame, Agent HTML, web page | an opaque frame | never acts as the Person |
| Repo content | tracked privately (see SECURITY.md) | runs only in its environment |
| Another host; Banda Cloud | — | semi-trusted; never vouches for another host or adds a device alone; cannot act on a device without a gesture there (below) |

**F0, the Banda fence** (before pairing; `critic-security.md` W1):
- **Where:** `environments::Local` applies it in `pre_exec` to every Harness spawn, adapter and children.
- **Linux:** user, mount and PID namespaces hide Banda's state, data and runtime folders, and mount Banda's config read-only. Landlock is a second layer. **macOS:** a Seatbelt profile with the same denies. Codex and Claude Code already sandbox this way.
- **Owner access** goes through `$XDG_RUNTIME_DIR/banda/owner.sock` with a peer-uid check (`SO_PEERCRED`, `getpeereid`), hidden by the fence. TCP accepts only passes and device signatures. Inside a Harness, every call to Banda carries the Agent's own pass.
- **Costs:** hiding the session bus breaks `gh`'s and git's keyring helpers and `notify-send` in Agents' shells (credentials come through the gateway; §10.1); `docker` group membership defeats any fence (detected and shown).
- Without the fence, "Full access" means "this Agent is you", and the UI says so; where the fence cannot hold, the default mode becomes Supervised.

**F1, the browser wall now** (decision 14, which reverses ADR 0029 d1 and ADR 0013 d2 and d7): Agents see only tabs they opened or were lent; Agent-opened addresses load in `persist:agents-<project>`; an Agent reaches a tab only through a per-tab socket handed out by pass.

**F2, bookkeeping never runs Project content:** one `platform/git-cli` that runs no hook, filter, diff helper or other program a Project's config names, on any call; later `gix` in process for reads. A `trusted` flag per Project, which only the Person sets; until it is set, Harness sessions read only the Person's own settings.

**The Person key: a minimal root of trust** (amends 0081 d2, d3).
- One Ed25519 key, made on the first device, kept in the OS keystore, with a **recovery code**.
- It signs a short append-only chain: the members (devices and hosts) and the home host.
- Each host keeps a verified copy of the signed member list in its Host store, checked against the Person key on every update. It is the host's own record of whom it accepts, not Person data and not a Person replica.
- A host accepts a new device only with a chain entry, or a code typed on its own console.
- **A cloud-brokered pairing completes only when an existing device approves it** with a matching code. Until then the session is read-only. The device list says "paired through Banda Cloud", with one-tap revoke.
- Not worth building now: quorum schemes, Sigstore.

**Who acts as the Person:** only a gesture on one of the Person's devices (§4.3). Rights never travel through the outbox; a worker acts as `App{app}` and records `on_behalf`.

**A bad host cannot act through the client** (`critic-security.md` W12). Hosts are semi-trusted, and any of them may send device requests.
- A device request that opens, runs or reads something (`open_outside`, `clipboard` read, `webview` open) needs a gesture on that device, unless that device's Person started it.
- Files fetched to a device are quarantined (the macOS quarantine flag) and land read-only.
- Relayed `show.*` placements are checked again on the home host (§4.6).

**macOS privacy permissions** (`critic-security.md` W16): the camera, microphone and screen-recording permissions the Person gives Banda.app stay with Banda.app and never reach Agents' shells. The machine service (S3) spawns Harnesses from its own binary, not from Banda.app, and an architecture test checks that the client spawns no Harness.

**MCP frames** act as `App("mcp:<server>")`, walled to the Thread's Project, calling only their own server's tools with app visibility, never Banda's own. A write needs a user-activation token the renderer mints on a real click. `ui/message` becomes a draft in the Thread's message box that the Person sends. Agent-written Visuals keep today's frame, with no `tools/call` (`critic-security.md` W7).

**Passes:** hashed, with an audience (`ws`, `gateway`, `door`), a TTL the gateway refreshes, revoked when the session or box ends, stored in the Host store (today an in-memory `HashMap`, `kernel/src/passes.rs`).

**The web client's code** comes only from assets compiled into the signed `banda` binary, never from a disk an Agent can edit (decision 12). In v1 it reaches hosts over `direct` TLS (§4.5); when iroh comes (H10), prefer iroh-in-WASM, end to end to the pinned host key, over an SNI edge (0081 d4).

**Supply chain.**
- Apps install by hash, with no build scripts; a grant binds `(id, publisher key, capabilities)`, trusted on first use. First-party ids and `banda.*` verbs are reserved.
- Sensitive facts (`threads.tool.ran@1` carries commands and output) need a loud grant; sensitive plus `net` is refused for third parties in v1.
- The Inbox draws a call's emitter from the registry, never from the payload.
- The SQLite authorizer allows the App's prefix only: no `ATTACH`, no `PRAGMA` off an allowlist; `trusted_schema=OFF`.
- Electron is hardened once adapters run on the host's Node (S1); the details are tracked privately (see SECURITY.md).

---

## 9. Refactoring plan

### 9.1 Target tree

```
kernel/    banda-kernel: scopes (Project, Host, Person), store, log, cursors, outbox,
           receipts, access, identity and passes, registry, devices, the API over any
           transport, methods!/facts!/view, the Environment port. Names no App.
engine/    the banda binary: composition root (apps.rs generated from app.toml), CLI,
           `banda mcp`, the old-data migration.
platform/  projects, workspaces (+ the shared model crate), settings(-core), keys(-core),
           look, sidebar, calls, harnesses (+ adapters/, a host Node package), gateway,
           bytes, fs, git-cli, environments, problems, sharing, skill. Names no App.
apps/      threads, git, pulls, files, terminal, browser, usage; each with app.toml,
           host/ (crate), view/ (client code until Level 1), skill/.
client/    core (Hosts router, directory cache, Inbox merge, device vocabulary, view
           state, renderer), web, desktop + desktop-kit (main = chrome + device/<cap>.ts),
           ghostty, ui (temporary), mobile (later).
sdk/       contract (generated types, the TS Engine client), ts (@banda/sdk), kit
           (@banda/kit), intents, ui (Tree), app (the Rust binding).
cloud/     auth, api, relay, push, backup; infra/ beside it. Later.
```

### 9.2 Deep-module verdicts

| Module | Verdict | Target |
|---|---|---|
| `store.rs`, outbox core, Heard, `methods!`, `contract/src/engine.ts` | **deep** | keep; add authorizer, cursors, receipts for every command, GC |
| `kernel.rs` (1323 lines) | **mixed**: deep routing plus Project CRUD outside receipts | `router.rs`, `scopes.rs`; `platform/projects` |
| Module host API (`module.rs`, `Tx`) | **shallow, leaky** | the host API as data |
| `look` (7.6k lines) | **grab-bag**; ten crates link it for `OneFile` | a pure resolver; `settings-core` leaf; keys, sidebar out |
| `banda-settings` | **inverted** (six App crates) | a leaf core; file list from `apps.rs` |
| `Shell.tsx` (1562 lines) | **god object** | tiling controller, key router, device adapter; Thread features to the threads view; ≤ 400 lines |
| `@banda/ui` | **no surface** (wildcard exports) | `@banda/sdk` and `@banda/kit` with export maps |
| Threads engine (33 methods) | **deep core, wide surface** | keep `rules`, `writer`, `acp/`; Pipe to `gateway`, notify to `calls`, issues to `problems` |
| Browser engine | **shallow pass-through** | a `Tabs` port and the site policy on the host |
| `window.rs` road | **deep, wrong abstraction** (one holder) | `devices.rs` |
| Watches, notifications | **deep rules, shallow delivery** | `platform/calls` |
| `passes.rs` (62 lines) | **shallow** | hashed, expiring, audience, stored |
| Client `model.ts` + `arrange.ts` | **duplicated rules, lossy diff** | the shared Rust model in WASM |
| `Hosts<H>`, git, files, terminal engines, ghostty, workspaces `model.rs`, `FileLinks` | **deep** | move only |

### 9.3 PRs by phase

One concern per PR; `scripts/check.sh` green after each; a move is a pure `git mv` commit; each PR adds the guard test that keeps it; data is never rewritten. `[W]`: needed by the web client. `[H]`: needed by several hosts.

**IDs against `refactor.md`.** Most IDs mean what they mean there; these differ. Here **A1** = refactor A1 + A2 (the Project list as commands and facts); **A2** = refactor H2 without the Person replica; **A9** = refactor D1; **B4** = refactor B4 + B5; **B7** includes refactor B13 (`item@1`); **B8** = refactor B8 + B9; **B10** = refactor B10 + B11; **E1** = refactor E1 + E2; **E8** = refactor E7 + E8 (seen marks as Person data, not Project data); **H6** = refactor H6 + H8 without H7; **B16** = the `sessions` part of refactor D7; **V6** = the rest of refactor D7; **V1-V3** = refactor D6; **V7**, **V8** = parts of refactor D10. New here: **F0-F2**, **A8**, **T1-T2** (in place of refactor E12), **B15**, **E13**, **V4**. Refactor H7 (host to host) has no step.

**Phase 0: clear the ground**

| ID | What | Size | Depends | Unblocks |
|---|---|---|---|---|
| 0.1 | Drain the 10 open feature PRs (#660, #646, #640, #574, #550, #538, #536, #522, #510, #503); renumber #460; close #385. Land the guards for the privately tracked items before the PRs they concern (see SECURITY.md). | — | — | R0 |
| 0.2 | ADR hygiene (§13), including #557, the 0062 draft itself: its Changes section, then accepted or split; Roma's decisions become ADRs | S × n | Roma | A3, A5, B7, B14 |
| R0 | Rename by an idempotent `scripts/layout.sh` (git mv plus sed) that open branches can run; ids, crates and packages keep their names | L lines, S risk | 0.1 | new crates born in place |

**Phase 1: the base**

| ID | What | Size | Depends | Unblocks |
|---|---|---|---|---|
| S1 | Harness adapters and session shim as a host Node package; Claude usage and sharing's posts on the host | M | R0 | S3 `[W][H]` |
| S3 | The machine service (#460); passes persisted, hashed, expiring | L | S1, A6 | F0, E3 `[W][H]` |
| A7 | `Environment` port, `local` adapter, one spawn chokepoint | M | R0 | F0, I3 |
| **F0** | **The fence**; `owner.sock` with peer-uid; TCP takes only passes and device signatures | M | A7, S3 | H3 `[W][H]` |
| F1 | Browser wall: own and lent tabs; `persist:agents-<project>`; per-tab sockets by pass | S-M | — | H4 |
| F2 | Hardened `platform/git-cli`; the Project trust flag. Born in `platform/`, so it can land before R0, which leaves it in place | M | — | H4, I3 |
| A1 | `kernel.rs` splits; `platform/projects` (commands with receipts and facts) and `platform/fs` leave | M | R0 | A2, E1 |
| A2 | The machine scope splits into Host and Person; Person data as documents with a `rev`; old state migrated | M | A1 | E8, H6 `[H]` |
| A3 | Receipt for every command; final refusals only; params hash | S-M | 0.2 | `[W][H]` |
| A4 | SQLite authorizer | S-M | R0 | T0, A9 |
| A5 | Durable cursors, acked in the transaction | M | 0.2 | B7, E8 |
| A6 | Outbox GC; retry policy per kind; leases with a fencing token for workers outside the engine; `banda mcp` CommandId per request | S-M | — | S3 |
| A8 | Router FIFO per (session, scope); receipts carry `at` | S | A3 | T2, V2 `[H]` |
| A9 | Data-shaped tx: Outcome as data, no raw rusqlite | L | A4 | V4 |
| B1 | One list of Apps: `app.toml` scanned into every list | M | R0 | B2, B7, B14 |
| B2 | `settings-core` leaf | M | B1 | E4 `[W][H]` |
| B3 | `platform/gateway` takes the Pipe and passes | S-M | R0 | B14, V6 |
| T0 | `agents` id → `threads`, with aliases, before facts are published | M | B1, A4 | B7 |
| B7 | `facts!` (`kind@major`, private, gate); `item@1`, `call@1` | M | T0, A5 | B8, E8 |
| B8 | Intents: `show(verb, args)` replaces `AGENT_KINDS`; the client calls by intent, not `Shell.tsx`'s `agents.*` strings | M-L | B7 | T1 |
| B10 | git and Threads decoupled; pulls hears `tool.ran@1` | M | B7, B8, B3 | E10, E11 |
| B12 | Deltas leave the durable log: reply, thought and tool-output chunks go to the `threads.live` stream; the log keeps one complete item at the end (`transcript/output.rs:97-101`; borders d5). It matters for relay and phone bandwidth | M | B7 | H10 `[H]` |
| B4 | `Shell.tsx` splits; slots for details, Pane header, settings sections | L | R0 | L3 |
| B14 | One access rule; wall on the resolved ProjectId | M-L | B1, B3, B8 | B15, H3 `[W][H]` |
| B15 | What an Agent writes into the Person's data becomes a proposal: key lines with args, intent defaults, MCP server lists, Web App manifests land as a `call@1` the Person accepts (§4.3) | M | B14, B7 | — |
| B16 | The `sessions` capability for Threads, served by `harnesses` (borders d20): Threads drops the in-process `Harnesses` value (`engine/src/serve.rs:44, 63, 68`), so it is an SDK App with one unstable mark at most | M | B3, B14 | — |
| E1 | `platform/bytes` (`FileLinks` in Rust, served by the host); Thread media and paths from the host | M-L | A1 | W1 `[W][H]` |
| E3 | The device road | M-L | S3 | E9 `[W][H]` |
| E4 | Settings through the API, each file by its owner | M-L | B2, E3 | E5, W1 `[W][H]` |
| E5 | The look from the API: the Person's theme files come from the home host; resolved on the host for v1 (`look.follow{device facts}`), on the device (WASM or TS) later. `banda look --follow` in Electron main (`app/desktop/src/look.ts:1-5`) stays only for the device's overlay | M | E4 | W1 `[W][H]` |
| E6 | Two small moves: `pane.left@1` emitted on the host (`Shell.tsx:425-433` and `TerminalPane.tsx:96-101` go); `problems.record` from clients (today problems tails `window.log`) | S + S | — | `[W][H]` |
| E8 | Seen marks as a Person document; calls on the host; `calls.inbox`; Watches deleted | L | A2, A5, B7 | E9, H6 `[W][H]` |
| E9 | Who is told decided on the host; Web Push | M | E8, E3 | W3 `[W]` |
| E10 | The commit run on the host; `chain.ts` deleted | M | B10 | — |
| E11 | `files.activity` on the host: the Threads-and-git join that `files/pane/src/live.ts` does in the client today | S-M | B10 | `[W][H]` |
| T1 | The workspaces model as one Rust crate, compiled to WASM | L | B8 | T2 `[H]` |
| T2 | Tiling sends intents; `model.ts` rules go; the overlay | M | T1, A8 | `[H]` |

**Phase 2: the look (ADR 0080):** L1 the look crate is only the look (M-L; after B2, E5 and ADR 0071 step 5); L2 ADR 0080's own steps; L3 `@banda/ui` becomes `@banda/sdk` and `@banda/kit` (M-L; after B4).

**Phase 3: the web client, then several hosts**

| ID | What | Size | Depends | Marks |
|---|---|---|---|---|
| H1 | Version range; `welcome.apps` | S | B1 | `[W][H]` |
| H3 | Challenge first; `hello` by signature; pairing; the Person key with recovery code | L | F0, B14 | `[W][H]` |
| H4 | Transport port; `ssh` and `direct` routes (`direct` = TLS on a LAN or a tailnet, with a browser-valid certificate such as `tailscale cert`; §4.5); credits; heads in `pong`. **No listener leaves loopback before the fence, one access rule, the browser wall and hardened git** (F0 and B14 through H3, plus F1 and F2; `critic-security.md` §4) | M-L | H3, F1, F2 | `[W][H]` |
| H5 | `client/core` Hosts router; stale and fail-fast; the visible queue | M-L | H1, H4 | `[W][H]` |
| W1 | The page runs without Electron | M | E1, E3, E4, E5, H5 | `[W]` |
| W2 | The host serves the client from its binary over `direct` TLS; a web manifest, a Service Worker, a pairing page | M | W1 | `[W]` |
| W3 | Browser device adapter and Web Push: **the PWA is the phone's v1**, over a tailnet (decision 15); every host it joins has a browser-valid certificate | M | W2, E9 | `[W]` |
| H6 | Directory cache, `show.*` relay, merged Inbox and sidebar | M | H5, A2, E8 | `[H]` |
| H9 | The CLI names its host | M | H3, H4 | `[H]` |
| H10 | iroh routes, iroh-in-WASM | L | 0081 spike | `[H]` |

**Phase 4: the SDK road:** V1-V3 views and the renderer (§5.7; after A8, B4, Phase 2's tokens); V4 the tracer App (after A9, B14); V6 the HTTP gateway, `client/frame` and MCP Apps (after B3, F0); E13 the Visual layout check (`lay_out`, `heights`, `agents/engine/src/lib.rs:1111, 1150`) leaves the window: the host's Chromium measures it (after I7), or Visuals move into frames that size themselves (after V6); V7 Web Apps (after E3); D4 per-App migration refusal and uninstall that keeps data; I1-I7 isolation (§6; any time after F0); V8 the installer (folder, git, index, capability diff; after V4 and I5, since an App from elsewhere runs only inside the `sandbox` adapter, §5.5). Then Banda Cloud, a service at a time (0081 step 9).

**Shortest path to the web client** (F1 and F2 may land any time, before R0 too): F1 → F2 → R0 → A6 → S1 → S3 → A7 → F0 → A3 → B1 → B2 → B3 → A4 → T0 → A5 → B7 → B8 → B14 → A1 → A2 → E1 → E3 → E4 → E5 → E8 → E9 → H1 → H3 → H4 → H5 → W1 → W2 → W3. Each step's dependencies in the tables above come before it.
**Several hosts** add A8, T1, T2, H6, H9, and B12 then H10 for NAT. Nothing host-to-host.

### 9.4 What not to refactor

- The Threads pane's fold (`modules/agents/pane/src/thread.ts:158-519`), until `<Thread>` streams host updates.
- Deep internals: `rules`, `writer`, `acp/`, store and outbox cores, git, files and terminal engines, ghostty, `FileLinks`.
- The Person's own browser in Electron: correctly device code.
- Data at rest: table prefixes, log kinds, SQLite.
- Any runtime before its contract: no wasmtime, WIT, ComponentizeJS or JS isolates before A9 runs first-party Apps.
- A reactive query engine, or the reader pool before contention is measured.
- Anything across hosts beyond the client integrator.

---

## 10. Roadmap

**Where to start: the next five PRs.** The critical weakness (§3 row 1) waits for F0, which sits behind R0, A6, S1, S3 and A7. So a stopgap goes first, then what needs nothing else.

1. **A stopgap, S, now.** It narrows accidents, not attacks; F0 is the fix.
   - Label Full access honestly in the mode menu: "this Agent is you" (a visible change, so mockup first).
   - A small fix for a security item tracked privately (see SECURITY.md).
   - The skill teaches `banda settings set` for every settings change.
2. **F1**, the browser wall, now that Roma has taken decision 14. It has no other dependency.
3. **F2**, hardened bookkeeping git and the Project trust flag. It has no real dependency and can land before R0.
4. **0.1**, the drain, guards first.
5. **0.2**, ADR hygiene, and Roma's decisions as ADRs.

| # | Milestone | What it unlocks for the Person |
|---|---|---|
| M0 | Ground cleared (Phase 0, rename) | nothing visible; fewer conflicts |
| M1 | The engine is the machine's service (S1, S3) | close the window and the Agents go on; a restart keeps their passes; usage and sharing work with no window |
| M2 | Fenced Agents (F0-F2) | "Full access" no longer means "this Agent is you"; Banda's own git never runs a repository's content |
| M3 | A hardened kernel (A1-A9) | retries never run twice or stay dead; reactions survive crashes |
| M4 | Calls on the host (E8, E9) | notifications with the window closed; one Inbox; "seen" agrees across windows |
| M5 | A host that may be elsewhere (E1, E3-E6, E11) | two windows behave alike; media, files, settings and the look come from the host; ready for a remote host |
| M6 | Borders (B1-B16, T1-T2) | any App's Pane opens from an Agent by intent; what an Agent changes in the Person's data waits for a yes; the tiling stays instant against a remote home host |
| M7 | The look (Phase 2) | ADR 0080's themes on every client |
| M8 | Web client (H1-H5, W1-W3) | **a phone (PWA, over a tailnet) starts Threads, follows them in the list and the Inbox, stops them, replies to Agents, answers Questions and gets pushes** |
| M9 | Several hosts in one window (H6, H9) | laptop and server in one Inbox, one sidebar, one tiling; stale hosts marked "as of" |
| M10 | First SDK views (V1-V3) | Usage and settings drawn the same on every client, phone included |
| M11 | Tracer App (V4) | an Agent writes a small App, the Person installs and changes it |
| M12 | MCP Apps and Web Apps (V6, V7) | MCP servers' UIs in Threads; X or Meet as an App with its own sign-in |
| M13 | Isolated Projects (I1-I4; any time after M2) | foreign code runs in a container with one switch |
| M14 | Banda Cloud services | pairing without typing codes, reach from any network, native push, backups, a host in the cloud |

### 10.1 Risks of this plan

| Risk | Why it may happen | What limits it |
|---|---|---|
| **A home host that is asleep** | The laptop is the default home and the host most often asleep; Person data lives only there | Ask for the always-on host at pairing; fail fast or a visible queue for Person writes; the tiling overlay; cached reads "as of" (§4.6) |
| **A catalogue too small for real Apps** | Level 1 starts Raycast-sized; an App that needs the DOM gets nothing better until Level 2 | Count misses on the first ten real Apps; when they keep missing components, bring Level 2 (an App's own page in a Frame) forward (§5.6) |
| **IPC latency on the worker road** | Every third-party command and view crosses a process boundary and back | Measure it with the tracer App (V4); WASM handlers in process stay open as a second binding of the same tx contract (§5.5) |
| **F0 breaks the Person's tools in Agents' shells** | Hiding the session bus breaks keyring helpers, `gh` and `notify-send` | Credentials through the gateway; say what is hidden; Supervised as the default where the fence cannot hold (§8) |
| **The rename stalls work** | About 100 commits a day; a drain stops the factory, and branches left open must rebase across every path | An idempotent `scripts/layout.sh` that open branches run; a short drain, as Roma decided (decision 9) |
| **Too much for one person and Agents** | About 70 PRs in this plan (counted from §9.3 and the stopgap), 10 of them L and 9 M-L; about 45 new nouns (`critic-simplicity.md`'s cost table counts them for the designs); Roma's decisions are the scarcest input | The next five PRs first; the decisions at a glance; one concern per PR; defer what §9.4 lists; cut a step when its gate is not needed yet |

---

## 11. Decisions for Roma

Roma accepted every recommendation below on 2026-11-06. The options stay as the record of what was weighed.

1. **Where an App's view runs.**
   - Options: (A) view code on the client, data from the host; (B) a React isolate per App on the host; (C) four places: Catalogue, Tree, Frame, Site.
   - **Decided (Roma, 2026-11-06): C**, with first-party Rust views first, read again on events, and patches only when measured.
   - Changes: **0062 d7** replaced (`judge.md` §4 has the text), with edits to d2, d8 and d10. It overturns Roma's 2026-11-06 wording "React runs on the host in a JavaScript isolate".
2. **Third-party runtime in v1.**
   - Options: (a) WASM handlers inside the writer's transaction (0062 d4, d14); (b) a worker process on the host speaking the public protocol with an App pass, handlers returning a tx as data with an `expect` seq check.
   - **Decided (Roma, 2026-11-06): (b), which a tracer App must prove.** WASM later, as a second binding.
   - The other side: in v1 a worker has no OS wall of its own. Under F0 it still runs as the Person's Unix user and can read `~/.ssh`, every Project folder and the network. So v1 workers run only Apps the Person made or trusts (the tracer App qualifies), and an App from elsewhere waits for the `sandbox` adapter (I5) or a container (§5.5). (a) would have a real wall from day one, at the cost of wasmtime, WIT, ComponentizeJS and fuel budgets.
   - Changes: **0062 d4, d14** (stay proposed until the tracer passes); d5 "Programs: in a worker only" holds.
3. **Hosts in v1.**
   - Options: (a) the client is the only integrator; (b) hosts follow the Person log and the home host follows `show.*` (`borders.md`); (c) peer commands between hosts.
   - **Decided (Roma, 2026-11-06): (a).** (c) later as the only host-to-host primitive, for delegation.
   - Changes: **0062 d13** (the home host no longer follows other hosts; a Pane names no host); **0081** plan step 6.
4. **The Person scope's shape.**
   - Options: (a) a Person log replicated read-only to every host, with epoch handoff (`borders.md`); (b) a few versioned documents only on the home host, cached by clients, moved by export and import.
   - **Decided (Roma, 2026-11-06): (b).** Grants are kept per host.
   - When home is away: the home host is the always-on host when the Person has one, asked at pairing; otherwise the laptop. A write to Person data while home is away fails fast or waits in the visible queue with `not_after`; seen marks stay on the device until home answers (§4.6).
   - Changes: **0081 d1, d9** ("the Person's home"); **0062 d13, d18**; `architecture.md` "Where data lives".
5. **The full-access Agent.**
   - Options: (a) say it is the Person and treat walls as guard rails; (b) the F0 fence by default; (c) every Project in a container.
   - **Decided (Roma, 2026-11-06): (b)**, with (c) for foreign code; the default mode becomes Supervised where the fence cannot hold; F0 lands before pairing.
   - Changes: a new ADR; notes on ADR 0003 d9 and ADR 0006 d3; **0081** plan order (F0 before step 2).
6. **Who acts as the Person.**
   - Options: (a) 0062 d10: frames, trees and compositions act as the Person within capabilities; (b) only a device gesture acts as the Person; the rest act as themselves with `on_behalf`.
   - **Decided (Roma, 2026-11-06): (b)**, plus "text sent to an Agent counts as running a program (the Run right)".
   - Changes: **0062 d10** rewritten; the access ADR.
7. **The Person's root of trust.**
   - Options: (a) the home host; (b) a Person key on devices; (c) Banda Cloud.
   - **Decided (Roma, 2026-11-06): (b), minimal:** one key from the first device, a recovery code; cloud-brokered pairing needs an existing device's approval.
   - Changes: **0081 d2, d3**.
8. **The tiling model.**
   - Options: (a) a round trip per key, rules moved into the engine step by step (0062 d17); (b) one Rust model crate: authority on the home host, WASM prediction in clients, intent commands, a bounded overlay; (c) keep `model.ts` and fix the lossy diff by sending the intent plus its result with `expect` (`critic-simplicity.md` W11), the home host being the machine one sits at.
   - **Decided (Roma, 2026-11-06): (b).** (c) is the cheapest now but keeps two copies of the rules, and against a remote or sleeping home host `expect` refuses exactly when Agents are busy placing Panes (`critic-distributed.md` W2).
   - Changes: **0062 d17**; ADR 0025's one-key-in-flight rule.
9. **Rename timing.**
   - Options: (a) first, after draining open PRs, by an idempotent script; (b) incremental, new crates born in the new layout (`critic-simplicity.md` W6).
   - **Decided (Roma, 2026-11-06): (a)**, with a short drain.
   - Changes: (a) matches **0062 d11** and its Consequences ("it goes first, in one PR, while little is open"); only (b) would change them.
10. **A generic Task now or later.**
    - Options: (a) `kernel_tasks` now (`work.md` A1); (b) Turn stays the unit; `task@1` reserved.
    - **Decided (Roma, 2026-11-06): (b).**
    - Changes: proposed **0082** split: data lifecycle now, Tasks, Units and delegation deferred.
11. **Isolation timing.**
    - Options: (a) after the SDK road (`refactor.md` D9); (b) any time after F0, v1 = Linux container with `shared` network.
    - **Decided (Roma, 2026-11-06): (b).**
    - Changes: a new ADR, "A Project may run in an environment of its own" (`isolation.md` §8.2).
12. **Where the web client's code comes from.**
    - Options: (a) the home host serves it from its signed binary, and it connects to the other hosts too; (b) one origin per host, merging only on the desktop (`critic-security.md` W6); (c) a static, hash-published build from Banda Cloud.
    - **Decided (Roma, 2026-11-06): (a) for v1**, since the home host already holds the Person's data; (c) once Banda Cloud exists.
    - Changes: **0081 d4** and plan step 8.
13. **Seen marks.**
    - Options: (a) Person data on the home host, joined by the client; (b) Thread data in the Project, moving with it (`borders.md` §8 Q1).
    - **Decided (Roma, 2026-11-06): (a)**; archive and snooze follow their own ADRs (0069, 0074).
    - The consequence: a Thread's mark depends on `seen` (`markOf(thread, seen)`, `modules/agents/pane/src/marks.ts:19-24`). With seen marks only on the home host, host B's calls projection works without them: it raises and clears calls from its own facts (asking, done, failed), and the client joins the seen marks to draw each mark. Host B's push, and its withdrawal of a push, rely on device presence, not on seen.
    - Changes: ADR 0081 d12's list of Person files.
14. **Agents and the Person's tabs.**
    - Options: (a) keep ADR 0029 d1 (which tabs an Agent may drive) and ADR 0013 d2 (one browser profile) as they stand; (b) the F1 wall now: Agents see only tabs they opened or were lent, Agent-opened addresses load in `persist:agents-<project>`, an Agent reaches a tab only through a per-tab socket handed out by pass; per-Project profiles (`persist:project-<id>`) later.
    - **Decided (Roma, 2026-11-06): (b).** It reverses (a), which Roma had decided himself.
    - Changes: **ADR 0029 d1**, **ADR 0013 d2**, and ADR 0013 d7 (how Agents reach the browser).
15. **The phone in v1.**
    - Options: (a) the PWA the home host serves (W3), a native app later; (b) a native app (React Native) in the first release; (c) no phone until Banda Cloud.
    - **Decided (Roma, 2026-11-06): (a).** Roma's notes want mobile in the first release (notes/10:7) as a remote client. The PWA covers notes/10:12, "starting, monitoring and controlling tasks": `thread.new` starts a Thread; the Threads list and the merged Inbox, with Web Push, follow them; Stop controls a turn; Questions are answered and replies sent from the phone. Apps' views come as Level 1 trees arrive (M10).
    - The cost: it needs a tailnet or a certificate on every host (§4.5), and iOS sends Web Push only to a PWA added to the Home Screen (iOS 16.4 and later, 0081 d6).
    - Changes: none to an ADR (0081 plan step 8 has the PWA); it reads notes/10:7's "Banda Mobile" as the PWA for v1.
16. **The `agents` → `threads` id rename (T0).**
    - Options: (a) rename the id before facts are published, with aliases (`agents.*` methods for one release, `was = ["agents"]` for events, `agents_*` tables kept as a legacy prefix); (b) skip it: the UI says "Threads" anyway, and aliases cost forever (`critic-simplicity.md` W6).
    - **Decided (Roma, 2026-11-06): (a).** Published names are the expensive ones, and this document names facts by App id (`threads.turn.began@1`). (b) would have needed a published fact to carry a name other than its App's id.
    - Changes: none to an ADR; `refactor.md` T0.
17. **Intents in v1.**
    - Options: (a) one handler per verb: `verb@major` in manifests, resolved to the target's own App or the only handler, and a second handler refused at install; (b) the governance in borders d7: Person defaults in `intents.toml`, an `ambiguous` picker, namespaces, version negotiation.
    - **Decided (Roma, 2026-11-06): (a).** About six first-party verbs, each with one handler today (`critic-simplicity.md` W7). Defaults and pickers come when a second handler exists; the names stay, so (b) can follow.
    - Changes: none to 0062 d6, which names no resolution rule; drops `intents.toml` from v1 (§1 rule 1, §4.4).
18. **The isolation door.**
    - Options: (a) the gateway's HTTP routes on loopback, `http://127.0.0.1:<engine>/door` (`isolation.md`); (b) the same routes and door passes on a unix socket mounted into the box at a fixed path, with `banda-run` as the only client inside (MCP over stdio relayed, `open`, `credential`, `secret`). Both critics prefer (b) (`critic-security.md` W14, `critic-distributed.md` §3 row 10).
    - **Decided (Roma, 2026-11-06): (b), if the I2 spike shows both Harnesses reach Banda's tools through it.** Boxes outlive the engine, whose port can change, and on `private` networks a socket needs no route or reverse forward to the engine's port at all. Either way a door pass carries `aud = door`, which the WebSocket API refuses (B14). Otherwise (a).
    - Changes: the isolation ADR (§13).

---

## 12. Roma's brainstorm: what is adopted

| Idea (notes) | Status | Where |
|---|---|---|
| Personal environment for people and Agents; Install, Customize, Share (00) | adopted | §1 |
| Small Rust core, no Electron in it; engine runs headless (01:6-15) | adopted | S1, S3, §9.1 |
| A third party can build what a bundled App does (01:13) | adopted | §5.5, unstable marks |
| "Everything is an app" is a contract, not the kernel's shape (00:12, 12:45) | adopted | §1 layers |
| Unite control, not databases; no DB sync at first; stale state marked (13:7-14, 13:26) | adopted, strictly | §4.6, decisions 3-4 |
| Node ID + Resource ID addresses (13:12) | **changed**: no host in an address | §4.6 |
| Mobile in the first release, as a remote client (10:7-16) | adopted as the **PWA in Phase 3** (decided, decision 15); native app later | M8, W3 |
| Define once, adapt everywhere (10:29) | adopted as trees and tokens | §5 |
| MCP as the interop border; MCP UIs in a frame (03) | adopted | §5.4 Frame, V6 |
| Compositions as an ordinary App (04) | adopted as a shape; built later | §4.4, §7 |
| Store with no gatekeeper; reproducible packages (05) | adopted; install by hash | V8, §8 |
| Agent-editable software; a tiny App through an Agent (08, 09:7) | adopted as the tracer App | §5.5, V4 |
| Apps disposable, data durable (12:11) | adopted | §7 |
| Third-party isolation (09, 12:41) | adopted: worker plus fence; Projects in containers | §5.5, §6 |
| Task as the visible unit of work (10:12, 18) | **deferred**; `task@1` reserved | §7 |
| Agent as a standing resource, "Arc" (15:11, 18:19) | **deferred**: a standing Thread later; ADR 0006 stands | `work.md` A5 |
| App → Agent → Session → Process (15:14) | **not adopted**: identity is not execution | `work.md` C1 |
| Delegation across hosts (18:24) | **deferred** to store-and-forward peer commands | §4.6 |
| Apps registering resource kinds in the kernel (15:18) | **rejected** | §7 |
| Storage local, on one's own server or with a managed provider (11:8); portability between SQLite and PostgreSQL (11:15) | **changed**: SQLite on the Project's host, which may be one's own server or a cloud host; export, not a promise of PostgreSQL | §7 |
| Cloud "sync" (11:9); several networks on one node (13:20) | **rejected** / **deferred**: one writer, one owner per host | §1, 0081 d10 |
| Desired and observed state for supervised things (18:10) | **deferred** (Units); `Hosts<H>` stays | §7 |
| Tracing across hosts (18:16) | **deferred**: the CommandId as trace id; `cause` on events and `banda trace` later | `critic-distributed.md` W10 |
| The tiling in the Electron shell (01:7) | **changed**: one Rust model, authority on the home host | §4.7 |

---

## 13. ADR hygiene after the decisions

**Draft 0062** (PR #557).
- Add a **Changes** section naming each earlier ADR decision it reverses or amends. The map lists them: ADR 0005 d12-13, ADR 0014 d3, ADR 0029 d1, ADR 0032 d3, ADR 0040 d3, ADR 0056 d1; and it supersedes PR #385.
- d2: kernel "the App runtimes" → "the handlers' runtime"; platform adds `environments`, `calls`, `bytes`, later `views`.
- d4, d14 stay **proposed** until the tracer App; add the worker road. d7 replaced (decision 1). d10: frames act as `mcp:<server>`.
- d13: "a Pane names its host" goes; the client integrates; Person documents on the home host. d17: the shared model crate. d19: PR #460's new number.
- Plan: the fence before several machines; isolation after the fence; the tracer App before step 9.

**ADR 0081** (accepted; amend by a new ADR, not by editing):
- d2, d3: the Person key with a recovery code; cloud-brokered pairing needs an existing device's approval.
- d1: the Person's records are documents on the home host, with no replicas. d9: backup is a SQLite backup plus a git bundle, not log segments.
- d4, plan 8: the web client comes from the home host's binary, never from disk.
- d4: `direct` comes before iroh, as plain TLS on a LAN or a tailnet with a browser-valid certificate (H4); iroh and the relay come in H10.
- d10: a suspended cloud host needs `next_wake_at` and a wake through `api`; keep it always on until then. d11: a move is fenced by `handed_off` as the source's last event.
- d12: seen marks join the Person's files (decision 13).
- Plan: step 6 becomes "the client integrates hosts"; F0 lands before step 2.

**This vision's own amendments**, each carried by the ADR that records its decision:
- ADR 0013 d2 and d7, ADR 0029 d1: Agents see only their own and lent tabs (decision 14).
- ADR 0022: `module.toml` becomes `app.toml` (B1).
- ADR 0025: one key in flight gives way to prediction and intent commands (decision 8).
- ADR 0003 d9 and ADR 0006 d3: the default mode is Full access only where the fence holds, otherwise Supervised (decision 5).
- ADR 0040 d3: a host-wide listener over every local Project's published facts, for the calls projection only (E8).
- ADR 0081 d4 and d12, as above.

**New ADRs to write:**
- borders and protocol: three scopes, four kinds, receipts for every command, published facts, durable listeners, intents, the access rule, the device road, frames, bytes;
- trust and the fence: F0, who acts as the Person, passes, the Person key;
- Project isolation (`isolation.md` §8.2);
- versioning: the protocol range, each App's `api`, majors of published facts, the catalogue's `ui` version and its fallbacks;
- the 0082 split (below).

**PR #460** (the engine as the machine's service): give it the next free ADR number; add the owner socket with a peer-uid check, or point to the fence ADR.

**PR #385:** close as superseded by 0062.

**Proposed 0082** (`work.md`): split it. Keep data lifecycle (uninstall keeps data, per-App refusal, backup as SQLite plus git) and the safe `banda mcp` CommandId. Move Tasks, Units, delegation, compositions and migrations by hash to "deferred".

**`docs/architecture.md`:** three scopes in "Kernel" and "Where data lives"; a short **trust model** section (the fence, who acts as the Person, passes); the command path (a receipt for every command, final refusals only, `at`, FIFO per session and scope); the device road in "Window"; and in "Checks that hold the shape": "platform names no App", "no `Command` outside `banda-environments`", "`client/desktop` reads no Project path".

**`GLOSSARY.md`:** add Host scope, Person scope, home host, intent, published fact, environment, the fence, Catalogue, Tree, Frame, Site, and the other new words of §1; rename the Harness process pool's "host" to avoid the clash with a host machine; keep "composer" for the tiling (Roma's word) and never for compositions. ADRs 0015 and 0031 and `keys.toml`'s `composer` scope use "composer" for the Thread's message box, so one of the two meanings needs a new name; this document says "message box" (`<PromptEditor>`, §5.2).
