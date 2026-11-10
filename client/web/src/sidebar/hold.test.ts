import type { ProjectId } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import type { Row } from "./arrange"
import { held, hold } from "./hold"
import type { Block } from "./inbox"

const project = { id: "s" as ProjectId, name: "S" } as Row["project"]
const row = (id: string, title = id): Row => ({
  project,
  listed: { id, title, mark: "rest", changed: 0 } as Listed,
  stand: "open",
})
const list = (...rows: Row[]): Block[] => [
  { kind: "head", key: "turn:head", label: "Your turn", count: 0 },
  {
    kind: "rows",
    key: "open",
    stand: "open",
    rows: rows.map((one) => ({ row: one, at: 0 })),
  },
]
const ids = (blocks: Block[]) =>
  blocks.flatMap((block) =>
    block.kind === "rows" ? block.rows.map(({ row }) => row.listed.id) : []
  )
const was = held(list(row("a"), row("b"), row("c")))
// c called and comes to the top; d is new; a says something new.
const next = list(row("c"), row("d"), row("a", "a, again"), row("b"))

test("under the pointer the cards stay put, say what they say now, and a new one comes last", () => {
  const drawn = hold(next, was)
  expect(ids(drawn)).toEqual(["a", "b", "c", "d"])
  const cards = drawn[1]
  expect(cards?.kind === "rows" && cards.rows[0]?.row.listed.title).toBe(
    "a, again"
  )
  // What is not a block of cards stays as it comes.
  expect(drawn[0]).toBe(next[0])
})

test("a card gone goes, a block new to the list comes as it is, and nothing held is as it is", () => {
  expect(ids(hold(list(row("a"), row("c")), was))).toEqual(["a", "c"])
  const other: Block[] = [
    {
      kind: "rows",
      key: "working",
      stand: "working",
      rows: [{ row: row("z"), at: 0 }],
    },
  ]
  expect(hold(other, was)).toEqual(other)
  expect(hold(next, undefined)).toBe(next)
})
