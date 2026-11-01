---
name: sidebar
description: Arrange Banda's sidebar - group, sort, fold, rows of one to three lines, presets - in ~/.config/banda/sidebar.toml.
---

# The sidebar

`~/.config/banda/sidebar.toml` arranges the sidebar: how Threads are
grouped and sorted, and what a row shows. Its keys lie over the preset it
names, and the preset's over Banda's defaults. The Person's keys always
win, so switching the preset never undoes them.

The view menu in the sidebar's header switches the preset: it writes
`preset = "…"` into this file and keeps everything else. If the file is
not there yet, it starts as this template:

<!-- include ../sidebar.toml -->

## States

A Thread's mark, as the sidebar sees it:

- `needs`: it asks the Person, or it failed.
- `done`: it finished while the Person was away.
- `working`: its Agent is at work.
- `idle`: nothing to see.

A state named in neither `states` nor `bottom` goes to the last section,
so no Thread is ever hidden.

## Presets

Banda's own:

- `inbox`: what needs the Person first, the working Threads on a shelf at
  the bottom, three lines a row. It is the defaults.
- `spaces`: each Space a section, one line a row.
- `places`: a list of Spaces above, a click shows one's Threads; below,
  every Thread by need, the quiet ones folded; two lines a row.

A preset of the Person's own is `~/.config/banda/sidebars/<name>.toml`,
with the keys of `sidebar.toml` except `preset`. The view menu lists it.
A file named as one of Banda's presets wins over it.

## Asked for, and what to write

- "Group my Threads by Space": `[group]` `by = "space"`.
- "One line per Thread": `[row]` `lines = 1`.
- "Hide the Harness": `[row]` `hide = ["harness"]`.
- "Show everything, no shelves": `[group]` `bottom = []` and
  `states = ["needs", "done", "working", "idle"]`.
