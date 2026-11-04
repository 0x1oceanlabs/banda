import { describe, expect, it } from "vitest"
import { filesOf } from "@banda/ui/components/code-diff"
import { actsOf, allOf, fileAsk, hunkAsk } from "./stage"

const PATCH = `diff --git a/ten.txt b/ten.txt
index 97b3d1a..3e913d0 100644
--- a/ten.txt
+++ b/ten.txt
@@ -1,4 +1,4 @@
-1
+one
 2
 3
 4
@@ -7,4 +7,4 @@
 7
 8
 9
-10
+ten
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3e757e7
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+new
`

describe("what the Diff can do", () => {
  it("stages and reverts what is unstaged, and unstages what is staged", () => {
    expect(actsOf({ kind: "unstaged" })).toEqual(["stage", "revert"])
    expect(actsOf({ kind: "staged" })).toEqual(["unstage"])
    expect(actsOf({ kind: "uncommitted" })).toEqual([])
    expect(actsOf({ kind: "changes", base: null })).toEqual([])
  })

  it("asks for a hunk by its lines and the file's objects", () => {
    const [ten] = filesOf(PATCH, "test")
    expect(hunkAsk(ten!, 1)).toEqual({
      files: ["ten.txt"],
      ids: { "ten.txt": "3e913d0" },
      hunk: {
        old_start: 7,
        old_lines: 4,
        new_start: 7,
        new_lines: 4,
        old_id: "97b3d1a",
        new_id: "3e913d0",
      },
    })
  })

  it("offers no hunk of a file the patch names no objects of", () => {
    const [ten] = filesOf(PATCH, "test")
    expect(hunkAsk({ ...ten!, prevObjectId: undefined }, 0)).toBeNull()
  })

  it("takes a new file's hunk as the file", () => {
    const [, made] = filesOf(PATCH, "test")
    expect(hunkAsk(made!, 0)).toEqual(fileAsk(made!))
    expect(fileAsk(made!)).toEqual({
      files: ["new.txt"],
      ids: { "new.txt": "3e757e7" },
    })
  })

  it("names a renamed file by both its paths", () => {
    expect(
      allOf([
        {
          path: "b.txt",
          old_path: "a.txt",
          added: 0,
          removed: 0,
          binary: false,
        },
        { path: "c.txt", added: 1, removed: 0, binary: false },
      ])
    ).toEqual({ files: ["b.txt", "a.txt", "c.txt"], ids: {} })
  })

  it("checks a revert of them all by the objects of those drawn", () => {
    const [ten, made] = filesOf(PATCH, "test")
    const drawn = new Map([["ten.txt", ten!]])
    const files = [made!, ten!].map((file) => ({
      path: file.name,
      added: 1,
      removed: 1,
      binary: false,
    }))
    // new.txt is not drawn yet: only ten.txt is checked.
    expect(allOf(files, drawn)).toEqual({
      files: ["new.txt", "ten.txt"],
      ids: { "ten.txt": "3e913d0" },
    })
  })
})
