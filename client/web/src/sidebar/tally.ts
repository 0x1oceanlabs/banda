/**
 * What the bar's middle counts (ADR 0035): who waits for the Person and
 * who works, over every Project's list, as `[bar] counts` in `sidebar.toml`
 * says. Pure, so plain tests cover it.
 */
import type { ProjectId } from "@banda/contract"
import type { Count } from "@banda/contract/sidebar"
import { loudest, type MarkState } from "@banda/ui/components/banda-mark"
import type { Listed, Lists } from "@banda/ui/pane"
import { isAway, type Stand, standOf } from "@banda/ui/status"
import { byOrder } from "./order"

/** A Thread counted, with the Project it is in and where it stands. */
export type Counted = { project: ProjectId; listed: Listed; stand: Stand }

/** One count: the loudest mark of what it counts, and what that is. */
export type Tally = {
  count: Count
  mark: MarkState
  things: readonly Counted[]
}

/** Which Threads each count takes, by where they stand (`status.ts`):
 * the Person's turn, whole or by what asks or failed and what is done,
 * or what works. */
const TAKES: Record<Count, (stand: Stand, listed: Listed) => boolean> = {
  asking: (stand, { mark }) =>
    stand === "turn" && (mark === "asking" || mark === "failed"),
  done: (stand, { mark }) => stand === "turn" && mark === "done",
  waiting: (stand) => stand === "turn",
  working: (stand) => stand === "working",
}

/**
 * The counts in `counts`' order, each of what is not put away at `now`; a
 * count of none is left out.
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
      TAKES[count](stand, listed)
    )
    if (things.length === 0) return []
    return [{ count, mark: loudest(things.map((t) => t.listed.mark)), things }]
  })
}

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
  const key = ({ project, listed }: Counted) => `${project}:${listed.id}`
  const seen = new Map<string, Counted>()
  for (const { things } of tallies)
    for (const thing of things) seen.set(key(thing), thing)
  const sorted = byOrder(
    [...seen.values()],
    order,
    key,
    (a, b) => a.listed.changed - b.listed.changed
  )
  return {
    waiting: sorted.filter((t) => t.stand !== "working"),
    working: sorted.filter((t) => t.stand === "working"),
  }
}
