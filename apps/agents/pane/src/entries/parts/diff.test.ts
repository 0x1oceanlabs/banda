import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"
import { counts, type Line, lineDiff, parts } from "./diff"

/** `apps/agents/changed-lines.json`: how many lines a change of a file
 * added and removed. The engine's copy of the count, `counted()` in
 * changes.rs for a Thread's card, reads the same cases. */
const { cases, many } = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../../../changed-lines.json"),
    "utf8"
  )
) as {
  cases: {
    case: string
    before: string | null
    after: string
    added: number
    removed: number
  }[]
  many: { case: string; lines: number; added: number; removed: number }
}

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

test("the shared cases are there", () => {
  expect(cases.length).toBeGreaterThanOrEqual(8)
})

test.each(cases)(
  "a change counts as the card counts it: $case",
  ({ case: name, before, after, added, removed }) => {
    expect(
      counts(lineDiff(before ?? undefined, after)),
      `"${name}": the Thread's diff and the card (changes.rs) count it differently`
    ).toEqual({ added, removed })
  }
)

test("a change counts as the card counts it: many lines", () => {
  const before = Array.from({ length: many.lines }, (_, i) => `line ${i}`)
  const after = before.map((line, i) => (i % 2 ? `changed ${i}` : line))
  const diff = lineDiff(before.join("\n"), after.join("\n"))
  expect(counts(diff), many.case).toEqual({
    added: many.added,
    removed: many.removed,
  })
})
