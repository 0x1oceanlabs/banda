import type { ProjectId } from "@banda/contract"
import { expect, test } from "vitest"
import { composerFor } from "./attach"

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
    composerFor({ id: "thread-b", project: work }, ["thread-a"], composers)
  ).toBe("thread-b")
})

test("from a Pane with none, as Files, it goes to the Thread focused last in the same Project", () => {
  const history = ["files", "thread-c", "thread-b", "thread-a"]
  expect(composerFor({ id: "files", project: work }, history, composers)).toBe(
    "thread-b"
  )
  expect(composerFor({ id: "files", project: home }, history, composers)).toBe(
    "thread-c"
  )
})

test("a Thread gone since, or in another Project alone, takes nothing: then nothing does", () => {
  const history = ["files", "thread-gone", "thread-c"]
  expect(
    composerFor({ id: "files", project: work }, history, composers)
  ).toBeNull()
  expect(
    composerFor({ id: "files", project: "other" as ProjectId }, [], composers)
  ).toBeNull()
})

test("with no Pane focused, nothing takes it", () => {
  expect(composerFor(null, ["thread-a"], composers)).toBeNull()
})
