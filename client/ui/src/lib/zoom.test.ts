import { expect, test } from "vitest"
import { zoomBy } from "./zoom"

test("the zoom goes in, out and back, a browser's steps", () => {
  expect(zoomBy(1, 1)).toBe(1.1)
  expect(zoomBy(1.1, 1)).toBe(1.25)
  expect(zoomBy(1, -1)).toBe(0.9)
  expect(zoomBy(1.75, 0)).toBe(1)
})

test("a zoom stays at either end", () => {
  expect(zoomBy(2, 1)).toBe(2)
  expect(zoomBy(0.5, -1)).toBe(0.5)
})
