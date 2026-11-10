/** Plain words a Pane shows. */
import { Lost, Refused, Unreachable } from "@banda/contract"

/**
 * What went wrong with an act, for a Person to read. `what` names the act,
 * as its button says it ("Stop") or as the Person would ("your answer").
 * A machine the Window does not reach is named (ADR 0095, decision 7), in
 * the words its pill says: "arc is away: Stop was not sent."; one that
 * went as the act was on its way, "arc went away; Stop may have gone
 * through." (ADR 0082, decision 16). This machine's engine lost for a
 * moment, as it restarts, says so the same way (ADR 0106, law 4).
 */
export function problem(error: unknown, what?: string): string {
  if (error instanceof Refused) return error.refusal.message
  if (error instanceof Unreachable) return unreachable(error, what)
  if (error instanceof Lost)
    return error.may_have_run
      ? `Banda lost its engine for a moment; ${what ?? "it"} may have gone through.`
      : "Banda lost its engine for a moment. Try again."
  return "Something went wrong. Try again."
}

function unreachable(
  { message, machine, may_have_run }: Unreachable,
  what: string | undefined
): string {
  if (may_have_run)
    return `${machine} went away; ${what ?? "it"} may have gone through.`
  const sent = what === undefined ? "nothing was sent" : `${what} was not sent`
  return `${message}: ${sent}.`
}

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** A card's seconds go by tens of them; under the first ten, a moment
 * just passed reads "now". */
const TEN_SECONDS = 10_000

/** A card's day past a week, and its month and year past this year's.
 * Made once: a formatter with options is built anew on each call. */
const THIS_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
})
const OTHER_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
})

/**
 * How long ago `at` (ms since the epoch) was, short and still, as a card
 * says it (ADR 0098, decision 8): "now", then by tens of seconds, minutes,
 * hours and days, so a label changes seldom; past a week, the day, and its
 * year when that was another: "40s", "14m", "2h", "3d", "Mar 3",
 * "Mar 2025". In English, as all of Banda's words are.
 */
export function short(at: number, now = Date.now()): string {
  const passed = Math.max(0, now - at)
  if (passed < TEN_SECONDS) return "now"
  if (passed < MINUTE) return `${Math.floor(passed / TEN_SECONDS) * 10}s`
  if (passed < HOUR) return `${Math.floor(passed / MINUTE)}m`
  if (passed < DAY) return `${Math.floor(passed / HOUR)}h`
  if (passed < 7 * DAY) return `${Math.floor(passed / DAY)}d`
  const thisYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  return (thisYear ? THIS_YEAR : OTHER_YEAR).format(at)
}

/** How long ago `at` (ms since the epoch) was, in a few letters: as
 * `short` says it, but "now" for the whole first minute, where no one
 * counts the seconds. */
export function ago(at: number, now = Date.now()): string {
  return now - at < MINUTE ? "now" : short(at, now)
}

/** How long until `at` (ms since the epoch), rounded up, in a few
 * letters: "45m", "3h", "2d". */
export function left(at: number, now = Date.now()): string {
  const rest = at - now
  if (rest <= 0) return "now"
  // Rounded up, a minute short of an hour reads as the hour.
  const minutes = Math.ceil(rest / MINUTE)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.ceil(rest / HOUR)
  if (hours < 24) return `${hours}h`
  return `${Math.ceil(rest / DAY)}d`
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
