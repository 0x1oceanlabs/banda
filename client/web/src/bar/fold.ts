/**
 * How a Project's list is drawn from what every module's Watch says of it.
 * Pure, so plain tests cover it.
 */
import { MARK_ORDER } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"

/**
 * A Project's list as the sidebar draws it: what a module says of another's
 * Thread (`Listed.on`) goes on that Thread's row, the louder mark and its
 * call with it, and has no row of its own. Only that: a Thread another
 * Agent started has its own card, and its call never goes on its parent's
 * (ADR 0098, decision 24).
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
