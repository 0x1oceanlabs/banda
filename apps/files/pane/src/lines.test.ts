import { expect, test } from "vitest"
import { lineCount, lineIn, rangeText, startOf } from "./lines"

test("a last line break ends a line, it does not start one", () => {
  expect(lineCount("")).toBe(1)
  expect(lineCount("one")).toBe(1)
  expect(lineCount("one\ntwo\n")).toBe(2)
  expect(lineCount("one\ntwo\n\n")).toBe(3)
})

test("the line a file opens at is within it", () => {
  expect(lineIn(12, 40)).toBe(12)
  expect(lineIn(99, 40)).toBe(40)
  expect(lineIn(0, 40)).toBe(1)
  expect(lineIn(-3, 40)).toBe(1)
  expect(lineIn(2.7, 40)).toBe(2)
  expect(lineIn(null, 40)).toBeNull()
  expect(lineIn(undefined, 40)).toBeNull()
  expect(lineIn(Number.NaN, 40)).toBeNull()
})

test("a long file is drawn to its last line that fits, and says it was cut", () => {
  expect(startOf("a\nb\nc\n", 3)).toEqual({ text: "a\nb\nc\n", cut: false })
  expect(startOf("a\nb\nc", 3)).toEqual({ text: "a\nb\nc", cut: false })
  expect(startOf("a\nb\nc\nd\n", 3)).toEqual({ text: "a\nb\nc\n", cut: true })
  expect(startOf("a\nb\nc\nd", 2)).toEqual({ text: "a\nb\n", cut: true })
})

test("picked lines read as a compiler writes them, either way they were dragged", () => {
  expect(rangeText("src/a.ts", { start: 12, end: 12 })).toBe("src/a.ts:12")
  expect(rangeText("src/a.ts", { start: 12, end: 20 })).toBe("src/a.ts:12-20")
  expect(rangeText("src/a.ts", { start: 20, end: 12 })).toBe("src/a.ts:12-20")
})
