---
status: accepted
date: 2026-11-17
---

# The App stays `agents`, and what a Person gives an Agent is a Task

_It replaces ADR 0085's decision 12 (`agents` becomes `threads`) and
amends its decision 2 (`task@1`). It serves
[what we build](../what-we-build.md): one system for those who code and
those who do not, where a Person hands work to Agents and is called back._

Roma, on 2026-11-17 (translated): "I wanted the Agents' part to be called
agents, and the Thread renamed to Task. That seems more logical to me",
and, after the words of other apps were set side by side: "agents / task".
The idea was issue #1502, of 2026-11-11.

## Where it stands

ADR 0085 (decision 12, 2026-11-06) renamed the App `agents` to `threads`,
after the thing it keeps. The move was begun on 2026-11-17 and stopped
the same day, nothing of it merged. What is in `main` is the kernel's
part alone (#1892): a module says the ids it had (`was`), and nothing
written under one is lost. It renames nothing by itself.

The word **Thread** says the shape of the thing, a chain of messages. It
says little to a Person who does not code, and it is not what Banda does
with it: the sidebar shows work that runs, waits, is put off and is done;
the Agent calls its Person when it ends or asks; the thing is put off,
archived and moved to another machine. Those are what one does with
work handed over, not with a conversation.

How others name it, as far as we know: apps where one talks with a model
say Chat; apps where one hands work over and comes back say Task; Thread
stays with tools for developers; Session names the process, not the aim.

## Decisions

1. **The App keeps the id `agents`.** Its folder, crate, packages,
   methods' prefix, events' module and Panes' prefix stay as they are.
   ADR 0085's decision 12 is replaced in this: there is no `threads` App.
   Its rule for any App stands, and the kernel holds it (`Module::was`):
   one that changes its id declares the old one, keeps its tables'
   prefix, and loses no data.

2. **What a Person gives an Agent is a Task.** It is what the glossary
   called a Thread: one session with a Harness in a Project, with its
   entries, its turns, its Questions and its place in the sidebar.
   Nothing of what it is or does changes, only its name.
   - A Person sees Task everywhere: New Task, the Task menu, a Task's
     Group, "Move this Task".
   - **Thread** and **chat** are avoided for it. Earlier ADRs and
     research keep the word they were written with: they are history.
   - **Turn** stays: a Task has turns. **Agent** stays: each Task has
     its own. The sidebar's Working, Later and Done stay.

3. **The reserved `task@1` is this Task.** ADR 0085 (decision 2) kept the
   name for a generic unit of work that any App might have, to come
   later. It comes as the Agents' Task: when the App publishes facts,
   they are `agents.task.<past-verb>@1`. If a second App one day has
   work a Person must see in the same list, that is decided then, with
   its own word or a shared kind, and not reserved now.

4. **Names at rest are not renamed.** Tables (`agents_threads`), their
   columns, and events a log already holds (`thread.started`) stay as
   they are and are read for good, as ADR 0085 says of data.

5. **Old names answer for one stable release** where a Person or an
   Agent typed them: a method (`agents.threads`), a tool, an action's id
   in `keys.toml`, a Pane kind kept in an arrangement (`agents.thread`).
   Each step below brings what it needs for that, with its check.

## Plan

Each step its own PR, from what costs least to undo to what costs most.
The names that cost are the published ones, so step 3 lands before any
App publishes a fact (the vision's B7).

1. **The words a Person sees**, and the glossary. The window's labels,
   menus, settings, notices and the refusals a Person reads say Task. No
   method, tool, kind or type changes. Roma lives with the word before
   the next steps.
2. **The words an Agent reads.** The tools' names and descriptions, and
   the Banda skill. A tool named for a Thread keeps answering by its old
   name for one stable release.
3. **The names in code and the contract.** Methods (`agents.threads` →
   `agents.tasks`), Pane kinds (`agents.thread` → `agents.task`), new
   events (`task.started`), action ids, and the types the contract
   carries. Old names answer and are read as decision 5 says.

## Consequences

- The move of `apps/agents` to `apps/threads` is not made, and no
  session waits for it. Its branch is dropped.
- The glossary's entry for Thread becomes Task's, and Task is reserved
  no more.
- Until step 3, a Person reads Task where the code and an Agent's tools
  still say thread. That is the price of trying the word first.
- Step 3 is larger than the App's rename was: it touches every method
  and type that names a Thread. It is not started without Roma's word
  after step 1.
