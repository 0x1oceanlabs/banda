/** Plain words a Pane shows. */
import { Lost, Refused } from "@banda/contract"

/** What went wrong with a call, for a Person to read. */
export function problem(error: unknown): string {
  if (error instanceof Refused) return error.refusal.message
  if (error instanceof Lost)
    return "Banda lost its engine for a moment. Try again."
  return "Something went wrong. Try again."
}

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** How long ago `at` (ms since the epoch) was, in a few letters. */
export function ago(at: number, now = Date.now()): string {
  const passed = Math.max(0, now - at)
  if (passed < MINUTE) return "now"
  if (passed < HOUR) return `${Math.floor(passed / MINUTE)}m`
  if (passed < DAY) return `${Math.floor(passed / HOUR)}h`
  if (passed < 7 * DAY) return `${Math.floor(passed / DAY)}d`
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

/**
 * When `at` (ms since the epoch) was, as a clock reads it: the hour today,
 * the weekday too within a week, the date before that.
 */
export function clock(at: number, now = Date.now()): string {
  const when = new Date(at)
  const today = new Date(now).toDateString() === when.toDateString()
  const week = Math.abs(now - at) < 6 * DAY
  return new Intl.DateTimeFormat(undefined, {
    ...(today
      ? {}
      : week
        ? { weekday: "short" }
        : { month: "short", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(when)
}

/** `at` in full, for a tooltip. */
export function fullDate(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  }).format(at)
}

/** How long `ms` took: "12s", "1m 05s", "2h 03m". */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const pad = (n: number) => String(n).padStart(2, "0")
  if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s`
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`
}
