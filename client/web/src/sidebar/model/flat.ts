/**
 * The sidebar list as one flat list, keyed (ADR 0098, decisions 3–6),
 * with the parts' heads and the groups' headers as items in it: a card
 * that changes part keeps its node and its Mark, so its change plays as
 * news, and React moves the rows by their keys. Each item says the region
 * it is in, which a screen reader names and a test finds: each group's
 * header with what follows it, on the other machine it is on; else each
 * place's cards with their heads, the divider above Open and what a cut
 * list leaves out, Your turn and Open together as the Person's Threads;
 * and inbox zero, or a tab with nothing in it, alone. It lays out what
 * `inbox.ts` laid out and moves nothing. Pure, so plain tests cover it.
 */
import { NO_PROJECT } from "@banda/ui/lib/projects"
import { STAND_WORDS, type Stand } from "@banda/ui/status"
import type { Block, Entry } from "./inbox"
import { itemKey } from "./rows"

/** A block that is not cards. */
export type Piece = Exclude<Block, { kind: "rows" }>

/** One item of the list, in its region: a card, or a piece. */
export type Item = {
  key: string
  /** Its region's key, which stays its own while the items in it come
   * and go: its place's, its group's, or its one piece's. A gap parts one
   * region from the next. */
  region: string
  /** What its region is called; none for inbox zero or an empty tab,
   * which say what they are in words. */
  place?: string
  /** The other machine whose Project's group it is in, which goes under
   * that machine's label. */
  host?: string
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

/** What each place's region is called: Your turn and Open are one, the
 * Threads that are the Person's. */
const PLACES: Readonly<Record<Stand, string>> = {
  turn: "Threads",
  open: "Threads",
  working: STAND_WORDS.working,
  later: STAND_WORDS.later,
  archived: STAND_WORDS.archived,
}

/** Where an item is: its region's key, name and machine. */
type At = Pick<Item, "region" | "place" | "host">

/** Between two cards of one part, and between two regions, in px. */
export const ROW_GAP = 1
export const REGION_GAP = 4

/** The items of `blocks`, top down, each in its region. */
export function itemsOf(blocks: readonly Block[]): Item[] {
  const items: Item[] = []
  let at: At | undefined
  // Whether the region is a group's, which holds all that follows it.
  let grouped = false
  // The heads and the divider above the cards they stand over.
  let above: Piece[] = []
  const put = (piece: Piece) => {
    if (at) items.push({ kind: "piece", key: piece.key, ...at, piece })
  }
  for (const block of blocks)
    switch (block.kind) {
      case "zero":
      case "empty":
        at = { region: block.key }
        grouped = false
        put(block)
        break
      case "group":
        at = {
          region: block.key,
          place: block.project?.name ?? NO_PROJECT,
          ...(block.host === undefined ? {} : { host: block.host }),
        }
        grouped = true
        put(block)
        break
      case "head":
      case "divider":
        if (grouped) put(block)
        else above.push(block)
        break
      case "project":
      case "rows": {
        // Keyed by its place, not by its first block: the Person's
        // Threads stay the same region as Your turn empties, and Later as
        // its first day does, so the cards in it are not drawn anew. A
        // Project that waits for the Person is among them, in Your turn.
        const place = PLACES[block.kind === "rows" ? block.stand : "turn"]
        if (!at || (!grouped && at.place !== place))
          at = { region: `region:${place}`, place }
        above.forEach(put)
        above = []
        if (block.kind === "project") put(block)
        else
          for (const entry of block.rows)
            items.push({
              kind: "card",
              key: itemKey(entry.row),
              ...at,
              block: block.key,
              stand: block.stand,
              entry,
            })
        break
      }
      case "more":
        put(block)
        break
    }
  return items
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
