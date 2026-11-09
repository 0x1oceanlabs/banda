import { expect, test } from "vitest"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { DEFAULT_SIDEBAR } from "@banda/contract/sidebar"
import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import { callsOf } from "@banda/ui/status"
import { nextCall } from "../calls/sight"
import { keysOf, order } from "./order"
import type { Settings } from "./settings"
import { type Counted, inOrder, tally } from "./tally"

const one = (id: string, mark: MarkState, changed = 0): Listed => ({
  id,
  title: id,
  mark,
  changed,
  pane: { kind: "thread", args: { thread: id } },
})

const lists = {
  ["a" as ProjectId]: [
    one("run", "running", 5),
    one("ask", "asking", 3),
    one("old", "done", 1),
  ],
  ["b" as ProjectId]: [
    one("new", "done", 4),
    one("broke", "failed", 6),
    one("quiet", "rest"),
  ],
}

test("each count takes its marks, the loudest shows, and a count of none is left out", () => {
  const counts = tally(lists, ["asking", "done", "working"], 0)
  expect(counts.map((c) => [c.count, c.mark, c.things.length])).toEqual([
    ["asking", "failed", 2],
    ["done", "done", 2],
    ["working", "running", 1],
  ])
  const calm = { ["a" as ProjectId]: [one("run", "running")] }
  expect(tally(calm, ["asking", "done", "working"], 0)).toHaveLength(1)
})

test("waiting takes what asks and what is done, and archived Threads are not counted", () => {
  const archived = {
    ...lists,
    ["a" as ProjectId]: lists["a" as ProjectId].map((l) =>
      l.id === "old" ? { ...l, archived: true as const } : l
    ),
  }
  const counts = tally(archived, ["waiting"], 0)
  expect(counts[0].things.map((t) => t.listed.id).sort()).toEqual([
    "ask",
    "broke",
    "new",
  ])
})

test("the list goes in the sidebar's order, not the loudest first, what waits before what works, and one the sidebar lists nowhere last (ADR 0087, decision 8)", () => {
  const order = ["a:old", "b:new", "a:run", "a:ask", "b:quiet"]
  const { waiting, working } = inOrder(
    tally(lists, ["asking", "done", "waiting", "working"], 0),
    order
  )
  expect(waiting.map((t) => t.listed.id)).toEqual([
    "old",
    "new",
    "ask",
    "broke",
  ])
  expect(working.map((t) => [t.project, t.listed.id])).toEqual([["a", "run"]])
})

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

test("the list is what Alt+U walks from the top, as the Person arranges the sidebar", () => {
  // Project a changed last, though b's calls are the newer; an Agent
  // works in each.
  const day = {
    ["a" as ProjectId]: [
      one("run", "running", 7),
      one("ask", "asking", 3),
      one("old", "done", 1),
    ],
    ["b" as ProjectId]: [
      one("new", "done", 4),
      one("broke", "failed", 6),
      one("build", "running", 2),
      one("quiet", "rest"),
    ],
  }
  const keys = (things: Counted[]) =>
    things.map((t) => `${t.project}:${t.listed.id}`)
  const listedIn = (settings: Settings) => {
    const sidebar = keysOf(
      order(day, [project("a"), project("b")], 0, { settings })
    )
    const listed = inOrder(tally(day, ["waiting", "working"], 0), sidebar)
    const waiting = keys(listed.waiting)
    const working = keys(listed.working)
    // Alt+U, once for each call, from no Thread in front.
    const calls = callsOf(day, 0)
    const walked: string[] = []
    while (walked.length < calls.length)
      walked.push(nextCall(calls, sidebar, walked.at(-1))!.key)
    expect(waiting).toEqual(walked)
    // What works keeps the sidebar's order too, wherever its rows stand.
    expect(working).toEqual(sidebar.filter((key) => working.includes(key)))
    return { waiting, working }
  }
  // The `inbox` preset: what waits first, the latest first, then what
  // works.
  expect(listedIn(DEFAULT_SIDEBAR)).toEqual({
    waiting: ["b:broke", "b:new", "a:ask", "a:old"],
    working: ["a:run", "b:build"],
  })
  // Sorted by title, the list is too.
  expect(listedIn({ ...DEFAULT_SIDEBAR, sort: { by: "title" } })).toEqual({
    waiting: ["a:ask", "b:broke", "b:new", "a:old"],
    working: ["b:build", "a:run"],
  })
  // The `projects` preset: the Project that changed last first, and in
  // each what waits, then what works.
  const projects: Settings = {
    ...DEFAULT_SIDEBAR,
    group: {
      ...DEFAULT_SIDEBAR.group,
      by: "project",
      states: ["active", "working", "later", "archived"],
      bottom: [],
    },
  }
  expect(listedIn(projects)).toEqual({
    waiting: ["a:ask", "a:old", "b:broke", "b:new"],
    working: ["a:run", "b:build"],
  })
})
