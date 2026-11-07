import { expect, test } from "vitest"
import { counts, type Line, lineDiff, parts } from "./diff"

const show = (diff: Line[]) =>
  diff.map(({ kind, text }) =>
    kind === "same" ? ` ${text}` : `${kind === "added" ? "+" : "-"}${text}`
  )

test("a change keeps the lines it did not touch", () => {
  const diff = lineDiff("one\ntwo\nthree\n", "one\n2\nthree\nfour\n")
  expect(show(diff)).toEqual([" one", "-two", "+2", " three", "+four"])
  expect(counts(diff)).toEqual({ added: 2, removed: 1 })
})

test("the fewest changes, when lines move around", () => {
  const diff = lineDiff("a\nb\nc\na\nb\nb\na", "c\nb\na\nb\na\nc")
  expect(counts(diff)).toEqual({ added: 2, removed: 3 })
  const after = diff.filter((l) => l.kind !== "removed").map((l) => l.text)
  const before = diff.filter((l) => l.kind !== "added").map((l) => l.text)
  expect(after).toEqual(["c", "b", "a", "b", "a", "c"])
  expect(before).toEqual(["a", "b", "c", "a", "b", "b", "a"])
})

test("a new file is all added", () => {
  expect(show(lineDiff(undefined, "x\ny"))).toEqual(["+x", "+y"])
  expect(show(lineDiff("x\n", ""))).toEqual(["-x"])
})

test("far from a change, unchanged lines become a gap", () => {
  const before = Array.from({ length: 20 }, (_, i) => `${i}`).join("\n")
  const after = before.replace("10", "ten")
  const shown = parts(lineDiff(before, after), 2)
  expect(shown[0]).toEqual({ kind: "gap", lines: 8 })
  expect(shown.at(-1)).toEqual({ kind: "gap", lines: 7 })
  expect(shown).toHaveLength(8)
})
