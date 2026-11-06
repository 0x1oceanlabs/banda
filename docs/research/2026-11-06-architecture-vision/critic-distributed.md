# Banda's architecture under failure: single writer, sleeping hosts, skew, moves

Input to [the vision](../2026-11-06-architecture-vision.md) (2026-11-06). Roma's decisions are in its §11 and override this document where they differ.

All code paths below were checked in `arch-review` at `9916fff9`.

## 1. Strengths to keep

- **Exactly-once inside one scope works.** The receipt commits in the same transaction as the change, and the writer checks it again before running (`kernel/src/store.rs:209-242`, the check at `:219`). So two copies of one CommandId arriving at once commit once. Every way of crossing a scope should end in "a derived CommandId lands on this receipt check". Do not add a second exactly-once mechanism.
- **Subscriptions have no gap and no repeat.** A subscriber listens before it reads, falls back to the log when it lags (`SUBSCRIBER_LAG`, `store.rs:22`), and resumes by `after` (`api.rs:377-397`, the resubscribe in `contract/src/engine.ts`). This is what makes "resume is stateless" honest across N hosts.
- **The outbox is owned by the boot, and that survives sleep.** Effects keep order per key and always settle. Recovery is per boot, and the module picks replay or abandon (`outbox.rs:124-166`; agents' `OnRestart::Abandon` at `modules/agents/engine/src/lib.rs:1255`). A process cannot pause without its boot pausing too, so this ownership is immune to laptop sleep. Keep it (see W5).
- **The log is append-only and every event has a global id.** Triggers enforce append-only, and `EventId` is UNIQUE (`store.rs:26-41`), so dedupe across hosts already has its key.
- **Clients choose CommandIds, and the ids survive reloads.** Pane args keep them (`engine.ts:154-172`). Refusal codes include `may_have_run`.
- **A Project is quiet before it moves.** Agents' `can_move` refuses while a turn runs (`agents lib.rs:1233-1243`). That is the right pattern for a move between hosts; extend it to every App.
- **Addresses have no host.** A Pane is `{project, kind, args}`, and `ProjectId` is a global UUIDv7. References survive moves.
- **In the designs:**
  - Commands fail fast; queuing happens only when the Person asks, visibly, with `not_after` enforced by the host.
  - `as_of` is on everything.
  - Reaction and workflow steps use derived ids.
  - 0082's delegation is store-and-forward, answers on every end state, and has a delivery deadline.
  - 0082's boot rule turns an orphaned Task into `interrupted`.
  - Migrations are identified by hash, and a refusal blocks one App, not the Project.
  - The container is not a host, and boxes are reconciled by label.
  - View verdict C keeps no per-client state on the host, so a reconnect is just a re-follow.
  - 0081 keeps one writer and no CRDT, a client takes a route only when it "answers as that key", and the host signs its own sessions.

## 2. Weaknesses, ranked

### W1 · Critical: moves and handoffs are not fenced, and passing errors become permanent answers

- **Two writers after a crash in a move.**
  - Today the freeze is an in-memory `RwLock` (`kernel/src/project.rs:207`, taken at `kernel.rs:566` and `:1060-1064`).
  - In the borders design, the destination "opens at epoch+1 and publishes `located`", and the source then keeps a tombstone. If the source crashes after sending the bundle and before writing the tombstone, it restarts unfrozen at epoch n while the destination writes at n+1.
  - That is two writers on one Project, which 0081 d1 forbids.
- **Split brain after a forced take.** The Person handoff has the safe order: the new home writes only after it reads `handed_off` in the old home's log. But `person.take --force` leaves the old home writable by its local Electron until it hears a peer, and nothing says what happens to the writes it took in that time.
- **A passing error becomes the command's permanent answer (a bug in today's code).**
  - `kernel.rs:584-588` keeps every `Err` of a command as its receipt.
  - That includes `Refusal::internal`, which `store.rs:241` and `error.rs:100-108` turn engine failures into. This contradicts `store.rs:207-208`: "An engine failure does not [get a receipt], so the caller may try again".
  - The designs add `moving`, `not_home`, `busy`, `stale` and `unreachable` at the same spot. Each would become the permanent answer for its CommandId and would travel to the destination inside the SQLite bundle.
  - Pane args keep CommandIds across reloads, so an action that hit one of these stays dead.
- **Fix:**
  - Give each refusal code a `final` flag. `refused()` keeps only final refusals. It never keeps `internal`, `moving`, `not_home`, `busy` or `moved`.
  - A Project move takes the Person-handoff order:
    1. The source goes quiet. Every App's `can_move` must pass: no running turns, the Project's Units stopped, only abandon-able outbox rows, no open Questions.
    2. The source commits `project.handed_off{to, epoch, at_seq}` as the last event of its own log.
    3. The source ships the bundle.
  - The destination opens only a bundle whose last event names it. The tombstone is in the log, so it survives a crash with no second record.
  - An abort is `handoff_aborted`, written only after the destination confirms it never opened the bundle, or when the Person forces it.
  - After a `--force` take, the returning old home moves the writes it made after the split into `person_orphans` and shows a line: "changes made while cut off were not kept · Show".
  - Put the epoch on every `kernel_events` row and check it when an effect settles (W5).

### W2 · High: the tiling cannot keep up with a remote home host, and the pipelining design rests on an ordering that does not exist

- **One key per round trip.** ADR 0025 (`:93-103`) sends one command at a time, and the next waits until the window draws the event. Through a relay at 150 ms round trip, that is at most about 6 keys a second, each with 150 ms of lag.
- **Ordering in the code.** The borders design says "commands from one connection to one scope commit in the order sent". Today they do not: `api.rs:371-375` starts each `Call` as its own `tokio::spawn`, and the receipt read and `access` are async, so two pipelined keys can reach the writer swapped.
- **Ordering on QUIC.** "One QUIC stream per Banda stream" gives no order between commands either, if each command rides its own stream.
- **Spurious `stale` refusals.**
  - The borders design's `expect{seq}` compares against the Person scope's seq.
  - The arrangement emits its whole state on every change (`Say::Whole`, `modules/workspaces/engine/src/lib.rs:857`).
  - So every Agent placement from any host bumps the seq. Optimistic keys get rolled back exactly when Agents are busy.
- **Fix:**
  - The router runs one FIFO per (session, scope) instead of a task per frame.
  - Commands go on one ordered QUIC control stream. Streams and bytes get their own.
  - Tiling commands become intents, such as `workspaces.move{pane, dir}`. The home host applies each to its current state (rebase, no `expect`).
  - The client predicts each key with the same Rust model compiled to WASM, then reconciles when the event arrives.
  - Use `expect{workspace_rev}` only for destructive changes to several Panes.
  - Gate: from key press to frame, p95 ≤ 16 ms with `--latency 150`.

### W3 · High: sleeping and suspended hosts stop the hub that all other hosts depend on

- **The laptop home sleeps.**
  - The home host is the laptop by default (0062 `:281`), and in v1 every host dials the home host and the home host follows their `show.*` facts.
  - With the lid closed, nothing places the server's Agents' Panes, `delegable` writes fail, replicas freeze, and the phone cannot rearrange anything (0062 `:286-289`).
- **Cloud hosts are suspended and nothing wakes them.**
  - Cloud hosts are "suspended while the Agents are idle" (0081 `:150`).
  - iroh dials by key through the host's live relay connection, which a suspended VM no longer holds, and nothing in 0081 starts the VM again.
  - Anything that must act at a given time does not run: outbox `next_at` retries (`outbox.rs:197`), `deliver_by`, receipt and outbox cleanup, restarting `want=running` Units, and time-based pushes.
  - Snooze is fine: ADR 0074 d3 needs no timer.
- **Fix:**
  - Before suspending, the host tells `api.banda.so` its `next_wake_at`: the earliest outbox `next_at` or deadline.
  - `api` starts the VM through the provider's API at that time, and whenever a device asks to reach host X. The client shows a quiet line, "Waking the server…".
  - The default home is the always-on host when the Person has one; ask at pairing.
  - In v1, no host depends on another host (decision 1 below).

### W4 · High: an event-sourced Person replica on every host is the most expensive part and the least needed

- **Version skew.**
  - An event-sourced replica must fold every Person event.
  - Hosts update on their own schedules (ADR 0072 waits for Threads), so a newer home host writes `workspaces.changed@2` and an older replica cannot apply it.
  - "A `down` function for one release" does not cover days of skew across N hosts.
- **Size.**
  - The whole arrangement is logged on every change (`lib.rs:857`).
  - The log cannot be compacted, because triggers forbid it (`store.rs:38-41`).
  - Every newly paired host replays it from seq 1.
- **Grants arrive late.**
  - Grants are replicated, so host B acts on the home host's grant or revocation late, with no bound on how late.
  - This also breaks the borders design's own rule 4: "never trusts another host's decision".
- **What actually reads the replica.** An Agent's `panes` read, the keys in force, `intents.toml`, `[notify]`, and grants. All are small documents, or can live on each host.
- **Fix:**
  - **Documents.** The Person scope becomes a few versioned documents (arrangement, keys, sidebar, intents, notify, themes), each with a `rev`. Hosts and clients cache them through `person.docs{since_rev}`. Each document is read whole, and fields are only added, so old readers ignore new ones.
  - **Grants.** Grants are kept per host at install time; the client sends the same grant to each host.
  - **Agents' reads.** An Agent's `panes` read is answered from its own `show.*` facts, on its own host.

### W5 · High: retries give up too soon, the planned leases depend on the wall clock, and nothing fences them

- **Retries give up in seconds.** `ATTEMPTS = 5` with backoff from 500 ms, doubling (`outbox.rs:97, 110-112`). A network effect fails for good after about 7.5 s: one Wi-Fi drop, a laptop waking, or a relay reconnecting is enough.
- **Leases break under sleep.**
  - 0082 and plan step D2 replace `boot` with `lease_until`.
  - When a laptop wakes, every wall-clock lease has expired while the workers that held them carry on, so effects run twice.
  - Settling updates `WHERE id = ?` only (`outbox.rs:304-325`), so a late worker overwrites the result of the worker that reclaimed its effect.
- **Fix:**
  - Keep `boot` ownership for effects run inside the engine.
  - Use leases only for workers outside the engine. Each claim gets a `claim` counter, a fencing token, checked at settle (`WHERE id=? AND claim=?`) and on every call the worker makes under that claim. Renew leases on monotonic time.
  - Set retry policy per kind: an `until` deadline for network kinds, 5 tries for local ones.
  - The SDK says plainly that effects outside Banda run at least once, so writes to the outside carry an idempotency key or read before they write. This covers pulls on GitHub, push, sharing and `git push`.

### W6 · High: duplicate-run holes that remote links will widen

- **Retried MCP tool calls can get another call's result.**
  - Receipts check module, method and author, but not params (`store.rs:355-387`).
  - The planned `derive(pass, MCP request id)` (0082 hop 2, plan step A6) collides whenever MCP request ids restart under the same pass: Claude Code reconnecting its MCP server, or a new `banda mcp` process.
  - When that happens, a different tool call silently gets the old call's answer.
- **A resend can race the original.**
  - The original call's task keeps running after a disconnect (`api.rs:373` is never cancelled).
  - The resend passes the receipt read on the reader (`kernel.rs:569-575`).
  - So IO a handler does before `Call::command` runs twice. `files.write`, `rename` and `trash` do that IO inline.
- **Long commands run twice.** `compose.text@1` (borders §3.5) calls the Harness before it writes, so a retried step starts a second run.
- **Fix:**
  - Store `hash(params)` in `kernel_receipts`, and refuse a mismatch as `conflict`.
  - `banda mcp` gives each MCP request a fresh CommandId and reuses it only when it resends that request itself.
  - The router keeps an in-flight table per (scope, CommandId); a second arrival waits for the first.
  - Any work longer than one write returns a `task`, and its result arrives as a fact.

### W7 · Medium: durable cursors, Project moves and receipt cleanup do not line up

- **Old replays outlive receipts.**
  - Receipts are deleted after 30 days, yet reactions across scopes dedupe through receipts while a cursor can replay further back.
  - Example: a laptop offline for 40 days comes back, and its `show.requested` events replay. `PaneId = derive(event)` no longer dedupes, so closed Panes reopen.
- **History fires again after a move.** Cursors kept in the host's store do not move with the Project. A composition enabled in a moved Project starts at seq 0 on the new host and fires its whole history again.
- **No single seq to resume by.** `tasks.follow` "over every open Project … resumed by seq like Heard" (0082 A1) and one `calls.inbox` per host both span several logs.
- **Fix: two kinds of listener.**
  - **Acting listeners** (compositions, git, pulls) keep their cursor in the source Project's store. They acknowledge in the same transaction as the command or effect they create. The cursor is the dedupe, so receipt cleanup is safe, and cursors move with the Project.
  - **Pure projections** (calls, tasks, items) are written into the Host store with their own seq. A Project arriving or leaving rebuilds its rows, and a client resumes with one number per host.

### W8 · Medium: a Project move loses things nobody listed, and can land on an older host

- **Not moved, and not listed anywhere:**
  - Rows in the Host store that belong to the Project. 0082 puts Units in the host's `supervisor_units`, so dev servers keep running on the source against a tombstone.
  - Problems.
  - The ADR 0078 session store and the Harness transcripts, which are keyed by path.
  - Environment sign-ins and volumes, and the Agents' browser profile.
- **Paths differ.** Absolute paths differ between hosts (`/home/roma` against `/root`), yet ACP's cwd and the isolation design's same-path mounts assume they match.
- **Moving to an older host.**
  - Newer migrations make today's code refuse the whole Project (`store.rs:435-439`), and under 0082 F2 the App becomes unavailable. A Project with Threads unavailable is broken.
  - First-party Apps cannot be "installed from the source's package" (borders §5): they are part of the binary.
- **The freeze lasts the whole transfer.** A repository of several GB sent through a relay freezes the Project for minutes or hours.
- **Fix:**
  - `projects.move --check` lists what will not move, and refuses when the target's version is older than the source's migrations.
  - Copy git, files and a SQLite online backup while the Project still runs. Then freeze, send the rest (events after seq N, an incremental git bundle, a new copy of the small database), and write `handed_off`.
  - A Project's Units live in the Project store.
  - The Thread says "this session starts fresh" when its Harness session could not move.

### W9 · Medium: a backup of "sealed log segments" (0081 `:115`) cannot restore a Project

- App tables are written next to events and nothing guarantees they can be rebuilt from them: Questions, `git_runs`, receipts, the outbox, cursors.
- The checkpoint refs live in git, outside SQLite.
- **Fix:** backup and move are one artefact: a SQLite online backup, plus a git bundle including `refs/banda/*`, plus the data folders, sealed. The NDJSON export (0082 F5) stays only for replacing or purging an App.

### W10 · Medium: nothing ties one piece of work together across hosts

- An event does not record the command that caused it: `kernel_events` has no such column (`store.rs:26-37`).
- A receipt does not record the seq it produced.
- Problems belong to the Host scope, so they stay behind when a Project moves.
- A host's logs cannot be read from another machine.
- **Fix** (cheap, columns are only added):
  - Add `cause` (the CommandId) and `epoch` to events, and `seq` to receipts. A derived id records its source event.
  - `banda trace <id>` asks every host it can reach, searching receipts, the outbox, tasks and events by `cause`.
  - Add `banda logs --host`.
  - `pong` carries `{time, version, heads}`, which feeds a hosts strip showing clock skew and version.

### W11 · Medium: dead hosts are noticed slowly, and calls can hang

- Two missed 15 s pongs means up to 30 s before a host is marked stale. Meanwhile commands sit, and "a call made while the engine is away waits for it" (`engine.ts:90`).
- **Fix:**
  - Every command must answer within a deadline; anything long returns a `task`. A receipt missing after about 5 s triggers an immediate probe.
  - A query to a stale host answers from cache with `as_of` instead of waiting.
  - QUIC path events feed staleness.

### W12 · Low: smaller edges

- **0082's answers retry forever.** `delegation.answer` retries with no limit, even after host S is unpaired. Make "peer gone" a settle reason, shown in Problems.
- **`threads.answered` dedupes through a receipt that expires** after 30 days. Make it idempotent by state: an answer to a closed delegation is OK.
- **Cancel can overtake delivery.** Key `delegation.cancel` by the delegation, as delivery is keyed.
- **Two names for one deadline.** `deliver_by` (0082) and `not_after` (borders) are the same thing. Use one field, checked by the receiver on its own clock, with an allowance for clock skew.
- **View pending marks can wait forever (C).** A view's act stays pending "until a patch at ≥ the receipt's `at`". If the act lands in another scope, that patch never comes. Add a deadline, after which the mark settles.

## 3. Contradictions between the designs

| # | One design says | Another says | Resolve to |
|---|---|---|---|
| 1 | Borders rule 6 and d12: hosts link only by two follows, never by RPC; a star around the home host | Borders §5: `delegable` writes forwarded to the home host with a delegated pass, which is an RPC. 0082 A4: `peer` methods `threads.asked` and `threads.answered`, a mesh in which S dials L. | One host-to-host primitive: 0082's store-and-forward peer command. None in v1. |
| 2 | Borders rule 4: no host acts on another host's decision | Borders d18: grants per Person, replicated, "one decision covers every host" | Grants per host. Reword rule 4: a paired host's word on who is calling is trusted; the decision on rights is always local. |
| 3 | Borders §5: a Person-scope grant `{from, to, intents, until}` for delegation | 0082: `threads.allow`, a Project setting | 0082's version: it lives in the receiving Project and is decided there. |
| 4 | Borders step H6: a Person-scope directory | 0082: "v1 asks the paired hosts" | The client builds the directory from each host's `projects.list` plus epochs; the highest epoch wins. No Person directory in v1. |
| 5 | Borders: `task@1` is a fact any App emits; its states have no `interrupted` | 0082: a `kernel_tasks` row, transitions enforced by the kernel, the boot rule | 0082's row. `task.changed@1` is its published fact. |
| 6 | Borders §4: optimistic apply with the shared Rust model in WASM | Refactor §4: no Rust model in WASM. Step E12 moves the rules into the engine, which is a round trip per key. | Build the WASM model crate first, then do E12. |
| 7 | Borders: commands from one connection commit in order; one QUIC stream per Banda stream | `api.rs:371-375` spawns a task per call | A FIFO in the router and one ordered control stream. |
| 8 | Refactor plan: "outbox core kept"; agents rely on `OnRestart::Abandon` | 0082 step 2 and plan step D2: "leases replacing boot" | Boot ownership inside the engine; leases with a fencing token outside it. |
| 9 | Borders: the move bundle is a SQLite backup plus a git bundle | 0082 F5: NDJSON, "one format for backup, move and replace". 0081 d9: backup is log segments. | SQLite plus git for backup and move; NDJSON only for export and replace. |
| 10 | Borders: the box reaches the gateway through a mounted socket | Isolation: an HTTP door at `127.0.0.1:<engine>/door` | A unix socket at a fixed path. Boxes outlive the engine, and the engine's port can change. |
| 11 | 0082: `program` Units with `want=running` stay in the Host store and restart at boot | Isolation: boxes stop when idle. Borders: a move carries the Project scope only. | A Project's Units live in its store, count as activity for its box, and are stopped before a move. |
| 12 | Notes 13:11: a node stays autonomous; losing the other nodes does not stop local Banda | 0062 `:286-289`: without the home host, the arrangement changes none | The client overlay in decision 3. |
| 13 | 0081 d8: a client works with a host one version behind | Borders: `down` for one App release; a Person replica must fold every event | Version windows measured in time; Person data as documents. |
| 14 | 0081 `:150`: a cloud host is suspended while the Agents are idle | Outbox timers, deadlines and pushes need it awake; `views.follow` keeps it awake | `next_wake_at`, and a wake through `api`. |
| 15 | Isolation §5.3: a move to a host without Docker falls back to `sandbox` | Isolation's own security premise | A downgrade needs the Person's confirmation. |

## 4. What to cut or defer

- **Links between hosts, all of them, in v1:** both follows, `delegable` forwarding, and pairing a host as a device. The client bridges instead (decision 1). An Agent on a host that is not home gets `not_home` when it tries to write Person data.
- **The Person replica.** Cut the event-sourced replica, `person.hand_off` and `--force`. In v1 the home host is set at pairing. Changing it means exporting the documents, importing them on the new home, and unpairing the old one.
- **`expect{seq}` on a whole scope:** never. Add `expect{workspace_rev}` later, if it is needed.
- **Wall-clock leases for effects run inside the engine:** never.
- **Breaking majors of published facts, and `down` functions.** No major above 1 until third-party Apps ship; add new kinds instead.
- **Hot Project moves.** In v1 a move is backup, restore and `handed_off`, started by the Person on a quiet Project. Add the live pre-copy when bundles get large.
- **Suspending cloud hosts.** Keep them always on until `next_wake_at` exists.
- **Work across hosts.** Task trees across hosts, cancel cascades and Agent-to-Agent work across hosts stay deferred (0082 step 7), and wait until W1, W5 and W6 are fixed.
- **Acting listeners over every Project on a host:** none in v1. Only projections (calls, tasks, items) span Projects.
- **The 64-command window and credit tuning:** after the router FIFO exists and has been measured.

## 5. Three decisions for Roma

### Decision 1: what connects hosts in v1?

- **Options:**
  - (a) Nothing; the client is the only bridge.
  - (b) The borders design's two durable follows: every host follows the Person log, and the home host follows `show.*`.
  - (c) 0082's peer commands through the outbox.
- **Recommendation: (a) now, and (c) later as the only primitive between hosts. Drop (b).**
  - The client already connects to every host (0081 d6 merges the Inbox there).
  - Placement works through the client. When a client sees a `show.requested` event on host B, it sends `workspaces.place{source: event address}` to the home host.
  - The home host applies only events past `placed_through[project]` and advances that cursor in the same transaction. Several clients are idempotent, and with no client open, nothing is lost.
  - Placements that are old, or already followed by `show.closed`, are skipped. That also avoids 30 Panes appearing at once after a laptop wakes.
- **What it removes:** the star around the home host, pairing a host as a device, cursors across hosts, version skew inside follows, and any dependence on the home host being awake.
- **Cost:** an Agent's Pane on host B appears only once a client is open. That is the only time anyone can see it anyway.

### Decision 2: what is the Person scope?

- **Options:**
  - (a) An event-sourced log on the home host, replicated read-only to every host, with epoch handoff.
  - (b) A few versioned documents on the home host, cached by hosts and clients, with grants kept per host.
- **Recommendation: (b).**
  - It removes the version-skew, compaction, revocation-lag and bootstrap problems of W4 together.
  - It keeps one writer.
  - The documents are small, so caching them whole is fine.
  - Moving the home host stays a rare manual step: export, then import.

### Decision 3: how does the tiling write to a home host that may be remote or offline?

- **Options:**
  - (a) A round trip per key: ADR 0025's rule, carried by step E12.
  - (b) The client predicts with the shared Rust `workspaces` model compiled to WASM and sends intent commands. The home host applies each to its current state (rebase, no `expect`).
- **How (b) handles a lost home host:**
  - The client keeps unsent keys as a visible "layout changes not yet saved" overlay, and replays them when it reconnects.
  - The overlay is bounded: at most 1 h and 200 commands, and a command whose target is gone is dropped.
  - This keeps the autonomy of notes 13:11 without a second writer.
- **Default home:** the always-on host when there is one, otherwise the laptop.
- **Recommendation: (b).** Build the WASM crate before E12 moves rules out of `model.ts`, so the shared model replaces the TS rules instead of adding a third copy.
- **Gate:** from key press to frame, p95 ≤ 16 ms at 150 ms round trip, and `motion.spec.ts` no slower.