---
name: banda
description: Banda is the workspace this Agent works in, a tiling window of Spaces, Threads and Panes. Read it to know where things are and to change Banda for the Person, such as its look or its sidebar.
---

# Banda

Banda is a tiling workspace for working with Agents. If you run in one of
its Threads, you are one of those Agents, and the Person sees your work in a
Pane of Banda's window.

## Words

- **Space**: one body of work and its folder. Its `.bandaso/` folder keeps
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
2. Edit the file. Keep the Person's comments and every key you were not
   asked to change. Every key is optional: write only what changes.
3. Check it: `bandaso look check` prints `path:line:column: problem` for
   each mistake, and nothing when all is well.
4. Tell the Person what you changed, and how to undo it.

The window applies each save at once. A broken file leaves the last good
state in force, and the bar names the file and the line.

Never touch credentials, a Harness's own configuration, or a Space's
`.bandaso/` folder.

## Where things live

`~/.config/banda/` (or `$BANDA_CONFIG`) holds what belongs to this machine:

| File | What it sets |
|---|---|
| `look.toml` | the theme, colours, corners, gaps, motion and sounds |
| `themes/<name>/` | the Person's own themes |
| `sidebar.toml` | how the sidebar arranges Threads |
| `sidebars/<name>.toml` | the Person's own sidebar presets |
