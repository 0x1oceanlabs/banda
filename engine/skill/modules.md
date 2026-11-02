---
name: modules
description: Banda's modules - what each is, the settings files it owns, its actions and their keys, and what an Agent may call.
---

# Modules

<!-- Written by banda's tests from each module's module.toml and code: do not edit. -->

Banda's work is done by modules. `banda modules` prints all of this as JSON, one line per module; `banda modules --unstable` lists the paths a module takes that are not in the contract yet.

## Agents (`agents`)

Threads with Agents on their Harnesses: what each says and does, and what it asks the Person.

Its settings: `agents.toml`, `harnesses.toml`.

Its actions, which `keys.toml` binds by id:

- New Thread (`thread.new`), Alt+Return

Its methods, `banda call agents.<method>`: `harnesses`, `account`, `sign_in`, `sign_out`, `threads`, `thread`, `defaults`, `send`, `edit`, `withdraw`, `steer`, `resume`, `configure`, `stop`, `retry`, `answer`, `attach`, `image`, `keep`, `files`.

What an Agent in a Thread may call as a tool of `banda mcp`:

- `threads`: The Threads of this Space, the latest first: each one's ID, title and Harness, what it was last asked, how its latest turn stands, and the Questions it waits on.
- `read`: One Thread of this Space as its Person reads it: its messages and replies, its turns and what each may do now, and its settings.
- `send`: Writes into a Thread of this Space, or starts a new Thread on a Harness. Its Agent reads that the message is from your Thread's Agent, not its Person; when the turn it asks for ends, its last reply comes back to your Thread by itself. A message waits its turn in a Thread that works; a Person's with `steer` joins the turn that runs.

## Terminal (`terminal`)

Programs the Person runs in a terminal: a shell, or a Harness's sign-in.

Its methods, `banda call terminal.<method>`: `open`, `write`, `resize`, `close`, `watch`.

## Browser (`browser`)

Chromium pages in the window, for the Person and every Agent: tabs, extensions, and a blocker of ads and trackers.

Its settings: `browser.toml`.

Its actions, which `keys.toml` binds by id:

- New browser (`browser.new`), Alt+Shift+Return

## Workspaces (`workspaces`)

How this machine's Panes are arranged: workspaces one under another, each a Strip of columns.

Its methods, `banda call workspaces.<method>`: `list`, `open`, `close`, `update`, `move_pane`, `move_column`, `size`, `maximize`, `display`, `tidy`, `take`.
