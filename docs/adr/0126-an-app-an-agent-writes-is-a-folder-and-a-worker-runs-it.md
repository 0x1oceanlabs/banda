---
status: proposed
date: 2026-11-13
---

# An App an Agent writes is a folder, and a worker runs it

Track 2, slices 2a and 2b of [the roadmap](../research/2026-11-08-roadmap-in-slices.md).
It serves story 2 and principles 2 and 3 of [what we build](../what-we-build.md),
which already decided the ground: an App talks to Banda in JSON with a
description in words; one that an Agent or anyone else writes is a separate
program on the machine, a worker, that the engine starts and talks to in
lines of JSON, TypeScript on Node first; the engine does the writing; and an
App the Person's own Agent writes installs with no click and no sandbox
(Roma, 2026-11-12). This ADR says how, so that an App's files do not change
when the rest of the SDK lands.

**Where it stands.**

- Every App is compiled into `banda`: its crate, its builder
  (`engine/src/apps.rs`) and the kernel's list of modules, fixed as the
  engine starts (`kernel/src/scopes.rs`). A module is Rust: its name and
  its migrations are `&'static`, and a write is a closure over SQLite
  (`kernel/src/module.rs`).
- What a worker needs underneath is there: one store for each Project,
  with tables walled by prefix, receipts and events; and a method's words
  and JSON Schema as an Agent's tool through `banda mcp`.
- ADR 0062, decisions 4 and 14, name the worker and are "proposed until the
  tracer App passes". They have it speak the public protocol with a pass of
  its App, and answer an `expect` that the kernel refuses as stale.
- A module whose migration fails is turned off alone (ADR 0085, decision 8,
  built with this slice).

## Decision

1. **An App is a folder of plain files**, which a Person and an Agent both
   read, written anywhere in a Project:

   ```
   clients/
     app.toml          its id, name, about, version, api, and entry
     methods.json      its methods, as data
     migrations/       001.sql, 002.sql, …: its tables, one step a file
     worker.mjs        its code
   ```

   `app.toml` is the manifest Banda's own Apps have (ADR 0022), with
   `entry = "worker.mjs"`. Its id is lowercase letters, as every module's,
   and is the prefix of its methods (`clients.add`), its tables
   (`clients_people`) and its events. `[needs]` stays refused until a need
   is built.

2. **Its methods are data, each with a description in words.**
   `methods.json` holds, by name: `kind` (`call` or `command`), `right`
   (`read`, `write`, …), `about`, and `params`, a JSON Schema. It is what a
   `methods!` line says for a compiled App, so the window, `banda call`,
   `apps.describe` and Agents get them the same way.
   - **Every method is an Agent's tool by default**, named
     `<app>_<method>`; `"tool": false` leaves one out. A name another tool
     has is refused as the App is installed.
   - A view (`kind: "view"`, whose answer is a Tree) comes with slice 2c.

3. **A worker runs it: one process an App on a machine, started by the
   engine.** The engine starts it when the App is first called, with the
   Node Banda carries (ADR 0062, step S1), and again when it ends. They
   talk in lines of JSON on its stdin and stdout; what it writes to stderr
   goes to the engine's log.

   ```
   → {"id":1,"call":"add","params":{…},"by":{…},"project":{"id":"…","folder":"…"}}
   ← {"id":1,"read":7,"sql":"SELECT … WHERE city = ?","params":["Berlin"]}
   → {"read":7,"rows":[{…}]}
   ← {"id":1,"answer":{…},"write":[{"sql":"INSERT …","params":[…]}],
      "emit":[{"kind":"added","subject":"…","payload":{…}}]}
   ← {"id":2,"refuse":{"code":"not_found","message":"No client 12."}}
   ```

   - A worker in **any language** speaks these lines. For Node, Banda
     carries the loop: `worker.mjs` only exports its methods, each a
     function of the params and of what the call gives (`read`, who calls,
     the Project), and returns `{answer, write, emit}`.
   - **This amends ADR 0062, decision 4:** the lines go over the worker's
     stdio, not the public protocol, and it holds no pass, since the engine
     that started it is the one that calls it. The messages are those of
     decision 4, so a worker reached over the public protocol with a pass
     of its App (`via = app`) can come later without changing an App.

4. **The engine does the writing.**
   - A worker reads its own tables through `read`, which the engine runs
     under the App's authorizer on the Project's reader. It never opens the
     store.
   - A command answers its writes as data. The engine runs each statement
     in one transaction with the command's receipt, under the App's
     authorizer, and appends its events there, signed by the caller. So an
     App cannot write another's tables, a resend never writes twice, and
     the event commits with the data.
   - **The engine runs one command of an App in a Project at a time**, from
     the call to the commit, so what a command read is still so when its
     writes land. This takes the place of decision 4's `expect`: a Project's
     log moves with every word an Agent streams, and a worker would be
     refused as stale while any Thread works.
   - A worker that does not answer in time is refused `may_have_run`:
     nothing of it was written, but what it did by itself may be done.
   - Only a worker's transaction comes as data. Banda's own Apps keep their
     closures (the vision's A9 waits).

5. **Installing is one call, `apps.install {folder}`, and it copies.** The
   engine checks the folder, copies it into its own data
   (`apps/<id>/`), and runs it from there. `banda app install <folder>`
   calls it; `banda app new <id>` writes a folder to start from; `banda app
   list` and `banda app remove <id>` are the rest.
   - It needs the right to write, so an Agent's pass may call it, for a
     folder in its own Project. There is no click and no sandbox: the
     worker runs as the Person's user, as the Agent's shell does. Every
     install is said in the Thread and shows in the list of Apps
     (`welcome.apps`, `banda status`).
   - Installing again replaces the code and adds the new steps. A step
     that ran never runs again, so a table changes by a new step.
   - Removing an App keeps its data (ADR 0085, decision 6).
   - In slice 2a an installed App runs from the engine's next start; in
     slice 2b it is added to the running engine, and an Agent's session
     hears its tools change.
   - Apps from other people wait for isolation (ADR 0123).

6. **The App is the machine's, and its data is each Project's** (ADR 0085,
   decision 5). Once installed it is there in every Project of that
   machine, each with its own tables. Data one Person keeps across
   Projects, such as one list of clients, needs a grant across Projects,
   which comes with story 3. That an App follows the Person to every
   machine is not decided here.

7. **A broken App turns off alone.** A step that fails, a worker that does
   not start, or one that keeps ending, refuses that App's methods with
   `app_unavailable` and why. The Project, its Threads and the other Apps
   go on (ADR 0085, decision 8).

## Not now

`[needs]` and capabilities; published facts and `listens`; effects in the
outbox for workers; an App's own pass and `via = app`; WebAssembly
handlers; a wall around the worker; installing from a git address; an
App's files folder in the Project's data; `banda import`.

## Consequences

- An Agent writes an App with a text editor and one command, and other
  Agents, Claude and Codex alike, call it as tools in the next session.
- An App's code is trusted as its Person's own programs are. That is right
  only for Apps the Person's Agents write.
- **What it amends.** ADR 0062, decision 4 (the transport and `expect`,
  above) and decision 14 (TypeScript on Node first; `banda app new` writes
  that); ADR 0022, decision 7 (an App from outside the build). GLOSSARY's
  **Worker** loses "with its App's pass".
- **How it is checked.** A golden App in the tests: add, find, a write past
  its prefix refused, a resend that writes once, a worker that ends and
  starts again, a broken step that turns off only it. Then the try: on
  devbox an Agent writes a clients App, and another Thread, Claude then
  Codex, finds the clients in Berlin.
