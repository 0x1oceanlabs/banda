import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import type { Stand } from "@banda/ui/status"
import { expect, test } from "vitest"
import { gapAbove, itemsOf, REGION_GAP, ROW_GAP } from "./flat"
import type { Block } from "./inbox"
import { regionsOf } from "./regions"
import type { Row } from "./rows"

const project = { id: "s" as ProjectId, name: "S" } as ProjectSummary
const row = (id: string, stand: Stand): Row => ({
  project,
  listed: { id, title: id, mark: "rest", changed: 0 } as Listed,
  stand,
})
const cards = (stand: Stand, ids: string[]): Block => ({
  kind: "rows",
  key: stand,
  stand,
  rows: ids.map((id) => ({ row: row(id, stand), at: 0 })),
})
const head = (key: string, label: string): Block => ({
  kind: "head",
  key: `${key}:head`,
  label,
})

test("the list is flat: each head, then its part's cards, by their keys; a part's cards stand 1 px apart and regions 4 px", () => {
  const list = itemsOf(
    regionsOf([
      head("turn", "Your turn"),
      cards("turn", ["a", "b"]),
      head("working", "Working"),
      cards("working", ["c"]),
    ])
  )
  expect(list.map((item) => item.key)).toEqual([
    "turn:head",
    ":a",
    ":b",
    "working:head",
    ":c",
  ])
  expect(list.map((item, i) => gapAbove(list[i - 1], item))).toEqual([
    0,
    0,
    ROW_GAP,
    REGION_GAP,
    0,
  ])
})

test("a card says the part it is drawn in, and its region's name", () => {
  const [, card] = itemsOf(
    regionsOf([head("turn", "Your turn"), cards("turn", ["a"])])
  )
  expect(card).toMatchObject({
    kind: "card",
    block: "turn",
    stand: "turn",
    place: "Threads",
  })
})
