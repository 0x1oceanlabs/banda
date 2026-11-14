import { expect, test } from "vitest"
import { kinds } from "../registry"
import { inOrder, ruleWords, withoutShare, withShare } from "./Tiling"

test("a list of shares is written narrowest first and each share once, as the engine reads it", () => {
  expect(inOrder(["1", "2/5", "1/3", "2/5"])).toEqual(["1/3", "2/5", "1"])
  // One share written two ways is one step: the first stays.
  expect(inOrder(["1/2", "2/4", "0.5"])).toEqual(["1/2"])
  // What is no share goes last, for the file's check to refuse.
  expect(inOrder(["wide", "1", "1/3"])).toEqual(["1/3", "1", "wide"])
})

test("a share added stands where its size puts it, and one already there is not added twice", () => {
  const steps = ["1/3", "1/2", "2/3", "1"]
  expect(withShare(steps, " 2/5 ")).toEqual(["1/3", "2/5", "1/2", "2/3", "1"])
  expect(withShare(steps, "1/2")).toBeUndefined()
  expect(withShare(steps, "2/4")).toBeUndefined()
  expect(withShare(steps, "  ")).toBeUndefined()
  // No share: sent as typed, so the file's check says what is wrong.
  expect(withShare(steps, "wide")).toEqual([...steps, "wide"])
})

test("a share is taken out, but not the last one: the file needs one at least", () => {
  expect(withoutShare(["1/3", "1/2", "2/3"], "1/2")).toEqual(["1/3", "2/3"])
  expect(withoutShare(["1/2"], "1/2")).toBeUndefined()
})

test("a rule is said in a Person's words, and any other share as written", () => {
  expect(ruleWords({ width: "1/3", opens: "below" })).toBe(
    "a third wide, below"
  )
  expect(ruleWords({ width: "1/2", opens: "beside" })).toBe("half wide, beside")
  expect(ruleWords({ width: "2/3" })).toBe("two thirds wide")
  expect(ruleWords({ width: "1" })).toBe("full width")
  expect(ruleWords({ width: "2/5", opens: "group" })).toBe(
    "2/5 wide, in its Group"
  )
  expect(ruleWords({ opens: "project" })).toBe("on its Project's workspace")
})

test("each kind of Pane names itself in a word or two, for a rule's row to read", () => {
  const named = Object.fromEntries(kinds.map((kind) => [kind.kind, kind.name]))
  expect(named).toMatchObject({
    "terminal.terminal": "Terminal",
    "browser.browser": "Browser",
    "agents.thread": "Thread",
    "git.diff": "Diff",
    "files.tree": "Files",
    "files.file": "File",
  })
  for (const kind of kinds) expect(kind.name, kind.kind).toMatch(/^\S+( \S+)?$/)
})
