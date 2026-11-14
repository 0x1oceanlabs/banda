/** Plain words a Pane shows. */
import { dayOf } from "@banda/core"
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

/** The steps a card's time takes past "now", its whole first minute
 * (ADR 0098, decision 8, as amended): under each bound it counts whole
 * `unit`s, short by its letter, in full by its word. */
const STEPS = [
  { below: HOUR, unit: MINUTE, letter: "m", word: "minute" },
  { below: DAY, unit: HOUR, letter: "h", word: "hour" },
  { below: 7 * DAY, unit: DAY, letter: "d", word: "day" },
] as const

/** How long ago a moment was, by a card's steps: "now" or a count of
 * one step; past a week, a date. */
export type Ago =
  | { kind: "now" }
  | { kind: "count"; count: number; letter: string; word: string }
  | { kind: "date"; thisYear: boolean }

/** How long ago `at` was at `now`, by a card's steps. A moment yet to
 * come, by another machine's clock, is "now". */
export function agoOf(at: number, now: number): Ago {
  const passed = Math.max(0, now - at)
  if (passed < MINUTE) return { kind: "now" }
  for (const { below, unit, letter, word } of STEPS)
    if (passed < below)
      return { kind: "count", count: Math.floor(passed / unit), letter, word }
  const thisYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  return { kind: "date", thisYear }
}

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
 * says it (ADR 0098, decision 8, as amended): "now" for the whole first
 * minute, then by minutes, hours and days, so a label changes seldom and
 * once a minute is often enough to draw it; past a week, the day, and its
 * year when that was another: "14m", "2h", "3d", "Mar 3", "Mar 2025".
 * In English, as all of Banda's words are.
 */
export function short(at: number, now = Date.now()): string {
  const ago = agoOf(at, now)
  switch (ago.kind) {
    case "now":
      return "now"
    case "count":
      return `${ago.count}${ago.letter}`
    case "date":
      return (ago.thisYear ? THIS_YEAR : OTHER_YEAR).format(at)
  }
}

/** How long ago `at` (ms since the epoch) was, in a few letters, as
 * `short` says it, "now" for the whole first minute. */
export const ago = short

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

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" })

/** `at`'s hour and minute on 24 hours, with no leading zero: "18:30",
 * "9:00". */
export function hourOf(at: number): string {
  const when = new Date(at)
  return `${when.getHours()}:${String(when.getMinutes()).padStart(2, "0")}`
}

/** `at`'s day, past this week: "Mar 3". */
export function monthDay(at: number): string {
  return THIS_YEAR.format(at)
}

/**
 * When something put off wakes, as a card says it (ADR 0098, decision 8):
 * its hour today, "18:30"; its weekday too within the week, "Tue 9:00";
 * further, its day, "Mar 3". On 24 hours and in English whatever the
 * system's, so it stays as short as a card's right has room for.
 */
export function wakes(at: number, now = Date.now()): string {
  const on = dayOf(at, now)
  if (on === "date") return monthDay(at)
  return on === "today" ? hourOf(at) : `${WEEKDAY.format(at)} ${hourOf(at)}`
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
