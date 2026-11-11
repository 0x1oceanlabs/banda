---
name: sidebar
description: Arrange Banda's sidebar - group by Project or machine, a card's lines, the Inbox's order and parts, presets - in ~/.config/banda/sidebar.toml.
---

# The sidebar

`~/.config/banda/sidebar.toml` arranges the sidebar, the Person's inbox
of their Agents' work (ADR 0098): how the list is grouped, how many
lines a card has, and what the Inbox shows. Its keys lie over the preset
it names, and the preset's over Banda's defaults. The Person's keys
always win, so switching the preset never undoes them.

The view menu in the sidebar's foot writes the keys of the view below
into this file, one at a time, and keeps everything else. If the file is
not there yet, it starts as this template:

<!-- include ../sidebar.toml -->

## The view

- `group`: `"none"`, one list (the default); `"project"`, each Project
  under its header; `"machine"`, each machine under its header.
- `card`: a card's lines. `"auto"` (the default) follows where it
  stands: three in Your turn, two there when grouped by Project, one for
  the rest. `3`, `2` or `1` is as many everywhere.
- `[inbox]`: `order` is Your turn's, `"oldest"` first (the default, so
  no one waits forever) or `"newest"`. Alt+U walks the oldest first
  whatever it says. `open = false` leaves Open out of the Inbox, and
  `working = false` its Working shelf.
- `[hold]` `still = false` lets the list move under the pointer; by
  default its order keeps still there, and what is new takes its place
  when the pointer leaves.

## Presets

Banda's own, kept so a file that names one still reads:

- `inbox`: one list. It is the defaults.
- `projects`: `group = "project"`.
- `places`: `group = "project"` too. Until the list of Projects goes
  (ADR 0098, decision 16), the window shows that list above, and the
  Threads as one list; a group picked in the view menu leaves it for
  `inbox`.

A preset of the Person's own is `~/.config/banda/sidebars/<name>.toml`,
with the keys of `sidebar.toml` except `preset`. Settings → Sidebar
lists it.
Behind Banda's fence the settings folder is read-only to you: write the
preset in your Project, and give your Person the line that copies it
there.

A file named as one of Banda's presets wins over it.

## Keys no longer used

ADR 0098 put these out of use: `[group]` and its keys (`by`, `states`,
`bottom`, `folded`, `limit`, `empty`), `[row]` and its keys (`lines`,
`hide`, `line1`–`line3`), and `[projects]` `list`. A file that still
says one is told so at its line; the key is left out and the rest of the
file holds. Take the line out, and write `group` or `card` instead where
one says the same.

Names from before ADR 0069 still read, for one stable release: the
preset `spaces` and the table `[spaces]`; and from before ADR 0098 the
table `[snooze]`. `banda look check` says each one's name now; write
that one.

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

- "Group my Threads by Project": `group = "project"`.
- "Group them by machine": `group = "machine"`.
- "One line per Thread": `card = 1`.
- "The newest call first": `[inbox]` `order = "newest"`.
- "Only what is my turn in the Inbox": `[inbox]` `open = false` and
  `working = false`.
- "Only the other machine's icon on its rows": `[machines]` `rows = "icon"`.
- "Name this machine too": `[machines]` `this-too = true`.
- "The Later picker offers half an hour and Friday afternoon": `[later]`
  `presets = ["30m", "fri 14"]`. Each is said as the picker's field reads
  it: a while (`45m`, `2h`), a time (`18:00`), or a day and its time
  (`tomorrow 9:00`, `mon 9:00`, `next week`). Eight at most; one it cannot
  read is named as a problem and left out.
