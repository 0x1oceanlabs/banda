/**
 * Which Threads the Person archived (ADR 0069; ADR 0008, decision 4). The
 * Thread's host keeps the mark, beside the Later, and its App lists it
 * (`Listed.archived`), so a Thread archived on one machine is archived on
 * all (ADR 0096). Only the Person archives a Thread, and anything new in
 * it brings it back, as a reply brings a letter back in Gmail.
 */
import type { ProjectId } from "@banda/contract"
import type { Lists } from "@banda/ui/pane"
import { mayArchive } from "@banda/ui/status"

/**
 * What Alt+S makes the row of `project` that is `thing`: archived, or back
 * if it is archived now. Nothing when it can be neither, as a Thread at
 * work.
 */
export function toggled(
  lists: Lists,
  project: ProjectId,
  thing: string
): boolean | undefined {
  const listed = lists[project]?.find((row) => row.id === thing)
  if (!listed) return undefined
  if (listed.archived) return false
  return mayArchive(listed) ? true : undefined
}
