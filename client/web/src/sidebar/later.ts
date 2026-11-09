/**
 * How the sidebar reads a Thread's Later (ADR 0074). The engine keeps the
 * Later, and what its Person saw of it waking beside it (ADR 0096);
 * whether the Thread sleeps now is worked out here, against the clock.
 */
import { useMemo } from "react"
import { wokeOf } from "@banda/ui/lib/later"
import { asleep, type Listed, type Lists } from "@banda/ui/pane"
import { useIsArchived } from "./archived"

/** When the first Thread of `lists` that sleeps at `now` wakes by its
 * time; none when none sleeps till a time. */
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

/** What the sidebar knows of Laters now, kept current. */
export type Laters = {
  /** The clock they are read by: it moves as the next one wakes. */
  now: number
  /** Whether a Thread sleeps. */
  asleep: (listed: Listed) => boolean
  /** When a Thread woke by itself, while its Person has not seen it. */
  woke: (listed: Listed) => number | undefined
  /** Whether a Thread is put away now, asleep or archived: what the bar's
   * counts leave out. */
  away: (listed: Listed) => boolean
  /** Whether the Person archived a Thread (ADR 0069). */
  archived: (listed: Listed) => boolean
}

/** The Laters read against `now`: the calls store's clock, which moves
 * only as the next of them wakes by its time, so nothing ticks while none
 * sleeps (`followCalls`). */
export function useLatersAt(now: number): Laters {
  const archived = useIsArchived()
  return useMemo(
    () => ({
      now,
      asleep: (listed) => asleep(listed, now),
      woke: (listed) =>
        listed.later?.wokeSeen ? undefined : wokeOf(listed.later, now),
      away: (listed) => asleep(listed, now) || archived(listed),
      archived,
    }),
    [now, archived]
  )
}
