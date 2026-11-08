import { afterEach, expect, test, vi } from "vitest"
import { groupState, stillMark } from "./banda-mark"

const colors = { body: "#111", attention: "#f60", destructive: "#e00" }

test("a still mark is one SVG, in its state's colours and eyes", () => {
  const done = stillMark("done", colors)
  expect(done).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
  expect(done).toContain('fill="#111"')
  // Happy eyes are strokes; no colour over the body.
  expect(done).toContain('stroke-linecap="round"')
  expect(done).not.toContain("#f60")

  const asking = stillMark("asking", colors)
  expect(asking).toContain('fill="#f60" fill-opacity="1.00"')
  expect(asking).toContain("<ellipse")

  const failed = stillMark("failed", colors)
  expect(failed).toContain('fill="#e00" fill-opacity="1.00"')

  // At rest it has no eyes at all.
  const rest = stillMark("rest", colors)
  expect(rest).not.toContain("<ellipse")
  expect(rest).not.toContain("stroke=")
})

test("a Group's colour, and a lent tab's, is its Agent's state", () => {
  expect(groupState("running")).toBe("working")
  expect(groupState("thinking")).toBe("working")
  expect(groupState("asking")).toBe("asking")
  expect(groupState("done")).toBe("done")
  expect(groupState("offline")).toBe("failed")
  expect(groupState("idle")).toBeUndefined()
  expect(groupState("rest")).toBeUndefined()
})

/** What a mark's motion writes to and listens on: nothing it reads. */
function part() {
  return {
    setAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

/** A mark's SVG, with the parts `BandaMark` draws in it. */
function svg(): SVGSVGElement {
  return {
    ...part(),
    querySelector: () => part(),
    // Two eyes, and three z's for its snores.
    querySelectorAll: (selector: string) =>
      selector.includes("eye") ? [part(), part()] : [part(), part(), part()],
  } as unknown as SVGSVGElement
}

/** The marks' motion afresh, on a clock whose ticks and timers the test
 * runs by hand. */
async function motion() {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
  const asked: ((now: number) => void)[] = []
  vi.stubGlobal("requestAnimationFrame", (run: (now: number) => void) =>
    asked.push(run)
  )
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal("addEventListener", () => {})
  vi.stubGlobal("removeEventListener", () => {})
  const { Animator } = await import("./banda-mark")
  return {
    Animator,
    /** Whether the clock asked for a tick. */
    ticking: () => asked.length > 0,
    /** Runs the ticks asked for, a frame apart, at most `most` of them:
     * how many ran. */
    run(most: number) {
      let ran = 0
      while (asked.length && ran < most) {
        vi.advanceTimersByTime(16)
        for (const run of asked.splice(0)) run(performance.now())
        ran++
      }
      return ran
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test("a mark ticks while it moves, and a mark at rest stops the clock", async () => {
  const time = await motion()
  const mark = new time.Animator(svg(), "agent")
  mark.set({ state: "rest", playful: 0, news: false })
  // It settles, and then asks for no tick.
  expect(time.run(1000)).toBeLessThan(100)
  expect(time.ticking()).toBe(false)
  // At work it moves on every tick, for as long as it works.
  mark.set({ state: "running", playful: 0, news: false })
  expect(time.run(600)).toBe(600)
  expect(time.ticking()).toBe(true)
  mark.set({ state: "rest", playful: 0, news: false })
  time.run(1000)
  expect(time.ticking()).toBe(false)
  mark.dispose()
})

test("the logo at rest wakes for its trick by a timer, not the clock", async () => {
  const time = await motion()
  const logo = new time.Animator(svg(), "logo")
  logo.set({ state: "rest", playful: 2, news: false })
  time.run(1000)
  expect(time.ticking()).toBe(false)
  // Its trick comes within 1.25 times `playful` seconds.
  vi.advanceTimersByTime(2500)
  expect(time.ticking()).toBe(true)
  // It wakes, plays, and is still again.
  expect(time.run(1000)).toBeGreaterThan(60)
  expect(time.ticking()).toBe(false)
  // Gone, it wakes no more.
  logo.dispose()
  vi.advanceTimersByTime(5000)
  expect(time.ticking()).toBe(false)
})
