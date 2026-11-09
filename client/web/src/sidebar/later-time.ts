/**
 * When a Later ends, in a Person's words (ADR 0074, decisions 5 and 9):
 * what the picker's field takes, and the presets, named as T3 Code names
 * them. Pure, so plain tests cover it.
 */
import { DAY, HOUR, MINUTE } from "@banda/ui/lib/words"

/** The longest a Later lasts: a year, as the engine takes it
 * (`platform/look/src/later.rs`). */
const LONGEST = 365 * DAY

/** One preset, as the picker lists it. */
export type Preset = { label: string; at: number }

/** What the field says, and when that is: a while from now, a time
 * alone, or a day and its time; Monday's too, for "Next week". */
type When =
  | { kind: "while"; at: number; after: number }
  | { kind: "time"; at: number; days: number }
  | { kind: "day"; at: number; days: number; monday: boolean }

const UNITS: ReadonlyArray<[RegExp, number]> = [
  [/^(m|mins?|minutes?|м|мин|минут[аы]?)$/, MINUTE],
  [/^(h|hrs?|hours?|ч|час(а|ов)?)$/, HOUR],
  [/^(d|days?|д|дн(я|ей)?|день)$/, DAY],
]

const WEEKDAYS: Readonly<Record<string, number>> = {
  sun: 0, sunday: 0, вс: 0, воскресенье: 0,
  mon: 1, monday: 1, пн: 1, понедельник: 1,
  tue: 2, tuesday: 2, вт: 2, вторник: 2,
  wed: 3, wednesday: 3, ср: 3, среда: 3, среду: 3,
  thu: 4, thursday: 4, чт: 4, четверг: 4,
  fri: 5, friday: 5, пт: 5, пятница: 5, пятницу: 5,
  sat: 6, saturday: 6, сб: 6, суббота: 6, субботу: 6,
} // prettier-ignore

const TODAY = new Set(["today", "сегодня"])
const TOMORROW = new Set(["tomorrow", "tmr", "завтра"])
const WEEK = new Set(["next week", "week", "через неделю", "неделя", "неделю"])

/** The day `days` after `now`'s, at `hour:minute`. */
function dayAt(now: number, days: number, hour: number, minute: number) {
  const at = new Date(now)
  at.setDate(at.getDate() + days)
  at.setHours(hour, minute, 0, 0)
  return at.getTime()
}

/** `9`, `9:30`, `18.30`: the hour and minute, or none. */
function timeOf(text: string): [number, number] | undefined {
  const found = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(text)
  if (!found) return undefined
  const [hour, minute] = [Number(found[1]), Number(found[2] ?? 0)]
  return hour < 24 && minute < 60 ? [hour, minute] : undefined
}

/** The days from `now` to `weekday`, today's too. */
function daysTo(weekday: number, now: number): number {
  return (weekday - new Date(now).getDay() + 7) % 7
}

/** The days from `now` to the day `word` names; none for no day. */
function dayOf(word: string, now: number): number | undefined {
  if (TODAY.has(word)) return 0
  if (TOMORROW.has(word)) return 1
  return word in WEEKDAYS ? daysTo(WEEKDAYS[word], now) : undefined
}

function read(text: string, now: number): When | undefined {
  const words = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^(in|через|в|до) /, "")
  if (!words) return undefined
  // A while: `45m`, `2 h`, `1.5d`, `3 часа`, up to a year.
  const span = /^(\d+(?:[.,]\d+)?) ?(\S+)$/.exec(words)
  const unit = span && UNITS.find(([unit]) => unit.test(span[2]))
  if (span && unit) {
    const after = Number(span[1].replace(",", ".")) * unit[1]
    return after > 0 && after <= LONGEST
      ? { kind: "while", at: now + after, after }
      : undefined
  }
  if (WEEK.has(words)) {
    const days = daysTo(1, now) || 7
    return { kind: "day", at: dayAt(now, days, 9, 0), days, monday: true }
  }
  // A time alone: today, or tomorrow once it has passed.
  const alone = timeOf(words)
  if (alone) {
    const days = dayAt(now, 0, ...alone) > now ? 0 : 1
    return { kind: "time", at: dayAt(now, days, ...alone), days }
  }
  // A day, and its time or nine o'clock: `fri`, `tomorrow 10`, `пт в 14`.
  const day = /^(\S+)(?: (?:at |в )?(\S+))?$/.exec(words)
  if (!day) return undefined
  const time: [number, number] | undefined =
    day[2] === undefined ? [9, 0] : timeOf(day[2])
  if (!time) return undefined
  let days = dayOf(day[1], now)
  if (days === undefined) return undefined
  const weekday = day[1] in WEEKDAYS
  // Today's weekday, its hour gone: the same day next week.
  if (dayAt(now, days, ...time) <= now) {
    if (!weekday) return undefined
    days = 7
  }
  const monday = weekday && WEEKDAYS[day[1]] === 1
  return { kind: "day", at: dayAt(now, days, ...time), days, monday }
}

/** When `text` says a Later ends, from `now`; none when it says no time
 * to come. */
export function whenOf(text: string, now: number): number | undefined {
  return read(text, now)?.at
}

/** `45 minutes`, `1 hour`, `3 hours`, `2 days`. */
function span(ms: number): string {
  const [n, unit] =
    ms % DAY === 0
      ? [ms / DAY, "day"]
      : ms % HOUR === 0
        ? [ms / HOUR, "hour"]
        : [Math.round(ms / MINUTE), "minute"]
  return `${n} ${unit}${n === 1 ? "" : "s"}`
}

/** A preset's name, as T3 Code's: "In 1 hour", "This evening",
 * "Tomorrow", "Next week", "Next Friday", "Saturday". */
function labelOf(when: When): string {
  if (when.kind === "while") return `In ${span(when.after)}`
  const date = new Date(when.at)
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" })
  if (when.days === 0) {
    const hour = date.getHours()
    return hour < 12
      ? "This morning"
      : hour < 17
        ? "This afternoon"
        : "This evening"
  }
  if (when.days === 1) return "Tomorrow"
  if (when.kind === "day" && when.monday) return "Next week"
  return when.days === 7 ? `Next ${weekday}` : weekday
}

/**
 * The presets `words` name, from `now`: one whose time passed today is
 * left out, two on the same minute show once, in time order. A word the
 * field cannot read is left out too.
 */
export function presets(words: readonly string[], now: number): Preset[] {
  const listed: Preset[] = []
  for (const word of words) {
    const when = read(word, now)
    // A time alone is today's: past, it is not tomorrow's preset.
    if (!when || (when.kind === "time" && when.days !== 0)) continue
    const minute = Math.floor(when.at / MINUTE)
    if (listed.some((one) => Math.floor(one.at / MINUTE) === minute)) continue
    listed.push({ label: labelOf(when), at: when.at })
  }
  return listed.sort((a, b) => a.at - b.at)
}
