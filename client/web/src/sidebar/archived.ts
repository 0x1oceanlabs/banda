/**
 * Which Threads the Person archived (ADR 0069; ADR 0008, decision 4). The
 * Thread's host keeps the mark, beside the Later, and its App lists it
 * (`Listed.archived`), so a Thread archived on one machine is archived on
 * all (ADR 0096). Only the Person archives a Thread, and anything new in
 * it brings it back, as a reply brings a letter back in Gmail.
 */
import type { ProjectId } from "@banda/contract"
import { works } from "@banda/ui/components/banda-mark"
import type { Listed, Lists } from "@banda/ui/pane"

/** Whether the Person may archive `listed`: not at work, not asking. */
export function archivable(listed: Listed): boolean {
  return !works(listed.mark) && listed.mark !== "asking"
}

/** Whether `listed` is archived, as its App lists it from its host. */
export function isArchived(listed: Listed): boolean {
  return listed.archived === true
}

/** Whether a Thread is archived, for what is drawn. */
export function useIsArchived(): (listed: Listed) => boolean {
  return isArchived
}

/** Whether a Thread is archived now, as an act asks outside React. */
export function archivedNow(listed: Listed): boolean {
  return isArchived(listed)
}

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
  if (archivedNow(listed)) return false
  return archivable(listed) ? true : undefined
}
