import { expect, test } from "vitest"
import { loudestChime, plays, QUIET_FOR } from "./sound"

test("calls that come together make the loudest sound", () => {
  expect(loudestChime([])).toBeUndefined()
  expect(loudestChime(["done", "failed", "asking"])).toBe("failed")
  expect(loudestChime(["done", "asking", "done"])).toBe("asking")
})

test("after a sound, only a louder call plays for a while", () => {
  expect(plays(undefined, "done", 0)).toBe(true)
  const last = { chime: "asking" as const, at: 1000 }
  expect(plays(last, "done", 1200)).toBe(false)
  expect(plays(last, "asking", 1200)).toBe(false)
  expect(plays(last, "failed", 1200)).toBe(true)
  expect(plays(last, "done", 1000 + QUIET_FOR)).toBe(true)
})
