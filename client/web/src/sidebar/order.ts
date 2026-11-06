/**
 * The sidebar's order of its rows, as `project:thing` keys, which `Alt+U`
 * walks (ADR 0079, decision 4). It is worked out as the sidebar arranges,
 * with no filter nor fold, so it holds while the sidebar is hidden.
 */
import type { ProjectSummary } from "@banda/contract"
import type { Lists } from "@banda/ui/pane"
import { useMemo } from "react"
import { useLookSidebar } from "../look"
import { arrange } from "./arrange"
import { useIsArchived } from "./archived"
import { useSnoozes } from "./snoozed"

export function useSidebarOrder(
  lists: Lists,
  projects: readonly ProjectSummary[]
): readonly string[] {
  const settings = useLookSidebar()
  const archived = useIsArchived()
  const { asleep, woke } = useSnoozes(lists)
  return useMemo(() => {
    const { sections, shelves } = arrange(
      lists,
      projects,
      settings,
      undefined,
      undefined,
      { archived, asleep, woke }
    )
    return [...sections, ...shelves].flatMap((section) =>
      section.rows.map((row) => `${row.project.id}:${row.listed.id}`)
    )
  }, [lists, projects, settings, archived, asleep, woke])
}
