import { afterEach, expect, test } from "vitest"
import type { ProjectId } from "@banda/contract"
import { forgetAll, remember, take, takeLatest, type Undoable } from "./undo"

const work = "work" as ProjectId
const other = "other" as ProjectId

const op = (title: string, project = work): Undoable => ({
  title,
  project,
  steps: [{ kind: "trash", paths: [`/w/${title}`] }],
})

afterEach(forgetAll)

test("Mod+Z takes the latest first, and each once", () => {
  const [a, b, c] = [op("a"), op("b"), op("c")]
  remember(a)
  remember(b)
  remember(c)
  expect(takeLatest()).toBe(c)
  expect(takeLatest()).toBe(b)
  expect(takeLatest()).toBe(a)
  expect(takeLatest()).toBeUndefined()
})

test("a toast's Undo takes its own, which Mod+Z then passes over", () => {
  const [a, b] = [op("a"), op("b")]
  remember(a)
  remember(b)
  expect(take(b)).toBe(true)
  expect(take(b)).toBe(false)
  expect(takeLatest()).toBe(a)
})

test("what has no steps is not kept, and a Project's latest is its own", () => {
  remember({ title: "on macOS", project: work, steps: [] })
  expect(takeLatest()).toBeUndefined()
  const [mine, theirs] = [op("mine"), op("theirs", other)]
  remember(mine)
  remember(theirs)
  expect(takeLatest(work)).toBe(mine)
  expect(takeLatest(work)).toBeUndefined()
  expect(takeLatest(other)).toBe(theirs)
})

test("only the last 20 are kept", () => {
  const ops = Array.from({ length: 25 }, (_, n) => op(`${n}`))
  for (const one of ops) remember(one)
  const back: string[] = []
  for (let one = takeLatest(); one; one = takeLatest()) back.push(one.title)
  expect(back).toHaveLength(20)
  expect(back.at(-1)).toBe("5")
})
