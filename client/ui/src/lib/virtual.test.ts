import { expect, test } from "vitest"
import { drawnAt, scrollFor } from "./virtual"

const rows = { count: 1000, row: 20, view: 200, overscan: 2 }

test("the rows in view are drawn, with a few past each end, each where it is", () => {
  const top = drawnAt(rows, 0)
  expect([top.first, top.last, top.height]).toEqual([0, 11, 20_000])
  const mid = drawnAt(rows, 1010)
  // Row 50 starts at 1000 and is half out of view.
  expect([mid.first, mid.last]).toEqual([48, 62])
  expect(mid.top(50)).toBe(1000)
  const end = drawnAt(rows, 19_800)
  expect([end.first, end.last]).toEqual([988, 999])
  expect(drawnAt({ ...rows, count: 0 }, 0).last).toBeLessThan(0)
})

test("rows taller than a list may be are scaled into it, and drawn in the view", () => {
  const tall = {
    count: 1_000_000,
    row: 20,
    view: 200,
    overscan: 0,
    most: 10_000,
  }
  const end = drawnAt(tall, 10_000 - 200)
  expect(end.height).toBe(10_000)
  expect(end.last).toBe(999_999)
  // The last row's foot is the view's.
  expect(end.top(999_999) + 20).toBe(10_000)
  const half = drawnAt(tall, (10_000 - 200) / 2)
  expect(half.first).toBe(499_995)
  // The first row drawn sits at the view's top.
  expect(half.top(half.first)).toBeCloseTo(4900, 0)
})

test("a row is scrolled to the top, the middle, or as near as needs", () => {
  expect(scrollFor(rows, 50, "start", 0)).toBe(1000)
  expect(scrollFor(rows, 50, "center", 0)).toBe(910)
  expect(scrollFor(rows, 999, "start", 0)).toBe(19_800)
  // In view already: where it is.
  expect(scrollFor(rows, 5, "nearest", 0)).toBe(0)
  expect(scrollFor(rows, 20, "nearest", 0)).toBe(220)
  expect(scrollFor(rows, 3, "nearest", 500)).toBe(60)
  const tall = { count: 1_000_000, row: 20, view: 200, most: 10_000 }
  expect(scrollFor(tall, 999_999, "start", 0)).toBe(9800)
  expect(scrollFor({ ...rows, count: 3 }, 2, "start", 0)).toBe(0)
})
