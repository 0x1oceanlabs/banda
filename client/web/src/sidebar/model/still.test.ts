import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import type { Stand } from "@banda/ui/status"
import { expect, test } from "vitest"
import type { Item, Piece } from "./flat"
import { itemKey, type Row } from "./rows"
import { stillOf } from "./still"

const project = { id: "s" as ProjectId, name: "S" } as ProjectSummary
const row = (id: string, stand: Stand, title = id): Row => ({
  project,
  listed: { id, title, mark: "rest", changed: 0 } as Listed,
  stand,
})
/** The card of `one`, drawn in the part of `stand`. */
const card = (one: Row, stand: Stand = one.stand): Item => ({
  kind: "card",
  key: itemKey(one),
  region: "region:Threads",
  block: stand,
  stand,
  entry: { row: one, at: 0 },
})
const piece = (block: Piece): Item => ({
  kind: "piece",
  key: block.key,
  region: "region:Threads",
  piece: block,
})
const head = (count: number) =>
  piece({ kind: "head", key: "turn:head", label: "Your turn", count })
const zero = piece({ kind: "zero", key: "zero", working: 0 })
/** What `items` draw: each piece's key, and each card's part and Thread. */
const shape = (items: readonly Item[]) =>
  items.map((item) =>
    item.kind === "piece"
      ? item.key
      : `${item.block}:${item.entry.row.listed.id}`
  )

test("the order drawn is kept as the cards change places, and what each says is fresh", () => {
  const drawn = [
    head(2),
    card(row("a", "turn")),
    card(row("b", "turn")),
    card(row("c", "open")),
  ]
  const renamed = row("a", "open", "A, renamed")
  const fresh = [
    head(2),
    card(row("c", "turn")),
    card(row("b", "turn")),
    card(renamed),
  ]
  const still = stillOf(drawn, fresh)
  expect(shape(still)).toEqual(["turn:head", "turn:a", "turn:b", "open:c"])
  const [, a] = still
  expect(a?.kind === "card" && a.entry.row).toBe(renamed)
})

test("a card that left the tab goes at once, and so does a piece the list no longer has", () => {
  const drawn = [
    head(2),
    card(row("a", "turn")),
    card(row("b", "turn")),
    piece({ kind: "divider", key: "divider" }),
    card(row("c", "open")),
  ]
  const fresh = [head(1), card(row("b", "turn"))]
  const still = stillOf(drawn, fresh)
  expect(shape(still)).toEqual(["turn:head", "turn:b"])
  expect(still[0]).toBe(fresh[0])
})

test("a card new to the tab waits", () => {
  const drawn = [head(1), card(row("a", "turn"))]
  const fresh = [
    head(2),
    card(row("new", "turn")),
    card(row("a", "turn")),
    card(row("other", "open")),
  ]
  expect(shape(stillOf(drawn, fresh))).toEqual(["turn:head", "turn:a"])
})

test("with no card left, the list is drawn as it is: inbox zero shows at once, and so does what came", () => {
  const drawn = [head(1), card(row("a", "turn"))]
  expect(stillOf(drawn, [zero])).toEqual([zero])
  const came = [head(1), card(row("new", "turn"))]
  expect(stillOf(drawn, came)).toEqual(came)
  expect(itemKey(row("a", "turn"))).toBe(":a")
})
