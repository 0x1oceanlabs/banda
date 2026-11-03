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
    expect(fileAsk(made!)).toEqual({ files: ["new.txt"] })
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
    ).toEqual({ files: ["b.txt", "a.txt", "c.txt"] })
  })
})
