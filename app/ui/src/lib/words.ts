/** Plain words a Pane shows. */
import { Lost, Refused } from "@bandaso/contract"

/** What went wrong with a call, for a Person to read. */
export function problem(error: unknown): string {
  if (error instanceof Refused) return error.refusal.message
  if (error instanceof Lost)
    return "Bandaso lost its engine for a moment. Try again."
  return "Something went wrong. Try again."
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

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
