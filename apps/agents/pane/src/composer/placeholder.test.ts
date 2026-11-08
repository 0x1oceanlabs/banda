import { expect, test } from "vitest"
import { heldWords, placeholder } from "./placeholder"

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

test("Send waits while another machine's engine is not open: connecting until the window has tried it, away after", () => {
  expect(heldWords("arc", "open", true)).toBeUndefined()
  expect(heldWords("arc", "open", false)).toBeUndefined()
  expect(heldWords("arc", "connecting", false)).toBe("Connecting to arc…")
  // Tried once, the engine connects again only once arc is back.
  for (const state of ["connecting", "lost", "refused"] as const)
    expect(heldWords("arc", state, true)).toBe(
      "arc is away. Send once it is back."
    )
  for (const state of ["lost", "refused"] as const)
    expect(heldWords("arc", state, false)).toBe(
      "arc is away. Send once it is back."
    )
})
