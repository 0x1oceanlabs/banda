/**
 * What the bar's middle counts (ADR 0035): who waits for the Person and
 * who works, over every Project's list, as `[bar] counts` in `sidebar.toml`
 * says. Pure, so plain tests cover it.
 */
import type { ProjectId } from "@banda/contract"
import type { Count } from "@banda/contract/sidebar"
import { loudest, type MarkState, works } from "@banda/ui/components/banda-mark"
import type { Listed, Lists } from "@banda/ui/pane"
import {
  attentionOf,
  isAway,
  lookOf,
  type Stand,
  standOf,
  takes,
} from "@banda/ui/status"
import { byOrder } from "./order"

/** A Thread counted, with the Project it is in and where it stands. */
export type Counted = { project: ProjectId; listed: Listed; stand: Stand }

/** One count: the loudest look of what it counts, as the bar's Mark takes
 * it, and what that is. */
export type Tally = {
  count: Count
  mark: MarkState
  things: readonly Counted[]
}

/**
 * The counts in `counts`' order, each of what is not put away at `now`, as
 * `takes` in `status.ts` says it takes a Thread; a count of none is left
 * out.
 */
export function tally(
  lists: Lists,
  counts: readonly Count[],
  now: number
): Tally[] {
  const all = Object.entries(lists).flatMap(([project, listed]) =>
    listed.flatMap((one) => {
      const stand = standOf(one, now)
      return isAway(stand)
        ? []
        : [{ project: project as ProjectId, listed: one, stand }]
    })
  )
  return counts.flatMap((count) => {
    const things = all.filter(({ stand, listed }) =>
      takes(count, stand, listed.mark)
    )
    if (things.length === 0) return []
    const mark = loudest(things.map((t) => lookOf(t.listed, now).look))
    return [{ count, mark, things }]
  })
}

/**
 * Whether nothing waits for the Person and nothing works at `now`, over
 * every list: what the calm square says. Not so while a Thread no count
 * takes calls or works, as one that woke by itself, which only "waiting"
 * counts (`banda status` alike).
 */
export function calm(lists: Lists, now: number): boolean {
  const { mark, waiting } = attentionOf(lists, now)
  return waiting === 0 && !works(mark)
}

/** A counted thing's `project:thing` key, as `rowKey` says its row's. */
export const countedKey = ({ project, listed }: Counted): string =>
  `${project}:${listed.id}`

/**
 * What waits for the Person, then what works, as their list shows it:
 * each in the sidebar's `order` of `project:thing` keys, the one order of
 * what calls, which Alt+U walks (ADR 0087, decision 8). A thing the
 * sidebar lists nowhere comes last, the one that changed first first, as
 * Alt+U takes it (`byOrder`).
 */
export function inOrder(
  tallies: readonly Tally[],
  order: readonly string[]
): {
  waiting: Counted[]
  working: Counted[]
} {
  const seen = new Map<string, Counted>()
  for (const { things } of tallies)
    for (const thing of things) seen.set(countedKey(thing), thing)
  const sorted = byOrder(
    [...seen.values()],
    order,
    countedKey,
    (a, b) => a.listed.changed - b.listed.changed
  )
  return {
    waiting: sorted.filter((t) => t.stand !== "working"),
    working: sorted.filter((t) => t.stand === "working"),
  }
}
