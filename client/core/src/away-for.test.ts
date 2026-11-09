import { expect, test } from "vitest"
import { awayFor } from "./hosts"

const MINUTE = 60_000

test("away says for how long by the label's rule: nothing under a minute, then minutes, then hours", () => {
  expect(awayFor(0, 0)).toBeUndefined()
  expect(awayFor(0, MINUTE - 1)).toBeUndefined()
  expect(awayFor(0, MINUTE)).toBe("1 min")
  expect(awayFor(0, 12 * MINUTE + 59_000)).toBe("12 min")
  expect(awayFor(0, 59 * MINUTE + 59_999)).toBe("59 min")
  expect(awayFor(0, 60 * MINUTE)).toBe("1 h")
  expect(awayFor(0, 125 * MINUTE)).toBe("2 h")
  // Not known since when, as the label: just away.
  expect(awayFor(undefined, 125 * MINUTE)).toBeUndefined()
})
