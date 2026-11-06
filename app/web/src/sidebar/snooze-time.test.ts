import { expect, test } from "vitest"
import { HOUR, MINUTE } from "@banda/ui/lib/words"
import { PRESETS, presets, whenOf } from "./snooze-time"

/** Thursday, 5 November 2026, 21:40, in the machine's own time. */
const NOW = new Date(2026, 10, 5, 21, 40).getTime()

/** The day `days` after NOW's, at `hour:minute`. */
const on = (days: number, hour: number, minute = 0) =>
  new Date(2026, 10, 5 + days, hour, minute).getTime()

test("a while from now, in English or Russian", () => {
  expect(whenOf("45m", NOW)).toBe(NOW + 45 * MINUTE)
  expect(whenOf("2h", NOW)).toBe(NOW + 2 * HOUR)
  expect(whenOf("in 2 hours", NOW)).toBe(NOW + 2 * HOUR)
  expect(whenOf("1.5h", NOW)).toBe(NOW + 90 * MINUTE)
  expect(whenOf("3d", NOW)).toBe(on(3, 21, 40))
  expect(whenOf("через 3 часа", NOW)).toBe(NOW + 3 * HOUR)
  expect(whenOf("20 мин", NOW)).toBe(NOW + 20 * MINUTE)
})

test("a time alone is today's, or tomorrow's once it has passed", () => {
  expect(whenOf("23:15", NOW)).toBe(on(0, 23, 15))
  expect(whenOf("18", NOW)).toBe(on(1, 18))
  expect(whenOf("9.30", NOW)).toBe(on(1, 9, 30))
})

test("a day, at nine unless it says when", () => {
  expect(whenOf("tomorrow", NOW)).toBe(on(1, 9))
  expect(whenOf("tomorrow 10", NOW)).toBe(on(1, 10))
  expect(whenOf("завтра в 10:30", NOW)).toBe(on(1, 10, 30))
  expect(whenOf("fri", NOW)).toBe(on(1, 9))
  expect(whenOf("пт 14", NOW)).toBe(on(1, 14))
  expect(whenOf("friday at 9", NOW)).toBe(on(1, 9))
  expect(whenOf("thu", NOW), "a week on, today being Thursday").toBe(on(7, 9))
  expect(whenOf("next week", NOW)).toBe(on(4, 9))
  expect(whenOf("today 23", NOW)).toBe(on(0, 23))
  expect(whenOf("thu 23", NOW), "today's weekday, still to come").toBe(
    on(0, 23)
  )
})

test("no time to come, or nothing it can read, is none", () => {
  for (const text of ["", "soon", "25:00", "today 9", "0h", "fri 99"])
    expect(whenOf(text, NOW), text).toBeUndefined()
})

test("the presets leave out what passed today, in time order, named", () => {
  expect(presets(PRESETS, NOW)).toEqual([
    { label: "In 1 hour", at: NOW + HOUR },
    { label: "In 3 hours", at: NOW + 3 * HOUR },
    { label: "Tomorrow", at: on(1, 9) },
    { label: "Next week", at: on(4, 9) },
  ])
  const morning = on(1, 8)
  expect(presets(PRESETS, morning).map((one) => one.label)).toEqual([
    "In 1 hour",
    "In 3 hours",
    "This evening",
    "Tomorrow",
    "Next week",
  ])
})

test("two presets on one minute show once, and an unread one not at all", () => {
  const at = new Date(2026, 10, 5, 15, 0).getTime()
  const listed = presets(["3h", "18:00", "someday", "sat"], at)
  expect(listed).toEqual([
    { label: "In 3 hours", at: at + 3 * HOUR },
    { label: "Saturday", at: on(2, 9) },
  ])
  expect(presets(["thu 10"], NOW)[0].label).toBe("Next Thursday")
})
