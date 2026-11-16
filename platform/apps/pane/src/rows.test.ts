import type { TreeAction, TreeColumn } from "@banda/contract/apps"
import { expect, test } from "vitest"
import { found, nextOrder, ordered, type Row, taken } from "./rows"

const COLUMNS: TreeColumn[] = [
  { key: "name", title: "Name", as: "text", tones: {} },
  { key: "deals", title: "Deals", as: "text", tones: {} },
]
const ROWS: Row[] = [
  { id: 1, name: "Boris", deals: 10, city: "Kyiv" },
  { id: 2, name: "anna", deals: 9, city: "Berlin" },
  { id: 3, name: "Chen", deals: null, city: "Berlin" },
]
const names = (rows: readonly Row[]) => rows.map((row) => row.name)

test("the rows found have the words in a column's cell, whatever their case", () => {
  expect(names(found(ROWS, COLUMNS, " AN "))).toEqual(["anna"])
  // A key that is no column is not looked in.
  expect(found(ROWS, COLUMNS, "berlin")).toEqual([])
  expect(found(ROWS, COLUMNS, "")).toBe(ROWS)
})

test("rows go by a column: numbers by size, text as it reads, nothing last", () => {
  expect(names(ordered(ROWS, { key: "name", down: false }))).toEqual([
    "anna",
    "Boris",
    "Chen",
  ])
  expect(names(ordered(ROWS, { key: "deals", down: false }))).toEqual([
    "anna",
    "Boris",
    "Chen",
  ])
  expect(names(ordered(ROWS, { key: "deals", down: true }))).toEqual([
    "Boris",
    "anna",
    "Chen",
  ])
  expect(ordered(ROWS, undefined)).toBe(ROWS)
})

test("a click on a title orders up, then down, then as the App wrote the rows", () => {
  const up = nextOrder(undefined, "name")
  expect(up).toEqual({ key: "name", down: false })
  const down = nextOrder(up, "name")
  expect(down).toEqual({ key: "name", down: true })
  expect(nextOrder(down, "name")).toBeUndefined()
  expect(nextOrder(down, "deals")).toEqual({ key: "deals", down: false })
})

test("an action sends what it writes and what it takes from its row", () => {
  const action: TreeAction = {
    label: "Move",
    command: "move",
    params: { stage: "won" },
    take: { client: "id", town: "city" },
    confirm: null,
    form: null,
    tone: "plain",
  }
  const all = { stage: "won", client: 2, town: "Berlin" }
  expect(taken(action, ROWS[1]!)).toEqual({ sent: all, given: all })
  // What its form fills is the form's to send.
  const town = { name: "town" } as NonNullable<TreeAction["form"]>["fields"][0]
  const form = { title: null, command: "move", submit: "Move", fields: [town] }
  expect(taken({ ...action, form }, ROWS[1]!)).toEqual({
    sent: { stage: "won", client: 2 },
    given: all,
  })
})
