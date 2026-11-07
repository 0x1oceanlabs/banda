/**
 * The sidebar's order of its rows, as `project:thing` keys: the one order
 * of what calls, which `Alt+U` walks and the bar's counts list follows
 * (ADR 0079, decision 4; ADR 0087, decision 8). It is worked out as the
 * sidebar arranges, with no filter nor fold, so it holds while the
 * sidebar is hidden; and only when asked, on the key or as the counts'
 * list opens.
 */
import type { ProjectSummary } from "@banda/contract"
import { DEFAULT_SIDEBAR } from "@banda/contract/sidebar"
import { currentLook } from "@banda/ui/lib/look"
import type { Lists } from "@banda/ui/pane"
import { arrange } from "./arrange"
import { rowKey } from "./hold"
import type { Settings } from "./settings"
import type { Snoozes } from "./snoozed"

/** @param settings the look's, as the Person arranged the sidebar; a test
 * hands its own. */
export function sidebarOrder(
  lists: Lists,
  projects: readonly ProjectSummary[],
  { archived, asleep, woke }: Snoozes,
  settings: Settings = currentLook()?.sidebar ?? DEFAULT_SIDEBAR
): string[] {
  const { sections, shelves } = arrange(
    lists,
    projects,
    settings,
    undefined,
    undefined,
    { archived, asleep, woke }
  )
  return [...sections, ...shelves].flatMap((section) =>
    section.rows.map(rowKey)
  )
}

/** Where a `project:thing` key stands in `order`: one the sidebar lists
 * nowhere stands after them all. The counts' list and `Alt+U` place by
 * it alike. */
export function placeIn(order: readonly string[]): (key: string) => number {
  const place = new Map(order.map((key, i) => [key, i]))
  return (key) => place.get(key) ?? order.length
}
