import { expect, test } from "vitest"
import {
  clamped,
  firstLine,
  namesSubagent,
  piecesOf,
  planTitle,
} from "./messageText"

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
  expect(planTitle("2. Rename *old_name* in `card.ts`")).toBe(
    "Rename old_name in card.ts"
  )
  expect(planTitle("   ")).toBe("")
})

test("a report's first line loses the markup that starts it", () => {
  expect(firstLine("\n\n# Summary\nmore")).toBe("Summary")
  expect(firstLine("- **one** `two`")).toBe("one two")
  expect(firstLine("1. First")).toBe("First")
  expect(firstLine("   ")).toBeUndefined()
  expect(firstLine(undefined)).toBeUndefined()
})

test("a Person's message shows each sub-agent of its Thread it is about as a chip", () => {
  const known = new Set(["Reviewer", "Kim's notes"])
  const text =
    "(about sub-agent 'Reviewer') skip card.ts, and ask (about sub-agent 'Kim's notes').\n(about sub-agent 'Gone') stays"
  expect(namesSubagent(text)).toBe(true)
  expect(piecesOf(text, known)).toEqual([
    { about: "Reviewer" },
    { text: " skip card.ts, and ask " },
    { about: "Kim's notes" },
    { text: ".\n(about sub-agent 'Gone') stays" },
  ])
  // Words that name none stay one piece, and the bubble never an editor.
  expect(namesSubagent("about sub-agent Reviewer")).toBe(false)
  expect(piecesOf("just words", known)).toEqual([{ text: "just words" }])
  expect(piecesOf("", known)).toEqual([])
})
