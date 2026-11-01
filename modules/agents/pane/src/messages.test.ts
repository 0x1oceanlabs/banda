import { expect, test } from "vitest"
import { clamped } from "./messages"

test("a short message shows whole", () => {
  expect(clamped("hello")).toBe(false)
  expect(clamped(Array(8).fill("line").join("\n"))).toBe(false)
  expect(clamped("a".repeat(600))).toBe(false)
})

test("a message past 8 lines or 600 characters is clamped", () => {
  expect(clamped(Array(9).fill("line").join("\n"))).toBe(true)
  expect(clamped("a".repeat(601))).toBe(true)
})
