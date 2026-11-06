---
status: accepted
date: 2026-11-06
---

# Parts talk in four kinds of message, and every hop checks access

_Accepted by Roma on 2026-11-06, with the architecture vision of that day
as Banda's main architecture document and every decision of its §11. A
point marked (Roma, 2026-11-06) is one of those decisions; the rest is the
vision's design, accepted with it. Nothing here is built. Research:
docs/research/2026-11-06-architecture-vision.md (§1, §4) and its designs in
docs/research/2026-11-06-architecture-vision/ (`borders.md` and the three
critiques)._

ADR 0062 makes Banda a kernel, a platform and Apps built on one SDK.
ADR 0081 runs Banda on several machines: hosts run the work, and clients
show it and ask for changes. Neither says how the parts talk to each
other, which host writes what, or how one client works with several
hosts. This ADR does. Two lines of Roma's brainstorm of 2026-11-04 hold
throughout: unite control, not databases; and the UI is not the runtime.

What stands in the way today:

- The kernel has two scopes, a Project and this machine (ADR 0025). The
  machine's is a Project in disguise. It holds both what is the machine's
  (the Harnesses, ADR 0040) and what is the Person's (the workspaces).
- Modules talk by commands and events (ADR 0001, decision 3), but they
  know each other by strings. git hears Threads' turns by name and reads
  fields of their payload; Threads hears git's acts the same way, so each
  needs the other. The tiling names four Pane kinds of other modules.
  pulls reads the Agents' tool payloads to find a pull request.
- A command keeps a receipt only when its right is not Read. Every refusal
  is kept as the answer, a passing one too, so a resend after a passing
  error gets the same error for good.
- A reaction starts at the log's head, so events committed just before a
  crash are never heard. A five-second wait stands in for "let git take
  its checkpoint before the turn runs".
- Commands from one window run as they arrive, each on its own task, so
  two sent together may commit in either order. The tiling sends one key
  at a time and waits for each (ADR 0025).
- The road to the window has one holder (ADR 0029, decision 2), and some
  of the host's own work runs through it.
- The commit run lives in the window's page; closing the window loses it.
- The protocol's version is matched exactly, and copied by hand into the
  client.

Roma, 2026-11-06, among the vision's decisions:

- In v1 the client is the only integrator; hosts never talk to each other
  (decision 3).
- The Person's data is a few versioned documents, only on the home host;
  the always-on host is home when there is one (decision 4).
- Only a gesture on one of the Person's devices acts as the Person
  (decision 6).
- The Turn stays the unit of work, and `task@1` is reserved (decision 10).
- Seen marks are the Person's, on the home host, joined by the client
  (decision 13).
- The phone's v1 is the PWA the home host serves; a native app comes
  later (decision 15).
- The id `agents` becomes `threads` before any fact is published
  (decision 16).
- One handler per intent verb in v1 (decision 17).

**Decision.**

1. **Every record has one writer, and the writer is a scope** (Roma,
   2026-11-06, the vision's decision 4). The kernel has three scopes.
   - **Project**: the work. It lives on one host and moves between hosts
     on command (ADR 0081 decision 11, ADR 0085 decision 11).
   - **Host**: what is this machine's: its programs, the Harnesses and
     their accounts, installed code, the host's settings
     (`harnesses.toml`, MCP servers, the Agents' browser), Problems,
     sharing and passes. It never moves.
   - **Person**: a few versioned documents, such as the arrangement, keys,
     the sidebar, themes, `[notify]`, seen marks and Web Apps' manifests;
     intent defaults later (decision 7).
     - They live only on the home host. No other host keeps a copy.
     - Each is read whole, with a `rev`. A new version only adds fields,
       so an older reader ignores what it does not know.
     - Clients cache them. A write is a command to the home host.
     - They move by export and import. Changing the home host is done by
       hand, that way.
   - Today's machine scope splits into Host and Person. Its data is
     migrated by owner, and the old machine log stays, read-only.
   - What a device shows (the focus, the scroll, the zoom, the resolved
     theme) stays the device's, as ADR 0081 decision 1 has it. It is not a
     scope of the kernel.
   - An App is installed and granted per host, and enabled per Project.
     Grants are kept on each host.

2. **Each part is a program that says what it gives and what it needs.**
   - **The kernel**, one per host, inside `banda serve`: the router,
     identity and passes, one store per scope (its log, receipts, outbox,
     cursors and the Apps' tables), access, the registry of this host's
     Apps, devices, and the scopes.
   - **The platform**, on the host: projects, workspaces, settings, keys
     and the look, calls, harnesses, the gateway, bytes, environments,
     Problems and sharing. It may hold rights no App gets.
   - **Apps**, built on the SDK: Threads, git, pulls, Files, the terminal,
     the browser, Usage, and Apps from elsewhere.
   - What a part gives is declared in its code: `methods!`, and `facts!`
     and intents to come. What it needs is declared in `app.toml`:
     `listens`, `calls`, `intents`, its capabilities and `device`.
   - The registry and every list of Apps are made from one scan of the
     manifests. `apps.describe` gives the JSON Schema of every method,
     fact and intent.
   - The kernel and the platform name no App, and a test proves each.
   - Who calls: the Person, by a gesture on a device; an Agent, with a
     pass that names its Agent, Thread, Project and tools; an App's own
     code, marked `via` that App; a device, answering a request. The CLI
     is the Person or an Agent, by its session.

3. **There are four kinds of message: query, command, fact and stream.**

   | Kind | What it is | As in Unix |
   |---|---|---|
   | query | a read, answered with `as_of{seq, at}`; safe to repeat | `stat`, `read(2)` |
   | command | a write, answered by a receipt that carries its place in the log, `at` | argv and the exit status |
   | fact | an event: typed, versioned, committed with the data | syslog and inotify |
   | stream | live pieces with flow control, not logged | a pipe |

   - An **intent** is a verb bound late to one of the four (decision 7),
     as `xdg-open` is.
   - A **device request** is a command whose target is a device
     (decision 12), as `/dev` and `ioctl` are.
   - **`cancel`** ends a stream, a subscription or a query. It is the only
     signal, as SIGINT is.
   - A byte URL and a pass are capabilities, as a file descriptor is.
   - No fifth kind is added. A new need fits one of the four, or it shows
     a part that is missing.

4. **The kernel keeps a receipt for every command, and a command never
   hangs.**
   - Every method of the command kind keeps a receipt, whatever its
     right. A resend with the same CommandId gets the same answer and
     runs nothing again.
   - Only final refusals are kept. `internal`, `busy`, `moving`, `moved`
     and `unreachable` pass; they are not kept, so a resend may go
     through.
   - The receipt keeps a hash of the params. The same CommandId with other
     params is refused as `conflict`.
   - The answer carries `at`, the place in the log of what the command
     wrote. A control the Person changed stays pending until an update at
     or past `at` arrives.
   - Commands from one session to one scope commit in the order sent. The
     router keeps one queue for each session and scope; on a transport
     with several streams, commands share one ordered stream. So a client
     sends the next command before the last one answers.
   - A command may carry `not_after`, checked in host time; past it the
     host refuses `expired`. It carries `expect{rev}` only where a rewrite
     of a whole state needs it.
   - Work longer than one write answers at once and reports through
     facts.
   - Reactions and workflow steps use a CommandId derived from their
     source and step, so they land on the same receipt check. Banda has
     one way to run a thing once, not two.
   - `banda mcp` gives each MCP request a CommandId of its own, and reuses
     it only when it sends that request again.
   - A receipt is kept longer than the longest `not_after` (seven days).

5. **A fact is private unless it is published, and a published fact is
   `app.noun.past-verb@major`.**
   - An App publishes a fact by declaring it in `facts!`. Every other fact
     is its App's own, heard only by that App's code, its views included.
   - Published names are `<app>.<noun>.<past-verb>@<major>`:
     `threads.turn.began@1`, `threads.tool.ran@1`, `git.pushed@1`. The
     first part is the App's id, so `agents` becomes `threads`, with
     aliases for the old names, before any fact is published (Roma,
     2026-11-06, the vision's decision 16; ADR 0085, decision 12).
   - Within a major a fact only adds fields, and a listener ignores the
     fields it does not know.
   - The log keeps every old version (ADR 0002, decision 6). The
     publisher owns the upcasters that read an old version as its current
     one, so a listener reads one shape.
   - Until Apps from elsewhere ship, no fact goes past major 1: a break
     is a new kind.
   - A payload names other things only by their Address (decision 15),
     never by another App's field.
   - A listener declares what it hears in `app.toml`, as
     `listens = ["threads.turn.began@1"]`. The registry refuses a listen
     on a private or undeclared kind.
   - A fact that carries what an Agent ran and what it printed, as
     `threads.tool.ran@1` does, is sensitive: listening to it is a grant
     the Person sees.
   - The pieces of a reply, a thought or a tool's output go on a live
     stream, `threads.live`, not into the log. The log keeps each item
     once, whole, when it ends.

6. **Listeners are durable, and the kernel keeps their cursors.**
   - A listener resumes from its cursor, never from the log's head, so a
     crash loses no fact.
   - **An acting listener** (git, pulls, later compositions) keeps its
     cursor in the source Project's store. It acks a fact in the same
     transaction as the command or effect it writes. So it acts exactly
     once in a scope, and its cursor moves with the Project.
   - **A projection** (the Inbox's calls, the sidebar's items) is a table
     worked out from published facts. It lives in the Host store with its
     own seq, so a client resumes with one number per host. It can be
     rebuilt, and it writes nothing back.
   - **Only the platform listens across Projects.** Its projections may
     hear the published facts of every Project on the host. No App may:
     an App's code is walled to the Project it runs for (decision 10).
   - **A gate** is a short wait a publisher declares, as `gate 5s`, so a
     listener that opts in acts before the next step goes on, as git
     takes its checkpoint before a turn runs. It replaces today's implicit
     five-second wait. A gate holds within one scope only.

7. **An intent is `verb@major` with typed args, and in v1 each verb has
   one handler** (Roma, 2026-11-06, the vision's decision 17).
   - An intent goes to the target's own App when it handles the verb:
     `notice.post@1` about a Thread goes to Threads. Otherwise it goes to
     the one handler the manifests name. A second handler is refused at
     install.
   - Banda's verbs live in `sdk/intents/`: `show.diff@1`, `show.file@1`,
     `open.address@1`, `run.command@1`, `thread.new@1`, `notice.post@1`.
   - `show(verb, args)` answers the Pane to open. It replaces the
     tiling's list of other modules' Pane kinds, so the tiling names no
     App.
   - An Agent opens a Pane by intent: Threads writes
     `show.requested@1{pane, by, owner}` into the Project's log, and the
     home host places it in the Agent's Group (decision 15). An Agent
     moves and closes only the Panes it opened, the same way.
   - A Pane kind marked `runs_as_person`, such as a terminal, is refused
     for an Agent.
   - The Person's defaults and a picker come when a verb has a second
     handler. The names stay, so nothing changes for the first.
   - An intent never raises rights. Its handler is bound by the caller's
     rights and its own capabilities together.

8. **Apps meet in slots and in workflows on the host.**
   - **A slot is a place in one App's thing that other Apps fill with
     typed rows**, from `slot.<name>(subject) → Item[]`. The owner draws
     them. A Thread's details and its Mark in the Pane header become
     slots.
   - **A workflow across Apps runs on the host, never in a client.** It
     is its App's table of runs plus outbox steps, each step's CommandId
     derived from the run and the step (ADR 0085, decision 1). Closing a
     window loses nothing, and the CLI sees the same run. The commit run
     leaves the window's page.

9. **The kernel owns two platform languages, `item@1` and `call@1`, and
   reserves `task@1`.**
   - `item@1` is a row of a listing, as `ls` prints: an Address, a title,
     its Mark, when it changed, its owner and the Pane that opens it.
     Groups are keyed by owner, so the tiling knows no Thread.
   - `call@1` is what calls the Person, as mail does: a Call raised or
     cleared, written in the same transaction as the change behind it.
   - Any App may speak them without declaring them. The sidebar, the
     Inbox, the bar and push read only these, so the platform names no
     App.
   - The Inbox names a Call's App from the registry, never from the
     payload.
   - `task@1`, what runs, as `ps` shows it, is reserved, so no App
     invents its own (Roma, 2026-11-06, the vision's decision 10; ADR
     0085, decision 2).

10. **Every hop checks access.**

    ```rust
    struct Session {
        person: PersonId,            // one owner per host (ADR 0081, decision 10)
        actor: Actor,                // Person{device} | Agent{agent, thread, project} | App{app}
        via: Option<AppId>,          // whose code acts: a handler, worker, view or frame
        on_behalf: Option<PersonId>, // recorded, never a source of rights
        scopes: Scopes,              // an Agent's: its tool list, by App
        only: Option<ProjectId>,     // the wall
        aud: Audience,               // ws | gateway | door
        expires: Timestamp,
    }
    // allowed = rights(actor, method.right) ∩ capability(via, method.capability)
    //         ∩ (method ∈ scopes) ∩ wall(only, the resolved ProjectId)
    ```

    - The kernel checks it at every hop: a call, a subscription, a listen,
      an intent's handler, a device request. No hop raises rights: not an
      intent, not a composition, not a frame, not a worker.
    - **Only a gesture on one of the Person's devices acts as the Person**
      (Roma, 2026-11-06, the vision's decision 6). Everything else acts as
      itself, with the Person recorded as `on_behalf`, which gives no
      rights. ADR 0083 (decision 3) says what a gesture is, and that text
      sent to an Agent needs the Run right.
    - A record names its author: the session's actor, a Person, an Agent,
      or an App that acts as itself. `on_behalf` is kept beside it.
    - Every session marked `via` an App is walled to the Project it runs
      for.
    - The wall (ADR 0019, decision 2) is checked on the resolved
      ProjectId, in one place.
    - An Agent's scopes are its tool list, by App.
    - Each host decides for its own scopes, and never acts on another
      host's decision.
    - Passes, the fence around an Agent's shell and the Person's key are
      ADR 0083's. This ADR only uses them.

11. **A client and a host speak one protocol.** Today's frames stay, in
    JSON; `call` is renamed `query`. Bytes, a terminal's output and a
    page's screencast travel as binary messages. Added or changed:

    | Frame | Direction | What it carries |
    |---|---|---|
    | `challenge` | host → client, first | a nonce, the host's key and name, its time |
    | `hello` | client → host | `protocol{min, max}`; the device's id and kind; a signature, or an Agent's pass; `client{build, ui}`, where `ui` is the client's catalogue version |
    | `welcome` | host → client | the protocol picked; the host's key, version and time; `person{id, home}`; `session{scopes, expires}`; `apps[{id, version, api, hash}]`; `ui`, the catalogue version the host writes |
    | `query`, `command` | client → host | a command adds its CommandId, `not_after?` and `expect?` |
    | `result{as_of}`, `receipt{at}` | host → client | `at` is the command's place in the log |
    | `subscribe{after}`, `stream{credit}`, `credit`, `cancel` | client → host | a stream answers with `as_of` too |
    | `device.register{caps, presence, push?}`, `device.presence`, `device.answer` | client → host | decision 12 |
    | `device.request{cap, params, within}` | host → client | decision 12 |
    | `ping`, `pong{time, version, heads}` | both | freshness and the clock's offset |
    | `goodbye{reason}` | host → client | `unsupported{range}`, `forbidden`, `revoked` |

    - **Freshness.** A client pings every 15 seconds. After two missed
      `pong`s, or when its path is lost, the host is **stale**: its rows
      dim and say "as of 14:02", queries answer from the client's cache,
      and commands fail fast.
    - **Resume needs no state on the host**: a new `hello`, a
      `subscribe{after}` for each subscription, and each unanswered
      command sent again with its CommandId.
    - **Credits.** A stream sends only as many pieces as the client has
      room for, and `credit` gives it more.

12. **Devices register, and the road goes to a device** (ADR 0081,
    decision 5).
    - A device registers its kind, its capabilities and whether the
      Person is in front of it, awake or away. It may give a push
      address.
    - The capabilities are a closed list: `notify`, `sound`, `clipboard`,
      `pick_file`, `open_outside`, `webview`, and `drag_out` for a host on
      the same computer. A web client has no `webview` and no `drag_out`.
    - An App asks with `device.<cap>`, a capability its manifest names.
      The request names a device, or where the Person is.
    - It runs at most once and has a deadline. Past the deadline it
      refuses with `may_have_run`. With no device that can, it refuses
      `no_device`, or becomes a Call and a push.
    - A request that opens, runs or reads something on a device needs a
      gesture there, unless that device's Person started it (ADR 0083,
      decision 3).
    - Only a device's session answers. The host's own work leaves the
      road: reading a Harness's Limits and sharing's posts now, the
      Visual's layout and the Agents' browser later.

13. **Bytes come from the host, by a signed URL.**
    - `platform/bytes` issues a URL bound to one device and a time, and
      the host serves it. On `direct` and `ssh` routes it is a plain
      fetch, so pictures and videos load by range as any page's do.
      Through a relay, later, it is a `bytes.read` stream.
    - A client never reads a host's disk. Electron main reads no Project
      path: media, file links, paths, open and drag come through the
      host.
    - Today's file links (signed, bound to the file, with ranges and a
      sandbox) move to the host as they are.

14. **Versions are agreed at each layer** (ADR 0081, decision 8).
    - **The protocol.** `hello` carries a range, and the host picks the
      highest both know, or says `goodbye{unsupported{range}}`. The
      version comes from the Rust contract; nothing copies it by hand.
    - **Each App's API.** Its manifest names a major, and `welcome` lists
      each App's version and major. Within a major, methods only add. A
      host serves an App's current major and the one before (N−1), so a
      client one version behind still works. A client newer than its host
      shows the older host and offers its update (ADR 0072).
    - **Published facts.** They only add within a major, are read through
      the publisher's upcasters, and go no further than major 1 for now
      (decision 5).
    - **The Person's documents.** A `rev` each, fields only added
      (decision 1).
    - **The catalogue**, the components a client draws an App's view
      with, as ADR 0062 decision 7 has it. `hello` says the client's
      version, and each view names the version it needs. For an older
      client the host puts in the declared fallbacks before it sends, so
      fallbacks live once, on the host.

15. **Addresses carry no host, and in v1 the client is the only
    integrator between hosts** (Roma, 2026-11-06, the vision's decision 3).
    - An Address is `{scope: Project(id) | Person | Host(key), app, id}`.
      Only a Host's thing, which cannot move, names a host. Panes, intents
      and published facts name things by Address.
    - **Hosts never talk to each other.** An Agent on one host does not
      act on another.
    - **The directory is the client's cache**, made from each paired
      host's `projects.list` with its epochs. The higher epoch wins. A host
      that gave a Project away answers `moved{to, epoch}`; the client notes
      it and sends once more.
    - **The Inbox.** The client follows one `calls.inbox` per host and
      merges them. Each row keeps its host, so an answer goes back there.
      Each host shows as live, stale (with its "as of") or away.
    - **Seen marks** come from the Person's document (Roma, 2026-11-06,
      the vision's decision 13). A host raises and clears its Calls from
      its own facts, and the client joins the seen marks to draw each
      Thread's Mark. A host's push goes by the devices' presence, not by
      seen marks.
    - **Placements.** When a client sees `show.requested@1` on another
      host, it sends `workspaces.place` with that event to the home host.
      The home host applies only events past its `placed_through` for that
      Project, and the new Pane's id is derived from the event. So several
      clients place a Pane once, and a Pane already closed is skipped. A
      Pane appears once a client is open, the only time anyone sees it.
    - **The home host checks every placement again**, since another host
      is only semi-trusted and the client only carries the placement: the
      Pane's kind is in the home host's registry, it does not run as the
      Person, and the browser's check of the address passes. Anything else
      is dropped and kept as a Problem.
    - An Agent's read of its Panes is answered on its own host, from its
      own Project's `show.*` facts. An Agent writes the Person's data only
      on the home host. Anywhere else it is refused `not_home`, and it may
      raise a Call to the Person instead.
    - Work handed from one host to another waits for store-and-forward
      peer commands, with a grant on the receiving side. That will be the
      only link between hosts.

16. **The home host is the always-on host when there is one, and a host
    that is away fails fast** (Roma, 2026-11-06, the vision's decision 4).
    - Pairing asks which host is always on, and that one is home. Without
      one, the laptop is.
    - A host in Banda Cloud, kept always on, is a home host like any
      other. It stays always on until it can tell Banda Cloud's `api`
      when it must next wake (`next_wake_at`: its next outbox retry or
      deadline) and `api` can wake it. Only then may it be suspended
      while its Agents are idle.
    - While home is away:
      - a write to the Person's data fails fast, or waits in the visible
        queue if the Person chooses "send when back";
      - seen marks stay on the device until home answers, then go as
        ordinary commands;
      - the tiling keeps a bounded overlay of changes not yet saved (ADR
        0062, decision 17);
      - reads come from the client's cache, marked "as of".
    - A command to a host that does not answer fails at once with
      `unreachable{as_of, may_have_run: false}`.
    - If the Person chooses "send when back", the client keeps the
      command in a **visible queue** with `not_after`: 10 minutes by
      default, 7 days at most. It sends it again, with its CommandId, when
      the host is back, and the host refuses `expired` past `not_after`.
      So a phone's command never runs hours late unless the Person chose
      it.
    - Streams and answers say "as of".

17. **In v1 the routes are `local`, `ssh` and `direct`; iroh comes
    later.**
    - `direct` is plain TLS over a LAN or a tailnet, with a certificate
      browsers accept, as `tailscale cert` gives a tailnet name.
    - `ssh` forwards a port, which a desktop browser opens as
      `localhost`.
    - **The phone's v1 is a PWA the home host serves; a native app comes
      later** (Roma, 2026-11-06, the vision's decision 15).
    - A PWA needs a secure context for its Service Worker and Web Push.
      So the phone's v1 route is `direct` over a tailnet, or a LAN name
      with a trusted certificate, and every host the PWA joins needs a
      certificate the browser accepts.
    - iroh and the relay come later (the vision's step H10). In a
      browser, iroh in WebAssembly, end to end to the host's key, is
      preferred over an SNI edge.
    - No listener leaves loopback before the fence, the one access rule
      (decision 10), the browser wall and hardened bookkeeping have
      landed (ADR 0083, decision 7).

**Plan.** Each step its own PR; `scripts/check.sh` passes after each. The
ids are the vision's (§9.3), and each step waits for the dependencies it
lists there.

1. This ADR; GLOSSARY's new words; in `docs/architecture.md`, the three
   scopes, the command path and the device road.
2. A receipt for every command: final refusals only, the params' hash;
   `banda mcp`'s CommandId per request (A3, A6).
3. The router's queue per session and scope; receipts carry `at` (A8).
4. Durable listeners: cursors acked in the listener's transaction; gates
   (A5).
5. One list of Apps, scanned from `app.toml` (B1).
6. The machine scope splits into Host and Person; the Person's documents
   with a `rev`; the old state migrated (A2).
7. `agents` becomes `threads`, with aliases (T0): ADR 0085's step 1.
8. `facts!`: published and private facts, `item@1` and `call@1` (B7); the
   deltas leave the log (B12).
9. Intents: `show(verb, args)` replaces the tiling's Pane kinds (B8); git
   and Threads stop knowing each other, and pulls hears
   `threads.tool.ran@1` (B10).
10. One access rule, with the wall on the resolved ProjectId (B14,
    ADR 0083's step 5).
11. Bytes from the host (E1); the device road (E3); calls on the host,
    with seen marks as the Person's document (E8); the commit run on the
    host (E10).
12. The protocol's range of versions, and `welcome.apps` (H1).
13. A transport port; `ssh` and `direct` routes; credits; heads in `pong`
    (H4). After keys and pairing (H3), the fence (F0), step 10, the
    browser wall (F1) and hardened bookkeeping (F2).
14. The client's Hosts router: stale hosts, fail fast, the visible queue
    (H5).
15. The directory cache, `show.*` placements relayed to the home host,
    the merged Inbox and sidebar (H6).
16. Later: iroh routes, and iroh in WebAssembly (H10).

**Consequences.**

- A part that needs another names a published fact, a query or a verb,
  never its tables or a string. Today's three couplings (git and Threads,
  the tiling's Pane kinds, pulls reading tool payloads) go, and Threads
  hears nothing of git's.
- A resend never runs twice, and a passing error is never the answer for
  good.
- A crash loses no fact a listener had not handled.
- Closing every window stops nothing that runs on the host: workflows,
  calls and the device road live there.
- Hosts know nothing of each other; adding one adds a connection in each
  client. The price: an Agent's Pane on another host appears only once a
  client is open, and a write to the Person's data waits for the home
  host.
- Every answer says how fresh it is, so a sleeping host shows "as of",
  never now.
- The stores gain a few columns and a table (the params' hash, `at`,
  cursors). Data at rest keeps its shape.
- Decided elsewhere, not here: passes, the fence, who acts as the
  Person, the Person's key and where the web client's code comes from
  (ADR 0083, decision 8 for the last); Project isolation (ADR 0084);
  what a backup and a move carry (ADR 0085); where an App's view and an
  App from elsewhere run, and the tiling's shared model with its overlay
  (ADR 0062, decisions 4, 7, 14 and 17).

**Changes.**

- **ADR 0001, decision 3**: modules' "commands and events" become the
  four kinds of message, with intents and device requests (decision 3).
- **ADR 0001, decision 8**: the access decision becomes the rule of
  decision 10. The Person, by a gesture on a device, may still do
  everything on their host; everything else acts as itself, bound by its
  capabilities. A record's author is no longer only "a Person or an
  Agent": it is the session's actor, and an App that acts as itself is
  one (decision 10).
- **ADR 0002, decision 2**: "a refusal gets a receipt too" now holds only
  for final refusals, and the receipt keeps the params' hash (decision 4).
- **ADR 0003, decision 11**: "Text is written in pieces every 80 ms"
  goes. The pieces of a reply, a thought or a tool's output go on
  `threads.live`, and the log keeps each item once, whole, when it ends
  (decision 5).
- **ADR 0005, decision 7**: "the workspaces live on the Person's
  computer" becomes: on the home host, the always-on host when there is
  one (decisions 1 and 16).
- **ADR 0014, decision 1**: the window's `engine.call` takes the frame's
  new name, `query` (decision 11).
- **ADR 0022, decision 1**: beside the rename to `app.toml` (ADR 0062,
  decision 11), it says what an App needs: `listens`, `calls`, `intents`,
  its capabilities and `device` (decision 2).
- **ADR 0025, decision 1**:
  - The workspaces are no longer a module of the machine: the
    arrangement is a Person's document on the home host (decision 1).
  - "The window sends one at a time … the next waits until the window
    draws past it" goes: commands commit in the order sent (decision 4).
    How a key is drawn before its answer is ADR 0062, decision 17.
  - An Agent no longer arranges its Panes through the workspaces' tools:
    it opens, moves and closes them by `show.*` facts in its own Project
    (decision 7).
- **ADR 0029, decision 2**: the road to the window becomes the device
  road (decision 12). Many devices register; a request names a device or
  where the Person is; "one window holds the stream at a time" goes; "with
  no window, the ask refuses" becomes `no_device`, or a Call and a push.
- **ADR 0032, decisions 1 and 2**: an Agent's read of its Panes is
  answered from its own Project's `show.*` facts, so it holds no other
  Project's Panes (decision 15). _Open:_ whether `sees_others` goes, or
  the home host alone answers it; Roma decides.
- **ADR 0032, decision 4**: an Agent no longer calls the arrangement's
  methods; its Panes are `show.*` facts in its own Project, placed by the
  home host, and its read of them is answered on its own host (decisions
  7 and 15). Decision 3, a Pane beside another Project's: ADR 0062
  amends it.
- **ADR 0034, decision 2**: git hears `threads.turn.began@1`, a published
  fact, not the agents module's `turn.started` by name. A gate the fact
  declares takes the place of a turn's wait on `reacted`, at most five
  seconds (decisions 5 and 6).
- **ADR 0040, decision 1**: `harnesses` is the Host's, as it was the
  machine's.
- **ADR 0040, decision 3**: "A module of the machine still never hears a
  Space's log" now holds for Apps; the platform's projections may hear
  the published facts of every Project on the host (decision 6). A
  Project's App hears the Host's published facts through `listens`, from
  its cursor, not from the log's head.
- **ADR 0043, decision 2**: the window's main no longer reads Claude
  Code's limits; the host does, as it sends sharing's posts (ADR 0039).
  Neither goes through the road to a device (decision 12).
- **ADR 0071, decision 5**: an Agent's `keys.*` writes run only on the
  home host; anywhere else they are refused `not_home` (decision 15).
  On the home host an Agent's `keys.bind` with args becomes a proposal
  (ADR 0083, decision 3).
- **ADR 0073, decision 5**: the byte host leaves `desktop-kit` and
  Electron main for `platform/bytes` on the host, with its tokens, ranges
  and sandbox as they are. Main reads no Project path (decision 13).
- **ADR 0081, decision 1**: the writer is a scope (Project, Host or
  Person), and the Person's records are a few versioned documents on the
  home host, with no copy on any other host (decision 1).
- **ADR 0081, decision 4**: in v1 `direct` is plain TLS over a LAN or a
  tailnet, before iroh; iroh's `direct` and `relay` come later
  (decision 17).
- **ADR 0081, decision 9**: Banda Cloud's "the Person's home" is no store
  of its own; a host in the cloud, always on, is the home host
  (decision 16).
- **ADR 0081, decision 10, and decision 14's row for hosts in the
  cloud**: a host in Banda Cloud is not suspended while its Agents are
  idle until it keeps `next_wake_at` and `api` can wake it; until then
  it stays always on (decision 16).
- **ADR 0081, decision 12**: the Person's files are documents on the home
  host, and seen marks and Web Apps' manifests join them (decisions 1
  and 15).
- **ADR 0081, plan step 6**: "one client over several hosts" becomes "the
  client integrates the hosts": the directory cache, the merged Inbox,
  and `show.*` placements relayed to the home host. No host follows
  another (decision 15).
