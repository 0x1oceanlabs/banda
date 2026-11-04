import { describe, expect, test } from "vitest"
import { fit, LEAST, NARROWEST, ROW } from "./fit"

const screen = { width: 1000, height: 800 }

describe("fit", () => {
  test("a workspace one screen wide takes the zoom the look says", () => {
    const { zoom, rows, wide } = fit({
      widths: [1000, 0],
      screen,
      room: { width: 2000, height: 2000 },
      most: 0.35,
    })
    expect(zoom).toBe(0.35)
    expect(rows).toEqual([0.35, 0.35])
    expect(wide).toEqual([false, false])
  })

  test("a wide one shows whole: smaller where the room is short of it", () => {
    const { rows, wide } = fit({
      widths: [1000, 2000, 3000],
      screen,
      room: { width: 600, height: 4000 },
      most: 0.35,
    })
    // Two screens fit at 0.3; three would want 0.2, below the share.
    expect(rows[0]).toBe(0.35)
    expect(rows[1]).toBeCloseTo(0.3)
    expect(rows[2]).toBeCloseTo(0.35 * NARROWEST)
    expect(wide).toEqual([false, true, true])
  })

  test("all of them fit in the height, down to the least", () => {
    const widths = [1000, 1000, 1000, 1000, 0]
    const room = { width: 2000, height: 900 }
    const { zoom, rows } = fit({ widths, screen, room, most: 0.35 })
    const height =
      rows.reduce(
        (sum, row, i) => sum + (widths[i] ? 800 * row : ROW.empty),
        0
      ) +
      ROW.between * widths.length
    expect(zoom).toBeLessThan(0.35)
    expect(height).toBeLessThanOrEqual(room.height)
    expect(height).toBeGreaterThan(room.height - 4)

    const many = fit({
      widths: Array(20).fill(1000),
      screen,
      room,
      most: 0.35,
    })
    expect(many.zoom).toBeCloseTo(LEAST)
  })

  test("a zoom the look sets below the least stays", () => {
    const { zoom } = fit({
      widths: Array(20).fill(1000),
      screen,
      room: { width: 2000, height: 900 },
      most: 0.1,
    })
    expect(zoom).toBe(0.1)
  })
})
