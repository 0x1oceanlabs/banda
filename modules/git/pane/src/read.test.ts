import type { TurnChanges } from "@banda/contract/agents"
import type { Diff } from "@banda/contract/git"
import { pathOf } from "@banda/ui/components/code-diff"
import { expect, test } from "vitest"
import { turnRead } from "./read"

/** A checkpoint's diff: `inside.ts` changed in the Space's folder. */
const KEPT: Diff = {
  at: 7,
  files: [{ path: "inside.ts", added: 1, removed: 1, binary: false }],
  patch: `diff --git a/inside.ts b/inside.ts
index 1111111..2222222 100644
--- a/inside.ts
+++ b/inside.ts
@@ -1 +1 @@
-a
+b
`,
  truncated: false,
}

/** What the turn's tool calls changed: one file in the Space's folder,
 * named from there, and two outside it, in a worktree and in a state
 * folder, named from the root. */
const CHANGES: TurnChanges = {
  at: 9,
  turns: [{ turn: "u", n: 1, said: "Fix it", files: 3 }],
  files: [
    { path: "inside.ts", old: "a\n", new: "b\n" },
    { path: "/home/p/work-trees/fix/README.md", old: "x\n", new: "x\ny\n" },
    { path: "/home/p/.local/state/notes.md", new: "one\ntwo\n" },
  ],
}

test("a turn git kept shows its files outside the Space's folder too, from its tool calls", () => {
  const read = turnRead(KEPT, CHANGES)
  expect(read.at).toBe(7)
  expect(read.patch).toBe(KEPT.patch)
  expect(read.files).toEqual([
    KEPT.files[0],
    {
      path: "/home/p/work-trees/fix/README.md",
      added: 1,
      removed: 0,
      binary: false,
    },
    {
      path: "/home/p/.local/state/notes.md",
      added: 2,
      removed: 0,
      binary: false,
    },
  ])
  // The file in the folder is git's alone, as its checkpoint has it.
  expect(read.drawn?.map(pathOf)).toEqual([
    "/home/p/work-trees/fix/README.md",
    "/home/p/.local/state/notes.md",
  ])
  expect(read.drawn?.[1]?.type).toBe("new")
  expect(read.turns).toBe(CHANGES.turns)
})

test("a turn git kept no checkpoint of is all its tool calls changed", () => {
  const read = turnRead(null, CHANGES)
  expect(read.at).toBe(9)
  expect(read.patch).toBe("")
  expect(read.files.map((file) => file.path)).toEqual(
    CHANGES.files.map((file) => file.path)
  )
  expect(read.drawn).toHaveLength(3)
})

test("a turn whose files are all in the Space's folder is git's", () => {
  const read = turnRead(KEPT, { ...CHANGES, files: CHANGES.files.slice(0, 1) })
  expect(read.files).toEqual(KEPT.files)
  expect(read.drawn).toEqual([])
})
