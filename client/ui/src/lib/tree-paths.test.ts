import { expect, test } from "vitest"
import { foldersOf, movedPaths, outermost, pathUpdates } from "./tree-paths"

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

test("a drag carries a folder picked, not what it holds as well", () => {
  expect(outermost(["src/a.ts", "src/", "docs/b.md", "src/lib/c.ts"])).toEqual([
    "src/",
    "docs/b.md",
  ])
  expect(outermost(["a.ts", "a.ts", "b.ts"])).toEqual(["a.ts", "b.ts"])
})

test("a row renamed moves, and all a folder holds with it", () => {
  expect(movedPaths(["a.txt", "b.txt"], "a.txt", "c.txt")).toEqual([
    "c.txt",
    "b.txt",
  ])
  expect(movedPaths(["src/", "src/main.rs", "srcs/"], "src/", "lib/")).toEqual([
    "lib/",
    "lib/main.rs",
    "srcs/",
  ])
})
