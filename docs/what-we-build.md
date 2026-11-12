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
  ordinary Apps with no special rights.
- **The check:** an App with no screen is fully useful through an Agent. An
  Agent writes a working App in one Thread.

### 4. The engine is the operating system, the client is the browser

- **The code:** all work and all state live in the engine. A client shows
  and asks; it decides nothing by itself, not which machine, not queues,
  not notifications.
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

1. **The session follows you.** Roma starts working with an Agent on the
   Mac. He moves the session to devbox, where the Agent keeps doing its
   tasks. He closes the laptop, goes for a walk and keeps working with the
   Agent from the phone. Back home, from the Mac or the phone, he moves the
   session to arc.
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

1. **Story 1, the foundation.** Reach what cloud sessions give, on the
   Person's own machines and with any Agent. This is "the engine is the
   operating system, the client is the browser", and it is the weakest part
   today.
2. **Story 2, the difference.** An Agent writes an App: no cloud session
   does it.
3. **The other stories**, on the same base.

The door for the phone and the web (device keys, pairing, one access rule)
comes with story 1; isolating Agents waits (ADR 0123). The slices are in
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
