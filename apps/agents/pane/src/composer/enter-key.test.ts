import { expect, test } from "vitest"
import { keyFor, steers } from "./enter-key"

test("Enter does what agents.toml says, and Ctrl+Enter the other", () => {
  expect(steers("steer", false)).toBe(true)
  expect(steers("steer", true)).toBe(false)
  expect(steers("queue", false)).toBe(false)
  expect(steers("queue", true)).toBe(true)
  expect(keyFor("queue", "steer")).toBe("Ctrl+Enter")
  expect(keyFor("queue", "queue")).toBe("Enter")
})
