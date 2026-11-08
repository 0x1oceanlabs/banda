import { expect, test } from "vitest"
import { steady } from "./steady"

type Parts = { project: string; run: (id: string) => string }

test("a steady face keeps its functions, which do what the latest does", () => {
  const latest: { current: Parts } = {
    current: { project: "a", run: (id) => `a:${id}` },
  }
  const face = steady(latest.current, latest)
  const run = face.run
  expect(run("x")).toBe("a:x")
  expect(face.project).toBe("a")

  latest.current = { project: "b", run: (id) => `b:${id}` }
  expect(face.run).toBe(run)
  expect(run("x")).toBe("b:x")
  expect(face.project).toBe("b")
})

test("a steady face has the keys its first had, as a spread reads them", () => {
  const latest = { current: { project: "a", run: (id: string) => id } }
  const face = steady(latest.current, latest)
  expect(Object.keys(face)).toEqual(["project", "run"])
  latest.current = { project: "c", run: (id: string) => id }
  expect({ ...face }.project).toBe("c")
})
