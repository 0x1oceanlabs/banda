import type { Entry } from "@banda/contract/files"
import { expect, test } from "vitest"
import {
  candidates,
  completed,
  crumbsOf,
  foldCrumbs,
  parentOf,
  tilded,
  typedParts,
  untilded,
  wholeOf,
  within,
} from "./where"

const HOME = "/home/roma"

test("the crumbs start at ~ under home, else at the root", () => {
  expect(crumbsOf("/home/roma/code/banda", HOME)).toEqual([
    { name: "~", path: "/home/roma" },
    { name: "code", path: "/home/roma/code" },
    { name: "banda", path: "/home/roma/code/banda" },
  ])
  expect(crumbsOf("/home/roma", HOME)).toEqual([
    { name: "~", path: "/home/roma" },
  ])
  expect(crumbsOf("/srv/data", HOME)).toEqual([
    { name: "/", path: "/" },
    { name: "srv", path: "/srv" },
    { name: "data", path: "/srv/data" },
  ])
  expect(crumbsOf("/home/romeo", HOME)[0].name).toBe("/")
})

test("~ is home, both ways, and a path typed is made whole", () => {
  expect(tilded("/home/roma/code", HOME)).toBe("~/code")
  expect(tilded("/home/roma", HOME)).toBe("~")
  expect(tilded("/home/romeo", HOME)).toBe("/home/romeo")
  expect(untilded("~/code/", HOME, "/x")).toBe("/home/roma/code")
  expect(untilded("~", HOME, "/x")).toBe("/home/roma")
  expect(untilded("src/../docs", HOME, "/work")).toBe("/work/docs")
  expect(untilded("/a//b/./c/", HOME, "/x")).toBe("/a/b/c")
})

test("the tree's paths and whole ones go both ways, and up", () => {
  expect(wholeOf("/work", "src/lib/")).toBe("/work/src/lib")
  expect(wholeOf("/work", "")).toBe("/work")
  expect(wholeOf("/", "etc/")).toBe("/etc")
  expect(within("/work", "/work/src/a.rs")).toBe("src/a.rs")
  expect(within("/work", "/work")).toBe("")
  expect(within("/work", "/workshop/a")).toBeNull()
  expect(parentOf("/work/src")).toBe("/work")
  expect(parentOf("/work")).toBe("/")
  expect(parentOf("/")).toBeNull()
})

const entries: Entry[] = [
  { name: "code", kind: "folder" },
  { name: "Codex", kind: "folder" },
  { name: ".config", kind: "folder", hidden: true },
  { name: "cool.txt", kind: "file" },
  { name: "linked", kind: "link", to_folder: true },
]

test("Tab completes a folder's name from the folder typed", () => {
  expect(typedParts("~/co")).toEqual({ folder: "~/", start: "co" })
  expect(candidates(entries, "co")).toEqual(["code", "Codex"])
  expect(candidates(entries, "")).toEqual(["code", "Codex", "linked"])
  expect(candidates(entries, ".c")).toEqual([".config"])
  // Of several, as much as they share; of one, all of it and a slash.
  expect(completed("~/c", ["code", "Codex"])).toBe("~/code")
  expect(completed("~/code", ["code", "Codex"])).toBe("~/code")
  expect(completed("~/li", ["linked"])).toBe("~/linked/")
  expect(completed("~/zz", [])).toBe("~/zz")
})

test("the crumbs that do not fit fold after the first, the last ones kept", () => {
  const crumbs = crumbsOf("/home/roma/a/bb/ccc/dddd/eeeee", HOME)
  expect(foldCrumbs(crumbs, 1000)).toEqual({ shown: crumbs, folded: [] })
  const narrow = foldCrumbs(crumbs, 180)
  expect(
    narrow.shown.map((one) => (one === "folded" ? "…" : one.name))
  ).toEqual(["~", "…", "dddd", "eeeee"])
  expect(narrow.folded.map((one) => one.name)).toEqual(["a", "bb", "ccc"])
  // The last one stays, however narrow.
  expect(foldCrumbs(crumbs, 10).shown.at(-1)).toEqual(crumbs.at(-1))
})
