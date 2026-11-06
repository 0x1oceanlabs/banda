import { expect, test } from "vitest"
import type { Archive } from "@banda/contract/files"
import { summaryOf, treeOf, treePath } from "./archive"

test("a name is drawn from the top, a folder's with its slash, and .. stays a name", () => {
  expect(treePath({ path: "docs/a.md", folder: false })).toBe("docs/a.md")
  expect(treePath({ path: "docs", folder: true })).toBe("docs/")
  expect(treePath({ path: "/etc/passwd", folder: false })).toBe("etc/passwd")
  expect(treePath({ path: "./x//y", folder: false })).toBe("x/y")
  expect(treePath({ path: "../x", folder: false })).toBe("../x")
  expect(treePath({ path: "a\\b.txt", folder: false })).toBe("a/b.txt")
  expect(treePath({ path: "./", folder: true })).toBeNull()
})

test("the tree's paths come once each, with the files' sizes beside them", () => {
  const tree = treeOf([
    { path: "docs/", folder: true },
    { path: "docs/a.md", folder: false, size: 1200 },
    { path: "docs/a.md", folder: false, size: 1 },
    { path: "/", folder: true },
  ])
  expect(tree.paths).toEqual(["docs/", "docs/a.md"])
  expect(tree.notes.get("docs/a.md")).toBe("1.2 KB")
  expect(tree.entries.get("docs/a.md")?.size).toBe(1200)
})

test("an archive is summed up in a line", () => {
  const archive: Archive = {
    path: "/a/site.zip",
    packing: "zip",
    truncated: false,
    entries: [
      { path: "docs/", folder: true },
      { path: "docs/a.md", folder: false, size: 4000, packed: 1000 },
      { path: "img/b.png", folder: false, size: 2000, packed: 2000 },
    ],
  }
  expect(summaryOf(archive, 3500)).toBe(
    "Zip · 2 files in 2 folders · 6 KB unpacked, 3 KB packed"
  )
  expect(
    summaryOf(
      { ...archive, packing: "tar_gz", entries: archive.entries.slice(1, 2) },
      900
    )
  ).toBe("Gzipped tar · 1 file in 1 folder · 4 KB unpacked, 900 bytes packed")
})
