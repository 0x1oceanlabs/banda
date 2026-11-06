import { expect, test } from "vitest"
import { foldersOf, pathUpdates } from "./tree-paths"

test("a folder gone takes what it holds, and a new folder comes before what it holds", () => {
  const was = ["src/", "src/a.ts", "src/lib/", "src/lib/b.ts", "README.md"]
  const now = ["README.md", "docs/", "docs/guide/", "docs/guide/one.md"]
  expect(pathUpdates(was, now)).toEqual([
    { type: "remove", path: "src/", recursive: true },
    { type: "add", path: "docs/" },
    { type: "add", path: "docs/guide/" },
    { type: "add", path: "docs/guide/one.md" },
  ])
})

test("the same paths need no update", () => {
  expect(pathUpdates(["a", "b/"], ["b/", "a"])).toEqual([])
})

test("a path's folders are named from the top", () => {
  expect(foldersOf("a/b/c.ts")).toEqual(["a/", "a/b/"])
  expect(foldersOf("a/b/")).toEqual(["a/"])
  expect(foldersOf("c.ts")).toEqual([])
})
