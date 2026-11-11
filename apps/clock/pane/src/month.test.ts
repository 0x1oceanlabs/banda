import { expect, test } from "vitest"
import {
  dayTitle,
  firstDay,
  isoWeek,
  monthTitle,
  said,
  sameDay,
  shifted,
  today,
  weekdays,
  weeksOf,
} from "./month"

const days = (week: { days: { day: { date: number } }[] }) =>
  week.days.map(({ day }) => day.date)

test("November 2026 from Monday: six weeks, 26 October to 6 December, numbered 44 to 49", () => {
  const weeks = weeksOf({ year: 2026, month: 10 }, 1)
  expect(weeks.map((week) => week.number)).toEqual([44, 45, 46, 47, 48, 49])
  expect(days(weeks[0]!)).toEqual([26, 27, 28, 29, 30, 31, 1])
  expect(days(weeks[5]!)).toEqual([30, 1, 2, 3, 4, 5, 6])
  expect(weeks[0]!.days.map(({ out }) => out)).toEqual([
    ...Array(6).fill(true),
    false,
  ])
})

test("from Sunday, the same month starts on its first and has five weeks", () => {
  const weeks = weeksOf({ year: 2026, month: 10 }, 0)
  expect(weeks).toHaveLength(5)
  expect(days(weeks[0]!)).toEqual([1, 2, 3, 4, 5, 6, 7])
  // Each row is the ISO week of its Thursday: 5 November is in week 45.
  expect(weeks[0]!.number).toBe(45)
})

test("a February that starts on a Monday and has 28 days fills four weeks", () => {
  const weeks = weeksOf({ year: 2027, month: 1 }, 1)
  expect(weeks).toHaveLength(4)
  expect(weeks.every((week) => week.days.every(({ out }) => !out))).toBe(true)
})

test("the ISO week at a year's turn belongs to the year of its Thursday", () => {
  expect(isoWeek({ year: 2026, month: 10, date: 11 })).toBe(46)
  expect(isoWeek({ year: 2027, month: 0, date: 1 })).toBe(53)
  expect(isoWeek({ year: 2024, month: 11, date: 30 })).toBe(1)
  expect(isoWeek({ year: 2026, month: 0, date: 1 })).toBe(1)
})

test("months shift across years", () => {
  expect(shifted({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
  expect(shifted({ year: 2026, month: 0 }, -1)).toEqual({
    year: 2025,
    month: 11,
  })
})

test("today is the day the time falls on here", () => {
  const at = new Date(2026, 10, 11, 14, 32).getTime()
  expect(sameDay(today(at), { year: 2026, month: 10, date: 11 })).toBe(true)
})

test("the week starts where the language says, on Monday where it cannot", () => {
  expect(firstDay("ru-RU")).toBe(1)
  expect(firstDay("en-US")).toBe(0)
  expect(firstDay("not a locale")).toBe(1)
})

test("the clock and the calendar speak the device's language", () => {
  const at = new Date(2026, 10, 11, 14, 32).getTime()
  // ICU's versions differ on a comma here and there.
  expect(said(at, "en-GB")).toEqual({
    day: expect.stringMatching(/^Wed,? 11 Nov$/),
    time: "14:32",
    whole: expect.stringMatching(/^Wednesday,? 11 November 2026$/),
  })
  expect(said(at, "ru-RU").time).toBe("14:32")
  expect(monthTitle({ year: 2026, month: 10 }, "en-GB")).toBe("November 2026")
  expect(weekdays(1, "en-GB")).toEqual([
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
    "Sun",
  ])
  expect(weekdays(0, "en-US")[0]).toBe("Sun")
  expect(dayTitle({ year: 2026, month: 10, date: 11 }, "en-GB")).toMatch(
    /^Wednesday,? 11 November$/
  )
})
