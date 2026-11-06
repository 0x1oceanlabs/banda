/**
 * The sidebar's order of its rows, as `project:thing` keys, which `Alt+U`
 * walks (ADR 0079, decision 4). It is worked out as the sidebar arranges,
 * with no filter nor fold, so it holds while the sidebar is hidden; and
 * only when asked, on the key.
 */
import type { ProjectSummary } from "@banda/contract"
import { DEFAULT_SIDEBAR } from "@banda/contract/sidebar"
import { currentLook } from "@banda/ui/lib/look"
import type { Lists } from "@banda/ui/pane"
import { arrange } from "./arrange"
import { rowKey } from "./hold"
import type { Snoozes } from "./snoozed"

export function sidebarOrder(
  lists: Lists,
  projects: readonly ProjectSummary[],
  { archived, asleep, woke }: Snoozes
): string[] {
  const settings = currentLook()?.sidebar ?? DEFAULT_SIDEBAR
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
