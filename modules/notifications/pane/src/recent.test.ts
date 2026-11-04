import { expect, test } from "vitest"
import { LAST, withNewest } from "./recent"
import type { Told } from "./told"

const told = (key: string): Told => ({
  key,
  kind: "done",
  title: key,
  buttons: [],
})

test("the bell keeps the last notices, the newest last, a thing's newer in its older's place", () => {
  let kept: Told[] = []
  for (const key of ["a", "b", "c", "d", "e", "f"])
    kept = withNewest(kept, told(key))
  expect(kept.map((one) => one.key)).toEqual(["b", "c", "d", "e", "f"])
  expect(kept).toHaveLength(LAST)
  kept = withNewest(kept, told("c"))
  expect(kept.map((one) => one.key)).toEqual(["b", "d", "e", "f", "c"])
})
