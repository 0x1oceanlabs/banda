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
is whole: your Person talks to an Agent, and the Agent calls it. Give it
a screen when they ask to see or fill something themselves ("Its
screen", below).

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
  App keeps; a `view` answers the App's screen ("Its screen", below).
  Only one of the App's commands runs in a Project at a time.
- **`about`** is the most important line you write. Another Agent sees
  only it and `params`, and decides from them whether to call the
  method. Say what it does, what it takes and what it answers.
- **`params`** is a JSON Schema of an object; describe each property.
  Banda refuses a call whose params do not fit its `type`, `enum`,
  `required`, `properties`, `additionalProperties: false` and `items`,
  and says where; a `pattern`, a range or a `format` the method checks
  itself.
- **`right`**: `read` for a call and `write` for a command when left
  out. `manage` is for what only your Person may do.
- Every call and command is an Agent's tool, `<id>_<method>`. `"tool":
  false` leaves one out. A tool's name another tool has is refused.
- **`ui`**: `true` on a command a control of the App's screen may send.

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
- A `call` or a `view` that answers `write` or `emit` is refused.

Rules that keep an App right:

- One process serves every Project and every caller, and calls run side
  by side. Keep nothing in the module that is one Project's or one
  caller's: what the App keeps is in its tables.
- What your Person reads and edits themselves, a document or a note,
  write as a plain file in `project.folder`. What the App keeps for
  itself goes in its tables.
- `console.log` goes to Banda's log, not to the caller.
- Plain Node, with what Node has built in.

## Its screen

A screen is a `view`: a method that answers a Tree, the screen as data.
Banda draws it with its own components, in your Person's theme, in every
window they have. You write no HTML and no CSS, and none of your code
runs in the window.

- Declare it in `methods.json` with `"kind": "view"`, as `home` above. It
  reads, and writes nothing. Name the main one `home`: your Person finds
  it in the Banda menu by the App's name.
- Mark each command a control sends with `"ui": true`, as `add`.
- Its function answers `{ answer: <Tree> }`, as `home` in `worker.mjs`.
- `banda call clients.home` prints the Tree as Banda read it, or says
  where it is wrong: `children[0] (Tabel): there is no such node`.
- Show it to your Person: the `open_pane` tool with the kind `apps.view`
  and args `{"app": "clients", "view": "home"}` opens it beside your
  Thread.
- It is read again whenever the App emits an event: emit one in each
  command that changes what a screen shows, as `add` and `note` do.

A Tree is `{ "title", "about", "children": [ … ] }`: `title` names its
Pane, `about` is a line under it. Each child is a node, an object with
`"node"` and its props. A `tone` is `"good"`, `"warn"` or `"bad"`.

Nodes that hold nodes:

| `node` | Its props |
|---|---|
| `Card` | `title`, `about`, and `children`: nodes in a box |
| `Grid` | `children` side by side, and `columns`, 1 to 6: as many as fit when unsaid. For a row of `Stat`s, or two charts |
| `Tabs` | `tabs`: each `{ "title", "children" }`, one shown at a time |
| `Accordion` | `items`: each `{ "title", "children" }`, opened by its title |
| `Dialog` | `label`: the words on its button. `title`, `about`, `children`: opened over the screen, for a Form that would crowd it. It closes once its Form's command went |

Nodes that show:

| `node` | Its props |
|---|---|
| `Table` | `columns`: each `{ "key", "title" }`. `rows`: objects by the columns' keys, a cell text, a number, true, false or null. `empty`: the words for no rows. `"search": true` for a field that finds rows. `actions`: what can be done with a row (below). A click on a column's title orders the rows, and more than 50 go by pages. At most 12 columns and 1,000 rows |
| a column's `as` | `"badge"` sets its cells apart, with `tones` for a colour by the cell's text: `{ "won": "good" }`. `"check"` shows true as a tick. `"progress"` shows a number from 0 to 100 as a bar |
| `List` | `items`: each `{ "title", "about", "badge", "tone", "actions" }`, for what reads badly in columns. `empty` |
| `Chart` | `kind`: `"bar"`, `"line"`, `"area"` or `"pie"`. `rows`, as a Table's. `x`: the key that names a row. `series`: each `{ "key", "title" }`, a number of each row, 1 to 6 of them; a pie draws the first. `title` |
| `Stat` | `label`, and `value`, text or a number, shown large. `about`: a line under it, in its `tone` |
| `Progress` | `value` out of `max`, 100 when unsaid, as a bar. `label` |
| `Badge` | `text`, `tone` |
| `Alert` | `title`, `about`, `tone`: words that must be seen |
| `Empty` | `title`, `about`: what to say where there is nothing yet |
| `Separator` | A line between what is above and below |
| `Markdown` | `text` |

Nodes that send one of the App's `ui` commands:

| `node` | Its props |
|---|---|
| `Form` | `command`. `title`. `submit`: the words on its button. `params`: what it sends as written beside what its fields fill, as the id of what it changes. Its fields are the command's params, in the order `methods.json` writes them; a param's `title` is its label. `fields` chooses and orders them: each `{ "name" }`, with `label`, `placeholder`, `about` and `kind`. `values`: what its fields hold as it opens, by param |
| `Button` | `label`, `command`, and `params`: it sends the command with them. `confirm`: a question it asks first. `"tone": "bad"` for what cannot be undone |

More than one screen: declare each as a `view`, with the `params` it
takes, as `{ "id": { "type": "integer" } }` for one record's own screen.
A screen opens another in its place, and the Pane shows the way back by
the title of the one before, so write no "Back":

- A Table's `open`: `{ "view": "client", "take": { "id": "id" } }`. A
  click on a row opens that view, with params taken from the row and
  `params` as written.
- A List item's `open`: `{ "view", "params" }`.
- The node `Link`: `label`, `view`, `params`. For the same list by
  another filter, or a page further on.

So a list and a record are two views: `home` answers the Table, and
`client` reads `id` and answers that client's numbers, notes and a Form
with `"params": { "id": id }`. A view that finds nothing answers an
`Empty` and a `Link` home.

A field's kind follows its param in `methods.json`, and `kind` may ask
for another of the same line:

| The param | Its field, and what `kind` may ask for instead |
|---|---|
| `"type": "string"` | `text`; or `textarea`, `date`, `time`, `datetime`, `email`, `url`, `password`. A `"format"` of `date`, `time`, `date-time`, `email`, `uri` or `password` chooses it without `kind` |
| `"type": "string"` with `"enum"` | `select`; or `radio` |
| `"type": "integer"` or `"number"` | `number`; or `slider`, which needs the param's `minimum` and `maximum` |
| `"type": "boolean"` | `checkbox`; or `switch` |

An action of a Table's row or a List's item is `{ "label", "command" }`
with:

- `params`: what it sends as written.
- `take`: what it sends from its row, each param by the row's key:
  `{ "id": "id" }`. A row may hold keys that are no column, as its id.
  Only a Table's rows have keys: an item's action writes its `params`.
- `confirm`: a question it asks first, as before a delete.
- `"form": true`, or `fields` as a Form's: it opens a form first, whose
  fields start from what it takes from the row, and it sends what it
  writes and takes with what was filled. `submit` names its button.
  Text the row had that your Person emptied is sent as `""`, so write
  the command to take that as "no more". An action asks or opens a form,
  not both.
- `tone`.

So a row is changed by `{ "label": "Edit", "command": "update", "take":
{ "id": "id", "name": "name" }, "fields": [{ "name": "name" }] }`, and
removed by `{ "label": "Delete", "command": "remove", "take": { "id":
"id" }, "confirm": "Delete this client?", "tone": "bad" }`.

A screen that reads well: what must be seen first, then a `Grid` of
`Stat`s, then `Tabs` of its tables, and its forms in a `Dialog`; a row
opens its record's own view. A Tree
holds at most 500 nodes. A prop not named here is refused: ask for less,
not for a prop Banda does not have. What a screen cannot be made of,
tell your Person rather than work around.

## When it goes wrong

Each refusal says what to do next:

- `invalid`, from `check` or `install`, names the file and what is wrong
  in it: `methods.json: find: about is empty…`. Nothing was installed.
- `app_unavailable`: the App does not run here, and the message says
  why: a step of its tables failed in this Project, its code does not
  load, or it lacks a method `methods.json` declares. Nothing ran. Fix
  and install again.
- `internal`, "`clients.add` failed: …": the method threw, a write
  failed, or a view answered what is no Tree. The message has the error,
  and for a Tree where in it. Nothing was written.
- `conflict`, when the method did not refuse so itself: a table's own
  rule refused the write, as a row there already.
- `may_have_run`: the method did not answer in time, or its worker
  ended. Banda wrote nothing, but its code may have acted by itself, on
  a file or over the network: look before you call again.
