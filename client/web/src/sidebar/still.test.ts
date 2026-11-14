import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import type { Stand } from "@banda/ui/status"
import { expect, test } from "vitest"
import type { Block } from "./inbox"
import { itemKey, type Row } from "./rows"
import { stillOf } from "./still"

const project = { id: "s" as ProjectId, name: "S" } as ProjectSummary
const row = (id: string, stand: Stand, title = id): Row => ({
  project,
  listed: { id, title, mark: "rest", changed: 0 } as Listed,
  stand,
})
const cards = (stand: Stand, rows: Row[]): Block => ({
  kind: "rows",
  key: stand,
  stand,
  rows: rows.map((one) => ({ row: one, at: 0 })),
})
const head = (count: number): Block => ({
  kind: "head",
  key: "turn:head",
  label: "Your turn",
  count,
})
const zero: Block = { kind: "zero", key: "zero", working: 0, later: 0 } as Block
/** What `blocks` draw: each block's key, a part's with its cards'. */
const shape = (blocks: readonly Block[]) =>
  blocks.map((block) =>
    block.kind === "rows"
      ? `${block.key}[${block.rows.map(({ row: one }) => one.listed.id).join(",")}]`
      : block.key
  )

test("the order drawn is kept as the cards change places, and what each says is fresh", () => {
  const drawn = [
    head(2),
    cards("turn", [row("a", "turn"), row("b", "turn")]),
    cards("open", [row("c", "open")]),
  ]
  const renamed = row("a", "open", "A, renamed")
  const fresh = [
    head(2),
    cards("turn", [row("c", "turn"), row("b", "turn")]),
    cards("open", [renamed]),
  ]
  const still = stillOf(drawn, fresh)
  expect(shape(still)).toEqual(["turn:head", "turn[a,b]", "open[c]"])
  const [, turn] = still
  expect(turn?.kind === "rows" && turn.rows[0]?.row).toBe(renamed)
})

test("a card that left the tab goes at once, with a part it leaves empty and a block the list no longer has", () => {
  const drawn = [
    head(2),
    cards("turn", [row("a", "turn"), row("b", "turn")]),
    { kind: "divider", key: "divider" } as Block,
    cards("open", [row("c", "open")]),
  ]
  const fresh = [head(1), cards("turn", [row("b", "turn")])]
  const still = stillOf(drawn, fresh)
  expect(shape(still)).toEqual(["turn:head", "turn[b]"])
  expect(still[0]).toBe(fresh[0])
})

test("a card new to the tab waits", () => {
  const drawn = [head(1), cards("turn", [row("a", "turn")])]
  const fresh = [
    head(2),
    cards("turn", [row("new", "turn"), row("a", "turn")]),
    cards("open", [row("other", "open")]),
  ]
  expect(shape(stillOf(drawn, fresh))).toEqual(["turn:head", "turn[a]"])
})

test("with no card left, the list is drawn as it is: inbox zero shows at once, and so does what came", () => {
  const drawn = [head(1), cards("turn", [row("a", "turn")])]
  expect(stillOf(drawn, [zero])).toEqual([zero])
  const came = [head(1), cards("turn", [row("new", "turn")])]
  expect(stillOf(drawn, came)).toEqual(came)
  expect(itemKey(row("a", "turn"))).toBe(":a")
})
