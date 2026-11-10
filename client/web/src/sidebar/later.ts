/**
 * The Later clock (ADR 0074): when it moves next. The engine keeps the
 * Later and fires nothing at its time, so the window moves its clock as
 * the next one wakes, and reads where each Thread stands by it
 * (`status.ts`).
 */
import type { Lists } from "@banda/ui/pane"
import { asleep } from "@banda/ui/status"

/** When the first Thread of `lists` that sleeps at `now` wakes by its
 * time; none when none sleeps till a time. One until done and one put off
 * Someday keep no time, so no clock waits for them (ADR 0098, decision
 * 12). */
export function nextWake(lists: Lists, now: number): number | undefined {
  let next: number | undefined
  for (const listed of Object.values(lists).flat()) {
    const until = listed.later?.until
    if (until !== undefined && asleep(listed, now))
      next = Math.min(next ?? until, until)
  }
  return next
}

/** The longest a browser's timer waits, about 24 days. */
const LONGEST = 2 ** 31 - 1

/** How long a timer waits for the Later that wakes at `next`: a little
 * past it, so it has woken by then. */
export function wakeAfter(next: number): number {
  return Math.min(Math.max(0, next - Date.now()) + 50, LONGEST)
}
