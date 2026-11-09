---
status: accepted
date: 2026-11-06
---

# Banda is a kernel, a platform and Apps built on one SDK

_Proposed on 2026-11-05; accepted by Roma on 2026-11-06, together with
the architecture vision (docs/research/2026-11-06-architecture-vision.md),
Banda's main architecture document, and every decision in its §11. Roma
answered this ADR's first open questions on 2026-11-05 (decisions 12 to
16). The vision's decisions rewrote decisions 4, 5, 6, 7, 10, 13, 14 and
17 here. Decisions 4 and 14 stay proposed until the tracer App passes
(plan step 11). Nothing here is built._

ADR 0001 made Banda a small kernel and modules, and said third-party
modules come once the module contract settles. ADR 0022 made a module
declare itself in its code and a short `module.toml`. On 2026-11-05 Roma
asked to bring Threads, Browser, Git and Terminal to one shape, draw the
borders, and let other people build their own: the Banda App SDK.

What stands in the way today (docs/research/2026-11-01-hackable-modules.md,
docs/research/2026-11-03-architecture-review-3.md):

- Everything is compiled in: the engine parts are crates in one binary, the
  window parts static imports in `app/web/src/modules.ts`.
- A Pane gets a live `Engine` and runs as a React component in the window,
  so it cannot run anywhere else.
- A module's `desktop` part is all of Electron main; no outside author can
  have it. The Browser lives almost wholly there.
- Modules know each other by strings: the workspaces name `agents.thread`,
  `git.diff`, `files.file` and `browser.browser` (`AGENT_KINDS`); the
  shell calls `agents.wake` and `thread.new`; git hears agents' facts by
  name (R3-38, R3-45); settings depends on the agents and browser crates;
  the module list is written in five places (R3-43).
- Some extension points are one module's: `threadDetails`; a settings
  section a module cannot declare (the agents' unstable mark).
- Rights are the owner's or an Agent's; a module has no capabilities.
- Parts of the window read the engine's disk: Visuals and media in a
  Thread (`modules/agents/desktop`), and Sharing posts through Chromium.
  An engine on another machine breaks them.
- The engine is the window's child (`banda serve --with-parent`), so it
  stops when the window closes, and the Agents with it.

And the engine is meant to run Agents on other machines (ADR 0001,
decision 1), with Electron, a browser tab or later a phone only showing
what it streams.

On 2026-11-06 the vision weighed where an App's view runs, how an App
from elsewhere runs, how hosts work together, where the Person's data
lives, who acts as the Person, the tiling's model and how intents
resolve. Its answers are decisions 4, 5, 6, 7, 10, 13, 14 and 17 below.

**Decision.**

1. **The words.** A **Banda App** is an app for Banda: what a Person
   installs, opens and arranges. The **Banda App SDK** is how one is
   built. "Module" stays the word for a unit inside the code. Threads,
   Browser, Git, Files, Terminal and Usage are Apps. GLOSSARY's "plugin"
   goes: an App from elsewhere is an App.

2. **Three layers, and the SDK is the border between the last two.**

   ```
   Kernel     scopes and their stores · event log · transactions,
              receipts, outbox, cursors · access and capabilities ·
              identity, passes · registry · devices · the API ·
              the handlers' runtime
   Platform   projects · the tiling (workspaces, columns, Groups) ·
              the look · views · harnesses · the Agents' bridge (the
              MCP gateway) · calls and notifications · settings · skill ·
              problems · sharing · bytes · environments · the shell
              (bar, sidebar, menu, overview)
   ───────────────────────── Banda App SDK ─────────────────────────────
   Apps       threads · browser · git · pulls · files · terminal · usage ·
              Apps from elsewhere
   ```

   - The kernel names no App, and the platform names no App.
   - The platform's parts may hold rights no App gets: the window's
     desktop, the keychain, the machine's processes.
   - **Threads is an App.** The Harness processes stay the platform's
     (`harnesses`), and so does the Agent as a Participant and its bridge
     (the gateway, decision 16). Sessions, turns and Questions are the
     Threads App's. Threads reaches the Harnesses through the `sessions`
     capability (decision 5), so it is an SDK App with one unstable mark
     at most. Another App reaches Agents through Threads' public methods,
     as any App reaches another.
   - Banda's own Apps are built on the same SDK. What they take that the
     SDK lacks is an unstable mark in their manifest, with why, and the
     count only falls (ADR 0022, decision 6), as VS Code's built-ins use
     proposed APIs.

3. **Three places run Banda: the host, the view and the device.**

   ```
   Host     banda serve, where the Projects are: this computer, a server, a devbox.
            The kernel, the platform, every App's host part, the files,
            Harnesses, PTYs, git, the stores, the outbox.
               │ one protocol: a snapshot, the events after it, streams
   Client   Electron · a browser tab · a phone, later
            ├ view    what Apps show, drawn from the trees their hosts
            │         answer (decision 7), and what the Person looks at
            │         (decision 13)
            └ device  what only the device has: notifications, sound,
                      clipboard, a file picker, opening a link, its own webviews
   ```

   - What changes the work runs on the host. A client only shows it and
     asks for changes, so a client can close and the Agents go on
     (decision 19).
   - The device is the platform's. An App from elsewhere has no code on
     it; its host part asks the device by the device road (ADR 0082,
     decision 12), which the window's road (ADR 0029, decision 2) grows
     into: a list of device capabilities, and a request sent to a named
     device or to where the Person is (ADR 0081, decision 5).
   - Nothing on the client reads the host's disk. Visuals, media in a
     Thread and anything else a client shows come through the API. Sharing
     sends from the host.
   - A client connects to more than one host (decision 13).

4. **An App's logic runs on the host, on the kernel's own command path,
   and an App from elsewhere starts as a worker** (Roma, 2026-11-06;
   proposed until the tracer App passes, plan step 11).

   ```
   command → access → handler (rules + store) → one transaction → events → outbox → worker
   ```

   - **One contract: a handler takes a command and answers a transaction
     as data.** The kernel commits it with the command's receipt, so a
     handler gets safe repeats and "the event commits with the data".
     Banda's own Apps write their handlers in Rust, in process, and
     answer the same data, so a Banda App proves the contract every day.
   - **An App from elsewhere runs as a worker process on the host**,
     speaking the public protocol with a pass of its App. The kernel
     sends it a command; the worker reads the App's tables at a place in
     the log, and answers a transaction as data: its statements on its
     own tables, its events, its effects, and an `expect` that names
     that place. The kernel commits it, or refuses it as stale when the
     log has moved on, and the worker tries again.
   - A worker also answers its App's views, with a read-only pass
     (decision 7), and runs the outbox's effects and the App's reactions
     to other Apps' events: the network, programs, long work. The kernel
     starts it and starts it again; the outbox gives it order per key,
     retries and a settle on failure.
   - **A worker runs only an App the Person made or trusts, until the
     `sandbox` environment walls it.** A worker is a process on the
     Person's machine. Its capabilities bound what it asks of Banda, not
     what the process itself can reach. So an App from elsewhere waits
     for the `sandbox` environment, or a container, which walls its files
     and its network too (ADR 0084).
   - **A tracer App proves this road first**: a small App an Agent
     builds for the Person, installs, changes and tests.
   - **WebAssembly handlers come later, as a second binding of the same
     contract.** When an App needs them, a handler in WebAssembly
     (wasmtime, the component model, as Zed's extensions are) runs
     inside the kernel's transaction and answers the same data, with
     nothing to install and a wall of its own. The transaction as data
     keeps that way open.

5. **The host API is what the kernel gives an App, each part behind a
   capability it declares.**

   | What | Capability | How the kernel holds it |
   |---|---|---|
   | Its own tables and migrations | always | SQLite's authorizer refuses any table without the App's prefix |
   | Its events, with versions | always | their schemas in its manifest |
   | Another App's events | `listens` | only that App's published language, typed, never by plain string |
   | Another App's methods, intents | `calls` | through the access rule, the App named as the caller |
   | Effects | always | the outbox |
   | Streams to a client | always | as the terminal's |
   | The Project's files | `files` (read or write, paths) | through the host |
   | Programs | `run` | in a worker only, the Person granting it by name, through the Project's environment |
   | The network | `net` (hosts) | in a worker only, allowed by host |
   | Secrets | `secrets` | the host's keychain |
   | Harness sessions: open, prompt, stop | `sessions` | served by the platform's `harnesses`; text sent to an Agent counts as running a program, so the Person grants it by name |
   | Tools for Agents | `tools` | as `methods!` marks them now |
   | The device | `device` (notify, open a link, clipboard…) | the window's road, to a device |

   - Banda's own Apps declare their capabilities too; they are granted
     without asking, but never undeclared, so the check runs from the
     first day (Zellij added permissions late and every plugin had to
     change).
   - **An App acts as itself, never as the Person** (Roma, 2026-11-06;
     ADR 0083, decision 3). Its handlers, workers, views and frames call
     Banda as the App, walled to the Project they work for. The Person
     they work for is recorded and gives no rights. What the App may do
     is the Person's rights cut down to its capabilities, the session's
     scopes and the Project's wall; no intent, frame or worker raises it.
   - **Only a gesture on one of the Person's devices acts as the
     Person** (ADR 0083, decision 3). A click in a view sends the App's
     own command, one it marks for its views, as the Person from that
     device (decision 7).

6. **Apps ask for what they need by intent, not by name.**
   - An intent is a verb with a version and typed args: "open this
     address" (`open.address@1`), "show this diff" (`show.diff@1`), "run
     this in a terminal" (`run.command@1`). An App says which intents it
     handles; the caller names none.
   - **One handler per intent in v1** (Roma, 2026-11-06; ADR 0082,
     decision 7). An intent goes to the App of the thing it names, or to
     the one App whose manifest handles it; a second App that handles it
     is refused at install. The Person's defaults, a picker and
     namespaces come when a second handler is wanted; the names stay, so
     they can follow.
   - An intent never raises the caller's rights.
   - The workspaces stop naming other Apps' Panes; git stops naming
     Threads' events. `threadDetails` and the Pane header's `ThreadMark`
     become **slots**: places in another App's thing that any App fills
     with typed rows.

7. **What an App shows is a tree its host part works out and each client
   draws from Banda's components (Level 1)** (Roma, 2026-11-06, in place
   of his earlier "React runs on the host in a JavaScript isolate").
   - **Code runs only where its author is trusted; the rest crosses the
     wire as data.** Banda's client release is trusted on a device. An
     App's code is trusted only on its host. HTML that a spec or an
     origin already walls in runs in the device's browser sandbox. So
     what a Person sees runs in one of four places, and the App's kind
     picks it:

     | Place | What | Runs on |
     |---|---|---|
     | **Catalogue** | the whole of shadcn/ui, as `@banda/ui` has it; Banda's own components (Markdown with Mermaid and KaTeX, Diff, CodeDiff, FileTree, Console, Message, Kbd, the Mark, meters, charts); the live components (a Thread with its message box, a terminal, a browser's page, a file's view), each behind its capability | the client, in Banda's release |
     | **Tree** | an SDK App's view | its host part, on the host |
     | **Frame** | an MCP App's `ui://` page (decision 10) | the device, in a sandboxed frame |
     | **Site** | a Web App (decision 9) | the device, in a webview |

     A component enters the catalogue only when it needs every frame or
     a fast stream, and two Apps use it or it is one of Banda's live
     components.
   - **A view is a read method whose answer is a tree.** An App declares
     it beside its commands (`view today(…) -> Tree`), one more kind in
     its `methods!` table, so routing, the access rule, the types,
     the CLI and Agents' tools come with it. It takes the Pane's args
     (the arrangement's, decision 13) and this client's local state (the
     view's). It reads its tables and the methods it `calls`, and answers
     the tree with the log's place it shows. It writes nothing, starts
     nothing, keeps nothing between calls, and has limits on time and
     size; `banda call` prints it. What collects data is a command.
   - **Banda's own views come first, in Rust**, Usage's the first. An
     App from elsewhere answers its views from its worker (decision 4).
     No React runs on the host, and the host keeps nothing for a client.
   - **A client reads a view again on events.** In v1 it follows the
     App's events and reads the whole view again, as most Panes do now.
     Patches by key, and one tree shared by every client with the same
     args and local state, come when a measured tree or rate of updates
     needs them.
   - **Versions.** A client says which catalogue it has, and each tree
     which it needs. For an older client the host puts each newer
     component's fallback in its place before sending; where there is
     none, the client says "Update Banda to see this" there and draws
     the rest.
   - **What the client holds never waits for the host:** a field's value
     as the Person types (nothing the host sends overwrites the field in
     focus), an open popover or menu, a tab, an accordion, hover, the
     scroll, a table's sort and filter, a chart's series, and the acts
     the tree declares for the client (show, hide, toggle, copy, open by
     intent), as LiveView's JS commands. Large lists and charts name
     their data (`source = "habits.list"`) and the client follows it a
     page at a time.
   - **An act is the App's own command**, one it marks for its views,
     sent as the Person from this device (decision 5). The control shows
     the new value at once and stays pending until the view is read at
     or past the command's place in the log; a refusal puts it back
     (ADR 0025's rule). An answer with no place (the command wrote no
     fact) has nothing to wait for: the control stops being pending at
     once, and a read sent after the answer shows what it did. (Amended
     by #880.) A form is checked on the client against the method's
     schema and sent as one command. The client sends no other method a
     tree names: the client is trusted, the tree is not.
   - Props carry no functions and no colours. A table's cells are typed
     columns or a subtree; `className` takes layout utilities only;
     colour comes through variants; images come only from the host, by
     a signed address.
   - So no App's code reaches a device. Every client, a phone included,
     draws every App with its own components (shadcn,
     react-native-reusables) in its own theme (decision 18); each shows
     the host's version of the App; and an Agent reads what a view shows
     as text. Any act that is not the client's costs one round trip:
     nothing on this computer, tens of milliseconds to a server, more to
     a phone through a relay. Every write costs one in any design, as
     the host is its one writer.
   - Banda's own Apps draw the same way. What needs every frame
     (Threads, the terminal, the browser, the Files viewer) is in the
     catalogue, for any App to embed by capability. The rest of their
     Panes move to views one at a time; each one still drawn by client
     React carries an unstable mark until it does.
   - **Level 2**, an App's own HTML, waits for an App that needs more
     than the catalogue. It will be a `ui://` page from the App's host in
     the Frame place, speaking the MCP Apps messages, so the only App
     code a device ever runs is in the browser's sandbox, under an open
     spec.

8. **There are three kinds of App, and a Person sees one kind.** Each
   opens from the launcher as a Pane, lists itself on the sidebar and the
   bar, calls its Person and takes a key.

   | Kind | What it holds | Who makes it | What it shows |
   |---|---|---|---|
   | SDK App | a host part, with its views | developers, Agents | Level 1: a tree from its host part |
   | Web App | a manifest over the Browser | any Person, in one click | the site, in its own webview |
   | MCP App | an MCP server with `ui://` resources | the MCP ecosystem | a sandboxed frame, as its spec says |

9. **A Web App is a site as an App** (X, YouTube, Meet).
   - Its manifest is a file with no code: its address, its scope (other
     addresses open in the Browser), a profile of its own or the
     Browser's, its permissions (camera, microphone, notifications,
     screen), where its badge comes from (the title's count or
     `navigator.setAppBadge`), whether Agents may read or drive it
     (`none` by default), its width. It is the Person's data, on the home
     host (decision 13).
     _Amended 2026-11-09 by
     [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md): there
     is no home host; a Web App's manifest is a shared file, a copy on every
     machine._
   - "Make an App" on any tab fills it from the site's web app manifest.
     Banda ships a few ready ones.
   - Its notifications go through the notifications module, its badge
     into the sidebar's and the bar's calls. Banda's Alt keys work over
     it as over the Browser. A page that plays media keeps playing when
     its Pane is out of sight.
   - It runs on the device: it holds the Person's own sessions. On a
     phone it opens in a webview or the site's own app. A browser tab as
     the client has no webview, so it shows no Web App.

10. **Banda hosts MCP Apps, as the gateway of every session's MCP.**
    - A Project (or the Person) lists its MCP servers, on the host. Banda
      passes every ACP session one MCP server, its gateway, in place of
      `banda mcp` alone: Banda's tools and the listed servers' tools in
      one place, for every Harness alike.
    - The gateway sees each tool's `_meta.ui.resourceUri`, reads its
      `ui://` resource and keeps it by its hash. A tool call with a UI
      shows in its Thread as a live card, a Visual that answers (ADR
      0037), on an origin of its own with the spec's CSP and the look's
      colours. It opens as a Pane of its own too.
    - **A frame acts as itself, never as the Person** (Roma, 2026-11-06;
      ADR 0083, decision 3). What it asks goes client → host → gateway as
      the App of its server, walled to its Thread's Project, through the
      access rule. It
      calls only its own server's tools that the spec lets an app see,
      never Banda's own. A call that changes something needs a real click
      in the frame, on the Person's device. A `ui/message` becomes a draft
      in the Thread's message box, which the Person sends.
    - A Visual an Agent wrote keeps its own frame, and calls no tool.
    - This is the only frame Banda draws for now: the MCP Apps spec, not
      an API of Banda's own.

11. **One repository.** The contract is generated from the kernel's Rust
    (ADR 0014), so the SDK and the kernel change in one PR, and Banda's
    Apps move to the SDK one at a time in it.
    - The SDK leaves as packages with the API's version in each App's
      manifest: `@banda/app-sdk` (the view, the types), the crate
      `banda-app` (the host part; the WIT files come with WebAssembly
      handlers), and `banda app new | dev | check | pack` in the `banda`
      program.
    - A starter (`banda-app-template`, with examples) and, later, the
      index of Apps (`banda-apps`, a PR adds one, as Zed's extensions)
      are repositories of their own.
    - `app/` (the window) clashes with the word: it becomes `client/`.
      `modules/` becomes `apps/` and `platform/`. A module's `module.toml`
      becomes its App's `app.toml`, and every list of Apps is made from
      them.
    - The rename goes first, after a short drain of the open PRs, by a
      script that open branches can run too (Roma, 2026-11-06).

12. **Chromium runs in both places, and the host's is the Agents'.**
    - An Agent's pages run by default in a headless Chromium on the host.
      A client sees and works them as a screencast over CDP, so an Agent
      keeps its browser with the laptop closed and a phone can watch it.
    - The client's Browser stays: the Person's own tabs and every Web App,
      with the Person's sessions. An Agent drives a tab of the Person's
      only when the Person lends it, and only while that client is open.
      Until the host's Chromium is built, the pages an Agent opens load
      in the client, in a profile of its Project's Agents apart from the
      Person's (ADR 0083).
    - Both are one Browser App with one set of tools; where a tab runs is
      the tab's.

13. **One client works with several hosts, and what it shows has three
    levels.**
    - A laptop, a server and a devbox show in one window: one Inbox, one
      bar, every host's Threads among them.
    - Each part lives where those who change it reach it (Roma,
      2026-11-06):

      | Level | What | Where it lives | Who changes it |
      |---|---|---|---|
      | The work | Threads, turns, and what an Agent opened ("this Thread opened that page") | the Agent's host, in its Project | the Agent, the CLI, the Person |
      | The arrangement | workspaces, columns, Groups, widths | the `workspaces` module, in the Person's documents on the **home host** | the Person, the CLI; an Agent only through what it opened |
      | The view | the focus, the scroll, the zoom, the overview, which workspace is on screen, the theme as worked out | each client | that client |

      _Amended 2026-11-09 by
      [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md):
      machines are peers, and there is no home host. The arrangement is the
      machine's whose window shows it, in its engine, as built. The Person's
      files are a full copy on every machine, copied whole later. An Agent's
      Pane is placed by each machine whose window sees it, in its own
      arrangement, and checked again there. Each arrangement places an
      event once, by one road: where the Agent's machine is the window's,
      `open_pane` places the Pane at once and moves that arrangement's
      `placed_through` past its event, so a window that carries it later
      places nothing more. The bullets below on the home host and on
      "while the home host is away" go._

    - **The Person's data is a few documents, only on the home host**
      (Roma, 2026-11-06; ADR 0082, decision 1): the arrangement, keys,
      the sidebar, themes, `[notify]`, the seen marks, and Web Apps'
      manifests. Each has a version and is read whole. Clients keep a
      copy to show; no other host keeps one. They move to another home
      host by export and import. What the Person grants an App is kept
      on each host.
    - ADR 0025 decision 1 holds in this: the arrangement is the engine's,
      so the CLI changes it as any App's data, and the window keeps the
      view.
    - **A Pane names its Project, not a host.** No address carries a
      host. A client finds a Project's host in its directory, made from
      what each host it is paired with lists, so a Project that moves
      keeps its Panes.
    - **The client is the only integrator between hosts in v1** (Roma,
      2026-11-06; ADR 0082, decision 15). Hosts do not follow each other
      and do not call each other. A client merges the Inboxes of its
      hosts, each row keeping its host, so an answer goes back there.
    - An Agent does not reach the arrangement. It writes what it opened
      into its Project, as part of its work. A client that sees it
      carries it to the home host by that event's id; the home host puts
      the Pane into that Agent's Group (ADR 0065) once for each event,
      however many clients carry it. The home host checks each one again:
      the Pane's kind is one it knows, it runs nothing as the Person, and
      the Browser's check of its address passes. An Agent on the home
      host takes the same road, so there is one. Its Pane appears once a
      client is open, the only time anyone sees it.
    - Delegation between Agents on two hosts comes later, as commands a
      host keeps and sends on, with a grant on the host that receives
      them.
    - **The home host is the always-on host, when the Person has one**
      (ADR 0082, decision 16), asked when it is paired: a server that
      never sleeps, or a host in Banda Cloud (ADR 0081, decision 10).
      Else it is the laptop.
    - While the home host is away, a change to the Person's data fails
      at once, or waits in a queue the Person sees with a time after
      which it is dropped; seen marks wait on the device; the tiling
      keeps its overlay (decision 17); what a client shows comes from its
      copy, marked "as of".
    - A phone shows the same arrangement its own way (one Group to a
      screen) and keeps only its view.
    - A host the client cannot reach shows its Panes as away, as a
      Project that does not open, and keeps them, with what they last
      showed marked "as of".

14. **A host part is written in Rust or TypeScript, and at first it is a
    worker** (Roma, 2026-11-06; proposed until the tracer App passes,
    plan step 11).
    - A worker is a process, so it can be any language that speaks the
      public protocol. `banda app new` offers Rust (`banda-app`) and
      TypeScript (`@banda/app-sdk/host`), with a view written in TSX
      against `@banda/app-sdk/ui` or in Rust.
    - When WebAssembly handlers come (decision 4), they compile from
      Rust or from TypeScript (through ComponentizeJS) against one WIT
      world, and an App's views run in the same WebAssembly.

15. **An App keeps data only through its host part.** One with only a view
    calls other Apps' methods and keeps nothing. `banda app new` makes the
    smallest host part for an App that needs tables.

16. **The gateway is the one source of MCP for a session.**
    - The ACP adapters of the Harnesses Banda carries take MCP over HTTP,
      so the gateway is an HTTP MCP server on the host, with a pass per
      session.
    - Banda turns off what a Harness would load of its own, so every
      server a session sees comes through the gateway.
    - **A Harness loads no Project's own settings or MCP config until the
      Project is trusted** (Roma, 2026-11-05). Only the Person trusts a
      Project (ADR 0083, decision 5). Where an adapter has no option for
      it, Banda patches the copy it carries (ADR 0059), and drops the
      patch once upstream takes one.
    - Adding a Project offers to import the servers its Harnesses' files
      name: `.mcp.json` in the folder, and the Harnesses' own MCP configs.
      A folder's own servers wait until the Project is trusted.
    - So each server runs once per host, every Harness in a Project sees
      the same ones, and every MCP App shows in Banda.

17. **The tiling is the platform's: one model in Rust, its authority on
    the home host, and a copy in each client to predict** (Roma,
    2026-11-06).
    - The tiling (Roma's "composer"; its own name may come with the
      window's split) is the `workspaces` module's model and each
      client's tiles, motion and input. It has no ADR of its own: its
      rebuilding is steps of this plan.
    - The model is one Rust crate. On the home host it is the authority.
      Each client runs the same crate, compiled to WebAssembly, to work
      out what a key does, and draws that frame at once.
      _Amended 2026-11-09 by
      [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md): the
      authority is the engine of the machine whose arrangement it is, the
      window's own. Only a client whose engine is on another machine, a
      browser tab, could need the overlay. So the overlay (T2) waits for
      stage 4's decision on the web, and is not built for the desktop._
    - A client sends intent commands ("move this Pane right"), not the
      states it worked out. The home host applies each to the state it
      has, in the order sent, and says what changed. The client takes
      its answer by the log's place, and a refusal rolls the frame back.
      So `model.ts` and its rules go from the window, and every client
      and the CLI share one set of rules.
    - What depends on the look (the presets, `alone`, `min`) stays each
      client's and arrives as the command's args (ADR 0025, decision 1).
    - While the home host is away, a client keeps the Person's changes in
      an **overlay** marked "not yet saved": an hour and 200 commands at
      most. It sends them when the home host answers; one whose Pane has
      gone is dropped.
    - It names no App. Intents (decision 6) take the place of
      `AGENT_KINDS` in the workspaces and of the shell's `agents.wake`
      and `thread.new`.
    - A Thread's Mark on its tile (`ThreadMark`) is the Threads App's
      row in the Pane header's slot (decision 6), not an import.

18. **The look is the platform's, in two levels, and Level 1 stands on its
    tokens.**
    - Each display has its own theme: a phone is not a Mac (Roma,
      2026-11-06).
    - The Person's themes (their files) and which display takes which are
      among the Person's documents, on the home host (decision 13).
      Working a theme out (the mode, the system's accent, the fonts, the
      glass) is each device's, as the view is (decision 13).
      _Amended 2026-11-09 by
      [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md): the
      Person's theme folders are shared files, a copy on every machine;
      which theme, the mode, the glass and which display takes which are the
      device's._
    - That working out is one pure function in Rust, a theme's files and
      the device's facts in, tokens out. Every client takes it as a
      library or as WebAssembly.
    - An App from elsewhere does not style itself (decision 7), so the
      whole look, the ladder of radii included, is in the tokens. Tokens
      are portable values, with no `color-mix()` or `var()` in the
      contract; the web's CSS and the object react-native-reusables takes
      are made from them.
    - ADR 0080, the themes module, holds the rest.

19. **The engine is the machine's service and outlives the window.** ADR
    0086 holds it (the draft in PR #460, renumbered), and it is built as
    a step of its own. Until then "a client can close and the Agents go
    on" (decision 3) holds for no host with a window.

**Decided elsewhere.** What this ADR left open is decided (Roma,
2026-11-06) and written down in ADRs of its own:

- Several machines: ADR 0081, accepted as v1. One Person by keys across
  hosts, the engine signing its own sessions, routes as a port, devices
  and where the Person is, calls worked out on the host, versions agreed
  as a range, and Banda Cloud as services each one can run.
- ADR 0082: scopes, the kinds of message, receipts, facts and
  listeners, intents, the access rule, the protocol, devices, bytes,
  versions, and how one client works with several hosts.
- ADR 0083: the fence, passes, who acts as the Person, the browser
  wall, bookkeeping and trust, the Person key, the order they land in,
  and where the web client's code comes from.
- ADR 0084: a Project's environment and the door.
- ADR 0085: the unit of work, `task@1`, an App's data, and the
  `agents` → `threads` rename.
- The engine as the machine's service: ADR 0086.

**Plan.** The order is the vision's roadmap (its §9 and §10): the ground
cleared and the rename; the base (the engine as the machine's service,
the fence, a firmer kernel, the borders); the look (ADR 0080); the web
client; several hosts (ADR 0081); then the SDK's own road. The fence
comes before any host is reached from another machine, and the tracer App
before any App from elsewhere. Each step its own PR; `scripts/check.sh`
passes after each. These steps are this ADR's own, with the vision's ids.

_The base._

1. The rename (R0): `app/` → `client/`, `modules/` → `apps/` and
   `platform/`. The words in GLOSSARY: App, host, host part, client,
   view, device, platform, home host, intent, capability, slot, Web App,
   MCP App, and the four places.
2. One list of Apps, made from each App's `app.toml` (B1): ADR 0082's
   step 5.
3. The `agents` id becomes `threads`, with aliases, before any event is
   published to other Apps (T0): ADR 0085's step 1 (its decision 12).
4. Slots (B4): for `threadDetails`, the Pane header and settings
   sections; `Shell.tsx` split. Intents in place of `AGENT_KINDS` and
   the shell's calls by name (B8) are ADR 0082's step 9.
5. The `sessions` capability, served by `harnesses` (B16).
6. The tiling's one model (T1, T2): the crate compiled to WebAssembly in
   the client, keys as intent commands, the overlay. A key reaches its
   frame within 16 ms at the 95th percentile with the home host 150 ms
   away, and the motion test is no slower.

_Several hosts_, with ADR 0081's plan:

7. The client integrates (H6): the directory, Agents' placements carried
   to the home host and checked there, the merged Inbox and sidebar.
   ADR 0082's step 15.
   _Amended 2026-11-09 by
   [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md): there
   is no home host, so step 1's words drop it; step 6's gate is measured
   against the engine that holds the arrangement, local for a desktop
   window, and its overlay (T2) waits for stage 4's decision on the web
   and is not built for the desktop; step 7's placements go to each
   window's own machine and are checked there._

_The SDK's own road._

8. Views (V1): the tree, its props and their fallbacks in a crate of
   their own; the `view` kind; Usage's view in Rust, and `UsagePane.tsx`
   goes. A view is worked out within 5 ms at the 95th percentile, and a
   tree is 30 KB at most.
9. The client's renderer (V2): about 15 components, the client's acts,
   pending marks, the field in focus, "as of"; still usable 150 ms from
   its host.
10. Settings sections and Problems as views (V3).
11. The tracer App on the worker road (V4), once the transaction is data
    and the one access rule holds.
12. The MCP gateway over HTTP, then MCP Apps in a frame, in a Thread and
    as a Pane (V6).
13. Web Apps on the Browser (V7).
14. The Agents' pages in the host's Chromium (I7).
15. The SDK's packages and the starter; installing an App from a folder,
    then a git address, then the index, showing what an update adds to
    its capabilities (V8). An App from elsewhere installs only once the
    `sandbox` environment walls it.
16. Patches by key and a cache of views, once measured (V5).

_Later:_ WebAssembly handlers, as the contract's second binding; Level 2;
a native phone's renderer.

**Consequences.**

- Banda's Apps and an outside App meet the same contract; the unstable
  marks say where they do not.
- The window and the phone become clients of one host, and an Agent's
  work no longer needs a window open, but for what it asks of the device.
- The arrangement stays the engine's, as ADR 0025 has it, and is now one
  of the Person's documents on the home host. What moves is what an Agent
  opened, into its Project, and the tiling's rules, into one Rust model
  that the home host and every client run.
  _Amended 2026-11-09 by
  [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md): the
  arrangement stays the machine's whose window shows it, and that machine's
  engine runs the model._
- Third-party code runs on the host, in a worker with its App's pass
  (and in WebAssembly later), or in a sandboxed frame on the device. None
  of it runs in a client's page, in Electron main or in a phone's own
  runtime. Until the `sandbox` environment, a worker runs only an App the
  Person made or trusts.
- No host talks to another in v1: a laptop asleep stops nothing on a
  server, but a client must be open for an Agent's Pane to be placed.
- Renaming `app/` and `modules/` touches every path; it goes first, in
  one PR, while little is open.

**Changes.**

- ADR 0005, decision 12: an App's Pane is a tree its host part answers,
  drawn by the client from Banda's catalogue (decision 7), not a React
  component of its own; Banda's Panes still in client React carry an
  unstable mark. A module from elsewhere runs its host part as a worker,
  as the decision said, and answers a transaction as data (decision 4).
- ADR 0005, decision 13: an App declares capabilities and the kernel
  checks them, Banda's own included (decision 5). An App acts as itself,
  never with the Person's rights (decision 5). An App from elsewhere runs
  only once the `sandbox` environment walls it (decision 4).
- ADR 0014, decision 3: a client stops folding an App's events into a
  view of its own; it reads the view again (decision 7). The check of
  the window's projection against the engine's holds for the Thread
  until its live component takes its updates from the host.
- ADR 0019, decision 1: `banda mcp`, a stdio pipe handed to every ACP
  session, gives way to the gateway, one HTTP MCP server on the host
  with a pass per session (decisions 10 and 16).
- ADR 0022, decisions 1 and 2: `module.toml` becomes `app.toml`, and
  every list of Apps, the window's included, is made from them
  (decision 11). Decision 6, the unstable marks, stays.
  - _Since 2026-11-08, step B1 (b):_ every manifest is `app.toml`, the
    window's own part's (`client/web/app.toml`) included.
- ADR 0025, decision 1: one key in flight gives way to prediction and
  intent commands (decision 17).
- ADR 0029, decision 1: as ADR 0083 decision 4 amends it; the Agents'
  pages move to the host's Chromium (decision 12).
- ADR 0032, decision 3: an Agent no longer opens a Pane at a place it
  names. It writes what it opened into its Project, and the home host
  puts it into the Agent's Group (decision 13). The kinds that run
  something as the Person stay refused to it, checked on its host and
  again on the home host.
  _Amended 2026-11-09 by
  [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md): each
  machine whose window sees it places it and checks it again, in place of
  the home host._
- ADR 0056, decision 1: what calls the Person is worked out on the host,
  not in the window (ADR 0081, decision 6). A client keeps where the
  Person looks and tells on its device.
- PR #385 (draft ADR 0042, a module from elsewhere as a folder, with
  views in a frame and tools from an MCP server) is superseded by this
  ADR.
