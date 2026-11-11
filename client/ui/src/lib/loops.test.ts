// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest"

/** A CSS animation as Chromium keeps one, enough for the loops: its time
 * runs with the page's clock while it plays, and holds while paused. */
class Loop {
  animationName: string
  timeline: unknown
  effect: {
    target: Element
    pseudoElement: string | null
    getTiming: () => { iterations: number }
  }
  playState: "running" | "paused" | "idle" = "running"
  #start: number | null
  #hold: number | null = null

  constructor(
    target: Element,
    name: string,
    {
      iterations = Infinity,
      timeline = document.timeline as unknown,
      pseudo = "",
    }: { iterations?: number; timeline?: unknown; pseudo?: string } = {}
  ) {
    this.animationName = name
    this.timeline = timeline
    this.effect = {
      target,
      pseudoElement: pseudo || null,
      getTiming: () => ({ iterations }),
    }
    this.#start = performance.now()
  }
  get currentTime(): number | null {
    if (this.playState === "idle") return null
    return this.#hold ?? performance.now() - this.#start!
  }
  set currentTime(time: number) {
    if (this.playState === "paused") this.#hold = time
    else this.#start = performance.now() - time
  }
  get startTime(): number | null {
    return this.playState === "paused" ? null : this.#start
  }
  set startTime(at: number) {
    // As the Web Animations API has it: a start plays it.
    this.#start = at
    this.#hold = null
    this.playState = "running"
  }
  pause() {
    this.#hold = this.currentTime
    this.playState = "paused"
  }
  play() {
    this.#start = performance.now() - (this.#hold ?? 0)
    this.#hold = null
    this.playState = "running"
  }
  cancel() {
    this.playState = "idle"
  }
}

/** The loops' clock afresh, over a page whose animations are `all`. */
async function loops() {
  vi.resetModules()
  const all: Loop[] = []
  document.getAnimations = () => all as unknown as Animation[]
  const module = await import("./loops")
  /** `name` starts on `element`, as CSS starts one, and says so. */
  const start = (
    element: Element,
    name: string,
    options?: ConstructorParameters<typeof Loop>[2]
  ) => {
    const loop = new Loop(element, name, options)
    all.push(loop)
    element.getAnimations = () =>
      all.filter(
        (one) => one.effect.target === element && one.playState !== "idle"
      ) as unknown as Animation[]
    const event = new Event("animationstart", { bubbles: true })
    Object.assign(event, {
      animationName: name,
      pseudoElement: options?.pseudo ?? "",
    })
    element.dispatchEvent(event)
    return loop
  }
  return { ...module, start }
}

/** An element in the page. */
function element(html = "<span></span>"): Element {
  const box = document.createElement("div")
  box.innerHTML = html
  document.body.append(box)
  return box.firstElementChild!
}

const STEP = 1000 / 12
let stop = () => {}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
  document.body.innerHTML = ""
})

afterEach(() => {
  stop()
  vi.useRealTimers()
})

test("a loop is held as it starts, and steps 12 times a second to where it would be had it played", async () => {
  const { stepLoops, start } = await loops()
  stop = stepLoops(document)
  vi.advanceTimersByTime(30)
  const loop = start(element(), "mark-breath")
  expect(loop.playState).toBe("paused")
  const times: number[] = []
  for (let i = 0; i < 12; i++) {
    const before = loop.currentTime
    vi.advanceTimersByTime(STEP / 4)
    // Still between steps.
    expect(loop.currentTime).toBe(before)
    vi.advanceTimersByTime((STEP * 3) / 4)
    times.push(loop.currentTime!)
  }
  // Stepped 12 times in a second, it stands where the last step put it:
  // the time since it started, 30 ms in.
  expect(new Set(times).size).toBe(12)
  const last = Math.floor(performance.now() / STEP) * STEP
  expect(times.at(-1)).toBeGreaterThanOrEqual(last - 30)
  expect(times.at(-1)).toBeLessThan(last - 30 + 1)
  expect(loop.playState).toBe("paused")
})

test("every loop steps at once, on steps they share", async () => {
  const { stepLoops, start } = await loops()
  stop = stepLoops(document)
  const first = start(element(), "mark-breath")
  vi.advanceTimersByTime(STEP * 2.5)
  const second = start(element(), "spin")
  const changed: number[] = []
  let was = [first.currentTime, second.currentTime]
  for (let t = 0; t < 1000; t += 5) {
    vi.advanceTimersByTime(5)
    const now = [first.currentTime, second.currentTime]
    if (now[0] !== was[0] || now[1] !== was[1]) {
      // Both moved in the same step, never one alone.
      expect(now[0]).not.toBe(was[0])
      expect(now[1]).not.toBe(was[1])
      changed.push(performance.now())
    }
    was = now
  }
  expect(changed.length).toBe(12)
})

test("what ends, a scroll's animation and one made in script are not loops", async () => {
  const { stepLoops, start } = await loops()
  stop = stepLoops(document)
  const swell = start(element(), "group-swell", { iterations: 2 })
  const fade = start(element(), "scroll-fade-reveal-t", {
    timeline: { scroll: true },
  })
  vi.advanceTimersByTime(STEP * 3)
  expect(swell.playState).toBe("running")
  expect(fade.playState).toBe("running")
})

test("a pseudo-element's loop is held too", async () => {
  const { stepLoops, start } = await loops()
  stop = stepLoops(document)
  const meter = element()
  meter.getAnimations = () => []
  const sheen = start(meter, "update-sheen", { pseudo: "::after" })
  expect(sheen.playState).toBe("paused")
})

test("a loop CSS takes away is let go, and the clock stops once none loops", async () => {
  const { stepLoops, start } = await loops()
  stop = stepLoops(document)
  const loop = start(element(), "mark-blink")
  vi.advanceTimersByTime(STEP)
  loop.cancel()
  document.dispatchEvent(new Event("animationcancel"))
  vi.advanceTimersByTime(STEP)
  expect(vi.getTimerCount()).toBe(0)
})

test("a loop whose element left the page is let go", async () => {
  const { stepLoops, start } = await loops()
  stop = stepLoops(document)
  const mark = element()
  start(mark, "mark-blink")
  mark.parentElement!.remove()
  vi.advanceTimersByTime(STEP * 2)
  expect(vi.getTimerCount()).toBe(0)
})

test("a loop inside [data-paused] waits, and none steps while the page is hidden", async () => {
  const { stepLoops, start } = await loops()
  stop = stepLoops(document)
  const out = element('<svg data-paused><g class="mark-loop"></g></svg>')
  const held = start(out.firstElementChild!, "mark-breath")
  const shown = start(element(), "mark-blink")
  const at = held.currentTime
  vi.advanceTimersByTime(STEP * 3)
  expect(held.currentTime).toBe(at)
  expect(shown.currentTime).toBeGreaterThan(at!)

  let hidden = true
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  })
  const was = shown.currentTime!
  vi.advanceTimersByTime(STEP * 3)
  expect(shown.currentTime).toBe(was)
  hidden = false
  // Shown again, it stands where it would be had it played, at the next
  // step: a whole millisecond late at most, as setTimeout keeps them.
  vi.advanceTimersByTime(STEP + 1)
  expect(shown.currentTime!).toBeGreaterThan(was + STEP * 4 - 2)
  expect(shown.currentTime!).toBeLessThan(was + STEP * 4 + 2)
  delete (document as { hidden?: boolean }).hidden
})

test("a time set from outside is kept: the loop goes on from it", async () => {
  const { stepLoops, start } = await loops()
  stop = stepLoops(document)
  const loop = start(element(), "mark-breath")
  vi.advanceTimersByTime(STEP * 5)
  // A Mark starts its loops on its rhythm again, between two steps: the
  // next one sees it, and goes on from there.
  loop.currentTime = 0
  vi.advanceTimersByTime(STEP)
  expect(loop.currentTime).toBe(0)
  vi.advanceTimersByTime(STEP * 6)
  expect(loop.currentTime!).toBeGreaterThan(STEP * 6 - 2)
  expect(loop.currentTime!).toBeLessThan(STEP * 6 + 2)
  expect(loop.playState).toBe("paused")
})

test("a loop played again from outside is held again at the next step", async () => {
  const { stepLoops, start } = await loops()
  stop = stepLoops(document)
  const loop = start(element(), "group-breath")
  vi.advanceTimersByTime(STEP)
  loop.play()
  vi.advanceTimersByTime(STEP)
  expect(loop.playState).toBe("paused")
})

test("startAt starts a held loop where it says and keeps it held; one not held, as its startTime", async () => {
  const { stepLoops, start, startAt } = await loops()
  stop = stepLoops(document)
  vi.advanceTimersByTime(1000)
  const breath = start(element(), "group-breath")
  vi.advanceTimersByTime(STEP * 2)
  // Every piece of a Group at work breathes from the clock's zero.
  startAt(breath as unknown as Animation, 0)
  expect(breath.playState).toBe("paused")
  vi.advanceTimersByTime(STEP)
  // The step stands where the clock was as it stepped.
  const last = Math.floor(performance.now() / STEP) * STEP
  expect(breath.currentTime!).toBeGreaterThanOrEqual(last)
  expect(breath.currentTime!).toBeLessThan(last + 2)

  const swell = start(element(), "group-swell", { iterations: 1 })
  startAt(swell as unknown as Animation, 500)
  expect(swell.startTime).toBe(500)
  expect(swell.playState).toBe("running")
})

test("letting go plays every loop again, as CSS has it", async () => {
  const { stepLoops, start } = await loops()
  const letGo = stepLoops(document)
  const loop = start(element(), "spin")
  vi.advanceTimersByTime(STEP)
  letGo()
  expect(loop.playState).toBe("running")
  expect(vi.getTimerCount()).toBe(0)
})
