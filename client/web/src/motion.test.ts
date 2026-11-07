import { expect, test } from "vitest"
import { bezierAt, Moving, springAt } from "./motion"

const niri = { dampingRatio: 1, stiffness: 800, epsilon: 0.0001 }

test("a critically damped spring comes to rest without passing it", () => {
  let passed = false
  for (let t = 0; t < 1; t += 0.005) {
    if (springAt(niri, 100, 0, t).value < 0) passed = true
  }
  expect(passed).toBe(false)
  expect(Math.abs(springAt(niri, 100, 0, 0.5).value)).toBeLessThan(0.01)
})

test("a bouncy spring passes its rest and comes back", () => {
  const bouncy = { ...niri, dampingRatio: 0.4 }
  const values = Array.from(
    { length: 100 },
    (_, i) => springAt(bouncy, 100, 0, i * 0.005).value
  )
  expect(Math.min(...values)).toBeLessThan(-1)
})

test("an overdamped spring keeps the speed it starts with", () => {
  const slow = { ...niri, dampingRatio: 2 }
  expect(springAt(slow, 0, 50, 0).velocity).toBeCloseTo(50, 0)
  expect(springAt(slow, 100, 0, 0).value).toBeCloseTo(100)
})

test("curves are CSS's", () => {
  expect(bezierAt([0, 0, 1, 1], 0.3)).toBeCloseTo(0.3)
  // easeOutCubic is well past half at a third of the time.
  expect(bezierAt([0.33, 1, 0.68, 1], 0.33)).toBeGreaterThan(0.6)
  expect(bezierAt([0.33, 1, 0.68, 1], 1)).toBe(1)
})

/** A clock the test turns by hand, in frames of 16 ms. */
function clock() {
  let now = 0
  let next: ((now: number) => void) | undefined
  return {
    frame: (run: (now: number) => void) => {
      next = run
      return 1
    },
    cancel: () => {
      next = undefined
    },
    now: () => now,
    run(frames: number) {
      for (let i = 0; i < frames && next; i++) {
        const run = next
        next = undefined
        now += 16
        run(now)
      }
    },
  }
}

test("a move lands exactly on its target", () => {
  const time = clock()
  let shown = 0
  const moving = new Moving(
    (v) => (shown = v),
    () => shown,
    time
  )
  moving.to(300, { kind: "spring", ...niri })
  time.run(10)
  expect(shown).toBeGreaterThan(0)
  expect(shown).toBeLessThan(300)
  time.run(200)
  expect(shown).toBe(300)
  expect(moving.moving).toBe(false)
})

test("a frame that began before the move was asked does not run it back", () => {
  // A busy page: the move is asked late in a long task, and the next
  // frame's time is when that frame began, before it.
  let next: ((now: number) => void) | undefined
  const late = {
    frame: (run: (now: number) => void) => {
      next = run
      return 1
    },
    cancel: () => {
      next = undefined
    },
    now: () => 200,
  }
  let shown = 1
  const moving = new Moving(
    (v) => (shown = v),
    () => shown,
    late
  )
  moving.to(0.5, { kind: "spring", ...niri })
  next!(50)
  expect(shown).toBe(1)
  next!(216)
  expect(shown).toBeLessThan(1)
  expect(shown).toBeGreaterThan(0.5)
})

test("sent elsewhere halfway, it keeps its speed", () => {
  const time = clock()
  let shown = 0
  const moving = new Moving(
    (v) => (shown = v),
    () => shown,
    time
  )
  moving.to(1000, { kind: "spring", ...niri })
  time.run(4)
  const before = shown
  moving.to(0, { kind: "spring", ...niri })
  time.run(1)
  // Still going up a moment, though the target is now behind it.
  expect(shown).toBeGreaterThan(before)
})

test("off jumps, and a hand stops it where it is", () => {
  const time = clock()
  let shown = 0
  const moving = new Moving(
    (v) => (shown = v),
    () => shown,
    time
  )
  moving.to(50, { kind: "off" })
  expect(shown).toBe(50)
  moving.to(500, { kind: "easing", durationMs: 200, bezier: [0, 0, 1, 1] })
  time.run(3)
  moving.stop()
  const stopped = shown
  time.run(10)
  expect(shown).toBe(stopped)
  shown = 80 // the hand moved it
  expect(moving.value).toBe(80)
})
