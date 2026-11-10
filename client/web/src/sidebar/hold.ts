/**
 * The list holds still under the pointer (ADR 0065, decision 8; ADR 0098,
 * decision 6): while the Person's pointer is over it, each block's cards
 * stay in the order they were drawn in, saying what they say now; a card
 * new to a block comes last in it, so nothing above moves. It holds
 * silently: what comes takes its place when the pointer leaves, with no
 * pill to count it. Pure, so plain tests cover it.
 */
import type { Row } from "./arrange"
import type { Block } from "./inbox"

/** The list as it was drawn when the pointer came: each block's cards,
 * by key, in their order. */
export type Held = ReadonlyMap<string, ReadonlyMap<string, number>>

/** A row's key: its Project's and its own. */
export function rowKey(row: Row): string {
  return `${row.project.id}:${row.listed.id}`
}

/** What `blocks` draw now, held as they stand. */
export function held(blocks: readonly Block[]): Held {
  return new Map(
    blocks.flatMap((block) =>
      block.kind === "rows"
        ? [
            [
              block.key,
              new Map(block.rows.map(({ row }, i) => [rowKey(row), i])),
            ],
          ]
        : []
    )
  )
}

/**
 * `next`, as `was` drew it: the blocks as they are now, each one's held
 * cards in their held order, and its new ones last.
 */
export function hold(next: Block[], was: Held | undefined): Block[] {
  if (!was) return next
  return next.map((block) => {
    if (block.kind !== "rows") return block
    const order = was.get(block.key) ?? new Map<string, number>()
    const at = ({ row }: { row: Row }) => order.get(rowKey(row))
    const kept = block.rows
      .filter((entry) => at(entry) !== undefined)
      .sort((a, b) => at(a)! - at(b)!)
    const came = block.rows.filter((entry) => at(entry) === undefined)
    return { ...block, rows: [...kept, ...came] }
  })
}
