---
name: apps
description: Write a Banda App, something that keeps records for your Person and their Agents, as a folder installed with `banda app`. Read it before you write or change one.
---

# Writing an App

A Banda App keeps something for your Person and gives it to every Agent
as tools: "make me an App for tracking clients". You write it as a
folder in your Project and install it, with no click and no restart.
From then its methods are tools every Agent on this machine calls, in
every Project, and `banda call` reaches them too. An App with no screen
is whole: your Person talks to an Agent, and the Agent calls it.

A program, website or CLI your Person asks you to build in their code is
not a Banda App: build that as asked.

Install only an App you or your Person wrote. One from anyone else would
run as your Person, with no wall around it: such Apps wait until Banda
can isolate them.

## The road

1. `banda app new clients` writes `clients/` here: a small App that
   works as it is.
2. Change it into what was asked: its tables, its methods, its code.
3. `banda app check clients` reads it and says what is wrong, by file,
   and lists the tools it will give. It tries the steps of its tables on
   empty tables, so a step that fails only over rows a Project already
   holds (a `NOT NULL` column added with no default, a `UNIQUE` index
   over rows that repeat) shows only when you install.
4. `banda app install clients` installs it, and refuses in the same
   words what `check` would. It answers `runs`, and `off`: the Projects
   where a step failed over what they hold, with why. Refused, the App
   installed before runs on as it was.
5. Try it: `banda call clients.add --params '{"name":"Anna"}'`, then
   `banda call clients.find`. Fix, raise `version`, and install again:
   installing over itself keeps what it holds.
6. `banda app list` shows it as installed. Its tools (`clients_add`, …)
   are in your session now, and in every Thread's. Tell your Person in a
   sentence or two what it does, that they can ask any Agent for it
   ("add Anna to my clients"), and that what it keeps is each Project's
   own.

`banda app remove <id>` takes an App away; what it kept stays, and
installing it again brings it back.

## The folder

```
clients/
  app.toml          its id, name, about, version, api and entry
  methods.json      its methods, as data
  migrations/       001.sql, 002.sql, …: its tables, one step a file
  worker.mjs        its code
```

Keep it in the Project, so your Person has it in their files and in git.
Installing takes a copy: a change to the folder runs only once you
install again, and what the code imports must be in the folder (nothing
is installed for it). Each file is at most 1 MB.

### app.toml

<!-- include ../engine/tests/folders/clients/app.toml -->

- `id` is 1 to 32 lowercase letters. It prefixes the App's methods
  (`clients.add`), its tools (`clients_add`) and its tables
  (`clients_people`). One Banda keeps for itself is refused.
- `about` is what the App is for, in a sentence.
- Raise `version` when you change it.
- Write no other key in it.

### methods.json

Each method has a `kind` and `about`, and `params` when it takes any:

<!-- include ../engine/tests/folders/clients/methods.json -->

- A method's name is lowercase letters, digits and `_`.
- **`kind`**: a `call` reads and answers; a `command` changes what the
  App keeps. Only one of the App's commands runs in a Project at a time.
- **`about`** is the most important line you write. Another Agent sees
  only it and `params`, and decides from them whether to call the
  method. Say what it does, what it takes and what it answers.
- **`params`** is a JSON Schema of an object; describe each property.
  Banda hands a method what it was sent: check in the method what it
  needs.
- **`right`**: `read` for a call and `write` for a command when left
  out. `manage` is for what only your Person may do.
- Every method is an Agent's tool, `<id>_<method>`. `"tool": false`
  leaves one out. A tool's name another tool has is refused.

### migrations

One step a file, `001.sql`, `002.sql`, …, with none left out:

<!-- include ../engine/tests/folders/clients/migrations/001.sql -->

- Every table and index is named `<id>_…`. Banda refuses the rest.
- A step that ran never runs again. To change a table, add the next
  step; never edit one that was installed and ran.
- A step may make tables and indexes and add columns. It may not make a
  view or a trigger, nor drop or rename a table or an index: to reshape
  a table, make a new `<id>_…` table and copy its rows.
- Each Project has its own tables: what the App keeps in one Project is
  not in another.
- A step that fails over what a Project holds turns the App off in that
  Project alone, and `install` says where and why. Put it right with the
  next step.

### worker.mjs

It exports `methods`, one function for each method of `methods.json`:

<!-- include ../engine/tests/folders/clients/worker.mjs -->

A method takes its params and what the call gives:

- `read(sql, params)`: rows of the App's own tables in the call's
  Project, each an object by column. It sees the tables as they were
  before this call's own writes: choose a new row's id in the method, as
  `add` does, when you answer it.
- `refuse(code, message)`: the refusal to `throw`, with `invalid`,
  `not_found`, `forbidden` or `conflict`. It reaches the caller as it
  is, and the caller reads the message.
- `by`: who calls, `{ kind: "person" | "agent", id }`.
- `project`: the Project it calls in, `{ id, folder }`.

It answers `{ answer, write, emit }`:

- `answer` is what the caller gets: JSON.
- `write` is the statements to run on the App's tables, each `{ sql,
  params }`. **Banda does the writing**, all of a command's statements
  in one transaction, or none. A method never opens the database.
- `emit` is the App's events, each `{ kind, subject, payload }`: what
  happened, for what follows the App later, as its screen.
- A `call` that answers `write` or `emit` is refused.

Rules that keep an App right:

- One process serves every Project and every caller, and calls run side
  by side. Keep nothing in the module that is one Project's or one
  caller's: what the App keeps is in its tables.
- What your Person reads and edits themselves, a document or a note,
  write as a plain file in `project.folder`. What the App keeps for
  itself goes in its tables.
- `console.log` goes to Banda's log, not to the caller.
- Plain Node, with what Node has built in.

## When it goes wrong

Each refusal says what to do next:

- `invalid`, from `check` or `install`, names the file and what is wrong
  in it: `methods.json: find: about is empty…`. Nothing was installed.
- `app_unavailable`: the App does not run here, and the message says
  why: a step of its tables failed in this Project, its code does not
  load, or it lacks a method `methods.json` declares. Nothing ran. Fix
  and install again.
- `internal`, "`clients.add` failed: …": the method threw, or a write
  failed. The message has the error. Nothing was written.
- `conflict`, when the method did not refuse so itself: a table's own
  rule refused the write, as a row there already.
- `may_have_run`: the method did not answer in time, or its worker
  ended. Banda wrote nothing, but its code may have acted by itself, on
  a file or over the network: look before you call again.
