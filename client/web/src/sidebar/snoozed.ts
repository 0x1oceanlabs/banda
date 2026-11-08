/**
 * How the sidebar reads a Thread's snooze (ADR 0074). The engine keeps the
 * snooze; whether the Thread sleeps now is worked out here, against the
 * clock, and whether its Person has seen it wake is this window's mark, as
 * "seen" is (ADR 0005, decision 8).
 */
import { useEffect, useMemo } from "react"
import { kept } from "@banda/ui/lib/kept"
import type { ProjectId } from "@banda/contract"
import type { HereStore } from "@banda/ui/here"
import type { Readable } from "@banda/ui/lib/store"
import type { Args } from "@banda/ui/module"
import { asleep, type Listed, type Lists, wokeOf } from "@banda/ui/pane"
import { useIsArchived } from "./archived"

/** When `listed` woke from its snooze by itself, at `now`, if it did. */
export function wokeAt(listed: Listed, now: number): number | undefined {
  return wokeOf(listed.snooze, now)
}

/** Which snooze's waking the Person has seen, by Thread: the moment it
 * was snoozed. */
const seen = kept(
  "banda.sidebar.woke-seen",
  (at): at is number => typeof at === "number"
)

/** Keeps that the Person has seen `listed` wake, as they open it or look
 * at it. One that sleeps still will wake. */
export function seeWoke(listed: Listed) {
  const at = listed.snooze?.at
  if (at === undefined || wokeAt(listed, Date.now()) === undefined) return
  if (seen.read()[listed.id] !== at) seen.put(listed.id, at)
}

/** Sees the waking of the Thread the Pane in focus shows, as Here says
 * it: now, as the focus moves, and as it wakes while looked at. */
export function useSeeWoke(here: HereStore, items: Readable<Lists>): void {
  useEffect(() => {
    const see = () => {
      const { pane } = here.get()
      const listed =
        pane?.subject &&
        items.get()[pane.project]?.find((one) => one.id === pane.subject)
      if (listed) seeWoke(listed)
    }
    see()
    const stops = [here.subscribe(see), items.subscribe(see)]
    return () => {
      for (const stop of stops) stop()
    }
  }, [here, items])
}

/** When the first Thread of `lists` that sleeps at `now` wakes by its
 * time; none when none sleeps till a time. */
export function nextWake(lists: Lists, now: number): number | undefined {
  let next: number | undefined
  for (const listed of Object.values(lists).flat()) {
    const until = listed.snooze?.until
    if (until !== undefined && asleep(listed, now))
      next = Math.min(next ?? until, until)
  }
  return next
}

/** The longest a browser's timer waits, about 24 days. */
const LONGEST = 2 ** 31 - 1

/** How long a timer waits for the snooze that wakes at `next`: a little
 * past it, so it has woken by then. */
export function wakeAfter(next: number): number {
  return Math.min(Math.max(0, next - Date.now()) + 50, LONGEST)
}

/** What the sidebar knows of snoozes now, kept current. */
export type Snoozes = {
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

/** The snoozes read against `now`: the calls store's clock, which moves
 * only as the next of them wakes by its time, so nothing ticks while none
 * sleeps (`followCalls`). */
export function useSnoozesAt(now: number): Snoozes {
  const acked = seen.use()
  const archived = useIsArchived()
  return useMemo(
    () => ({
      now,
      asleep: (listed) => asleep(listed, now),
      woke: (listed) =>
        acked[listed.id] === listed.snooze?.at
          ? undefined
          : wokeAt(listed, now),
      away: (listed) => asleep(listed, now) || archived(listed),
      archived,
    }),
    [now, acked, archived]
  )
}

/** What the notifications module tells of a Thread that woke by itself
 * with nothing that calls (ADR 0074, decision 7): one that calls is told
 * of by its call. Its button opens it. */
export function wokeTold(project: ProjectId, listed: Listed): Args {
  const { id: about, title, pane } = listed
  return {
    key: `woke:${project}:${about}`,
    kind: "done",
    title,
    body: "Woke from its snooze",
    in: project,
    about,
    buttons: [
      {
        label: "Open",
        // The notifications module's GO_TO: the window names a module's
        // action by its id, not its package.
        action: "notifications.go-to",
        args: { project, about, pane },
      },
    ],
  }
}
