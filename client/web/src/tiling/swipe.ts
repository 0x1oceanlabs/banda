/**
 * Wheel events as swipes, the way niri reads a touchpad. A touchpad sends
 * one swipe as a run of wheel events, its glide after the fingers lift
 * included; a mouse wheel sends one event a notch. Each swipe goes one way,
 * sideways or up and down, picked as it starts and kept to its end, so a
 * hand's drift in a long scroll up a Thread moves nothing sideways.
 */

/** A pause this long, in milliseconds, ends a swipe. */
export const SWIPE_END = 160

/** How far a swipe goes, in pixels, before it picks its way. */
const PICK = 8

/** How fast a touchpad's glide slows, a share kept each millisecond:
 * niri's and GNOME's. */
const DECELERATION = 0.997

/** How far a throw carries, in seconds of its speed: where it would come
 * to rest by itself, slowing as `DECELERATION` says (about a third). */
export const THROW = -1 / (1000 * Math.log(DECELERATION))

/** How long, in milliseconds, a gesture's speed is read over: niri's. */
const HISTORY = 150

/** How many steps in a row falling off evenly say the fingers lifted. */
const FALLING = 5

/**
 * A gesture's speed, as niri's `SwipeTracker` reads it: all it moved in
 * its last `HISTORY` ms over the time since, the idle time before it was
 * let go included, so a hand that stopped first throws nothing.
 */
export class Tracker {
  private steps: { at: number; delta: number }[] = []

  /** It moved `delta` at `at` milliseconds. */
  push(delta: number, at: number): void {
    this.steps.push({ at, delta })
    this.steps = this.steps.filter((step) => at - step.at <= HISTORY)
  }

  /** Its speed at `now`, in units a second. */
  speed(now: number): number {
    const steps = this.steps.filter((step) => now - step.at <= HISTORY)
    const first = steps[0]
    if (!first || now === first.at) return 0
    const moved = steps.reduce((sum, step) => sum + step.delta, 0)
    return (moved / (now - first.at)) * 1000
  }

  clear(): void {
    this.steps = []
  }
}

/** A pixel count for a wheel event's line and page units. */
const LINE = 16
const PAGE = 800

/** Which way a swipe goes. */
export type Way = "sideways" | "upright"

/** The pixels a wheel event moves by, whatever unit it came in. */
export function pixels(event: {
  deltaX: number
  deltaY: number
  deltaMode: number
}): { x: number; y: number } {
  const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? PAGE : 1
  return { x: event.deltaX * unit, y: event.deltaY * unit }
}

/**
 * The swipe under way: how far it has gone each way, and the way it goes
 * once it has picked one. It picks sideways only when it goes clearly more
 * sideways than up or down.
 */
export class Swipe {
  x = 0
  y = 0
  way: Way | undefined
  /** Its speed sideways. */
  readonly tracker = new Tracker()
  private last = -Infinity
  private start = 0
  private thrown = false
  /** Its last steps sideways, by size, for the glide; and the largest. */
  private sizes: number[] = []
  private peak = 0

  /** Takes one wheel event, sent at `at` milliseconds. True when the event
   * begins a new swipe. */
  add(x: number, y: number, at: number): boolean {
    const begins = at - this.last > SWIPE_END
    this.last = at
    const size = Math.abs(x)
    // The fingers came back while the glide of the last throw still ran:
    // a step rose again, after it was thrown.
    const rose =
      !begins && this.thrown && size > 1.6 * (this.sizes.at(-1) ?? 0) + 3
    if (begins) {
      this.x = 0
      this.y = 0
      this.way = undefined
    }
    if (begins || rose) {
      this.start = at
      this.thrown = false
      this.sizes = []
      this.peak = 0
      this.tracker.clear()
    }
    this.tracker.push(x, at)
    this.sizes = [...this.sizes.slice(1 - FALLING), size]
    this.peak = Math.max(this.peak, size)
    this.x += x
    this.y += y
    if (this.way === undefined && Math.hypot(this.x, this.y) >= PICK) {
      this.way =
        Math.abs(this.x) > 2 * Math.abs(this.y) ? "sideways" : "upright"
    }
    return begins
  }

  /**
   * Whether the fingers have lifted: a touchpad says nothing of it, but
   * its steps then fall off evenly, as the system's glide slows. Once it
   * says so, the swipe is thrown: what the glide sends after is not the
   * hand's, until the fingers come back or a new swipe begins.
   */
  lifted(): boolean {
    if (this.thrown) return false
    const last = this.sizes
    const falling =
      last.length === FALLING &&
      last.every((one, i) => i === 0 || one <= last[i - 1]!) &&
      last.at(-1)! < last[0]!
    this.thrown =
      falling && last.at(-1)! < 0.7 * this.peak && this.last - this.start > 60
    return this.thrown
  }

  /** Thrown: the fingers lifted, and the glide that follows is not theirs. */
  get gliding(): boolean {
    return this.thrown
  }
}

/**
 * Whether something between `target` and `stop` scrolls sideways by itself,
 * as a wide table or a long line of code does: a sideways swipe over it is
 * its own.
 */
export function scrollsSideways(target: EventTarget | null, stop: Element) {
  for (
    let element = target instanceof Element ? target : null;
    element && element !== stop;
    element = element.parentElement
  ) {
    const { overflowX } = getComputedStyle(element)
    if (
      (overflowX === "auto" || overflowX === "scroll") &&
      element.scrollWidth > element.clientWidth + 1
    ) {
      return true
    }
  }
  return false
}
