import type { ProjectId } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import type { Arranged, Row, Section } from "./arrange"
import { held, hold } from "./hold"

const project = { id: "s" as ProjectId, name: "S" } as Row["project"]
const row = (id: string, title = id): Row => ({
  project,
  listed: { id, title, mark: "rest", changed: 0 } as Listed,
  state: "active",
})
const list = (...rows: Row[]): Arranged => ({
  sections: [
    { key: "active", label: "", rows, folded: false, mark: "rest", waiting: 0 },
  ] as Section[],
  shelves: [],
})
const ids = (arranged: Arranged) =>
  arranged.sections[0].rows.map((one) => one.listed.id)
const was = held(list(row("a"), row("b"), row("c")))
// c called and comes to the top; d is new; a says something new.
const next = list(row("c"), row("d"), row("a", "a, again"), row("b"))

test("under the pointer the rows stay put, say what they say now, and a new one comes last", () => {
  const { arranged } = hold(next, was)
  expect(ids(arranged)).toEqual(["a", "b", "c", "d"])
  expect(arranged.sections[0].rows[0].listed.title).toBe("a, again")
})

test("what comes, or comes up, waits as updates", () => {
  // d, new, and c, come up; a and b only went down under them.
  expect(hold(next, was).updates).toBe(2)
})

test("a row gone goes, and nothing held is as it is", () => {
  expect(ids(hold(list(row("a"), row("c")), was).arranged)).toEqual(["a", "c"])
  expect(hold(next, undefined)).toEqual({ arranged: next, updates: 0 })
})
