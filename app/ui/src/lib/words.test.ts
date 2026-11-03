import { expect, test } from "vitest"
import { duration } from "./words"

test("a duration reads as a clock would", () => {
  expect(duration(12_400)).toBe("12s")
  expect(duration(65_000)).toBe("1m 05s")
  expect(duration(2 * 3600_000 + 3 * 60_000)).toBe("2h 03m")
})
