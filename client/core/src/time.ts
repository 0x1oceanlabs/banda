/** Time as the Window reads it: its words, and a clock to draw by. */
import type { Readable } from "./store"

/** How far off `dayOf` still calls a day this week's. */
export const WEEK = 6 * 24 * 60 * 60_000

/** Which day `at` is on, from `now`'s: today, within the week, or
 * further. */
export function dayOf(at: number, now: number): "today" | "week" | "date" {
  if (new Date(now).toDateString() === new Date(at).toDateString())
    return "today"
  return Math.abs(now - at) < WEEK ? "week" : "date"
}

/**
 * When `at` (ms since the epoch) was, as a clock reads it here: the hour
 * today, the weekday too within a week, the date before that. By the
 * system's own hours, or by 24 where words have no room for "PM".
 */
export function clock(
  at: number,
  now = Date.now(),
  { hours }: { hours?: 24 } = {}
): string {
  const on = dayOf(at, now)
  return new Intl.DateTimeFormat(undefined, {
    ...(on === "today"
      ? {}
      : on === "week"
        ? { weekday: "short" }
        : { month: "short", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    ...(hours === 24 && { hourCycle: "h23" }),
  }).format(at)
}

/**
 * A clock to draw by: the time in ms, read again `every` ms while anything
 * listens, and the time now while nothing does. Its owner makes it, one
 * per Window (ADR 0089, decision 5).
 */
export function tickingClock(every: number): Readable<number> {
  let now = Date.now()
  const heard = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | undefined
  const tick = () => {
    now = Date.now()
    for (const hear of [...heard]) hear()
  }
  return {
    get: () => (heard.size === 0 ? Date.now() : now),
    subscribe: (listener) => {
      if (heard.size === 0) {
        now = Date.now()
        timer = setInterval(tick, every)
      }
      heard.add(listener)
      return () => {
        heard.delete(listener)
        if (heard.size === 0) clearInterval(timer)
      }
    },
  }
}
