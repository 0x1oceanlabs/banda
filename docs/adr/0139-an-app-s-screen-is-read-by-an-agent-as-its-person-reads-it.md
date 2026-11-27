---
status: proposed
date: 2026-11-27
---

# An App's screen is read by an Agent as its Person reads it

_It amends ADR 0126's decision 8 (a view "is no Agent's tool unless it
says so"). It serves [what we build](../what-we-build.md): what the
window does with a button, the CLI and an Agent do with the same call._

Roma, on 2026-11-27 (translated): "the idea is that the interface is for
the Person and for the Agent", and of a component that says what it is to
an Agent: "that is just what we need for the Banda App SDK". Of Banda's
own Panes: "it would be good to describe those to an Agent too, as they
are all Banda Apps as well. It does not burn now, but in the plan we do
all of it on the Banda App SDK."

## Where it stands

An App's commands are for both already. Each method is an Agent's tool,
and a control on the screen sends the same command on the Person's click
(ADR 0126, decisions 1 and 8). When an Agent's command writes, the Pane
reads the view again.

The screen is not. A view answers a Tree: what is shown, in what order,
under what words, and which command each control sends with which
fields. An Agent has the commands as a flat list of tools and none of
that. It cannot say what its Person sees, or act "on the third row", or
learn from the screen which command the App's author meant for what.

Others reach the same aim from the page: a component in the browser
registers itself, and an Agent asks the page for a snapshot and acts on
it (Vercel's UI SDK, in beta since 2026-11-12, read on 2026-11-27). That
needs a page that is open. Banda's Tree is data the engine reads before
any client draws it, so here the same is said by the engine, to the CLI
and to an Agent whose Person has no window open.

## Decisions

1. **The Tree is the one description of an App's screen, for the Person
   and for the Agent.** An App's author writes a view once. No second
   description for Agents is written beside it, and no node is for one
   reader only.

2. **An Agent reads a screen with one tool, `app_screen {app, view,
   args}`**, the method `apps.screen`. It is a read, and it answers what
   the Pane `apps.view` of the same three would show now.
   - It answers **text**, not the Tree: an outline in the Tree's order,
     with each node's words and values, a Table as its columns and its
     first rows with how many more there are.
   - **Each control is written with the tool it sends and the params it
     carries**: a Button, a Form with its fields, a row's actions. So the
     Agent acts by the App's own tool, as it does today. `app_screen`
     sends nothing and has no "press".
   - It is one tool for every App, not one for each view, so a machine
     with many Apps does not fill an Agent's list of tools.
   - `banda call apps.screen` gives a Person and a script the same text.
     The Tree itself stays what a view answers to `banda call`.

3. **A view by itself stays no Agent's tool** unless it says so, as
   ADR 0126 has it: `app_screen` is how an Agent reads one.

4. **What a Person looks at is not in this ADR's first step.** Which
   screen of an App is open, on which tab, with which row chosen, is the
   window's and the engine's places (ADR 0110), not the Tree's. It comes
   as its own step, when a try asks for it.

5. **Banda's own Panes follow as they become Apps on the SDK.** A Task,
   Files, Git and the terminal say nothing of their screens to an Agent
   by this ADR. Each gets `app_screen` with no work of its own on the day
   its screen is a view. Nothing is built for them before that.

## Not decided here

- **A word of the author's for an Agent on a control**, such as "ask
  your Person first". Banda holds no Agent back (Roma, 2026-11-11), so it
  could only be a word the Agent reads, the same the Person reads before
  they confirm. Roma's call, after the first step is tried.
- A value kept from an Agent. An App's worker and an Agent's shell both
  run as the Person's user, so a mark on the screen would hide nothing.

## Plan

1. `apps.screen` in `platform/apps`, with its tool and the topic `apps`
   of the Banda skill; the deals App of the tests read as text.
2. The try: a real Agent, asked "what is on the deals screen, and close
   the oldest deal", with no other hint.
3. What the Person looks at (decision 4), if the try asks for it.

## Consequences

- An App's author gets an Agent that understands the screen for nothing.
- A screen that reads badly as text reads badly to an Agent: a control
  with no words on it says nothing to either reader.
- **How it is checked.** A test in `platform/apps` holds the text of the
  deals App's home: every control there names a tool that the App's
  `methods.json` has. Then step 2's try.
