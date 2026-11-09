import { expect, test } from "vitest"
import type { ProjectId } from "@banda/contract"
import type { Args } from "@banda/ui/module"
import type { Listed, Lists } from "@banda/ui/pane"
import type { Shell } from "../window/actions"
import { archiving, itemActionsOf, paneRowsOf, rowsOf } from "./items"

const S1 = "s1" as ProjectId

const thread = (more: Partial<Listed> = {}): Listed => ({
  id: "t1",
  title: "Fix the list",
  mark: "idle",
  changed: 1,
  pane: { kind: "agents.thread", args: { thread: "t1" } },
  ...more,
})

/** A Window whose lists hold `item`, in focus; what it is asked to run,
 * it keeps. */
function fake(item: Listed) {
  const ran: [string, Args | undefined][] = []
  const lists: Lists = { [S1]: [item] }
  const shell = {
    here: {
      get: () => ({ pane: { id: "e1", project: S1, subject: item.id } }),
      subscribe: () => () => undefined,
    },
    items: { get: () => lists, subscribe: () => () => undefined },
    run: (action: string, args?: Args) => void ran.push([action, args]),
  } as unknown as Shell
  return { shell, ran }
}

test("a Thread's item actions are Threads', then the sidebar list's Archive", () => {
  expect(itemActionsOf(thread()).map((action) => action.id)).toEqual([
    "thread.rename",
    "thread.suggest-title",
    "agents.previous-title",
    "thread.unread",
    "agents.make-project",
    "thread.later",
    "thread.wake",
    "agents.archive-thread",
    "sidebar.archive",
  ])
})

test("the Thread menu's rows, as it stands", () => {
  const at = { now: 10, archived: false }
  const titles = (listed: Listed, more = {}) =>
    rowsOf(listed, { ...at, ...more }).map(({ row }) =>
      row.off ? `${row.title} (off)` : row.title
    )
  expect(titles(thread())).toEqual([
    "Rename…",
    "Suggest a title",
    "Later…",
    "Archive thread",
  ])
  expect(
    titles(thread({ mark: "asking", seen: true, was: "Before" }), {
      project: { id: S1, scratch: true },
    })
  ).toEqual([
    "Rename…",
    "Suggest a title",
    "Previous title",
    "Mark as unread",
    "Make a Project from it…",
    "Later… (off)",
    "Archive thread (off)",
  ])
  expect(
    titles(thread({ later: { at: 1, until: 20 } }), { archived: true })
  ).toEqual(["Rename…", "Suggest a title", "Wake now", "Unarchive thread"])
})

test("the Pane menu offers Later… or Wake now, and nothing that is off", () => {
  const ids = (listed: Listed) =>
    paneRowsOf(listed, S1, []).map(({ id, title, args }) => [id, title, args])
  const item = { project: S1, item: "t1" }
  expect(ids(thread())).toEqual([["thread.later", "Later…", item]])
  expect(ids(thread({ later: { at: 1, until: Date.now() + 60_000 } }))).toEqual(
    [["thread.wake", "Wake now", item]]
  )
  expect(ids(thread({ mark: "asking" }))).toEqual([])
})

test("Archive asks the Item's App to archive it on its host, in one command; an archived one, to bring it back", () => {
  const item = { project: S1, item: "t1" }
  // A sleeping one too: its host ends the Later as it archives it.
  const sleeping = thread({ later: { at: 1, until: Date.now() + 60_000 } })
  const first = fake(sleeping)
  archiving.run(first.shell)
  expect(first.ran).toEqual([
    ["agents.archive-thread", { ...item, archived: true }],
  ])
  const archived = fake(thread({ archived: true }))
  archiving.run(archived.shell, item)
  expect(archived.ran).toEqual([
    ["agents.archive-thread", { ...item, archived: false }],
  ])
})

test("a Thread at work is not archived", () => {
  const working = thread({ id: "t2", mark: "running" })
  const { shell, ran } = fake(working)
  archiving.run(shell)
  expect(ran).toEqual([])
})

test("an Item whose App has no archive of its own stays as it is", () => {
  const file = thread({ pane: { kind: "files.file", args: {} } })
  const { shell, ran } = fake(file)
  archiving.run(shell)
  expect(ran).toEqual([])
})
