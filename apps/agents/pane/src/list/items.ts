/**
 * What the Person does to a Thread as one of the Items Threads lists (ADR
 * 0087, decision 12): rename it, have its Harness's small model suggest a
 * title, give back the title it had before, mark it unread or read (ADR
 * 0077), make a Project of the No Project it is in (ADR 0046), snooze it
 * and wake it (ADR 0074). The Window draws their rows in the Thread menu,
 * the Pane menu and the Banda menu, and runs them by id, as any action;
 * Threads does them, on the engine of the host that lists the Thread (ADR
 * 0081).
 */
import type { ProjectId } from "@banda/contract"
import type { ThreadId } from "@banda/contract/agents"
import { toast } from "@banda/ui/components/sonner"
import {
  asking,
  cleanTitle,
  namingNow,
  offer,
  startNaming,
  think,
  thinkingNow,
} from "@banda/ui/lib/naming"
import { clock, problem } from "@banda/ui/lib/words"
import {
  type Args,
  type ItemAction,
  itemArgs,
  itemOf,
  type WindowApi,
} from "@banda/ui/module"
import { asleep, type Listed, snoozable } from "@banda/ui/pane"
import {
  AlarmClockIcon,
  CircleDotIcon,
  CircleIcon,
  FolderPlusIcon,
  PencilIcon,
  SparklesIcon,
  Undo2Icon,
} from "lucide-react"
import { markUnread } from "./seen"

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
 * another host's (ADR 0081). */
const engineOf = (window: WindowApi, { project, listed }: At) =>
  window.sessionOf(project, listed.pane)

/** Names the Thread `title`; with none, gives back the title it had by
 * itself, as its first message's. */
function renaming(window: WindowApi, at: At, title: string | null) {
  const thread = at.listed.id as ThreadId
  return engineOf(window, at).command(
    "agents.rename",
    title === null ? { thread } : { thread, title },
    at.project
  )
}

/** A title for the Thread, from what it says lately; renames nothing. */
function suggesting(window: WindowApi, at: At): Promise<string> {
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
    toast.error(problem(error))
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
            toast.error(problem(error))
          ),
      },
    })
  } catch (error) {
    toast.error(problem(error))
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
    toast.error(problem(error))
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
    // By its key, another host's Thread asks nothing, as before item
    // actions: its header's menu and its field ask. `sessionOf` reaches
    // its engine now, so the guard can go, as a change of its own.
    if (!at || (args?.item === undefined && window.here.get().pane?.host))
      return
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
 * Thread with nothing finished to see. The seen mark stays Threads' until
 * the platform keeps it by what is new (E8a). */
const unread: ItemAction = {
  id: "thread.unread",
  section: "Threads",
  title: "Mark the Thread you look at as unread, or as read",
  keys: [{ code: "KeyU", mod: true, shift: true }],
  args: itemArgs(),
  group: "name",
  row: (item) =>
    item.seen === undefined
      ? null
      : item.seen
        ? { title: "Mark as unread", icon: CircleDotIcon }
        : { title: "Mark as read", icon: CircleIcon },
  run: (window, args) => {
    const at = threadAt(window, args)
    if (at?.listed.seen !== undefined) markUnread(at.listed.id, at.listed.seen)
  },
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
  engineOf(window, at)
    .command("agents.wake", { thread: at.listed.id as ThreadId }, at.project)
    .catch((error: unknown) => toast.error(problem(error)))
}

/**
 * Snoozes the Thread till `until`, or till its turn ends with none (ADR
 * 0074). Snoozed, it is put away as an archived one is, its Panes closed;
 * a toast says till when, with Undo, which wakes it.
 */
function snoozing(window: WindowApi, at: At, until?: number, resume = false) {
  const thread = at.listed.id as ThreadId
  const asked = until === undefined ? { thread } : { thread, until, resume }
  engineOf(window, at)
    .command("agents.snooze", asked, at.project)
    .then(
      () => {
        window.run("pane.put-away", { project: at.project, item: thread })
        toast(
          until === undefined
            ? "Snoozed until it's done"
            : `Snoozed until ${clock(until)}`,
          { action: { label: "Undo", onClick: () => waking(window, at) } }
        )
      },
      (error: unknown) => toast.error(problem(error))
    )
}

/** Snooze…: till a time, or till its turn ends; asked for neither, the
 * Window's picker asks when, and wakes one that sleeps. */
const snooze: ItemAction = {
  id: "thread.snooze",
  section: "Threads",
  title: "Snooze the Thread you look at, or wake it",
  keys: [{ code: "KeyZ", mod: true }],
  args: itemArgs({
    until: { number: "when it wakes, in milliseconds since 1970" },
    resume: { flag: "with until, its failed turn goes again then" },
    done: { flag: "it sleeps until its turn ends" },
  }),
  group: "other",
  does: "snooze",
  offered: ["pane", "menu"],
  // The picker takes the focus.
  later: true,
  elsewhere: true,
  row: (item, at) =>
    asleep(item, at.now)
      ? null
      : {
          title: "Snooze…",
          icon: AlarmClockIcon,
          // One that asks is answered first.
          ...(snoozable(item) ? {} : { off: true }),
        },
  run: (window, args) => {
    const at = threadAt(window, args)
    if (!at) return
    const until = typeof args?.until === "number" ? args.until : undefined
    if (until !== undefined || args?.done === true)
      snoozing(window, at, until, args?.resume === true)
    else
      window.run("sidebar.snooze-picker", {
        project: at.project,
        item: at.listed.id,
      })
  },
}

/** Wake now, for a Thread that sleeps. */
const wake: ItemAction = {
  id: "thread.wake",
  section: "Threads",
  title: "Wake the snoozed Thread you look at",
  args: itemArgs(),
  group: "other",
  does: "wake",
  offered: ["pane", "menu"],
  elsewhere: true,
  row: (item, at) =>
    asleep(item, at.now) ? { title: "Wake now", icon: AlarmClockIcon } : null,
  run: (window, args) => {
    const at = threadAt(window, args)
    if (at) waking(window, at)
  },
}

/** Threads' item actions, in the order the Thread menu lists their rows. */
export const threadItems: readonly ItemAction[] = [
  rename,
  suggest,
  previous,
  unread,
  makeProject,
  snooze,
  wake,
]
