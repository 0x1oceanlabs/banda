import { describe, expect, it } from "vitest"
import { armsOf, drawGlyph, drawsItself } from "./glyphs"

describe("the glyphs the terminal draws itself", () => {
  it("are box drawing, blocks and braille, one letter each", () => {
    for (const text of ["─", "│", "╭", "█", "░", "▐", "⣿", "⠋", "\ue0b0"])
      expect(drawsItself(text)).toBe(true)
    for (const text of ["a", "", "──", "", "→", "🙂"])
      expect(drawsItself(text)).toBe(false)
  })

  it("know each box-drawing glyph's arms from its Unicode name", () => {
    // Up, right, down, left: 1 light, 2 heavy, 3 double.
    expect(armsOf(0x2500)).toEqual([0, 1, 0, 1]) // ─
    expect(armsOf(0x2502)).toEqual([1, 0, 1, 0]) // │
    expect(armsOf(0x250c)).toEqual([0, 1, 1, 0]) // ┌
    expect(armsOf(0x250d)).toEqual([0, 2, 1, 0]) // ┍ down light, right heavy
    expect(armsOf(0x251d)).toEqual([1, 2, 1, 0]) // ┝
    expect(armsOf(0x2540)).toEqual([2, 1, 1, 1]) // ╀
    expect(armsOf(0x254b)).toEqual([2, 2, 2, 2]) // ╋
    expect(armsOf(0x2552)).toEqual([0, 3, 1, 0]) // ╒
    expect(armsOf(0x256c)).toEqual([3, 3, 3, 3]) // ╬
    expect(armsOf(0x2574)).toEqual([0, 0, 0, 1]) // ╴
    expect(armsOf(0x257c)).toEqual([0, 2, 0, 1]) // ╼
  })

  it("fill whole screen pixels, so cells side by side meet", () => {
    const rects: number[][] = []
    const context = {
      fillStyle: "#fff",
      fillRect: (...rect: number[]) => rects.push(rect),
    } as unknown as CanvasRenderingContext2D
    const ratio = 1.6
    drawGlyph(context, "─", {
      left: 4,
      top: 0,
      width: 7.2,
      height: 16.25,
      ratio,
      fontSize: 12,
    })
    expect(rects.length).toBeGreaterThan(0)
    for (const rect of rects)
      for (const edge of rect)
        expect(edge * ratio).toBeCloseTo(Math.round(edge * ratio), 6)
  })
})
