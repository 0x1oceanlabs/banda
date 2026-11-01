/**
 * What the bar's mark shows: the loudest of what every module's Watch says
 * every Space calls for, and how many things wait for the Person in all.
 * Pure, so plain tests cover it.
 */
import { loudest } from "@bandaso/ui/components/banda-mark"
import type { Attention } from "@bandaso/ui/pane"

export function combine(reports: Iterable<Attention>): Attention {
  const all = [...reports]
  return {
    mark: loudest(all.map((report) => report.mark)),
    waiting: all.reduce((sum, report) => sum + report.waiting, 0),
  }
}
