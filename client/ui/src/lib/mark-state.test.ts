import { expect, test } from "vitest"
import { loudest, MARK_ORDER, type MarkState } from "./mark-state"

test("the logo's order is offline › failed › asking › woke › done › working › rest (ADR 0099, decision 9)", () => {
  const order = (Object.keys(MARK_ORDER) as MarkState[]).sort(
    (a, b) => MARK_ORDER[b] - MARK_ORDER[a]
  )
  expect(order).toEqual([
    "offline",
    "failed",
    "asking",
    "woke",
    "done",
    "working",
    "idle",
    "later",
    "rest",
  ])
})

test("the logo shows the loudest, a Thread that woke among them", () => {
  expect(loudest(["done", "woke", "working"])).toBe("woke")
  expect(loudest(["woke", "asking"])).toBe("asking")
  expect(loudest(["woke", "failed"])).toBe("failed")
  expect(loudest(["failed", "offline"])).toBe("offline")
  expect(loudest([])).toBe("rest")
})

test("what calls no one and works not leaves the logo at rest", () => {
  expect(loudest(["idle", "later"])).toBe("rest")
  expect(loudest(["later"])).toBe("rest")
  expect(loudest(["idle", "working"])).toBe("working")
})
