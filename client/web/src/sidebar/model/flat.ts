/**
 * The sidebar list as one flat list, keyed (ADR 0098, decision 6), with
 * the parts' heads and the groups' headers as items in it: a card that
 * changes part keeps its node and its Mark, so its change plays as news,
 * and React moves the rows by their keys. Pure, so plain tests cover it.
 */
import type { Stand } from "@banda/ui/status"
import type { Block, Entry } from "./inbox"
import type { Region } from "./regions"
import { itemKey } from "./rows"

/** A block that is not cards. */
export type Piece = Exclude<Block, { kind: "rows" }>

/** One item of the list, in its region: a card, or a block. */
export type Item = {
  key: string
  /** Its region's key: a gap parts one region from the next. */
  region: string
  /** What it is called, as its region is. */
  place?: string
} & (
  | {
      kind: "card"
      /** The part it is drawn in, and that part's place. */
      block: string
      stand: Stand
      entry: Entry
    }
  | { kind: "piece"; piece: Piece }
)

/** Between two cards of one part, and between two regions, in px. */
export const ROW_GAP = 1
export const REGION_GAP = 4

/** The items of `regions`, top down: each region's group header, then its
 * blocks, each part's cards one by one. */
export function itemsOf(regions: readonly Region[]): Item[] {
  return regions.flatMap((region) => {
    const at = {
      region: region.key,
      ...(region.label === undefined ? {} : { place: region.label }),
    }
    const blocks = region.group
      ? [region.group, ...region.blocks]
      : region.blocks
    return blocks.flatMap((block): Item[] => {
      if (block.kind !== "rows")
        return [{ kind: "piece", key: block.key, ...at, piece: block }]
      return block.rows.map((entry) => ({
        kind: "card",
        key: itemKey(entry.row),
        ...at,
        block: block.key,
        stand: block.stand,
        entry,
      }))
    })
  })
}

/** What parts `item` from the one above it, in px. */
export function gapAbove(above: Item | undefined, item: Item): number {
  if (!above) return 0
  if (above.region !== item.region) return REGION_GAP
  return above.kind === "card" &&
    item.kind === "card" &&
    above.block === item.block
    ? ROW_GAP
    : 0
}
