import { expect, test } from "vitest"
import { placeholder } from "./placeholder"

test("while a turn runs the composer steers the Thread", () => {
  expect(placeholder("Claude Code", true, true)).toBe("Steer this thread…")
  expect(placeholder("Claude Code", true, false)).toBe("Steer this thread…")
  expect(placeholder("Claude Code", true, true, "arc")).toBe(
    "Steer this thread…"
  )
})

test("else it says whom it writes to, and $ only once there are skills", () => {
  expect(placeholder("Fake AI", false, true)).toBe(
    "Write to Fake AI. @ files, / commands, $ skills"
  )
  expect(placeholder("Fake AI", false, false)).toBe(
    "Write to Fake AI. @ files, / commands"
  )
})

test("on another machine's Thread it names the machine too", () => {
  expect(placeholder("Personal", false, true, "arc")).toBe(
    "Write to Personal on arc. @ files, / commands, $ skills"
  )
  expect(placeholder("Fake AI", false, false, "Mac mini")).toBe(
    "Write to Fake AI on Mac mini. @ files, / commands"
  )
})
