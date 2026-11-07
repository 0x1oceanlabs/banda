import { expect, test } from "vitest"
import { lit, NOTHING, rowsOf, withPiece } from "./found"

const line = (n: number, text = "a needle") => ({
  line: n,
  text,
  ranges: [[2, 8]] as [number, number][],
})

test("the lines are grouped by file, the files by path, as they come", () => {
  let found = NOTHING
  found = withPiece(found, { kind: "file", path: "src/z.rs", lines: [line(3)] })
  found = withPiece(found, {
    kind: "file",
    path: "src/a.rs",
    lines: [line(1), line(9)],
    more: true,
  })
  found = withPiece(found, { kind: "done", files: 2, lines: 3, cut: false })
  expect(found.files.map((file) => file.path)).toEqual(["src/a.rs", "src/z.rs"])
  expect(found.done).toEqual({ lines: 3, cut: false })
  const rows = rowsOf(found.files, new Set(["src/z.rs"]))
  expect(
    rows.map((row) => (row.kind === "file" ? row.path : row.matched.line))
  ).toEqual(["src/a.rs", 1, 9, "src/z.rs"])
  expect(rows[0]).toMatchObject({ count: 2, more: true, folded: false })
  expect(rows[3]).toMatchObject({ folded: true })
})

test("a line is lit where it matches", () => {
  expect(lit(line(1))).toEqual([
    { text: "a ", lit: false },
    { text: "needle", lit: true },
  ])
})
