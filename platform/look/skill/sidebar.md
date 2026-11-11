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

Where a Thread stands, as the sidebar sees it:

- `active`: neither at work nor archived. It asks, it failed, it finished,
  or the Person has it in hand; its mark says which. Its section has no
  heading.
- `working`: its Agent is at work.
- `later`: put away until a time, or until its turn ends, from its row's
  clock, its menu or with Alt+Z (ADR 0074). It comes back then, or as soon
  as it asks, fails or hears from its Person. A Thread that asks cannot be
  put off.
- `archived`: put away. Only the Person archives a Thread, from its row's
  menu (a right click) or with Alt+S, and the Panes that show it close.
  Anything new in it brings it back, as a reply brings a letter back in
  Gmail. Its old name, `settled`, still reads as it.

A state named in neither `states` nor `bottom` goes to the last section,
so no Thread is ever hidden. `later` alone gets a shelf of its own above
Archive, so a Later always puts its Thread away.

## Presets

Banda's own:

- `inbox`: as T3 Code's sidebar, one list, what waits for the Person
  first; below, the shelves "Working", then "Later" and "Archive",
  folded. It is the defaults.
- `projects`: each Project a section.
- `places`: a list of Projects above, a click shows one's Threads; below,
  every Thread by need, the archived ones folded.

However it is arranged, a card's lines follow where it stands (ADR 0098,
decision 9): three in Your turn, two there when grouped by Project, one
for the rest. The `[row]` keys no longer lay a card out, and a preset's
`lines` is not read.

A preset of the Person's own is `~/.config/banda/sidebars/<name>.toml`,
with the keys of `sidebar.toml` except `preset`. The view menu lists it.
Behind Banda's fence the settings folder is read-only to you: write the
preset in your Project, and give your Person the line that copies it
there.

Names from before ADR 0069 still read, for one stable release: the
preset `spaces`, `by = "space"`, the table `[spaces]`, the part
`"space"` and the state `"settled"`. `banda look check` says each one's
name now; write that one.
A file named as one of Banda's presets wins over it.

## Machines

With another machine in `hosts.toml` (ADR 0095), the window names it by
the name and icon it gives itself: on its cards, before the account's
emblem (a card of one line has its icon alone), on a label over its
Projects, grouped by Project or in the list of Projects, and in its
Panes' headers, always.
`[machines]` `rows` says how its cards show it: `"named"`, its icon and
name (the default), `"icon"` alone, or `"off"`, on no card at all.
This machine is not named, unless `this-too = true`. With one machine
nothing is named, and these keys change nothing.

## Asked for, and what to set

- "Group my Threads by Project": `[group]` `by = "project"`.
- "One line per Thread", "Hide the Harness": not yet. `[row]` is no
  longer read; a key for a card's lines, `card = 1 | 2 | 3`, comes later
  (ADR 0098, decision 9). Tell your Person so, and write no `[row]`.
- "The working Threads in the list, not on a shelf": `[group]`
  `states = ["working", "active"]` and `bottom = ["archived"]`.
- "Show the archived Threads open": `[group]` `folded = []`.
- "Only the other machine's icon on its rows": `[machines]` `rows = "icon"`.
- "Name this machine too": `[machines]` `this-too = true`.
- "The Later picker offers half an hour and Friday afternoon": `[later]`
  `presets = ["30m", "fri 14"]`. Each is said as the picker's field reads
  it: a while (`45m`, `2h`), a time (`18:00`), or a day and its time
  (`tomorrow 9:00`, `mon 9:00`, `next week`). Eight at most; one it cannot
  read is named as a problem and left out.
