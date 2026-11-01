import { expect, test } from "vitest"
import { recall } from "./history"

const sent = ["first", "second"]

test("↑ in an empty composer walks back, and ↓ walks back to empty", () => {
  expect(recall(sent, 0, "", true, false)).toEqual({ text: "second", back: 1 })
  expect(recall(sent, 1, "second", true, false)).toEqual({
    text: "first",
    back: 2,
  })
  // No further back than the first.
  expect(recall(sent, 2, "first", true, false)).toBeUndefined()
  expect(recall(sent, 1, "second", false, false)).toEqual({
    text: "",
    back: 0,
  })
  expect(recall(sent, 0, "", false, false)).toBeUndefined()
})

test("what the Person writes keeps the keys on the caret", () => {
  expect(recall(sent, 0, "my own", true, false)).toBeUndefined()
  expect(recall(sent, 1, "second, changed", true, false)).toBeUndefined()
  expect(recall([], 0, "", true, false)).toBeUndefined()
})

test("while a message waits, ↑ in an empty composer opens it to edit", () => {
  expect(recall(sent, 0, "", true, true)).toBe("edit")
  expect(recall(sent, 0, "my own", true, true)).toBeUndefined()
  // Down an earlier message, it still walks.
  expect(recall(sent, 1, "second", true, true)).toEqual({
    text: "first",
    back: 2,
  })
})
