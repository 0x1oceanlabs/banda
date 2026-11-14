import { expect, test } from "vitest"
import type { ProjectId } from "@banda/contract"
import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import { calm, tally } from "./tally"

const one = (id: string, mark: MarkState, changed = 0): Listed => ({
  id,
  title: id,
  mark,
  changed,
  pane: { kind: "thread", args: { thread: id } },
})

const lists = {
  ["a" as ProjectId]: [
    one("run", "working", 5),
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
    ["working", "working", 1],
  ])
  const calm = { ["a" as ProjectId]: [one("run", "working")] }
  expect(tally(calm, ["asking", "done", "working"], 0)).toHaveLength(1)
})

test("a Thread that woke counts only in waiting, and rings there as the bar's Mark does (ADR 0099, decision 9)", () => {
  const woke = {
    ["a" as ProjectId]: [{ ...one("up", "rest"), later: { at: 0, until: 5 } }],
  }
  expect(tally(woke, ["asking", "done", "working"], 10)).toEqual([])
  expect(tally(woke, ["waiting"], 10).map((c) => c.mark)).toEqual(["woke"])
})

test("the calm square is for when nothing waits and nothing works, not for when no count takes it", () => {
  const withOne = (more: Partial<Listed>, mark: MarkState = "rest") => ({
    ["a" as ProjectId]: [{ ...one("t", mark), ...more }],
  })
  expect(calm({}, 10)).toBe(true)
  expect(calm(withOne({}), 10)).toBe(true)
  expect(calm(withOne({ later: { at: 0, until: 5 } }), 10)).toBe(false)
  expect(calm(withOne({}, "working"), 10)).toBe(false)
  expect(calm(withOne({}, "done"), 10)).toBe(false)
  expect(calm(withOne({ later: { at: 0, until: 50 } }, "done"), 10)).toBe(true)
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
