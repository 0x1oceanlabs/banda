import type { Entry } from "@banda/contract/files"
import { expect, test } from "vitest"
import {
  ahead,
  type Expected,
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

const QUIET = { hidden: false, ignored: false }
const expecting = (
  ...pairs: [string, Expected[]][]
): ReadonlyMap<string, readonly Expected[]> => new Map(pairs)

test("a thing made shows until its folder is listed again, whatever another folder's listing brings", () => {
  let listed: Listed = new Map([
    ["", [folder("docs"), folder("lib")]],
    ["docs/", [file("a.txt")]],
    ["lib/", []],
  ])
  const made = expecting([
    "docs/",
    [{ made: { name: "untitled", kind: "file" } }],
  ])
  // Another open folder listed meanwhile: its own Map, still with the row.
  listed = merged(listed, "lib/", [file("new.txt")])
  expect(treeOf(ahead(listed, made), QUIET).paths).toEqual([
    "docs/",
    "docs/a.txt",
    "docs/untitled",
    "lib/",
    "lib/new.txt",
  ])
  // Listed with it, it shows once, as listed.
  const again = merged(listed, "docs/", [
    file("a.txt"),
    file("untitled", { size: 0 }),
  ])
  expect(ahead(again, made).get("docs/")).toEqual(again.get("docs/"))
  // A folder not listed yet holds what was made in it.
  const unlisted = merged(listed, "", [
    folder("docs"),
    folder("lib"),
    folder("new"),
  ])
  expect(
    ahead(
      unlisted,
      expecting(["new/", [{ made: { name: "x", kind: "folder" } }]])
    ).get("new/")
  ).toEqual([{ name: "x", kind: "folder", hidden: false, ignored: false }])
})

test("a thing renamed shows under its new name, with what an open folder holds, until listed again", () => {
  const listed: Listed = new Map([
    ["", [folder("src"), file("a.md", { ignored: true, size: 3 })]],
    ["src/", [folder("lib"), file("main.rs")]],
    ["src/lib/", [file("x.rs")]],
  ])
  const renamed = ahead(
    listed,
    expecting(
      ["", [{ renamed: { from: "src", to: "code" } }]],
      ["code/", [{ renamed: { from: "main.rs", to: "lib.rs" } }]]
    )
  )
  expect(treeOf(renamed, ALL).paths).toEqual([
    "code/",
    "code/lib/",
    "code/lib/x.rs",
    "code/lib.rs",
    "a.md",
  ])
  expect([...renamed.keys()]).toEqual(["", "code/", "code/lib/"])
  // Made, then named in place, in the order done.
  const named = ahead(
    listed,
    expecting([
      "src/",
      [
        { made: { name: "untitled", kind: "file" } },
        { renamed: { from: "untitled", to: "notes.md" } },
      ],
    ])
  )
  expect(named.get("src/")?.map((entry) => entry.name)).toEqual([
    "lib",
    "main.rs",
    "notes.md",
  ])
})

test("a thing renamed to a dotfile keeps what it was, as the tree shows it until listed", () => {
  const listed: Listed = new Map([
    ["", [file("a.md", { ignored: true, size: 3 }), file("b.md")]],
  ])
  const renamed = ahead(
    listed,
    expecting(["", [{ renamed: { from: "a.md", to: ".a.md" } }]])
  )
  expect(renamed.get("")).toEqual([
    file(".a.md", { ignored: true, size: 3 }),
    file("b.md"),
  ])
  expect(treeOf(renamed, { hidden: false, ignored: true }).paths).toEqual([
    ".a.md",
    "b.md",
  ])
})

test("with nothing expected the listings are the same, so the tree's paths keep their identity", () => {
  const listed: Listed = new Map([["", [file("a")]]])
  expect(ahead(listed, new Map())).toBe(listed)
})
