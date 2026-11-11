/**
 * What the Person does to a Thread as one of the Items Threads lists (ADR
 * 0087, decision 12): rename it, have its Harness's small model suggest a
 * title, give back the title it had before, mark it unread or read (ADR
 * 0077), go to where its unseen begins (ADR 0094), make a Project of the
 * No Project it is in (ADR 0046), put it off and wake it (ADR 0074),
 * archive it as the sidebar list asks (ADR 0096), delete it for good, move
 * it to another Project, stop it, fork it and copy it as Markdown (ADR
 * 0098, decision 14). The Window draws their rows in the Thread menu, the
 * card's menu, the Pane menu and the Banda menu, and runs them by id, as
 * any action; Threads does them, on the engine of the host that lists the
 * Thread (ADR 0081).
 */
import { type Engine, newId, type ProjectId } from "@banda/contract"
import type { ThreadId, ThreadView } from "@banda/contract/agents"
import { toast } from "@banda/ui/components/sonner"
import { copyText } from "@banda/ui/lib/clipboard"
import {
  asking,
  cleanTitle,
  namingNow,
  offer,
  startNaming,
  think,
  thinkingNow,
} from "@banda/ui/lib/naming"
import { problem } from "@banda/ui/lib/words"
import { clock } from "@banda/core/react"
import { actOnTile } from "@banda/ui/hooks/use-scope"
import {
  type Args,
  type ItemAction,
  itemArgs,
  itemOf,
  takes,
  type WindowApi,
} from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
import { asleep } from "@banda/ui/status"
import {
  AlarmClockIcon,
  CircleDotIcon,
  CircleIcon,
  FolderPlusIcon,
  PencilIcon,
  SparklesIcon,
  Undo2Icon,
} from "lucide-react"
import { THREAD } from "../scopes"
import { markdownOf } from "./copy"
import { SHOW } from "./rows"
import { actOf, mark } from "./sent"

/** A Thread as an item action finds it: its Project, and how the lists
 * hold it. */
type At = { project: ProjectId; listed: Listed }

/** The Thread `args` name, else the one the Pane in focus shows; none
 * when it is not a Thread, as Threads acts only on its own Items. */
function threadAt(window: WindowApi, args?: Args): At | undefined {
  const at = itemOf(window, args)
  return at?.listed.pane.kind.startsWith("agents.") ? at : undefined
}

/** Whether the Pane in focus shows a Thread: F2 and Shift+F2 are not the
 * mod's (ADR 0077), and a Thread takes them only while one has the
 * focus, as a terminal's program has them else. */
const inSight = (window: WindowApi) => threadAt(window) !== undefined

/** The engine of the host that lists the Thread: this machine's, or
 * another host's (ADR 0081). One the Window does not reach now refuses
 * at once (`WindowApi.sessionOf`), and nothing is sent there. */
const engineOf = (window: WindowApi, { project, listed }: At) =>
  window.sessionOf(project, listed.pane)

/** `engineOf`, for an act named `what` that says itself what went
 * wrong: none when that host refuses, and a toast says why. */
function reached(window: WindowApi, at: At, what: string): Engine | undefined {
  try {
    return engineOf(window, at)
  } catch (error) {
    toast.error(problem(error, what))
    return undefined
  }
}

/** Names the Thread `title`; with none, gives back the title it had by
 * itself, as its first message's. */
async function renaming(window: WindowApi, at: At, title: string | null) {
  const thread = at.listed.id as ThreadId
  return engineOf(window, at).command(
    "agents.rename",
    title === null ? { thread } : { thread, title },
    at.project
  )
}

/** A title for the Thread, from what it says lately; renames nothing. */
async function suggesting(window: WindowApi, at: At): Promise<string> {
  return engineOf(window, at).command(
    "agents.suggest_title",
    { thread: at.listed.id as ThreadId },
    at.project
  )
}

/**
 * Names the Thread with `text`, as its field gives it; an empty one gives
 * back the title it had by itself. What the engine refuses, a toast says.
 */
function renamed(window: WindowApi, at: At, text: string) {
  const title = cleanTitle(text)
  if (title === at.listed.title) return
  renaming(window, at, title || null).catch((error: unknown) =>
    toast.error(problem(error, "Rename"))
  )
}

/**
 * Suggest a title, in one press (ADR 0077, decision 3): the model writes
 * one while the title shimmers, and the Thread is renamed with it. A toast
 * says so, with Undo, which gives back the title before: the one it had
 * by itself, where the Person had not named it. A suggestion the title
 * already says renames nothing.
 */
export async function suggestTitle(window: WindowApi, at: At): Promise<void> {
  const { project, listed } = at
  if (thinkingNow(project, listed.id)) return
  think(project, listed.id, true)
  try {
    const title = await suggesting(window, at)
    if (cleanTitle(title) === listed.title) {
      toast("The title already says it")
      return
    }
    await renaming(window, at, title)
    // Never renamed, its title was its own: none brings that back.
    const back = listed.was === undefined ? null : listed.title
    toast(`Renamed to ${title}`, {
      action: {
        label: "Undo",
        onClick: () =>
          void renaming(window, at, back).catch((error: unknown) =>
            toast.error(problem(error, "Undo"))
          ),
      },
    })
  } catch (error) {
    toast.error(problem(error, "Suggest a title"))
  } finally {
    think(project, listed.id, false)
  }
}

/** Puts the model's title in the Thread's open field, selected, as its ✨
 * does; once at a time. */
async function suggestIntoField(window: WindowApi, at: At): Promise<void> {
  const { project, listed } = at
  if (namingNow(project, listed.id)?.asking !== false) return
  asking(project, listed.id, true)
  try {
    offer(project, listed.id, await suggesting(window, at))
  } catch (error) {
    toast.error(problem(error, "Suggest a title"))
  } finally {
    asking(project, listed.id, false)
  }
}

/** The Thread's own title, renamed: its field, or a title given. */
const rename: ItemAction = {
  id: "thread.rename",
  section: "Threads",
  title: "Rename the Thread you look at",
  keys: [{ code: "F2" }],
  args: itemArgs({
    title: "its new title; an empty one gives back the title it had by itself",
    from: "where its field opens, without a title: head or row",
  }),
  group: "name",
  does: "rename",
  // Its field takes the focus.
  later: true,
  when: inSight,
  row: () => ({ title: "Rename…", icon: PencilIcon }),
  run: (window, args) => {
    const at = threadAt(window, args)
    if (!at) return
    if (typeof args?.title === "string") renamed(window, at, args.title)
    else
      startNaming(
        at.project,
        at.listed.id,
        args?.from === "row" ? "row" : "head"
      )
  },
}

/** A title from the Thread's Harness's small model: in its field while it
 * is open, else at once, with Undo. */
const suggest: ItemAction = {
  id: "thread.suggest-title",
  section: "Threads",
  title: "Suggest a title for the Thread you look at, and rename it",
  keys: [{ code: "F2", shift: true }],
  args: itemArgs(),
  group: "name",
  does: "suggest",
  when: inSight,
  row: () => ({ title: "Suggest a title", icon: SparklesIcon }),
  run: (window, args) => {
    const at = threadAt(window, args)
    if (!at) return
    if (namingNow(at.project, at.listed.id)) void suggestIntoField(window, at)
    else void suggestTitle(window, at)
  },
}

/** The title the Thread had before its last rename. */
const previous: ItemAction = {
  id: "agents.previous-title",
  section: "Threads",
  title: "Give the Thread you look at the title it had before",
  unlisted: true,
  args: itemArgs(),
  group: "name",
  row: (item) =>
    item.was === undefined
      ? null
      : { title: "Previous title", icon: Undo2Icon },
  run: (window, args) => {
    const at = threadAt(window, args)
    if (at?.listed.was !== undefined) renamed(window, at, at.listed.was)
  },
}

/** Takes back the Person's "seen" of what the Thread last finished, which
 * then calls them again, or gives it (ADR 0077, decision 6); nothing for a
 * Thread with nothing finished to see. The Thread's host keeps the mark,
 * so it goes there (ADR 0096); a Pane that shows the Thread leaves it as
 * it is until the Person leaves the Thread and comes back. */
const unread: ItemAction = {
  id: "thread.unread",
  section: "Threads",
  title: "Mark the Thread you look at as unread, or as read",
  keys: [{ code: "KeyU", mod: true, shift: true }],
  args: itemArgs(),
  group: "name",
  does: "unread",
  row: (item) =>
    item.seen === undefined
      ? null
      : item.seen
        ? { title: "Mark as unread", icon: CircleDotIcon }
        : { title: "Mark as read", icon: CircleIcon },
  run: (window, args) => {
    const at = threadAt(window, args)
    if (at?.listed.seen === undefined) return
    const thread = at.listed.id as ThreadId
    // Read: the latest turn that ended, as its host knows it.
    const seen = at.listed.seen ? null : "latest"
    const engine = reached(window, at, actOf({ seen }))
    if (engine) void mark(engine, at.project, thread, { seen })
  },
}

/** Takes the Person to where what they have not seen begins in the Thread
 * in focus (ADR 0094, rule 3), as the sidebar's Enter does on the card
 * already open: the Thread's Pane does it, by its scope. It has no row. */
const unseen: ItemAction = {
  id: "agents.thread.unseen",
  section: "Threads",
  title: "Go to where the unseen begins in the Thread you look at",
  unlisted: true,
  args: itemArgs(),
  group: "other",
  does: "unseen",
  row: () => null,
  run: (_, args) => void actOnTile(THREAD, "agents.thread.unseen", args),
}

/** "Make a Project from it…" for a Thread in No Project (ADR 0046): the
 * Window's dialog, which keeps the Thread and its history. */
const makeProject: ItemAction = {
  id: "agents.make-project",
  section: "Threads",
  title: "Make a Project from the Thread you look at, in No Project",
  unlisted: true,
  args: itemArgs(),
  group: "other",
  does: "make-project",
  // The dialog takes the focus.
  later: true,
  row: (_, at) =>
    at.project?.scratch
      ? { title: "Make a Project from it…", icon: FolderPlusIcon }
      : null,
  run: (window, args) => {
    const at = threadAt(window, args)
    if (at) window.run("project.make", { project: at.project })
  },
}

/** Wakes the Thread now; what the engine refuses, a toast says. */
function waking(window: WindowApi, at: At) {
  reached(window, at, "Wake now")
    ?.command("agents.wake", { thread: at.listed.id as ThreadId }, at.project)
    .catch((error: unknown) => toast.error(problem(error, "Wake now")))
}

/** Until when a Thread is put off: a time, its turn's end, or Someday,
 * with no time, till something wakes it (ADR 0098, decision 12). */
type Until = number | "done" | "someday"

/**
 * Puts the Thread off till `until` (ADR 0074). One that asks may be put
 * off too, by its Person: it waits with its question (ADR 0098, decision
 * 11). Put off, it is put away as an archived one is, its Panes closed; a
 * toast says till when, with Undo, which wakes it.
 */
function putOff(window: WindowApi, at: At, until: Until, resume = false) {
  const thread = at.listed.id as ThreadId
  const asked =
    until === "done"
      ? { thread }
      : until === "someday"
        ? { thread, someday: true }
        : { thread, until, resume }
  reached(window, at, "Later")
    ?.command("agents.later", asked, at.project)
    .then(
      () => {
        window.run("pane.put-away", { project: at.project, item: thread })
        toast(
          until === "done"
            ? "Later, until it's done"
            : until === "someday"
              ? "Later, someday"
              : `Later, until ${clock(until)}`,
          { action: { label: "Undo", onClick: () => waking(window, at) } }
        )
      },
      (error: unknown) => toast.error(problem(error, "Later"))
    )
}

/** Until when `args` put a Thread off; none when they say no time. */
function untilOf(args?: Args): Until | undefined {
  if (typeof args?.until === "number") return args.until
  if (args?.someday === true) return "someday"
  return args?.done === true ? "done" : undefined
}

/** Later…: till a time, till its turn ends, or Someday; asked for none,
 * the Window's picker asks when, and wakes one that sleeps. */
const later: ItemAction = {
  id: "thread.later",
  section: "Threads",
  title: "Move the Thread you look at to Later, or wake it",
  keys: [{ code: "KeyZ", mod: true }],
  args: itemArgs({
    until: { number: "when it wakes, in milliseconds since 1970" },
    resume: { flag: "with until, its failed turn goes again then" },
    done: { flag: "it sleeps until its turn ends" },
    someday: { flag: "it sleeps with no time, until something wakes it" },
  }),
  group: "other",
  does: "later",
  offered: ["pane", "menu"],
  // The picker takes the focus.
  later: true,
  row: (item, at) =>
    asleep(item, at.now) ? null : { title: "Later…", icon: AlarmClockIcon },
  run: (window, args) => {
    const at = threadAt(window, args)
    if (!at) return
    const until = untilOf(args)
    if (until !== undefined) putOff(window, at, until, args?.resume === true)
    else
      window.run("sidebar.later-picker", {
        project: at.project,
        item: at.listed.id,
      })
  },
}

/** Wake now, for a Thread that sleeps. */
const wake: ItemAction = {
  id: "thread.wake",
  section: "Threads",
  title: "Wake the Thread you look at from Later",
  args: itemArgs(),
  group: "other",
  does: "wake",
  offered: ["pane", "menu"],
  row: (item, at) =>
    asleep(item, at.now) ? { title: "Wake now", icon: AlarmClockIcon } : null,
  run: (window, args) => {
    const at = threadAt(window, args)
    if (at) waking(window, at)
  },
}

/**
 * Archives the Thread, or brings it back, on its host, which keeps the
 * mark (ADR 0096): the sidebar list's Archive asks it so, with
 * `archived`, as only Threads knows the Thread's commands, and draws its
 * row. Archived, the Thread is put away at once, as its mark goes, and
 * nothing waits for the host's answer: an answer that came late would
 * close a Pane opened since, or one of a Thread brought back meanwhile
 * (Roma, 2026-11-09, #974). One the host refuses, as a Thread that began
 * a turn there, or whose host goes before it answers, comes back in the
 * list and a toast says why; its Panes stay closed. One whose host is
 * away is not sent, and keeps its Panes. Without `archived`, nothing.
 */
const archive: ItemAction = {
  id: "agents.archive-thread",
  section: "Threads",
  title: "Archive a Thread on its host, or bring it back",
  unlisted: true,
  args: {
    ...itemArgs({
      archived: { flag: "true archives it, false brings it back" },
    }),
    required: ["archived"],
  },
  group: "other",
  does: "archive",
  row: () => null,
  run: (window, args) => {
    const at = threadAt(window, args)
    const archived = args?.archived
    if (!at || typeof archived !== "boolean") return
    const thread = at.listed.id as ThreadId
    // A host away is sent no mark (decision 8): its Thread stays as it
    // was, Panes and all, and a toast says why.
    const engine = reached(window, at, actOf({ archived }))
    if (!engine) return
    const goes = engine.status.state === "open"
    void mark(engine, at.project, thread, { archived })
    if (archived && goes)
      window.run("pane.put-away", { project: at.project, item: thread })
  },
}

/**
 * Deletes the Thread for good, on its host (ADR 0098, decision 14): the
 * Window's Delete… in Archive asks it so once its Person confirmed, and
 * draws that row and that dialog, as only Threads knows the Thread's
 * commands. It names its Thread, never the one in focus, as a delete is
 * never a guess. It goes `once`, as a mark does: a host away is sent
 * nothing, and a delete whose host goes on its way is not sent again once
 * that host is back, so one said to have failed never lands later (ADR
 * 0096, decision 8). Once the host took it, every Pane that shows the
 * Thread closes, as nothing is left there to show; one the host refuses,
 * as a Thread at work, keeps its Panes, and a toast says why.
 */
const remove: ItemAction = {
  id: "agents.delete-thread",
  section: "Threads",
  title: "Delete a Thread on its host, for good",
  unlisted: true,
  args: takes(
    {
      project: "the Project of the Thread it deletes",
      item: "the Thread's id in its Project",
    },
    ["project", "item"]
  ),
  group: "other",
  does: "delete",
  row: () => null,
  run: (window, args) => {
    const at = typeof args?.item === "string" && threadAt(window, args)
    if (!at) return
    const { project } = at
    const thread = at.listed.id as ThreadId
    reached(window, at, "Delete")
      ?.commandAt("agents.delete", { thread }, project, newId(), { once: true })
      .then(
        () => window.run("pane.put-away", { project, item: thread }),
        (error: unknown) => toast.error(problem(error, "Delete"))
      )
  },
}

/**
 * Moves the Thread to another Project of its host, `to`, whole (ADR 0098,
 * decision 14): what picks the Project asks it so, as the card's "Move to
 * Project…" will. It has no row of its own. Once the host moved it, its
 * Panes here are put away, as they show a Thread this Project no longer
 * has; the other Project's list has it now. One the host refuses, as a
 * Thread at work, stays as it was, Panes and all, and a toast says why.
 * Without `to`, or with the Project it is in, nothing. It goes `once`, as
 * a delete does, so a move said to have failed never lands later (ADR
 * 0096, decision 8). Only the Person binds a key to it (ADR 0083,
 * decision 3): it takes a Thread across the wall between Projects, where
 * the other Project's Agents read it.
 */
const move: ItemAction = {
  id: "agents.move-thread",
  section: "Threads",
  title: "Move a Thread to another Project on its host",
  unlisted: true,
  args: {
    ...itemArgs({ to: "the Project it moves to, on the same host" }),
    required: ["to"],
  },
  runsAsPerson: true,
  group: "other",
  does: "move",
  row: () => null,
  run: (window, args) => {
    const at = threadAt(window, args)
    const to = args?.to
    if (!at || typeof to !== "string" || to === at.project) return
    const thread = at.listed.id as ThreadId
    const asked = { thread, project: to as ProjectId }
    reached(window, at, "Move to Project")
      ?.commandAt("agents.move_thread", asked, at.project, newId(), {
        once: true,
      })
      .then(
        () =>
          window.run("pane.put-away", { project: at.project, item: thread }),
        (error: unknown) => toast.error(problem(error, "Move to Project"))
      )
  },
}

/** Reads the Thread whole on its host, for an act named `what` on its
 * turns or its items, and does `then` with it; what goes wrong, a toast
 * says. */
function withView(
  window: WindowApi,
  at: At,
  what: string,
  then: (engine: Engine, view: ThreadView) => unknown
) {
  const engine = reached(window, at, what)
  const thread = at.listed.id as ThreadId
  engine
    ?.call("agents.thread", { thread }, { project: at.project })
    .then((view) => then(engine, view))
    .catch((error: unknown) => toast.error(problem(error, what)))
}

/** Stops the turn the Thread works on, as its Pane's Stop does: the
 * card's Stop (ADR 0098, decision 14), whose row the Window draws. One
 * that ended meanwhile has nothing to stop. */
const stop: ItemAction = {
  id: "agents.stop-thread",
  section: "Threads",
  title: "Stop the turn a Thread works on",
  unlisted: true,
  args: itemArgs(),
  group: "other",
  does: "stop",
  row: () => null,
  run: (window, args) => {
    const at = threadAt(window, args)
    if (!at) return
    withView(window, at, "Stop", (engine, { turns }) => {
      const turn =
        turns.findLast((one) => one.can.stop && one.state === "running") ??
        turns.findLast((one) => one.can.stop)
      return (
        turn && engine.command("agents.stop", { turn: turn.id }, at.project)
      )
    })
  },
}

/** Forks the Thread at the end of its last turn that may fork (ADR 0027),
 * and opens the fork: the card's Fork (ADR 0098, decision 14), whose row
 * the Window draws. One with no such turn yet says so. */
const fork: ItemAction = {
  id: "agents.fork-thread",
  section: "Threads",
  title: "Fork a Thread at its last reply, and open the fork",
  unlisted: true,
  args: itemArgs(),
  group: "other",
  does: "fork",
  row: () => null,
  run: (window, args) => {
    const at = threadAt(window, args)
    if (!at) return
    withView(window, at, "Fork", async (engine, { turns }) => {
      const turn = turns.findLast((one) => one.can.fork)
      if (!turn) {
        toast("Nothing to fork yet", {
          description: "A fork starts at a reply of its Agent.",
        })
        return
      }
      const forked = await engine.command(
        "agents.fork",
        { turn: turn.id },
        at.project
      )
      window.run(SHOW, {
        project: at.project,
        thread: forked.thread,
        harness: at.listed.harness ?? "",
      })
    })
  },
}

/** Copies the Thread as Markdown, what was said in it (`markdownOf`): the
 * card's Copy as Markdown (ADR 0098, decision 14), whose row the Window
 * draws. */
const copy: ItemAction = {
  id: "agents.copy-thread",
  section: "Threads",
  title: "Copy a Thread as Markdown",
  unlisted: true,
  args: itemArgs(),
  group: "other",
  does: "copy",
  row: () => null,
  run: (window, args) => {
    const at = threadAt(window, args)
    if (!at) return
    const { listed } = at
    withView(window, at, "Copy as Markdown", (_, view) =>
      copyText(markdownOf(view, listed.title, listed))
    )
  },
}

/** Threads' item actions, in the order the Thread menu lists their rows. */
export const threadItems: readonly ItemAction[] = [
  rename,
  suggest,
  previous,
  unread,
  unseen,
  makeProject,
  later,
  wake,
  archive,
  remove,
  move,
  stop,
  fork,
  copy,
]
