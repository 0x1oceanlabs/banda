/**
 * The sidebar list's one clock (ADR 0098, decision 8; spec §2.5). A
 * card's times are short and still: "now", "40s", "14m", "2h", "3d", so
 * each changes seldom, and a card is drawn again only as one of its times
 * changes. One timer waits for the first of those moments across the
 * list. It is no animation frame, and it sleeps while the window is
 * hidden.
 */
import { useEffect, useState } from "react"
import { WEEK } from "@banda/core"
import { HOUR, nextShort } from "@banda/ui/lib/words"
import type { Time } from "./card"

/** When the words of a wake time `at` next change, after `now`: its hour
 * today, its weekday too within the week, a date before that, by the
 * local midnights and by the week's edge. */
export function nextClock(at: number, now: number): number {
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0)
  const edges = [at - WEEK, at + WEEK].filter((edge) => edge > now)
  return Math.min(midnight.getTime(), ...edges)
}

/** When `time`'s words next change after `now`; never for a Later that
 * keeps no time. */
export function nextOf(time: Time, now: number): number | undefined {
  switch (time.kind) {
    case "ago":
      return nextShort(time.at, now)
    case "wakes":
      return nextClock(time.at, now)
    case "someday":
    case "when done":
      return undefined
  }
}

/** When the first of `times` next changes after `now`. */
export function dueOf(times: readonly Time[], now: number): number | undefined {
  let due: number | undefined
  for (const time of times) {
    const next = nextOf(time, now)
    if (next !== undefined && (due === undefined || next < due)) due = next
  }
  return due
}

/** What the clock asks of the page: whether it is hidden, and to be told
 * when that changes. */
export type Page = {
  hidden: () => boolean
  onChange: (heard: () => void) => void
}

export type Clock = {
  /** Calls `wake` with the time then, once, as `at` comes; returns how to
   * stop waiting. */
  wakeAt: (at: number, wake: (now: number) => void) => () => void
}

/** The longest the timer waits at once: a far moment is waited for in
 * steps, so no delay overflows the timer. */
const LONGEST = HOUR

/** A clock of one timer for every card, which sleeps while `page` is
 * hidden and, shown again, wakes at once those whose moment passed. */
export function newClock(page?: Page): Clock {
  type Waiting = { at: number; wake: (now: number) => void }
  const waiting = new Set<Waiting>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const ring = () => {
    timer = undefined
    const now = Date.now()
    for (const one of [...waiting])
      if (one.at <= now) {
        waiting.delete(one)
        one.wake(now)
      }
    plan()
  }
  const plan = () => {
    clearTimeout(timer)
    timer = undefined
    if (waiting.size === 0 || page?.hidden()) return
    let first = Infinity
    for (const one of waiting) first = Math.min(first, one.at)
    timer = setTimeout(ring, Math.min(LONGEST, Math.max(0, first - Date.now())))
  }
  page?.onChange(() => (page.hidden() ? plan() : ring()))
  return {
    wakeAt(at, wake) {
      const one = { at, wake }
      waiting.add(one)
      plan()
      return () => {
        waiting.delete(one)
        if (waiting.size === 0) plan()
      }
    },
  }
}

/** The list's clock, on this page. */
const LIST: Clock = newClock(
  typeof document === "undefined"
    ? undefined
    : {
        hidden: () => document.hidden,
        onChange: (heard) =>
          document.addEventListener("visibilitychange", heard),
      }
)

/**
 * The time now, as a card reads it, drawn again only at the moment
 * `next(now)` names: when one of its times changes next.
 */
export function useClock(next: (now: number) => number | undefined): number {
  const [now, setNow] = useState(Date.now)
  const at = next(now)
  useEffect(
    () => (at === undefined ? undefined : LIST.wakeAt(at, setNow)),
    [at]
  )
  return now
}
