import { expect, test } from "vitest"
import { clamped, planTitle } from "./messages"

test("a short message shows whole", () => {
  expect(clamped("hello")).toBe(false)
  expect(clamped(Array(8).fill("line").join("\n"))).toBe(false)
  expect(clamped("a".repeat(600))).toBe(false)
})

test("a message past 8 lines or 600 characters is clamped", () => {
  expect(clamped(Array(9).fill("line").join("\n"))).toBe(true)
  expect(clamped("a".repeat(601))).toBe(true)
})

test("a plan's title is its first line without markdown's marks", () => {
  expect(planTitle("\n# Fix the **login** bug\n\n1. Read")).toBe(
    "Fix the login bug"
  )
  expect(planTitle("- Read the notes")).toBe("Read the notes")
})
