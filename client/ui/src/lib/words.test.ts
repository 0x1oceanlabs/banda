import { expect, test } from "vitest"
import { Lost, Refused } from "@banda/contract"
import { Unreachable } from "@banda/core"
import { DAY, duration, HOUR, left, MINUTE, problem } from "./words"

test("what went wrong reads as the Person can act on it; a machine out of reach by its words", () => {
  expect(problem(new Refused({ code: "conflict", message: "Taken" }))).toBe(
    "Taken"
  )
  expect(problem(new Lost())).toBe(
    "Banda lost its engine for a moment. Try again."
  )
  expect(problem(new Unreachable("arc", "arc is away"))).toBe("arc is away")
  expect(problem(new Error("socket said no"))).toBe(
    "Something went wrong. Try again."
  )
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
