import { describe, expect, it } from "vitest"
import { measureGhosttyCell } from "./t3/renderer"

// A canvas that measures as a 12px monospace does.
const context = {
  font: "",
  measureText: (text: string) => ({
    width: 7.2 * text.length,
    actualBoundingBoxAscent: 9,
    actualBoundingBoxDescent: 3,
  }),
} as unknown as CanvasRenderingContext2D

describe("a cell's height", () => {
  it("is whole screen pixels at a fractional scale, so a row's redraw leaves nothing of a cursor", () => {
    for (const ratio of [1.25, 1.333333, 1.5, 1.6, 1.75, 2.4]) {
      const cell = measureGhosttyCell(context, 12, "monospace", ratio)
      expect(
        Number.isInteger(Math.round(cell.height * ratio * 1e6) / 1e6)
      ).toBe(true)
      expect(
        Number.isInteger(Math.round(cell.baseline * ratio * 1e6) / 1e6)
      ).toBe(true)
    }
  })

  it("stays what it was where CSS pixels are the screen's", () => {
    expect(measureGhosttyCell(context, 12, "monospace", 1)).toEqual({
      width: 7.2,
      height: 16,
      baseline: 11,
    })
    expect(measureGhosttyCell(context, 12, "monospace", 2).height).toBe(16)
  })
})
