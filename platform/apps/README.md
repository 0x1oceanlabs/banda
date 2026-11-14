# The apps module

`platform/apps`: the Apps on this machine, and the Apps a Person's Agent
writes as a folder. [The architecture](../../docs/architecture.md#apps)
is the map this page is one part of. A change to this part changes this
page in the same PR.

## What it does

The apps module (`platform/apps`) is the machine's: it holds the Apps on
this machine (ADR 0126).

- `apps.describe` answers every App and platform part the engine runs,
  each with its methods, as the engine's scan of their manifests found
  them.
- **An App from a folder.** A Person's Agent writes an App as plain files:
  `app.toml` (its id, name, about, version, `api` and `entry`),
  `methods.json` (its methods as data: each with its `kind`, `call` or
  `command`, its `right`, `about` in words and `params`, a JSON Schema),
  `migrations/001.sql`, `002.sql`, … (its tables, one step a file) and its
  entry, the code a worker runs. Each method is an Agent's tool,
  `<app>_<method>`, unless it says `"tool": false`.
- **`apps.install {folder}`** reads the folder, checks it and says what is
  wrong by its file, then installs it in three steps, so the engine never
  runs a copy it did not take. It copies the folder into Banda's data, a
  folder of its own for each install (`apps/<id>/<when>/`); the engine
  takes the App from there; and only then does `apps/<id>/installed.json`
  name that copy, with who installed it. Refused, the copy goes and the
  App installed before runs on as it was. The copies no install names go
  as the engine next starts. An id the engine runs or the kernel keeps is
  refused, and so is a tool's name another tool has. It writes the fact
  `installed` in the machine's log.
- **Who may.** It needs the right to write, and a pass reaches it: an
  Agent installs from a folder inside its own Project, with no click, for
  the App runs as the Person's user, as the Agent's shell does. The Person
  names any folder, whole.
- `apps.installed` lists them, each with whether the engine runs that
  version yet, and `apps.remove {id}` takes one away; what it kept in
  each Project stays (ADR 0085, decision 6). `banda app install | list |
  remove` are these calls, and `banda modules` prints the installed Apps
  after Banda's own.
- **A worker runs it.** As the engine starts, it takes each installed App
  as a module of its own (`Served`): its name is the App's id, its
  migrations the folder's steps, its methods and its tools what
  `methods.json` declares, so the router, the access rule, receipts,
  `banda call` and `banda mcp` treat it as any module. One process serves
  an App on a machine: the engine starts it at the App's first call, with
  the Node Banda carries or the machine has and Banda's own loop
  (`runner.mjs`, which loads the App's entry), behind the fence where it
  holds, and again when it has ended. They talk in lines of JSON on its
  stdin and stdout: a call with its params, who calls and the Project; the
  worker's reads of its own tables, which the engine answers from that
  Project's reader under the App's authorizer; and its answer, or its
  refusal.
- **The engine does the writing.** A command answers its writes and its
  events as data, and the module keeps them in one transaction with the
  command's receipt: each statement under the App's authorizer, so SQL
  that reaches another App's table is refused and nothing of the command
  is kept, and each event by who called. One command of an App runs in a
  Project at a time, from its call to its commit, so what it read is
  still so as its writes land. A call that answers a write is refused.
- **What goes wrong stays in the App**, and the refusal says how far the
  call got. A worker that does not start, for its code does not load, it
  lacks a method `methods.json` declares, or the machine has no Node,
  refuses the App's methods with `app_unavailable` and what it said:
  nothing ran. One that ends before it answers, or does not answer in a
  minute, refuses with `may_have_run`: Banda wrote nothing, and what its
  code did by itself may be done; one that did not answer is let go of,
  and the next call starts another. A refusal its method makes
  (`invalid`, `not_found`, `forbidden`, `conflict`) reaches the caller as
  it is. What its code throws, a write that fails or a call that answers
  a write is `internal`, with its words, for it is the App's to put
  right; but a write its table's own rules refuse is `conflict`.
  `banda app new <id>` writes a folder to start from.
- **Tried before it is installed.** `banda app check <folder>` reads an
  App's folder and tries its steps on a database of its own, in memory,
  as a Project's store would run them (`banda_kernel::try_steps`), with
  no engine and none of its code run. `apps.install` does the same before
  it copies anything, so a step that fails is refused with why, and the
  App installed before goes on as it ran. A step that fails only over
  what a Project holds still turns it off there alone.
- **Its screen is a view that answers a Tree** (ADR 0062, decision 7).
  A method of kind `view` is a read, routed as a call, whose answer is
  the App's screen as data: a title and nodes of a small catalogue, Card,
  Table, List, Form, Button, Badge, Empty and Markdown
  (`platform/apps/engine/src/tree.rs`). The engine reads the Tree before
  any client sees it: a client is trusted and a Tree is not. What it
  gets wrong is `internal`, by where in the Tree and why, and a Tree is
  held to 500 nodes and a Table to 1,000 rows. A control names only one
  of the App's own commands that `methods.json` marks `"ui": true`. A
  Form's fields come from that command's params, so no App writes them
  twice: they come in the order `methods.json` writes them, and `fields`
  chooses among them, orders them or says more of one.
  The Tree carries the place in the Project's log it shows (`at`), taken
  before the view read, so a client follows the App's events from there
  and reads the view again on one. A view is no Agent's tool unless it
  says so. No Pane draws it yet.
- **Agents know the road.** The Banda skill's topic `apps`
  (`platform/apps/skill/apps.md`) says how to write one, with the clients
  App of the module's tests as its example, word for word; the skill's
  core and the brief every session gets point to it.
- **Added while the engine runs.** `apps.install` adds the App to the
  running engine through the kernel's `Registry`, a handle the engine
  makes and the kernel binds as it opens. Every open Project takes the
  module at once: both of its store's connections let it reach its
  tables, and its steps the store has not seen run, as when a Project
  opens; where they fail, or it does not open, it is turned off, there
  alone, and the install answers each such Project in `off`, with why.
  Then what the kernel runs is swapped whole: its modules, its tools and
  the Apps its `welcome` says.
- **Put in the place of itself.** An App installed again is each
  Project's as that Project took it: the Project waits for the calls the
  old one runs there to end, lets none begin, runs the new steps, and
  only then has the new module; the router calls a module, and reads a
  method's right, as the call's Project has it. So the App it replaces
  never writes the tables its steps changed. Its commands keep their
  turns, and its worker is let go of once its last call ends.
  `apps.remove` takes it out the same way, and what it kept stays. Only
  what was added so is replaced or taken away: a module the engine was
  built with keeps its name. What the kernel ends for a module it lets
  go of is its calls: one added so queues no effect, opens no stream and
  starts nothing as it opens. The Apps installed before a start are
  handed to the kernel as it is built, named as added, so their steps
  run as each Project opens.
- **What an App keeps reads without it.** `apps.export {project, app}`
  streams it as lines (ADR 0085, decision 10), read by the kernel
  (`kernel/src/export.rs`) in pieces, each the lines of one file of the
  export: first `app.json`, with the App's ledger and each of its
  tables' CREATE; then `events.ndjson`, its events in the log's order;
  then a `<table>.ndjson` for each table, a row a line by column, bytes
  as `{"$base64": …}`. The last piece is `done`, with each file's count
  of lines: an export without it was cut short, and `banda export`
  fails. Its tables are those of its prefix and of the ids it had
  before; a full-text index is listed by its CREATE and has no rows
  there, as it is made again from what it indexes. It reads a page at a
  time, each from the last row's key on, so the Project's reads go on
  beside it. It serves Banda's own Apps, and one removed whose data
  stays; it is the Person's alone; and an App's files are not in it
  yet. `banda export --app <id>` prints each line with its file, and
  with `--to <folder>` writes the export's files there.
- **A session hears its tools change.** `machine.apps` is the kernel's
  stream of the Apps it runs, as the `welcome` lists them: the list now,
  then again at each change. `banda mcp` hears it on a connection of its
  own, reads the tools again and tells its client
  `notifications/tools/list_changed`, so the Agent that installed an App
  calls it in the same Thread.
