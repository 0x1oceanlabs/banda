import { expect, test } from "vitest"
import { FIT, LEAST, percentOf, wheelFactor, zoomAt } from "./zoom"

test("zooming keeps the place under the pointer where it was", () => {
  const point = { x: 100, y: -40 }
  const zoomed = zoomAt(FIT, 2, point, 8)
  expect(zoomed.scale).toBe(2)
  // The picture's point under the pointer: (point - shift) / scale.
  expect((point.x - zoomed.x) / zoomed.scale).toBe(point.x)
  expect((point.y - zoomed.y) / zoomed.scale).toBe(point.y)
  // About the middle, it stays in the middle.
  expect(zoomAt(FIT, 2, { x: 0, y: 0 }, 8)).toEqual({ scale: 2, x: 0, y: 0 })
})

test("it zooms only as far as it may, either way", () => {
  expect(zoomAt(FIT, 100, { x: 0, y: 0 }, 8).scale).toBe(8)
  expect(zoomAt(FIT, 0.01, { x: 0, y: 0 }, 8).scale).toBe(LEAST)
})

test("the wheel zooms in as it turns up, a pinch faster, and the readout is of its own pixels", () => {
  expect(wheelFactor(-100, false)).toBeGreaterThan(1)
  expect(wheelFactor(100, false)).toBeLessThan(1)
  expect(wheelFactor(-10, true)).toBeGreaterThan(wheelFactor(-10, false))
  expect(percentOf(0.5, FIT)).toBe("50%")
  expect(percentOf(0.5, { scale: 3, x: 0, y: 0 })).toBe("150%")
})
