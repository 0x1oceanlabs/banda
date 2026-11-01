import { expect, test } from "vitest"
import { steers } from "./follow-up"

test("Enter does what the window chose, and Ctrl+Enter the other", () => {
  expect(steers("steer", false)).toBe(true)
  expect(steers("steer", true)).toBe(false)
  expect(steers("queue", false)).toBe(false)
  expect(steers("queue", true)).toBe(true)
})
