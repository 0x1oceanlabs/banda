// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { pixels, sidewaysRoom, SWIPE_END, Swipe } from "./swipe"

describe("a swipe", () => {
  it("picks its way once it has gone a little, and keeps it", () => {
    const swipe = new Swipe()
    expect(swipe.add(2, 1, 0)).toBe(true)
    expect(swipe.way).toBeUndefined()
    swipe.add(10, 1, 10)
    expect(swipe).toMatchObject({ way: "sideways", picked: true })
    // Up and down later in the same swipe does not change its way.
    swipe.add(0, 40, 20)
    expect(swipe).toMatchObject({ way: "sideways", picked: false })
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

/** What a wheel event at `target` goes through, as `composedPath` says. */
function path(target: Element): Element[] {
  const all: Element[] = []
  for (let at: Element | null = target; at; at = at.parentElement) all.push(at)
  return all
}

describe("the room to scroll sideways under a swipe", () => {
  /** A wide table in a Pane in the Strip, scrolled `at` of 300 pixels. */
  function table(at: number, direction = "ltr") {
    const strip = document.createElement("div")
    const pane = strip.appendChild(document.createElement("div"))
    const wide = pane.appendChild(document.createElement("div"))
    const cell = wide.appendChild(document.createElement("span"))
    wide.style.overflowX = "auto"
    wide.style.direction = direction
    Object.defineProperties(wide, {
      scrollWidth: { value: 500 },
      clientWidth: { value: 200 },
      scrollLeft: { value: at },
    })
    document.body.append(strip)
    return { strip, pane, cell }
  }

  it("is none over what does not scroll sideways", () => {
    const { strip, pane } = table(0)
    expect(sidewaysRoom(path(pane), strip)).toEqual({ back: 0, on: 0 })
  })

  it("is what is left each way, and none at an end", () => {
    const start = table(0)
    expect(sidewaysRoom(path(start.cell), start.strip)).toEqual({
      back: 0,
      on: 300,
    })
    const middle = table(100)
    expect(sidewaysRoom(path(middle.cell), middle.strip)).toEqual({
      back: 100,
      on: 200,
    })
    const end = table(300)
    expect(sidewaysRoom(path(end.cell), end.strip)).toEqual({
      back: 300,
      on: 0,
    })
  })

  it("counts from the right in a right-to-left text", () => {
    const { strip, cell } = table(-100, "rtl")
    expect(sidewaysRoom(path(cell), strip)).toEqual({ back: 200, on: 100 })
  })
})

describe("the room a page's own view has", () => {
  /** A page 500 wide in a view of 200, scrolled `at`. */
  function page(at: number) {
    Object.defineProperties(document.documentElement, {
      scrollWidth: { value: 500, configurable: true },
      clientWidth: { value: 200, configurable: true },
      scrollLeft: { value: at, configurable: true },
    })
    // As Chromium says of a page that sets neither; happy-dom says nothing.
    document.documentElement.style.overflowX = "visible"
    document.body.style.overflowX = "visible"
    return document.body.appendChild(document.createElement("p"))
  }

  it("counts, with no stop, as a page wider than its view scrolls", () => {
    expect(sidewaysRoom(path(page(100)), null)).toEqual({ back: 100, on: 200 })
  })

  it("is none when the body hides what is wider, as its view then does", () => {
    const target = page(0)
    document.body.style.overflowX = "hidden"
    expect(sidewaysRoom(path(target), null)).toEqual({ back: 0, on: 0 })
  })

  it("is none when the root hides it", () => {
    const target = page(0)
    document.documentElement.style.overflowX = "clip"
    expect(sidewaysRoom(path(target), null)).toEqual({ back: 0, on: 0 })
  })
})
