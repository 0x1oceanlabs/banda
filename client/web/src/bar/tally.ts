/**
 * What the bar's middle counts (ADR 0035): who waits for the Person and
 * who works, over every Project's list, as `[bar] counts` in `sidebar.toml`
 * says. Pure, so plain tests cover it.
 */
import type { ProjectId } from "@banda/contract"
import type { Count } from "@banda/contract/sidebar"
import {
  callOrder,
  loudest,
  type MarkState,
  waits,
  works,
} from "@banda/ui/components/banda-mark"
import type { Listed, Lists } from "@banda/ui/pane"

/** A Thread counted, with the Project it is in. */
export type Counted = { project: ProjectId; listed: Listed }

/** One count: the loudest mark of what it counts, and what that is. */
export type Tally = {
  count: Count
  mark: MarkState
  things: readonly Counted[]
}

/** Which marks each count takes: what waits, split or whole, or works. */
const TAKES: Record<Count, (mark: MarkState) => boolean> = {
  asking: (mark) => waits(mark) && mark !== "done",
  done: (mark) => mark === "done",
  waiting: waits,
  working: works,
}

/**
 * The counts in `counts`' order, each of what is not `archived`; a count of
 * none is left out.
 */
export function tally(
  lists: Lists,
  counts: readonly Count[],
  archived: (listed: Listed) => boolean
): Tally[] {
  const all = Object.entries(lists).flatMap(([project, listed]) =>
    listed
      .filter((one) => !archived(one))
      .map((one) => ({ project: project as ProjectId, listed: one }))
  )
  return counts.flatMap((count) => {
    const things = all.filter(({ listed }) => TAKES[count](listed.mark))
    if (things.length === 0) return []
    return [{ count, mark: loudest(things.map((t) => t.listed.mark)), things }]
  })
}

/**
 * What waits for the Person, then what works, as their list shows it: in
 * the order calls are answered, as Alt+U goes.
 */
export function inOrder(tallies: readonly Tally[]): {
  waiting: Counted[]
  working: Counted[]
} {
  const seen = new Map<string, Counted>()
  for (const { things } of tallies)
    for (const thing of things) seen.set(thing.listed.id, thing)
  const sorted = [...seen.values()].sort(
    callOrder(
      (t) => t.listed.mark,
      (t) => t.listed.changed
    )
  )
  return {
    waiting: sorted.filter((t) => !works(t.listed.mark)),
    working: sorted.filter((t) => works(t.listed.mark)),
  }
}
