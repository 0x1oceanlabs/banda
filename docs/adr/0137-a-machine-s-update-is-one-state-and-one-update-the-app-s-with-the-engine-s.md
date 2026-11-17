---
status: accepted
date: 2026-11-17
---

# A machine's update is one state and one Update, the app's with the engine's

_It amends ADR 0119 (decisions 2, 3 and 4) and ADR 0131 (decisions 1 and
3, and plan step 4). It serves [what we build](../what-we-build.md)'s
story 1, one Banda on every machine, and the rule that text is the
interface: what the window does with a button, `banda update` does with
the same call._

_Accepted by the agent that wrote it, on Roma's word of 2026-11-17 that
the steps of this work are its to take. The calls it made for him are
listed below._

Roma, on 2026-11-17 (translated): "I press Update and nothing happens,
then the program restarts. Bring it all into one deep module, and bring
the update system to a finished state." Then, of mock v3
(`~/Banda/artifacts/updates/updates-v3.html`): one flow and the same words
on Linux, macOS and Windows; and, of the steps after the first: "go on
yourself, step by step".

## Where it stands

After #1891 and #1893 the row says each step, and one machine in main
updates the app on every system. What is left in three places:

- **Two states of one machine's update.** The engine says its own on
  `updates.state`. Main says the app's to the page over a bridge of its
  own (`update.*`, core's `Update`). The page joins them
  (`machines.ts`'s `withApp`), and decides there what the row shows.
- **Two calls for one Update.** The button asks the engine to restart
  (`updates.restart`), then main (`update.restart`). `banda update --now`
  knows only the first, so it updates half a machine.
- **The page decides.** "Update when they finish", where the app's
  restart stops the Agents, is kept by the page: a reload drops it.

## Decision

1. **`updates.state` says the machine's whole update.** It gains `app`:
   what the app on that machine does, in the words the row uses. A
   version it takes (with how far), one ready, what it does since Update
   (installing, restarting), one out with its command, that it updated
   and from what, or why it could not. None where no app said anything.
2. **The app tells the engine, and the engine says it.** Main's machine
   (ADR 0131; `platform/updates/desktop`) says each change of its app's
   update with `updates.app`, and the module keeps it in its state, as it
   keeps what `banda-update` says of its looks (ADR 0131, decision 2).
   The state has one writer, the module, and each part of it one source.
   What the app last said stays until it says again: a Banda that starts
   says its own, and one that restarted says it updated.
3. **One Update, one call.** `updates.restart` means "update this machine
   now": the engine moves onto its copy where one is ready and it moves
   by itself, and the app is asked to restart into its version
   (`app.wanted`). Main follows the state and restarts when it is asked.
   The page calls nothing of main's to update, and `banda update --now`
   updates the app too.
4. **The engine keeps a wait.** While Agents work on a machine whose
   Update would stop them, `updates.restart` refuses as now, restarts
   with `force`, or with `wait` holds the Update until no Turn runs and
   then does it. `updates.state` says it is held, and `updates.later`
   drops it. It is the engine's, so a window that reloads, or another
   machine's, shows it.
5. **The page only draws.** It reads `updates.state` of each machine and
   draws one row. `withApp`, core's `Update`, and the bridge's
   `update.*` go. That Banda updated is in the state until the app says
   more; a window shows its check for its first seconds in front, and
   keeps for itself that it did.
6. **A version apart, the app's part waits.** A window on an engine
   older than this ADR is refused `updates.app`: its app still takes its
   version and installs it at the quit, and its row has no Update for the
   app until that engine moved, which it does once nothing runs (ADR
   0119, decision 6: it does without what it lacks).

## Calls made for Roma

Roma left the steps to the agent. These are the ones he may want
otherwise:

1. **An Update of another machine restarts its app at once,** as it
   restarts its engine: the window there closes and opens. It is the
   same Person's machine and their own click.
2. **No Cancel on a held row;** `banda update --later` drops it. A
   machine that updates by itself once idle has no Cancel either.
3. **No release notes kept** for the restart: the popover shows none
   since ADR 0131.

## Plan

| Step | What |
|---|---|
| 1 | The row says each step; Windows' installer shows; Update asks before it stops Agents (#1891): done |
| 2 | One machine for the app on every system, over an installer (#1893): done |
| 3a | This ADR |
| 3b | The engine: `app` in `updates.state`, `updates.app`, `wanted`, `wait` and `updates.later`; `banda update --follow` says the app's part |
| 3c | Main tells the engine and restarts when asked; the page reads one stream; the bridge's `update.*` and core's `Update` go |
| 4 | Linux: the new AppImage is put beside the old one by a rename, the old one is kept until the new Banda opened its window, and starts again if it does not |

ADR 0131's plan step 4, the app's download moved into `banda-update`, is
not taken up: it adds no answer the Person sees, and waits for a signed
app.

## Consequences

- One stream and one call hold a machine's update: the window, the CLI
  and an Agent see and do the same.
- The contract gains two methods and a part of a state; none changes
  shape for a window of the last Dev.
- For the time an engine is older than its window, the app's row is
  quieter than now.
