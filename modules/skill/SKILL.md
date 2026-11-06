---
name: banda
description: Banda is the workspace this Agent works in, a tiling window of Projects, Threads and Panes. Read it to know where things are and to change Banda for the Person, such as its look or its sidebar.
---

# Banda

Banda is a tiling workspace for working with Agents. If you run in one of
its Threads, you are one of those Agents, and the Person sees your work in a
Pane of Banda's window.

## Words

- **Project**: one body of work and its folder, any folder on this machine.
  Banda keeps its data and log outside it, in
  `~/.local/share/banda/projects/<id>/`.
- **Thread**: one session with a Harness in a Project. Each Thread has its
  own Agent.
- **Harness**: the agent program a Thread runs on, such as Claude Code or
  Codex.
- **Pane**: one tile of the window, such as a Thread or a terminal.
- **Workspace**: one screen of Panes. Its **Strip** lays them out in
  columns that scroll sideways.
- **Sidebar**: every Thread of every Project, at the window's left edge.
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
   takes it out. An entry for `claude` or `codex` takes what it leaves
   out from Banda, the adapter's version too, so write only what changes. What
   a new Thread on a Harness starts with is its `start` table:
   `banda settings set harnesses.toml harness.claude.start.model '"opus"'`,
   and `mode`, `plan` or any option the composer offers. `banda settings rename <file> <key> <to>` gives a key
   another name where it is, as a line of keys.toml another key:
   `banda settings rename keys.toml 'binds."Alt+J"' Alt+Q`. For more than a key,
   run one for each; never edit a file they take by hand. A new file of
   the Person's own that they do not take, a sidebar preset or a theme,
   you write whole. Every key is optional: set only what changes.
3. Check it: `banda settings check`, or `banda settings check <file>` for
   a new file, prints `path:line:column: problem`
   for each mistake, and nothing when all is well. `banda settings schema
   <file>` prints every key a file may hold, with what it does.
4. Tell the Person what you changed, and how to undo it.

The window applies each save at once. A broken file leaves the last good
state in force, and the bar names the file and the line.

Never touch credentials, a Harness's own configuration, or a Project's data
in `~/.local/share/banda/projects/`; the files a message keeps there are
yours to read.

## Opening the Banda menu for the Person

`banda menu [route]` opens the Banda menu in the window, as Alt+Space
does: `banda menu actions` at its Actions, each with its key;
`banda menu project.<name>` in a Project, its Threads and a new one there;
`banda menu project.add` at "Add Project" (`project.add.folder` at its path
field, `project.add.new` at a new Project's name);
`banda menu views` at the sidebar's presets; `banda menu
settings.<section>.<row>` opens the settings Pane there. Other words
open it with them typed in, as a search. It exits 2 when the window is
not open.

## Adding a folder as a Project

A Project is the Person's to add: when they ask for a folder to become
one, `banda menu project.add.folder` opens "Add Project" at its path
field for them, and you tell them the path. In their own terminal,
`banda project add <path>` adds it too. The folder is not changed:
Banda keeps the Project's data elsewhere.

A Project's name, pin and archive, and its removal, are the Person's: they
change them in the settings, which `banda menu settings.projects.<id>`
opens at that Project, or from the Project's menu in the sidebar.
A Project whose folder is gone is listed `missing`, and every call into it
is refused until the Person locates the folder: `banda menu
project.locate.<id>` opens "Locate folder" for them.

## Driving the browser's tabs

`banda browser` prints the CDP endpoint of the browser in Banda's
window, for Playwright, Playwright MCP or Chrome DevTools MCP; its
targets are the Person's tabs. Read `banda skill browser` before you use
it. It exits 2 when the window is not open.

## Showing the Person a Visual

Show a visual the Person asks for, and data with a trend or a
comparison, as a Visual in your Thread: lay the page out with
`preview_visual`, fix what its picture and console show, then show it
with `show_visual` and the height it answered. A visual already in a
file is shown by passing that file's HTML. Never start a server for
one, and never describe it after: say only what it doesn't. A picture
to post, send or use elsewhere is a `.png` file and its path, not a
Visual. Ordinary coding work needs neither tool.

## Where things live

`~/.config/banda/` (or `$BANDA_CONFIG`) holds what belongs to this machine.
Banda Dev keeps it in `~/.config/banda-dev/`, a Banda built from a checkout
in `~/.config/banda-local/`, as their data and state too:

| File | What it sets |
|---|---|
| `look.toml` | the theme, colours, corners, gaps, motion and sounds |
| `themes/<name>/` | the Person's own themes |
| `sidebar.toml` | how the sidebar arranges Threads |
| `sidebars/<name>.toml` | the Person's own sidebar presets |
| `browser.toml` | where the browser's tabs are, and its search |
| `agents.toml` | what Enter does with a message written while the Agent works |
| `keys.toml` | the Person's keys, `[binds]`: `"Alt+M" = "column.maximize"`, or `"none"` to free a key; `mod`, the keys held for every Banda key, `"Ctrl+Alt"` where the desktop holds Alt; Ctrl+Alt+Shift+K brings Banda's own back. Every action's id: `banda modules`, the window's own (the tiling's) as the module `window` |
| `harnesses.toml` | the Harnesses Threads start with |
| `schemas/` | each file's JSON Schema, written by Banda for editors |
