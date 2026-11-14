import { describe, expect, it } from "vitest"
import { pixels, SWIPE_END, Swipe } from "./swipe"

describe("a swipe", () => {
  it("picks its way once it has gone a little, and keeps it", () => {
    const swipe = new Swipe()
    expect(swipe.add(2, 1, 0)).toBe(true)
    expect(swipe.way).toBeUndefined()
    swipe.add(10, 1, 10)
    expect(swipe.way).toBe("sideways")
    // Up and down later in the same swipe does not change its way.
    swipe.add(0, 40, 20)
    expect(swipe.way).toBe("sideways")
  })

  it("goes up and down when a scroll up a Thread drifts sideways a little", () => {
    const swipe = new Swipe()
    for (let at = 0; at < 100; at += 10) swipe.add(3, -6, at)
    expect(swipe.way).toBe("upright")
  })

  it("goes sideways only when clearly more sideways than up or down", () => {
    const diagonal = new Swipe()
    diagonal.add(10, 6, 0)
    expect(diagonal.way).toBe("upright")
    const sideways = new Swipe()
    sideways.add(-13, 6, 0)
    expect(sideways.way).toBe("sideways")
  })

  it("ends after a pause; the next event begins another", () => {
    const swipe = new Swipe()
    swipe.add(20, 0, 0)
    expect(swipe.add(20, 0, SWIPE_END)).toBe(false)
    expect(swipe.x).toBe(40)
    expect(swipe.add(0, 20, 2 * SWIPE_END + 1)).toBe(true)
    expect(swipe).toMatchObject({ x: 0, y: 20, way: "upright" })
  })

  it("counts a mouse wheel's lines and pages in pixels", () => {
    expect(pixels({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toEqual({
      x: 0,
      y: 48,
    })
    expect(pixels({ deltaX: 1, deltaY: 0, deltaMode: 2 })).toEqual({
      x: 800,
      y: 0,
    })
    expect(pixels({ deltaX: 4, deltaY: 5, deltaMode: 0 })).toEqual({
      x: 4,
      y: 5,
    })
  })
})
