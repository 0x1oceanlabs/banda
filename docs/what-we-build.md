# What we build

Agreed with Roma on 2026-11-12. This is the first thing to read. Every ADR
and every PR serves one of its principles or stories, and says which. A
change that goes against it is Roma's call first. Where the architecture
vision (`research/2026-11-06-architecture-vision.md`) or an ADR differs
from it, this document wins until the ADR is amended.

## The thesis

Banda is the Person's workspace in the age of AI. It is a layer over the
operating system and the web, and it joins what is best in each: from the
operating system, processes, files, the terminal and machines; from the
web, reach from anywhere, links, and people working together.

In Banda the Person, their Agents and their machines work together, and
they talk in text:

- the Person and an Agent, in a Thread;
- program and program, in JSON with a description in words, as MCP tools
  are described;
- what they keep, in files that a Person and an Agent can both read.

Everything Banda can do is an App on one open SDK, and an Agent can write a
new App.

Banda runs on the Person's own machines, in a network with no centre, like
the internet. Banda Cloud is a convenience, never a part Banda needs. Banda
is built first for one Person with several machines and many Agents, and
from there it spreads, over the same network, into teams and companies.

## Principles

Each one says what it asks of the code and how to check it.

### 1. Three actors: the Person, the Agent and the machine

- **The code:** every act names who did it (a Participant, or an App that
  acts as itself) and the machine it came from. Rights belong to the actor,
  not to a window or a secret.
- **The check:** any record says who made it. An Agent cannot pass as its
  Person.

### 2. Text is the common language

As in Unix, where programs talk to each other in text. The Person and an
Agent talk in a Thread, in markdown. Programs talk in JSON with a
description in words. What is kept is in md, html and json files.

- **The code:** every action of an App is described in words and is called
  the same way from the window, from an Agent (MCP) and from the `banda`
  CLI.
- **The check:** whatever the Person does with a button, an Agent and the
  CLI do with the same call. An App's data can be read without the App.

### 3. Everything is an App, with a screen or without

- **The code:** an App is actions, data and events. Its screen is a
  separate part and may be missing. By default Banda gives an App a web
  screen built with shadcn/ui, shown on every client: the desktop, the web
  and the phone. Threads, the terminal, the browser, files and git are
  ordinary Apps with no special rights: they ship with Banda, as `ls` and
  `cp` ship with an operating system, and go through the same contract as
  any other App. Today Threads still has places of its own in the kernel;
  this principle is where it is going.
- **The check:** an App with no screen is fully useful through an Agent. An
  Agent writes a working App in one Thread.

### 4. The engine is the operating system, the client is the browser

- **The code:** all work and all state live in the engine. A client shows
  and asks. It joins the machines it reaches, in one router that every
  client shares (ADR 0124), and does no work by itself. The only thing it
  keeps is what waits for a machine that is away (ADR 0105), and it decides
  no notifications.
- **The check:** close the window and nothing is lost or stops. A new
  client, the web or a phone, needs only screens; it repeats no logic.

### 5. A network with no centre, like the internet

- **The code:** machines are peers. A company is one more machine in the
  network. Order comes from access rights, not from a main server.
- **The check:** when one machine is away, the others work. No machine is
  one without which nothing works.

### 6. Everything can run on the Person's own machines

- **The code:** whatever Banda Cloud does (finding machines, relaying,
  hosting), the Person can run themselves. Everything is open source today;
  if part of our own infrastructure ever closes, running it yourself stays
  possible.
- **The check:** nothing in the open code needs our server.

### 7. Banda is an adapter, not a Harness

- **The code:** Agents come from outside: Claude and Codex now, others
  through ACP later. Banda shows them, joins them and obeys them; it does
  not police them. A Harness of our own, if one ever comes, sits beside
  the others with the same rights.
- **The check:** a new Agent joins through ACP with no special code.

### 8. Built for one Person first, in the shape of a network from the start

- **The code:** names, rights and exchange are shaped from day one so that
  a team is just more people in the same network.
- **The check:** a team needs new rights, not a new model.

### 9. Where the work runs makes no difference

Every machine's Projects, Threads, terminals, files, git, browser pages and
settings look and act the same in every client (the desktop, the web and
the phone), whether the machine is the one in front of the Person or a
server far away. It is like `ssh`: you land in the same terminal as if it
stood on your desk. Only the device's own things are local: its screen,
clipboard, notifications, files and the apps it opens. A machine that is
away is said honestly, in one word, and nothing waits for it in silence.

- **The code:** no client code asks "this machine or another?" about a work
  thing; it asks the machine that owns the thing, through one router. A
  client reaches the engine of the machine it runs on by the same road,
  with the same key and the same away rule as any other machine
  (ADR 0124). A device thing goes through the device, by a named
  capability.
- **The check:** the same gesture on a Project of the Mac and on one of arc
  gives the same screen, except for the machine's name. The window works
  with its own machine's engine stopped. The phone, which has no machine of
  its own, and devbox, which has no window, pass every try of story 1.

## Apps on every machine and every device

Principles 3 and 9 together: **an App's logic lives on a machine, and the
device draws it.** An App's code never travels to a device; a description
of its screen does.

| Kind of screen | What it is | Where it runs | On the phone |
|---|---|---|---|
| **Tree** | the App answers data: which components, with what in them (a list, a form, a table, a chart) | the logic on the machine, drawn by the client | drawn the same way, with nothing new to write |
| **Live component** | what must draw every frame: a Thread, a terminal, a browser's page, a file's view | in every client, shipped with Banda | the same, in the web build |
| **Frame** | an App's own HTML page in a sandboxed frame, as an MCP App's | in the frame, on the device | the same frame |
| **Site** | a website as an App, with its own sign-in | in a webview of its own on the device | a browser tab |

- **One catalogue of components ships with Banda:** shadcn/ui, Banda's own,
  and the live components. Every client draws them itself, in its own
  theme. Typing, scrolling, sorting and menus act on the device at once; a
  save goes to the machine.
- **An App with a screen and one without are the same App.** An Agent calls
  its actions in text; the Person sees them drawn from its Tree. The
  default screen on shadcn/ui is that Tree.
- **The phone needs to know no App.** A new App an Agent writes on arc shows
  on the phone with no phone update. The catalogue is the channel through
  which every App reaches every client, so the phone can grow from its
  first version.
- **Machines on different versions do not get in the way.** The client knows
  only the catalogue, and the catalogue has one version.
- **An App asks the device through Banda,** never by itself: show this, tell
  the Person, put this on the clipboard, let them pick a file. The device
  where the Person is decides. So an App on devbox can reach the Person on
  the phone.

**What an App is written in.** Any language, because an App talks to Banda in
JSON with a description in words (principle 2).

- **Banda's own Apps** (Threads, the terminal, Files, Git, the browser): the
  part on the machine is Rust inside the engine, and the screens are
  TypeScript live components shipped with the client. They ship with
  Banda, as `ls` and `cp` ship with an operating system, but they are not
  its kernel: they go through the same contract as any other App, with no
  special rights (principle 3).
- **Apps an Agent or anyone else writes:** a separate program on the machine,
  a worker. The engine starts it and talks to it in lines of JSON: "call
  `add_client` with this". The App answers "here is the answer, and here is
  what to write". The engine does the writing, so an App cannot spoil
  another's data, every write has a receipt, and a broken migration turns
  off only that App. TypeScript on Node comes first (Agents write it best,
  and the engine already carries Node), then any language on the same
  JSON. WebAssembly comes later, with isolation, for Apps from people the
  Person does not trust.
- **Its screen is not code but data:** a Tree in JSON, drawn from the
  catalogue.

**Apps follow the Person.** By default an App installed once is there on
every one of the Person's machines; its data stays in each Project, on the
Project's machine. There may be exceptions. Which Apps live on which machines
is meant to be one declarative file, as with nix, that a Person and an Agent
can both read and that rebuilds any machine. Not decided yet.

## What Banda is not

- **Not an IDE.** Code is one kind of work. Many of the people who use
  Banda do not write code.
- **Not a Harness, not a model.** If one comes, it sits beside the others.
- **Not a dashboard builder.** The main interface is text; screens are
  optional.
- **Not a SaaS with a central server.** Banda Cloud is a convenience.
- **Not a replacement for the operating system or the browser.** It is a
  layer over them and uses them.

## What makes Banda different

Sessions that live in someone's cloud already exist: Claude Code on the
web, Codex cloud tasks, Cursor's background agents, T3 Connect. Banda
differs by four things together:

1. **The Person's machines.** The session lives on their own machines, or
   on an always-on machine of theirs in Banda Cloud, not in a vendor's
   throwaway container. Files, builds and running servers stay.
2. **Any Agent.** A vendor's cloud runs its own Agent. Banda runs any, in
   one place.
3. **The whole workspace, not only the chat.** What moves is everything:
   the terminal, the browser, files, Panes, Apps.
4. **Apps the Agent writes.** A cloud session has no workspace to build an
   App into.

## The stories the foundation must carry

1. **One Banda on every machine.** Roma has a Mac, arc (always on) and
   devbox. From the Mac, from a browser or from the phone he sees all three
   as one Banda: every machine's Projects, Threads, terminals, files, git,
   pages and settings. They look and act the same, on the device in front of
   him or on a server, as `ssh` lands you in the same terminal. Only the
   device's own things are local: its screen, clipboard, notifications and
   files. A machine that is away is said so, and the others work. He starts
   with an Agent on the Mac and moves the session to devbox, where the Agent
   keeps going. He closes the laptop, goes for a walk and works from the
   phone. Back home, he moves the session to arc. Moving is part of the
   story; its core is that where the work runs makes no difference.
2. **An Agent writes an App.** "Make me an App for tracking clients." In
   one Thread the App is ready, appears in Banda, and other Agents use it.
3. **A CRM as an App.** A company connects its CRM as an App, with a screen
   or without. People there mostly just talk to the Agent.
4. **An Agent asks an Agent.** A colleague gives access to their Project,
   and your Agent asks a question in their Thread.
5. **Your own Banda from a browser.** From someone else's computer or a
   phone you enter your Banda on arc, with nothing to install.
6. **No server of your own.** A Person takes a machine in Banda Cloud, or
   runs the same themselves.
7. **A document for two.** You and an Agent write one document. It is a
   file in the Project, and it reads without Banda.

## The order

We build all of it, in an order where each step stands on a finished base:

1. **Story 1, the foundation: one Banda on every machine.** Reach what
   cloud sessions give, on the Person's own machines and with any Agent,
   the same from the desktop, the web and the phone. This is principles 4
   and 9, and it is the weakest part today.
2. **Story 2, the difference.** An Agent writes an App: no cloud session
   does it. It runs beside story 1, on a second track (Roma, 2026-11-13).
3. **The other stories**, on the same base.

Every client reaches every machine by one road, at its door, by its own key
(ADR 0124); isolating Agents waits (ADR 0123). The slices are in
[the roadmap](research/2026-11-08-roadmap-in-slices.md).

## Decided

- **Where things are kept.** The Person's documents and notes are plain
  files. An App's own state may live in a database, and it exports as
  readable text (NDJSON).
- **The language between programs.** JSON with a description in words, as
  MCP tools are described.
- **Who it is for first.** People like Roma: one Person, several machines,
  many Agents. Companies come next, over the same network.
- **The business.** The code is open. Banda sells the cloud, integrations
  and inference; inference is one more provider beside the others.
- **The phone's first version** (Roma, 2026-11-13). The Threads list, a
  Thread, an Agent's questions, Stop, and any Pane opened from a Thread, full
  screen. The terminal comes when keys show before the machine answers, as
  in mosh. Through the catalogue, the phone grows with every App.
- **An App the Person's own Agent writes** installs and runs with no click
  and no sandbox, under the Person's user, as the Agent's shell does. Every
  install shows in the Thread and in the list of Apps. Apps from other
  people wait for isolation (Roma, 2026-11-12).
