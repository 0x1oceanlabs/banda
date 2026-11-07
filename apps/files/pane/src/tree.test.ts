import type { Entry } from "@banda/contract/files"
import { expect, test } from "vitest"
import {
  type Listed,
  matchesOf,
  merged,
  onlyFolder,
  toList,
  treeOf,
  untitled,
} from "./tree"

const folder = (name: string, more: Partial<Entry> = {}): Entry => ({
  name,
  kind: "folder",
  ...more,
})
const file = (name: string, more: Partial<Entry> = {}): Entry => ({
  name,
  kind: "file",
  ...more,
})
const ALL = { hidden: true, ignored: true }

test("a listing merges into the tree under its folder, in the engine's order", () => {
  let listed: Listed = new Map([
    [
      "",
      [
        folder("src"),
        folder("built", { ignored: true }),
        file(".env", { hidden: true }),
        file("a.md"),
      ],
    ],
  ])
  expect(treeOf(listed, ALL).paths).toEqual(["src/", "built/", ".env", "a.md"])
  listed = merged(listed, "src/", [folder("lib"), file("main.rs")])
  listed = merged(listed, "src/lib/", [file("x.rs")])
  expect(treeOf(listed, ALL)).toEqual({
    paths: [
      "src/",
      "src/lib/",
      "src/lib/x.rs",
      "src/main.rs",
      "built/",
      ".env",
      "a.md",
    ],
    ignored: ["built/"],
  })
  // What is hidden, or ignored, shows only when asked.
  expect(treeOf(listed, { hidden: false, ignored: false }).paths).toEqual([
    "src/",
    "src/lib/",
    "src/lib/x.rs",
    "src/main.rs",
    "a.md",
  ])
})

test("a folder gone from a listing is let go, with what was listed in it", () => {
  let listed: Listed = new Map([
    ["", [folder("a"), folder("b")]],
    ["a/", [folder("deep")]],
    ["a/deep/", [file("x")]],
    ["b/", [file("y")]],
  ])
  listed = merged(listed, "", [folder("b"), file("c")])
  expect([...listed.keys()]).toEqual(["", "b/"])
  expect(treeOf(listed, ALL).paths).toEqual(["b/", "b/y", "c"])
})

test("an open folder is listed once the folder above it is", () => {
  const listed: Listed = new Map([["", [folder("a")]]])
  expect(toList(["a/", "a/b/", "c/"], listed, new Set())).toEqual(["a/", "c/"])
  expect(toList(["a/"], listed, new Set(["a/"]))).toEqual([])
  expect(toList(["a/b/"], new Map([...listed, ["a/", []]]), new Set())).toEqual(
    ["a/b/"]
  )
})

test("a folder of one folder opens with it, as it shows as one row", () => {
  expect(onlyFolder("a/", [folder("b")], ALL)).toBe("a/b/")
  expect(onlyFolder("a/", [folder("b"), file("x")], ALL)).toBeNull()
  // A dotfile that does not show leaves the one folder alone.
  expect(
    onlyFolder("", [folder("b"), file(".x", { hidden: true })], {
      hidden: false,
      ignored: true,
    })
  ).toBe("b/")
})

test("a filter shows the files it found under their folders, all open", () => {
  expect(matchesOf(["src/lib/main.rs", "src/main.rs", "main.md"])).toEqual({
    paths: ["src/", "src/lib/", "src/lib/main.rs", "src/main.rs", "main.md"],
    open: ["src/", "src/lib/"],
  })
})

test("a new thing is untitled, then untitled 2, as the names are taken", () => {
  const entry = (name: string) => ({ name, kind: "file" as const })
  expect(untitled([], false)).toBe("untitled")
  expect(untitled([entry("untitled")], false)).toBe("untitled 2")
  expect(untitled([entry("untitled")], true)).toBe("untitled folder")
  expect(
    untitled([entry("untitled folder"), entry("untitled folder 2")], true)
  ).toBe("untitled folder 3")
})
