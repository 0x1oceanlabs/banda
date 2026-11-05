import { expect, test } from "vitest"
import type { SpaceId } from "@banda/contract"
import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import { inOrder, tally } from "./tally"

const one = (id: string, mark: MarkState, changed = 0): Listed => ({
  id,
  title: id,
  mark,
  changed,
  pane: { kind: "thread", args: { thread: id } },
})

const lists = {
  ["a" as SpaceId]: [
    one("run", "running", 5),
    one("ask", "asking", 3),
    one("old", "done", 1),
  ],
  ["b" as SpaceId]: [
    one("new", "done", 4),
    one("broke", "failed", 6),
    one("quiet", "rest"),
  ],
}
const none = () => false

test("each count takes its marks, the loudest shows, and a count of none is left out", () => {
  const counts = tally(lists, ["asking", "done", "working"], none)
  expect(counts.map((c) => [c.count, c.mark, c.things.length])).toEqual([
    ["asking", "failed", 2],
    ["done", "done", 2],
    ["working", "running", 1],
  ])
  const calm = { ["a" as SpaceId]: [one("run", "running")] }
  expect(tally(calm, ["asking", "done", "working"], none)).toHaveLength(1)
})

test("waiting takes what asks and what is done, and archived Threads are not counted", () => {
  const counts = tally(lists, ["waiting"], (l) => l.id === "old")
  expect(counts[0].things.map((t) => t.listed.id).sort()).toEqual([
    "ask",
    "broke",
    "new",
  ])
})

test("the list puts the loudest first, then who waited longest, and the work after", () => {
  const { waiting, working } = inOrder(
    tally(lists, ["asking", "done", "waiting", "working"], none)
  )
  expect(waiting.map((t) => t.listed.id)).toEqual([
    "broke",
    "ask",
    "old",
    "new",
  ])
  expect(working.map((t) => [t.space, t.listed.id])).toEqual([["a", "run"]])
})
