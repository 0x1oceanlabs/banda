/**
 * How the sidebar reads a Thread's snooze (ADR 0074). The engine keeps the
 * snooze; whether the Thread sleeps now is worked out here, against the
 * clock, and whether its Person has seen it wake is this window's mark, as
 * "seen" is (ADR 0005, decision 8).
 */
import { useEffect, useMemo, useState } from "react"
import { kept } from "@banda/ui/lib/kept"
import type { ProjectId } from "@banda/contract"
import type { Args } from "@banda/ui/module"
import { asleep, type Listed, type Lists } from "@banda/ui/pane"
import { useIsArchived } from "./archived"

/** Whether the Person may snooze `listed`: it does not ask. */
export function snoozable(listed: Listed): boolean {
  return listed.mark !== "asking"
}

/** What a menu offers for `listed`: waking it while it sleeps, snoozing
 * it when it may be, or nothing. */
export function snoozeAct(
  listed: Listed,
  sleeps: boolean
): "snooze" | "wake" | undefined {
  return sleeps ? "wake" : snoozable(listed) ? "snooze" : undefined
}

/**
 * When `listed` woke from its snooze by itself, at `now`: its time came,
 * or what calls its Person woke it early. Nothing when it sleeps, or when
 * its Person woke it, by hand or by writing to it.
 */
export function wokeAt(listed: Listed, now: number): number | undefined {
  const { snooze } = listed
  if (!snooze) return undefined
  if (snooze.woke)
    return snooze.woke.by === "woken" || snooze.woke.by === "message"
      ? undefined
      : snooze.woke.at
  return snooze.until !== undefined && snooze.until <= now
    ? snooze.until
    : undefined
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
}

/**
 * The snoozes of `lists`, read against a clock that moves only when the
 * next of them wakes by its time: nothing ticks while none sleeps.
 */
export function useSnoozes(lists: Lists): Snoozes {
  const [now, setNow] = useState(Date.now)
  const next = nextWake(lists, now)
  useEffect(() => {
    if (next === undefined) return
    const wait = Math.min(Math.max(0, next - Date.now()) + 50, LONGEST)
    const timer = setTimeout(() => setNow(Date.now()), wait)
    return () => clearTimeout(timer)
  }, [next])
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
