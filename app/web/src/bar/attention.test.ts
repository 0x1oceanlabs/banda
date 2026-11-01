import { expect, test } from "vitest"
import { combine } from "./attention"

test("the bar shows the loudest call, and counts every wait", () => {
  expect(combine([])).toEqual({ mark: "rest", waiting: 0 })
  expect(
    combine([
      { mark: "running", waiting: 0 },
      { mark: "asking", waiting: 1 },
      { mark: "failed", waiting: 2 },
    ])
  ).toEqual({ mark: "failed", waiting: 3 })
})
