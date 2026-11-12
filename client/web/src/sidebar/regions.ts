/**
 * The blocks of the tab in view as the list draws them, gathered into the
 * regions a screen reader names and a test finds (ADR 0098, decisions
 * 3–5): each group's header with what follows it, on the other machine it
 * is on; else each place's cards with their heads, the divider above Open
 * and what a cut list leaves out, Your turn and Open together as the
 * Person's Threads; and inbox zero, or a tab with nothing in it, alone.
 * It gathers what `inbox.ts` laid out and moves nothing. Pure, so plain
 * tests cover it.
 */
import { NO_PROJECT } from "@banda/ui/lib/projects"
import { STAND_WORDS, type Stand } from "@banda/ui/status"
import type { Block } from "./inbox"

/** A group's header, when the list is grouped. */
export type GroupBlock = Extract<Block, { kind: "group" }>

/** One region of the list. */
export type Region = {
  /** What it is, which stays its own while the blocks in it come and go:
   * its place's, its group's, or its one block's. */
  key: string
  /** What it is called; none for inbox zero or an empty tab, which say
   * what they are in words. */
  label?: string
  /** Its header, when it is a group. */
  group?: GroupBlock
  /** The other machine whose Project's group it is, which goes under
   * that machine's label; a machine's own group names it itself. */
  host?: string
  blocks: Block[]
}

/** What each place's region is called: Your turn and Open are one, the
 * Threads that are the Person's. */
const PLACES: Readonly<Record<Stand, string>> = {
  turn: "Threads",
  open: "Threads",
  working: STAND_WORDS.working,
  later: STAND_WORDS.later,
  archived: STAND_WORDS.archived,
}

/** What a group's header names: its Project, or its machine. */
function groupName(group: GroupBlock): string {
  if (group.by === "machine") return group.host ?? "This machine"
  return group.project?.name ?? NO_PROJECT
}

/** `blocks` in their regions, in their order. */
export function regionsOf(blocks: readonly Block[]): Region[] {
  const regions: Region[] = []
  // The heads and the divider above the cards they stand over.
  let above: Block[] = []
  for (const block of blocks) {
    const last = regions.at(-1)
    switch (block.kind) {
      case "zero":
      case "empty":
      case "titles-only":
        regions.push({ key: block.key, blocks: [block] })
        break
      case "group":
        regions.push({
          key: block.key,
          label: groupName(block),
          group: block,
          ...(block.by === "project" && block.host !== undefined
            ? { host: block.host }
            : {}),
          blocks: [],
        })
        break
      case "head":
      case "divider":
        if (last?.group) last.blocks.push(block)
        else above.push(block)
        break
      case "rows": {
        // Keyed by its place, not by its first block: the Person's
        // Threads stay the same region as Your turn empties, and Later as
        // its first day does, so the cards in it are not drawn anew.
        const label = PLACES[block.stand]
        if (last && (last.group || last.label === label))
          last.blocks.push(...above, block)
        else
          regions.push({
            key: `region:${label}`,
            label,
            blocks: [...above, block],
          })
        above = []
        break
      }
      case "more":
        last?.blocks.push(block)
        break
    }
  }
  return regions
}
