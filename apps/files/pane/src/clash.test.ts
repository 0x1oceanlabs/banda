import { expect, test } from "vitest"
import { answered, asking, question } from "./clash"

const clashes = [
  { path: "in/a.txt", name: "a.txt", folder: false },
  { path: "in/b", name: "b", folder: true },
  { path: "in/c.txt", name: "c.txt", folder: false },
]

test("each clash is asked in turn, and the answers kept by path", () => {
  const first = answered(asking(clashes), "keep-both", false)
  if (!("next" in first)) throw new Error("all answered")
  expect(first.next.at).toBe(1)
  expect(question(first.next, "out")).toBe(
    "A folder named “b” is already in “out”."
  )
  const second = answered(first.next, "skip", false)
  if (!("next" in second)) throw new Error("all answered")
  expect(answered(second.next, "replace", false)).toEqual({
    answers: { "in/a.txt": "keep-both", "in/b": "skip", "in/c.txt": "replace" },
  })
})

test("for all answers the one shown and every one after it", () => {
  const first = answered(asking(clashes), "skip", false)
  if (!("next" in first)) throw new Error("all answered")
  expect(answered(first.next, "keep-both", true)).toEqual({
    answers: {
      "in/a.txt": "skip",
      "in/b": "keep-both",
      "in/c.txt": "keep-both",
    },
  })
  expect(question(asking(clashes), "out")).toBe(
    "An item named “a.txt” is already in “out”."
  )
})
