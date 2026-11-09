import type { ProjectId, ProjectSummary } from "@banda/contract"
import { DEFAULT_SIDEBAR } from "@banda/contract/sidebar"
import type { MarkState } from "@banda/ui/components/banda-mark"
import { callsOf, type Listed, type Lists } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { nextCall } from "../calls/sight"
import { rowKey } from "./hold"
import { byOrder, keysOf, order } from "./order"
import type { Settings } from "./settings"
import { inOrder, tally } from "./tally"

const project = (id: string): ProjectSummary => ({
  id,
  name: id,
  folder: `/${id}`,
  pinned: false,
  archived: false,
  sees_others: false,
  sign: { kind: "letters", text: id, picked: false },
  trusted: true,
  scratch: false,
  missing: false,
})

const one = (id: string, mark: MarkState, changed: number): Listed => ({
  id,
  title: id,
  mark,
  changed,
  pane: { kind: "thread", args: { thread: id } },
})

const none = () => false
const marks = { archived: none, asleep: none, woke: () => undefined }

/** Every call, walked with Alt+U once each from no Thread in front. */
function walk(lists: Lists, keys: readonly string[]): string[] {
  const calls = callsOf(lists, 0)
  const walked: string[] = []
  while (walked.length < calls.length)
    walked.push(nextCall(calls, keys, walked.at(-1))!.key)
  return walked
}

/** What waits in the counts' list, top down. */
function counted(lists: Lists, keys: readonly string[]): string[] {
  return inOrder(tally(lists, ["waiting"], none), keys).waiting.map(
    ({ project, listed }) => `${project}:${listed.id}`
  )
}

test("the sidebar list draws the order the counts list and Alt+U go by, whatever it folds (ADR 0087, decision 8)", () => {
  const lists = {
    ["a" as ProjectId]: [one("ask", "asking", 3), one("old", "done", 1)],
    ["b" as ProjectId]: [one("broke", "failed", 6), one("run", "running", 7)],
  }
  const projects = [project("a"), project("b")]
  const byProject: Settings = {
    ...DEFAULT_SIDEBAR,
    group: { ...DEFAULT_SIDEBAR.group, by: "project", bottom: [] },
  }
  for (const settings of [DEFAULT_SIDEBAR, byProject]) {
    const keys = keysOf(order(lists, projects, marks, { settings }))
    // The sidebar list, a section folded: the same rows in the same order.
    const drawn = order(lists, projects, marks, {
      settings,
      toggled: new Set(["a", "active"]),
    })
    expect(
      [...drawn.sections, ...drawn.shelves].flatMap((s) => s.rows.map(rowKey))
    ).toEqual(keys)
    const waiting = keys.filter((key) => !key.endsWith(":run"))
    expect(counted(lists, keys)).toEqual(waiting)
    expect(walk(lists, keys)).toEqual(waiting)
  }
})

test("another machine's Threads stand among this one's in the sidebar list, and after them in the counts list and for Alt+U", () => {
  const away = project("far")
  const lists = {
    ["a" as ProjectId]: [one("ask", "asking", 3), one("old", "done", 1)],
    ["far" as ProjectId]: [one("there", "asking", 5)],
  }
  const projects = [project("a")]
  // The sidebar list, grouped by state: the newest that waits first,
  // wherever it is.
  const sidebar = keysOf(
    order(lists, projects, marks, {
      settings: DEFAULT_SIDEBAR,
      elsewhere: [{ name: "devbox", projects: [away] }],
    })
  )
  expect(sidebar).toEqual(["far:there", "a:ask", "a:old"])
  // The counts and Alt+U hand no other machine: it comes last there.
  const keys = keysOf(
    order(lists, projects, marks, { settings: DEFAULT_SIDEBAR })
  )
  expect(keys).toEqual(["a:ask", "a:old"])
  expect(counted(lists, keys)).toEqual(["a:ask", "a:old", "far:there"])
  expect(walk(lists, keys)).toEqual(["a:ask", "a:old", "far:there"])
})

test("things of one place keep their tie, and their order when it ties too", () => {
  const things = ["b:2", "x:9", "a:1", "y:9", "z:8"]
  const tie = (a: string, b: string) =>
    Number(a.split(":")[1]) - Number(b.split(":")[1])
  expect(byOrder(things, ["a:1", "b:2"], (key) => key, tie)).toEqual([
    "a:1",
    "b:2",
    "z:8",
    "x:9",
    "y:9",
  ])
})
