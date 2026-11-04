import { expect, test } from "vitest"
import { placeholder } from "./placeholder"

test("while a turn runs the composer steers the Thread", () => {
  expect(placeholder("Claude Code", true, true)).toBe("Steer this thread…")
  expect(placeholder("Claude Code", true, false)).toBe("Steer this thread…")
})

test("else it says whom it writes to, and $ only once there are skills", () => {
  expect(placeholder("Fake AI", false, true)).toBe(
    "Write to Fake AI. @ files, / commands, $ skills"
  )
  expect(placeholder("Fake AI", false, false)).toBe(
    "Write to Fake AI. @ files, / commands"
  )
})
