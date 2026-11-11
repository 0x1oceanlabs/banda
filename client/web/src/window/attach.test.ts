import type { ProjectId } from "@banda/contract"
import { expect, test } from "vitest"
import { chipOf, composerFor } from "./attach"

const work = "work" as ProjectId
const home = "home" as ProjectId
/** The Threads drawn: two in Work, one in Home. */
const composers = new Map([
  ["thread-a", { project: work }],
  ["thread-b", { project: work }],
  ["thread-c", { project: home }],
])

test("what is attached goes to the focused Pane's composer, when it has one", () => {
  expect(
    composerFor(
      { id: "thread-b", project: work },
      work,
      ["thread-a"],
      composers
    )
  ).toBe("thread-b")
})

test("from a Pane with none, as Files, it goes to the Thread focused last in the same Project", () => {
  const history = ["files", "thread-c", "thread-b", "thread-a"]
  expect(
    composerFor({ id: "files", project: work }, work, history, composers)
  ).toBe("thread-b")
  expect(
    composerFor({ id: "files", project: home }, home, history, composers)
  ).toBe("thread-c")
})

test("a Thread gone since, or in another Project alone, takes nothing: then nothing does", () => {
  const history = ["files", "thread-gone", "thread-c"]
  expect(
    composerFor({ id: "files", project: work }, work, history, composers)
  ).toBeNull()
  expect(
    composerFor(
      { id: "files", project: "other" as ProjectId },
      "other" as ProjectId,
      [],
      composers
    )
  ).toBeNull()
})

test("a file goes only to a Message box of its own Project: focus on another Project's Thread does not take it (ADR 0106, #1445)", () => {
  // The focused Thread is Home's, the file Work's: not Home's composer,
  // but Work's that had the focus last.
  expect(
    composerFor(
      { id: "thread-c", project: home },
      work,
      ["thread-c", "thread-b"],
      composers
    )
  ).toBe("thread-b")
  // No Thread of the file's Project is drawn: none takes it.
  expect(
    composerFor(
      { id: "thread-c", project: home },
      "other" as ProjectId,
      ["thread-c", "thread-a"],
      composers
    )
  ).toBeNull()
})

test("an arc Thread's composer takes a file of arc's own Project, its project as this machine's are (ADR 0106, 3b)", () => {
  const arcs = "arc-project" as ProjectId
  const withArc = new Map([...composers, ["arc-thread", { project: arcs }]])
  expect(
    composerFor(
      { id: "arc-thread", project: arcs },
      arcs,
      ["arc-thread"],
      withArc
    )
  ).toBe("arc-thread")
})

test("with no Pane focused, nothing takes it", () => {
  expect(composerFor(null, work, ["thread-a"], composers)).toBeNull()
})

test("file.attach's args name a file, or some of its lines with what is said of them", () => {
  expect(chipOf("/w/a.ts", {})).toEqual({ path: "/w/a.ts" })
  expect(chipOf("/w/a.ts", {}, work)).toEqual({
    path: "/w/a.ts",
    project: work,
  })
  expect(
    chipOf("/w/a.ts", { from: 14, to: 12, comment: " Why twice? ", text: "x" })
  ).toEqual({
    path: "/w/a.ts",
    lines: [12, 14],
    comment: "Why twice?",
    text: "x",
  })
  // Words with no lines are no comment on lines; blank words are none.
  expect(chipOf("/w/a.ts", { from: 3, comment: "hm", text: "x" })).toEqual({
    path: "/w/a.ts",
    comment: "hm",
  })
  expect(chipOf("/w/a.ts", { from: 3, to: 3, comment: "  " })).toEqual({
    path: "/w/a.ts",
    lines: [3, 3],
  })
})
