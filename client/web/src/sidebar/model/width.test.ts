import { describe, expect, it } from "vitest"
import { dragged, kept, MAX, MIN, WIDTH, widest } from "./width"

describe("the sidebar's width", () => {
  it("goes a quarter rem at a time, and sticks near 16", () => {
    expect(dragged(20.1, MAX)).toBe(20)
    expect(dragged(20.2, MAX)).toBe(20.25)
    expect(dragged(16.3, MAX)).toBe(WIDTH)
    expect(dragged(15.7, MAX)).toBe(WIDTH)
    expect(dragged(16.5, MAX)).toBe(16.5)
  })

  it("stays between 13rem and the widest the window has room for", () => {
    expect(dragged(4, MAX)).toBe(MIN)
    expect(dragged(40, MAX)).toBe(MAX)
    expect(dragged(30, 24)).toBe(24)
  })

  it("leaves a column and its gaps beside it", () => {
    // 90rem wide, columns of 30rem: up to 32rem.
    expect(widest(90, 30)).toBe(MAX)
    // 55rem wide: 24rem, so the window is not narrow yet.
    expect(widest(55, 30)).toBe(24)
    // Narrower than that, 13rem at least.
    expect(widest(40, 30)).toBe(MIN)
  })

  it("takes what was kept, within its bounds", () => {
    expect(kept(20)).toBe(20)
    expect(kept(100)).toBe(MAX)
    expect(kept(2)).toBe(MIN)
    expect(kept(Number.NaN)).toBe(WIDTH)
    expect(kept(0)).toBe(WIDTH)
  })
})
