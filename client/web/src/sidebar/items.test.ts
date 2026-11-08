import { expect, test } from "vitest"
import type { ProjectId } from "@banda/contract"
import type { Args } from "@banda/ui/module"
import type { Listed, Lists } from "@banda/ui/pane"
import type { Shell } from "../window/actions"
import { archivedNow } from "./archived"
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
    "thread.snooze",
    "thread.wake",
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
    "Snooze…",
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
    "Snooze… (off)",
    "Archive thread (off)",
  ])
  expect(
    titles(thread({ snooze: { at: 1, until: 20 } }), { archived: true })
  ).toEqual(["Rename…", "Suggest a title", "Wake now", "Unarchive thread"])
})

test("the Pane menu offers Snooze… or Wake now, and nothing that is off", () => {
  const ids = (listed: Listed) =>
    paneRowsOf(listed, S1, []).map(({ id, title, args }) => [id, title, args])
  const item = { project: S1, item: "t1" }
  expect(ids(thread())).toEqual([["thread.snooze", "Snooze…", item]])
  expect(
    ids(thread({ snooze: { at: 1, until: Date.now() + 60_000 } }))
  ).toEqual([["thread.wake", "Wake now", item]])
  expect(ids(thread({ mark: "asking" }))).toEqual([])
})

test("Archive puts a Thread away and ends its snooze by its App's wake; again, it comes back", () => {
  const sleeping = thread({ snooze: { at: 1, until: Date.now() + 60_000 } })
  const { shell, ran } = fake(sleeping)
  archiving.run(shell)
  const item = { project: S1, item: "t1" }
  expect(ran).toEqual([
    ["thread.wake", item],
    ["pane.put-away", item],
  ])
  expect(archivedNow(sleeping)).toBe(true)
  archiving.run(shell, item)
  expect(ran).toHaveLength(2)
  expect(archivedNow(sleeping)).toBe(false)
})

test("a Thread at work is not archived", () => {
  const working = thread({ id: "t2", mark: "running" })
  const { shell, ran } = fake(working)
  archiving.run(shell)
  expect(ran).toEqual([])
  expect(archivedNow(working)).toBe(false)
})
