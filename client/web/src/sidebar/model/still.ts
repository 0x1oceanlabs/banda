/**
 * The one rule that keeps a card from running out from under a click (ADR
 * 0098, decision 6, as amended 2026-11-14): the order does not change
 * while the pointer is over the list. What each card says stays live, a
 * card that left the tab goes at once, and one new to it waits for the
 * pointer to leave. Pure, so plain tests cover it.
 */
import type { Block, Entry } from "./inbox"
import { itemKey } from "./rows"

/** Whether `block` draws a card: a Thread's, or a Project's that waits. */
const cards = (block: Block) =>
  block.kind === "rows" || block.kind === "project"

/**
 * `fresh` in the order `drawn` drew it: each block of `drawn` in its
 * place, as `fresh` has it now, and each card where it was drawn, saying
 * what it says now wherever `fresh` has it. A card `fresh` has nowhere is
 * dropped, and so is a part left with none and a block `fresh` no longer
 * has; a card only `fresh` has is not added. With no card left, `fresh`
 * as it is, so inbox zero and a tab's empty words show at once.
 */
export function stillOf(
  drawn: readonly Block[],
  fresh: readonly Block[]
): Block[] {
  const blocks = new Map(fresh.map((block) => [block.key, block]))
  const entries = new Map<string, Entry>()
  for (const block of fresh)
    if (block.kind === "rows")
      for (const entry of block.rows) entries.set(itemKey(entry.row), entry)
  const still = drawn.flatMap((block): Block[] => {
    if (block.kind !== "rows") {
      const now = blocks.get(block.key)
      return now && now.kind !== "rows" ? [now] : []
    }
    const rows = block.rows.flatMap(
      ({ row }) => entries.get(itemKey(row)) ?? []
    )
    return rows.length > 0 ? [{ ...block, rows }] : []
  })
  return still.some(cards) ? still : [...fresh]
}
