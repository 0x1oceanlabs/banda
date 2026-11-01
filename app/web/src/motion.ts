/**
 * Motion in the window (ADR 0007, decision 9): each event moves on the
 * spring or the easing `bandaso look` resolved for it. Springs run here,
 * frame by frame, so a move sent somewhere else halfway keeps its speed,
 * as niri's do.
 */
import type { Move, Spring } from "@bandaso/contract/look"

/** Where a value is and how fast it goes, per second. */
export interface State {
  value: number
  velocity: number
}

/**
 * A spring's state `t` seconds after it let go `x0` away from its rest,
 * at `v0`: the damped oscillator in closed form, mass 1.
 */
export function springAt(
  spring: Spring,
  x0: number,
  v0: number,
  t: number
): State {
  const position = (t: number) => {
    const w = Math.sqrt(spring.stiffness)
    const z = spring.dampingRatio
    if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z)
      const b = (v0 + z * w * x0) / wd
      return (
        Math.exp(-z * w * t) * (x0 * Math.cos(wd * t) + b * Math.sin(wd * t))
      )
    }
    if (z === 1) return Math.exp(-w * t) * (x0 + (v0 + w * x0) * t)
    const root = w * Math.sqrt(z * z - 1)
    const r1 = -z * w + root
    const r2 = -z * w - root
    const c1 = (v0 - r2 * x0) / (r1 - r2)
    return c1 * Math.exp(r1 * t) + (x0 - c1) * Math.exp(r2 * t)
  }
  const h = 1e-4
  return {
    value: position(t),
    velocity:
      (position(t + h) - position(Math.max(0, t - h))) / (t > h ? 2 * h : h),
  }
}

/** CSS's `cubic-bezier()`: the curve's y at time `t` from 0 to 1. */
export function bezierAt(points: readonly number[], t: number): number {
  const [x1, y1, x2, y2] = points
  const at = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3
  if (t <= 0) return 0
  if (t >= 1) return 1
  // x is monotonic in s for x1, x2 within 0..1: halve until it is t.
  let low = 0
  let high = 1
  for (let i = 0; i < 40; i++) {
    const s = (low + high) / 2
    if (at(x1, x2, s) < t) low = s
    else high = s
  }
  return at(y1, y2, (low + high) / 2)
}

type Frame = (run: (now: number) => void) => number

/** The browser's frames and clock; tests turn their own. */
export interface Clock {
  frame: Frame
  cancel: (id: number) => void
  now: () => number
}

const BROWSER: Clock = {
  frame: (run) => requestAnimationFrame(run),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
}

/**
 * One value that moves: a scroll, a stack's place. `write` puts it on
 * screen; `read` says where it is when nothing moves it, as after a
 * swipe. Sent somewhere new while it moves, it starts from where it is,
 * at the speed it has.
 */
export class Moving {
  #write: (value: number) => void
  #read: () => number
  #clock: Clock
  #value: number
  #velocity = 0
  #target = 0
  #id = 0

  constructor(
    write: (value: number) => void,
    read: () => number,
    clock: Clock = BROWSER
  ) {
    this.#write = write
    this.#read = read
    this.#clock = clock
    this.#value = read()
  }

  get moving(): boolean {
    return this.#id !== 0
  }

  /** Where it is now: on its way, or at rest where `read` says. */
  get value(): number {
    return this.moving ? this.#value : this.#read()
  }

  /** Where it is headed: its target while it moves, else where it is. */
  get target(): number {
    return this.moving ? this.#target : this.value
  }

  /** Moves to `target` as `move` says; `off` jumps there. */
  to(target: number, move: Move): void {
    const from = this.value
    const velocity = this.moving ? this.#velocity : 0
    this.stop()
    if (move.kind === "off" || from === target) {
      this.#land(target)
      return
    }
    const step =
      move.kind === "spring"
        ? springStep(move, from - target, velocity)
        : easingStep(move.durationMs / 1000, move.bezier, from - target)
    // Time runs from now, so its first frame has moved already.
    const start = this.#clock.now()
    const tick = (now: number) => {
      const { value, velocity, done } = step((now - start) / 1000)
      if (done) {
        this.#id = 0
        this.#land(target)
        return
      }
      this.#value = target + value
      this.#velocity = velocity
      this.#write(this.#value)
      this.#id = this.#clock.frame(tick)
    }
    this.#value = from
    this.#velocity = velocity
    this.#target = target
    this.#id = this.#clock.frame(tick)
  }

  /** Stops where it is: a hand took over. */
  stop(): void {
    if (this.#id) this.#clock.cancel(this.#id)
    this.#id = 0
    this.#velocity = 0
  }

  #land(target: number) {
    this.#value = target
    this.#velocity = 0
    this.#write(target)
  }
}

type Step = (t: number) => State & { done: boolean }

function springStep(spring: Spring, x0: number, v0: number): Step {
  // At rest once within epsilon of the way, as niri counts it, and slow.
  const way = Math.abs(x0) + Math.abs(v0) / Math.sqrt(spring.stiffness)
  const near = spring.epsilon * way
  return (t) => {
    const { value, velocity } = springAt(spring, x0, v0, t)
    const done =
      Math.abs(value) < near &&
      Math.abs(velocity) / Math.sqrt(spring.stiffness) < near
    return { value, velocity, done }
  }
}

function easingStep(
  seconds: number,
  bezier: readonly number[],
  x0: number
): Step {
  return (t) => {
    if (t >= seconds) return { value: 0, velocity: 0, done: true }
    const at = (t: number) => x0 * (1 - bezierAt(bezier, t / seconds))
    const h = Math.min(1e-3, seconds / 100)
    return { value: at(t), velocity: (at(t + h) - at(t)) / h, done: false }
  }
}
