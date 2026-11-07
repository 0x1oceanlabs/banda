/** When a snoozed Thread sleeps (ADR 0074): pure, so a Thread's parts
 * read it without the Pane's API. */
import type { ListedSnooze } from "../pane"

/** Whether a Thread under `snooze` sleeps at `now`: nothing woke it, and
 * its time has not come (ADR 0074). */
export function sleeps(
  snooze: Pick<ListedSnooze, "until" | "woke"> | undefined,
  now: number
): boolean {
  if (!snooze || snooze.woke) return false
  return snooze.until === undefined || snooze.until > now
}
