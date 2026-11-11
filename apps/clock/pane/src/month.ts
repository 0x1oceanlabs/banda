/**
 * A month as a calendar shows it, and the words the clock says, by this
 * device's clock and its language (`Intl`): pure, so plain tests cover
 * them.
 */

/** A day of the calendar: its year, its month (0 to 11) and its date. */
export type Day = { year: number; month: number; date: number }

/** A month: its year and its month, 0 to 11. */
export type Month = { year: number; month: number }

/** A row of the month: its ISO week's number and its seven days, each
 * with whether it falls in the month shown. */
export type Week = { number: number; days: { day: Day; out: boolean }[] }

const dayOf = (at: Date): Day => ({
  year: at.getFullYear(),
  month: at.getMonth(),
  date: at.getDate(),
})

/** The day `at` (ms since the epoch) is, here. */
export const today = (at: number): Day => dayOf(new Date(at))

/** Whether `a` and `b` are the same day. */
export const sameDay = (a: Day, b: Day) =>
  a.year === b.year && a.month === b.month && a.date === b.date

/** The month `by` months after `month`; before it, for a negative `by`. */
export function shifted(month: Month, by: number): Month {
  const at = new Date(month.year, month.month + by, 1)
  return { year: at.getFullYear(), month: at.getMonth() }
}

/** The ISO 8601 week `day` falls in: weeks start on Monday, and the first
 * is the one with the year's first Thursday. */
export function isoWeek(day: Day): number {
  const at = new Date(Date.UTC(day.year, day.month, day.date))
  // The Thursday of its week, Monday first, says the week's year.
  const weekday = (at.getUTCDay() + 6) % 7
  at.setUTCDate(at.getUTCDate() - weekday + 3)
  const january4 = new Date(Date.UTC(at.getUTCFullYear(), 0, 4))
  const days = (at.getTime() - january4.getTime()) / 86_400_000
  return 1 + Math.round((days - 3 + ((january4.getUTCDay() + 6) % 7)) / 7)
}

/**
 * The weeks `month` spans, each from `first` (0 Sunday, 1 Monday, … 6
 * Saturday), with the days of the months beside it to fill them. Each
 * row is numbered by the ISO week of its Thursday, which each row of
 * seven days has one of.
 */
export function weeksOf(month: Month, first: number): Week[] {
  const start = new Date(month.year, month.month, 1)
  start.setDate(1 - ((start.getDay() - first + 7) % 7))
  const weeks: Week[] = []
  const at = new Date(start)
  do {
    const days: Week["days"] = []
    let thursday: Day | undefined
    for (let i = 0; i < 7; i++) {
      const day = dayOf(at)
      if (at.getDay() === 4) thursday = day
      days.push({ day, out: day.month !== month.month })
      at.setDate(at.getDate() + 1)
    }
    weeks.push({ number: isoWeek(thursday!), days })
  } while (at.getMonth() === month.month)
  return weeks
}

/** The day the week starts on where the device's language is spoken: 0
 * Sunday to 6 Saturday, Monday where `Intl` cannot say. */
export function firstDay(locale?: string): number {
  try {
    const known = new Intl.Locale(
      locale ?? new Intl.DateTimeFormat().resolvedOptions().locale
    ) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    // `Intl`'s days run 1 Monday to 7 Sunday.
    const day = (known.getWeekInfo?.() ?? known.weekInfo)?.firstDay
    return day === undefined ? 1 : day % 7
  } catch {
    return 1
  }
}

/** What the clock says on the bar, as the device's language says it: the
 * day, short, and the time, by the device's own hours. */
export function said(at: number, locale?: string) {
  return {
    day: new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(at),
    time: new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(at),
    whole: new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(at),
  }
}

/** A month's name and year, as a calendar's head says it. */
export const monthTitle = (month: Month, locale?: string) =>
  new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(month.year, month.month, 1)
  )

/** The names of the week's days, short, from `first`. */
export function weekdays(first: number, locale?: string): string[] {
  const named = new Intl.DateTimeFormat(locale, { weekday: "short" })
  // 4 January 1970 was a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    named.format(new Date(1970, 0, 4 + ((first + i) % 7)))
  )
}

/** A day as the calendar's foot says it: its weekday, date and month. */
export const dayTitle = (day: Day, locale?: string) =>
  new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(day.year, day.month, day.date))
