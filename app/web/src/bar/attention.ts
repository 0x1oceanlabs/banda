/**
 * What the bar's mark shows: the loudest of what every module's Watch says
 * every Space calls for, and how many things wait for the Person in all.
 * Pure, so plain tests cover it.
 */
import { loudest, MARK_ORDER } from "@banda/ui/components/banda-mark"
import type { Attention, Listed } from "@banda/ui/pane"

export function combine(reports: Iterable<Attention>): Attention {
  const all = [...reports]
  return {
    mark: loudest(all.map((report) => report.mark)),
    waiting: all.reduce((sum, report) => sum + report.waiting, 0),
  }
}

/**
 * A Space's list as the sidebar draws it: what a module says of another's
 * Thread (`Listed.on`) goes on that Thread's row, the louder mark and its
 * call with it, and has no row of its own.
 */
export function folded(listed: readonly Listed[]): readonly Listed[] {
  const about = listed.filter((thing) => thing.on !== undefined)
  if (!about.length) return listed
  return listed
    .filter((thing) => thing.on === undefined)
    .map((thing) => {
      const louder = about
        .filter((each) => each.on === thing.agent)
        .reduce<Listed>(
          (loud, each) =>
            MARK_ORDER[each.mark] > MARK_ORDER[loud.mark] ? each : loud,
          thing
        )
      if (louder === thing) return thing
      return {
        ...thing,
        mark: louder.mark,
        changed: Math.max(thing.changed, louder.changed),
        ...(louder.calls !== undefined && { calls: louder.calls }),
      }
    })
}
