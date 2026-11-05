import { expect, test } from "vitest"
import { settledToArchived } from "./renamed"

test("what the Person said while it was Settled reads as Archive", () => {
  const settled = JSON.stringify({
    a: { settled: true, at: 5 },
    b: { settled: false, at: 6 },
  })
  expect(JSON.parse(settledToArchived(settled))).toEqual({
    a: { archived: true, at: 5 },
    b: { archived: false, at: 6 },
  })
  expect(settledToArchived("not json")).toBe("{}")
})
