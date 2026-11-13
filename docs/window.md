# The window

Agreed with Roma on 2026-11-13. It says what the window is and the six
rules it is built by. They follow from [what we build](what-we-build.md)
and never go against it. Where an ADR on the window differs from this
document, this document wins until the ADR is amended. Its decisions are
[ADR 0127](adr/0127-the-window-shows-and-asks-and-each-thing-has-one-place.md),
and the slices that carry it out are
[the window's plan](research/2026-11-13-window-plan.md).

## What the window is

The window is everything the Person sees and touches on a client: the
desktop app's window, a browser tab, the phone. It is three kinds of
program (ADR 0087) and, on the desktop, the device under them.

| Program | It owns | It never |
|---|---|---|
| **The Window** | the areas (the Bar, the Sidebar, the Top layer, the middle), the keys, Here | names an App, or decides for one |
| **The Tiling** | the middle: the view of the arrangement, the Tiles, the motion | knows what a Pane shows, or decides where a Pane opens |
| **What fills the areas** | an App's Panes, widgets, menu rows and settings; the sidebar list | calls another App, or reaches the device by itself |
| **The device** (Electron main on the desktop) | what only this screen has: its frame, clipboard, notices, files, the system's look | holds a rule another client would have to repeat |

The engine of each machine is the other side. It keeps the work and
decides (principle 4 of what we build). The window shows what the engines
say and asks them for what the Person wants.

## Principles

Each one says what it asks of the code and how to check it.

### 1. One thing, one place, one owner

What hurts most today is that a rule is written in several places, so an
Agent that changes one of them breaks the others.

- **The code:** every behaviour has one module that owns it, with a small
  interface, and no other module repeats it. On the screen every function
  has one door: the Banda menu is the one search and the one list of
  commands; a Thread starts in the New Thread Pane; the Sidebar is a list.
- **The check:** each border is a test with a list that only falls
  (`client/web/src/architecture.test.ts`), and each owner has a test of
  its own behaviour that the others cannot change. A PR that adds a second
  copy of a rule, or a second door to a function, fails a test.

### 2. The window shows and asks; the engine decides

From principle 4.

- **The code:** the window sends what is wanted ("open this Pane, from
  that one") and draws the answer. Where a Pane opens, what is refused,
  who calls the Person, in what order and how many: each is decided once,
  in the engine module that owns it. The window may draw ahead of the
  answer, and the answer always wins.
- **The check:** a second client shows the same result and carries none of
  the rules. No code under `client/` picks a place, counts who calls or
  decides who is told.

### 3. Everything the window does is an action with a name

From principle 2.

- **The code:** a key, a button and a menu row only run an action by its
  id. The same action runs from an Agent and from the `banda` CLI, with the
  same arguments, and an Agent may run any of them.
- **The check:** whatever the Person does with a key, `banda act` does with
  one command. No control carries behaviour of its own.

### 4. The window knows no App

From principle 3.

- **The code:** the Window holds areas and the Tiling holds Panes. An App
  says what it puts where (its Pane kinds, actions, widgets, menu rows and
  settings), and the window reads that from the engines when it starts.
  Banda's own Apps come in by the same description as any other.
- **The check:** no file of the Window or the Tiling names an App. A new
  App shows with no new build of the client.

### 5. A view is the device's, the work is the machine's, the settings are the Person's

From principle 9.

- **The code:** each thing has one shelf. What is on this screen (which
  workspace, the focus, Solo, a width as drawn, the theme) is the
  device's. Threads, terminals, files and what an Agent does are the
  machine's. Keys, the Tiling's rules and how the Sidebar is arranged are
  the Person's, and follow them to every device. No window code asks
  whether a thing is on this machine or another.
- **The check:** two clients on one engine do not change each other's
  view. A client with no machine of its own passes every try.

### 6. Behaviour and the look are data in files the engine reads

From principles 2 and 4.

- **The code:** how the Tiling behaves is one file of settings and rules,
  `tiling.toml`. A theme is a set of tokens. The engine reads both and
  gives every client the same answer. The window draws only from tokens
  (ADR 0113) and keeps no rule of behaviour as a constant.
- **The check:** change a rule or a theme in its file, and every client
  follows with no new build. The same file reads without Banda.

## The order

Like a drawing: broad strokes first.

1. **The structure.** Every rule in its one place, the engine deciding,
   actions that run from anywhere, the Tiling's file, and how a theme
   travels from its file to every client.
2. **The look.** The themes themselves, Banda and macOS first, worked on
   with Roma by eye.
3. **The details.** Small things, last.

A change to the look does not start before the structure it stands on.
