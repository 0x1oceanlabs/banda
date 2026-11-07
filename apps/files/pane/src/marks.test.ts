import { expect, test } from "vitest"
import { marksOf } from "./marks"

test("git's changes mark the files under the folder shown, by their paths from it", () => {
  const files = [
    { path: "src/main.rs", status: "modified" },
    { path: "src/new.rs", status: "untracked" },
    { path: "docs/a.md", status: "added" },
    { path: "README.md", status: "conflicted" },
  ]
  expect([...marksOf(files, "/work", "/work/src")]).toEqual([
    ["main.rs", "modified"],
    ["new.rs", "added"],
  ])
  expect(marksOf(files, "/work/", "/work").get("README.md")).toBe("modified")
  expect(marksOf(files, "/work", "/elsewhere").size).toBe(0)
})
