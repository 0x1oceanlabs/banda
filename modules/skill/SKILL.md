---
name: banda
description: Banda is the workspace this Agent works in, a tiling window of Spaces, Threads and Panes. Read it to know where things are and to change Banda for the Person, such as its look or its sidebar.
---

# Banda

Banda is a tiling workspace for working with Agents. If you run in one of
its Threads, you are one of those Agents, and the Person sees your work in a
Pane of Banda's window.

## Words

- **Space**: one body of work and its folder. Its `.banda/` folder keeps
  Banda's data and log for it.
- **Thread**: one session with a Harness in a Space. Each Thread has its
  own Agent.
- **Harness**: the agent program a Thread runs on, such as Claude Code or
  Codex.
- **Pane**: one tile of the window, such as a Thread or a terminal.
- **Workspace**: one screen of Panes. Its **Strip** lays them out in
  columns that scroll sideways.
- **Sidebar**: every Thread of every Space, at the window's left edge.
- **Bar**: the line across the window's top, with Banda's **Mark**, which
  says what the work calls the Person for.

## How to change Banda

Banda is changed through text files, the same way the Person changes it.

1. Read the topic for what you change, below.
2. Change one key with `banda settings set <file> <key> <value>`, as
   `banda settings set look.toml tile.border 3`, or take it out with
   `banda settings reset <file> <key>`: they keep every comment and other
   key, and refuse a value the file would not take. A Harness is named by
   its ID: `banda settings set harnesses.toml harness.codex.enabled false`;
   `harness.<id>` set to an inline table adds a whole entry, and reset
   takes it out. For more than a key,
   edit the file: keep the Person's comments and every key you were not
   asked to change. Every key is optional: write only what changes.
3. Check it: `banda settings check` prints `path:line:column: problem`
   for each mistake, and nothing when all is well. `banda settings schema
   <file>` prints every key a file may hold, with what it does.
4. Tell the Person what you changed, and how to undo it.

The window applies each save at once. A broken file leaves the last good
state in force, and the bar names the file and the line.

Never touch credentials, a Harness's own configuration, or a Space's
`.banda/` folder.

## Opening the Banda menu for the Person

`banda menu [route]` opens the Banda menu in the window, as Alt+Space
does: `banda menu actions` at its Actions, each with its key;
`banda menu space.<name>` in a Space, its Threads and a new one there;
`banda menu views` at the sidebar's presets; `banda menu
settings.<section>.<row>` opens the settings window there. Other words
open it with them typed in, as a search. It exits 2 when the window is
not open.

## Where things live

`~/.config/banda/` (or `$BANDA_CONFIG`) holds what belongs to this machine:

| File | What it sets |
|---|---|
| `look.toml` | the theme, colours, corners, gaps, motion and sounds |
| `themes/<name>/` | the Person's own themes |
| `sidebar.toml` | how the sidebar arranges Threads |
| `sidebars/<name>.toml` | the Person's own sidebar presets |
| `browser.toml` | where the browser's tabs are, and its search |
| `harnesses.toml` | the Harnesses Threads start with |
| `schemas/` | each file's JSON Schema, written by Banda for editors |
