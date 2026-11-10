import type { Item, ToolContent, ToolStatus } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { changes, merged, total } from "./changes"
import { agent } from "../../testing"

let next = 0
function edit(
  diffs: ToolContent[],
  { turn = "u", status = "done" }: { turn?: string; status?: ToolStatus } = {}
): Item {
  next += 1
  return {
    id: `i${next}`,
    turn,
    author: agent,
    at: next,
    body: {
      kind: "tool",
      title: "Edit",
      tool: "edit",
      status,
      content: diffs,
    },
  }
}

const diff = (path: string, old: string | undefined, text: string) =>
  ({ kind: "diff", path, old, new: text }) as const

test("a turn's changes hold each file once, from its first state to its last", () => {
  const items = [
    edit([diff("/a.md", "one\n", "two\n")]),
    edit([diff("/b.md", undefined, "new\n")]),
    edit([diff("/a.md", "two\n", "two\nthree\n")]),
    edit([diff("/c.md", "x\n", "y\n")], { turn: "other" }),
  ]
  const files = changes(items, "u")
  expect(files.map(({ path, old, new: text }) => [path, old, text])).toEqual([
    ["/a.md", "one\n", "two\nthree\n"],
    ["/b.md", undefined, "new\n"],
  ])
  expect(files.map(({ added, removed }) => [added, removed])).toEqual([
    [2, 1],
    [1, 0],
  ])
  expect(total(files)).toEqual({ added: 3, removed: 1 })
})

test("a file changed back, or by a failed call, is no change", () => {
  const items = [
    edit([diff("/a.md", "one\n", "two\n")]),
    edit([diff("/a.md", "two\n", "one\n")]),
    edit([diff("/b.md", "x\n", "y\n")], { status: "failed" }),
  ]
  expect(changes(items, "u")).toEqual([])
})

test("merged keeps each list's order and puts the Thread's own item first on a tie", () => {
  const at = (when: number, name: string): Item => ({
    ...edit([diff(`/${name}`, undefined, "x")]),
    id: name,
    at: when,
  })
  const items = [at(1, "a"), at(3, "b"), at(3, "c"), at(9, "d")]
  const edits = [at(0, "w"), at(3, "x"), at(5, "y"), at(20, "z")]
  const ids = (all: Item[]) => all.map((item) => item.id)
  expect(ids(merged(items, edits))).toEqual([
    "w",
    "a",
    "b",
    "c",
    "x",
    "y",
    "d",
    "z",
  ])
  expect(merged(items, [])).toBe(items)
  expect(ids(merged([], edits))).toEqual(["w", "x", "y", "z"])
  // A list out of order keeps its own order: the merge only interleaves.
  const late = [at(7, "late"), at(2, "early")]
  expect(ids(merged(items, late))).toEqual([
    "a",
    "b",
    "c",
    "late",
    "early",
    "d",
  ])
})
