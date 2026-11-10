import { expect, test } from "vitest"
import { Lost, Refused, Unreachable } from "@banda/contract"
import {
  ago,
  DAY,
  duration,
  HOUR,
  left,
  MINUTE,
  nextShort,
  problem,
  short,
  wakes,
} from "./words"

test("what went wrong reads as the Person can act on it; a machine out of reach by its words", () => {
  expect(problem(new Refused({ code: "conflict", message: "Taken" }))).toBe(
    "Taken"
  )
  expect(problem(new Lost())).toBe(
    "Banda lost its engine for a moment. Try again."
  )
  // An act on its way as this machine's engine went may have run there.
  expect(problem(new Lost({ may_have_run: true }), "Revert")).toBe(
    "Banda lost its engine for a moment; Revert may have gone through."
  )
  expect(problem(new Lost({ may_have_run: true }))).toBe(
    "Banda lost its engine for a moment; it may have gone through."
  )
  expect(problem(new Error("socket said no"))).toBe(
    "Something went wrong. Try again."
  )
  // A machine out of reach is named, as its pill names it, with the act
  // that was not sent, or that went as it went away.
  const away = new Unreachable("arc", "arc is away")
  expect(problem(away, "Stop")).toBe("arc is away: Stop was not sent.")
  expect(problem(away)).toBe("arc is away: nothing was sent.")
  const studio = new Unreachable("arc", "Banda is stopped on Studio", {
    machine: "Studio",
  })
  expect(problem(studio, "your answer")).toBe(
    "Banda is stopped on Studio: your answer was not sent."
  )
  expect(problem(studio.sent(), "Stop")).toBe(
    "Studio went away; Stop may have gone through."
  )
  expect(problem(away.sent())).toBe("arc went away; it may have gone through.")
})

test("a duration reads as a clock would", () => {
  expect(duration(12_400)).toBe("12s")
  expect(duration(65_000)).toBe("1m 05s")
  expect(duration(2 * 3600_000 + 3 * 60_000)).toBe("2h 03m")
})

test("what is left reads rounded up, a minute short of an hour as the hour", () => {
  const now = 1_000_000
  expect(left(now - 1, now)).toBe("now")
  expect(left(now + 30_000, now)).toBe("1m")
  expect(left(now + 45 * MINUTE, now)).toBe("45m")
  expect(left(now + HOUR - 30_000, now)).toBe("1h")
  expect(left(now + 3 * HOUR, now)).toBe("3h")
  expect(left(now + DAY - MINUTE, now)).toBe("1d")
  expect(left(now + 2 * DAY + 1, now)).toBe("3d")
})

test("a card's time is short and still: by tens of seconds, then minutes, hours, days, then the day", () => {
  // Local times, as the Person's clock reads them.
  const now = new Date(2026, 10, 10, 15, 0).getTime()
  const before = (ms: number) => short(now - ms, now)
  expect(before(0)).toBe("now")
  expect(before(9_999)).toBe("now")
  expect(before(10_000)).toBe("10s")
  expect(before(19_999)).toBe("10s")
  expect(before(59_000)).toBe("50s")
  expect(before(MINUTE)).toBe("1m")
  expect(before(HOUR - 1)).toBe("59m")
  expect(before(HOUR)).toBe("1h")
  expect(before(DAY - 1)).toBe("23h")
  expect(before(DAY)).toBe("1d")
  expect(before(7 * DAY - 1)).toBe("6d")
  expect(short(new Date(2026, 2, 3, 9, 0).getTime(), now)).toBe("Mar 3")
  expect(short(new Date(2025, 2, 3, 9, 0).getTime(), now)).toBe("Mar 2025")
  // A moment ahead of the clock, as another machine's may be, is now.
  expect(short(now + MINUTE, now)).toBe("now")
})

test("how long ago reads as a card's time, with the whole first minute now", () => {
  const now = new Date(2026, 10, 10, 15, 0).getTime()
  expect(ago(now - 40_000, now)).toBe("now")
  expect(ago(now - 14 * MINUTE, now)).toBe("14m")
  expect(ago(new Date(2025, 2, 3).getTime(), now)).toBe("Mar 2025")
})

test("a card's time next changes each 10 s in the first minute, each 60 s in the first hour, then each hour and each day", () => {
  const at = new Date(2026, 10, 10, 15, 0).getTime()
  const next = (passed: number) => nextShort(at, at + passed)! - at
  expect(next(0)).toBe(10_000)
  expect(next(9_999)).toBe(10_000)
  expect(next(10_000)).toBe(20_000)
  expect(next(45_000)).toBe(50_000)
  expect(next(59_000)).toBe(MINUTE)
  expect(next(MINUTE)).toBe(2 * MINUTE)
  expect(next(14 * MINUTE + 30_000)).toBe(15 * MINUTE)
  expect(next(HOUR - 1)).toBe(HOUR)
  expect(next(HOUR)).toBe(2 * HOUR)
  expect(next(5 * HOUR + 1)).toBe(6 * HOUR)
  expect(next(DAY)).toBe(2 * DAY)
  expect(next(6 * DAY + 1)).toBe(7 * DAY)
  // Its words change at that moment and not before.
  for (const passed of [0, 9_000, 30_000, 14 * MINUTE, 3 * HOUR, 2 * DAY]) {
    const now = at + passed
    const changes = nextShort(at, now)!
    expect(short(at, changes - 1)).toBe(short(at, now))
    expect(short(at, changes)).not.toBe(short(at, now))
  }
  // Past a week a date, which changes as the year turns; an earlier
  // year's never. A moment yet to come is now for 10 s past it.
  const now = at
  expect(nextShort(new Date(2026, 2, 3).getTime(), now)).toBe(
    new Date(2027, 0, 1).getTime()
  )
  expect(nextShort(new Date(2025, 2, 3).getTime(), now)).toBeUndefined()
  expect(nextShort(now + 5_000, now)).toBe(now + 15_000)
})

test("a wake time is on 24 hours and in English, whatever the system's: 18:30, Fri 9:00, Dec 3", () => {
  // Tuesday, 10 November 2026, 15:00 by the local clock.
  const now = new Date(2026, 10, 10, 15, 0).getTime()
  expect(wakes(new Date(2026, 10, 10, 18, 30).getTime(), now)).toBe("18:30")
  expect(wakes(new Date(2026, 10, 10, 9, 5).getTime(), now)).toBe("9:05")
  expect(wakes(new Date(2026, 10, 13, 9, 0).getTime(), now)).toBe("Fri 9:00")
  expect(wakes(new Date(2026, 11, 3, 9, 0).getTime(), now)).toBe("Dec 3")
})
