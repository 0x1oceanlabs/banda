import { expect, test } from "vitest"
import {
  copyValue,
  docsOf,
  holdsAtMost,
  openTo,
  pathOf,
  rowsOf,
  stripJsonc,
  valueText,
} from "./json"

const doc = {
  name: "banda",
  "a b": true,
  users: [{ id: 1, tags: [] }, null],
  empty: {},
}

test("a path is written as jq reads it", () => {
  expect(pathOf(".", "name")).toBe(".name")
  expect(pathOf(".", "a b")).toBe('.["a b"]')
  expect(pathOf(".", 0)).toBe(".[0]")
  expect(pathOf(".users", 0)).toBe(".users[0]")
  expect(pathOf(".users[0]", "id")).toBe(".users[0].id")
  expect(pathOf(".x", "1st")).toBe('.x["1st"]')
})

test("the rows are the values of the open folders, each with its path, kind and size", () => {
  const docs = [{ value: doc }]
  const closed = rowsOf(docs, new Set())
  expect(closed.map((row) => [row.path, row.kind, row.size, row.open])).toEqual(
    [[".", "object", 4, false]]
  )
  const rows = rowsOf(docs, new Set([".", ".users"]))
  expect(rows.map((row) => [row.path, row.depth, row.key])).toEqual([
    [".", 0, undefined],
    [".name", 1, "name"],
    ['.["a b"]', 1, "a b"],
    [".users", 1, "users"],
    [".users[0]", 2, 0],
    [".users[1]", 2, 1],
    [".empty", 1, "empty"],
  ])
  expect(rows[4].open).toBe(false)
  // An empty object holds nothing to open.
  expect(rows[6]).toMatchObject({ kind: "object", size: 0, open: false })
})

test("expanding to a depth opens every folder above it", () => {
  const docs = [{ value: doc }]
  expect([...openTo(docs, 1)]).toEqual(["."])
  expect([...openTo(docs, 2)]).toEqual([".", ".users"])
  expect([...openTo(docs)]).toEqual([".", ".users", ".users[0]"])
  expect(rowsOf(docs, openTo(docs)).map((row) => row.path)).toContain(
    ".users[0].tags"
  )
  // Opened whole, it has 9 rows.
  expect(rowsOf(docs, openTo(docs))).toHaveLength(9)
  expect(holdsAtMost(docs, 9)).toBe(true)
  expect(holdsAtMost(docs, 8)).toBe(false)
})

test("a value is shown on one line, and copied as it is or as JSON", () => {
  const rows = rowsOf([{ value: doc }], new Set(["."]))
  expect(rows.map(valueText)).toEqual([
    "{…} 4 keys",
    '"banda"',
    "true",
    "[…] 2 items",
    "{}",
  ])
  expect(copyValue("banda")).toBe("banda")
  expect(copyValue({ id: 1 })).toBe('{\n  "id": 1\n}')
})

test("JSONC loses its comments and trailing commas, and its strings keep theirs", () => {
  const text = `{
    // a comment
    "url": "http://x.y/*z*/", /* another */
    "list": [1, 2,],
    "words": "a,}",
  }`
  expect(JSON.parse(stripJsonc(text))).toEqual({
    url: "http://x.y/*z*/",
    list: [1, 2],
    words: "a,}",
  })
  // A tsconfig.json has comments, and parses all the same.
  expect(docsOf('{ /* x */ "a": 1, }', "json")).toEqual([{ value: { a: 1 } }])
  expect(() => docsOf("{ nope", "json")).toThrow()
})

test("JSON Lines is a document per line, a broken one kept as its text", () => {
  const docs = docsOf('{"a":1}\n\n[2]\nnot json\n', "jsonl")
  expect(docs.map((one) => one.line)).toEqual([1, 3, 4])
  expect(docs[2].broken?.text).toBe("not json")
  const rows = rowsOf(docs, new Set(["3:."]))
  expect(rows.map((row) => row.id)).toEqual(["1:.", "3:.", "3:.[0]", "4:."])
  expect(rows[2].path).toBe(".[0]")
})
