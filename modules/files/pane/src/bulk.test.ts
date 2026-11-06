import { expect, test } from "vitest"
import { inOrder, namesText, readNames } from "./bulk"

const rows = [{ path: "/w/a.txt" }, { path: "/w/b.txt" }, { path: "/w/src" }]
const holds = (names: string[]) => () => new Set(names)

test("the names are one a line, and read back as renames of what changed", () => {
  expect(namesText(rows)).toBe("a.txt\nb.txt\nsrc")
  expect(
    readNames("one.txt\nb.txt\nlib\n", rows, holds(["a.txt", "b.txt", "src"]))
  ).toEqual({
    renames: [
      { path: "/w/a.txt", name: "one.txt" },
      { path: "/w/src", name: "lib" },
    ],
  })
})

test("a line missing, an empty name, a slash or a clash is refused", () => {
  const taken = holds(["a.txt", "b.txt", "src", "keep.txt"])
  const problem = (text: string) => {
    const read = readNames(text, rows, taken)
    return "problem" in read ? read.problem : null
  }
  expect(problem("a.txt\nb.txt\n")).toMatch(/3 names .* 2 lines/)
  expect(problem("a.txt\n \nsrc")).toBe("Line 2 is empty: a name cannot be.")
  expect(problem("a/x\nb.txt\nsrc")).toBe("Line 1: a name holds no /.")
  expect(problem("keep.txt\nb.txt\nsrc")).toBe(
    "Line 1: “keep.txt” is already in its folder."
  )
  expect(problem("c.txt\nc.txt\nsrc")).toBe(
    "Line 2: “c.txt” is given twice in one folder."
  )
  // A name another row leaves is free.
  expect(problem("b.txt\nc.txt\nsrc")).toBeNull()
})

test("the renames go where each name is free, and a ring through a name aside", () => {
  expect(
    inOrder([
      { path: "/w/a.txt", name: "b.txt" },
      { path: "/w/b.txt", name: "c.txt" },
    ])
  ).toEqual([
    { path: "/w/b.txt", name: "c.txt" },
    { path: "/w/a.txt", name: "b.txt" },
  ])
  expect(
    inOrder([
      { path: "/w/a.txt", name: "b.txt" },
      { path: "/w/b.txt", name: "a.txt" },
    ])
  ).toEqual([
    { path: "/w/a.txt", name: ".a.txt.banda-rename" },
    { path: "/w/b.txt", name: "a.txt" },
    { path: "/w/.a.txt.banda-rename", name: "b.txt" },
  ])
  // What a folder holds goes before the folder.
  expect(
    inOrder([
      { path: "/w/src", name: "lib" },
      { path: "/w/src/main.rs", name: "lib.rs" },
    ])
  ).toEqual([
    { path: "/w/src/main.rs", name: "lib.rs" },
    { path: "/w/src", name: "lib" },
  ])
})
