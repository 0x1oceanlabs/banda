/**
 * The Mark's rhythm (ADR 0099, decision 4): what each look does over and
 * over, as keyframes, and where each Agent stands in it. Pure, so plain
 * tests cover it.
 *
 * The loops play on the compositor, as CSS keyframes on the mark's SVG
 * groups (`styles/marks.css`), so a mark that only lives costs the main
 * thread nothing (ADR 0088, decision 9). The same keyframes draw a look on
 * the window's clock while news plays (`banda-mark.tsx`), so when the news
 * ends the keyframes take over from the pose it left, with no jump.
 * marks.css is written from `LOOPS` and `LOOPED`; mark-rhythm.test.ts holds
 * the two equal.
 */
import { bezierAt } from "./ease"
import type { MarkState } from "./mark-state"

/** A call: asks hops, failed shakes, woke rings, each in its first 0.6 to
 * 0.7 s, then the mark is still. */
export const CALL = 4.4
/** The eyes close once. */
const BLINK = 3.7
/** An awake mark breathes. */
const BREATH = 2.6
/** An asleep one breathes slower. */
const SLEEP = 4.2

/** Which of the mark's groups a loop moves, from the outermost: where it
 * stands, how it leans, its size, where its eyes look, its lids, woke's
 * bells and offline's snores. */
export type Part = "move" | "turn" | "size" | "look" | "lid" | "bell" | "z"

/** How a keyframe goes to the next: straight, held until the next, or as
 * a sine's quarter (`in`, `out`) or half (`inOut`). */
export type Ease = "linear" | "hold" | "in" | "out" | "inOut"

/** A keyframe: where in the period, as a fraction; its values, by its
 * loop's part (a move's x and y, a turn's degrees, a size's x and y, a
 * look's x and y, how shut a lid is, a bell's degrees, a snore's x, y,
 * size and opacity); how it goes to the next. */
export type Key = readonly [at: number, values: readonly number[], ease: Ease]

export type Loop = {
  readonly part: Part
  /** Seconds. */
  readonly period: number
  readonly keys: readonly Key[]
}

/** `value` to three places, as marks.css writes it, never -0. */
const round = (value: number) => Math.round(value * 1000) / 1000 || 0

/** A keyframe at `seconds` into `period`, rounded as marks.css writes it. */
function key(
  seconds: number,
  period: number,
  values: readonly number[],
  ease: Ease = "linear"
): Key {
  return [round((seconds / period) * 100) / 100, values.map(round), ease]
}

/** From `high` to `low` and back, as a sine. */
function wave(
  part: Part,
  period: number,
  high: readonly number[],
  low: readonly number[]
): Loop {
  return {
    part,
    period,
    keys: [
      key(0, period, high, "inOut"),
      key(period / 2, period, low, "inOut"),
      key(period, period, high),
    ],
  }
}

/** Each value from its second on, jumped to at once, as eyes that look
 * here, then there; the last until the period ends. */
function held(
  part: Part,
  period: number,
  steps: readonly (readonly [seconds: number, values: readonly number[]])[]
): Loop {
  const keys = steps.map(([seconds, values]) =>
    key(seconds, period, values, "hold")
  )
  return {
    part,
    period,
    keys: [...keys, key(period, period, steps.at(-1)![1])],
  }
}

/**
 * A swing that dies away over `length` seconds at the start of a call, at
 * `rate` radians a second: a keyframe at each quarter swing, its values
 * those `at` gives for where the swing is (1, 0 or -1) and how much of it
 * is left; then still.
 */
function swing(
  part: Part,
  { rate, length }: { rate: number; length: number },
  at: (swing: number, left: number) => readonly number[]
): Loop {
  const quarter = Math.PI / 2 / rate
  const keys: Key[] = []
  // From the middle a swing slows to its end, and from its end it speeds
  // back to the middle, as a sine does.
  for (let k = 0; k * quarter < length; k++)
    keys.push(
      key(
        k * quarter,
        CALL,
        at(Math.round(Math.sin((k * Math.PI) / 2)), 1 - (k * quarter) / length),
        k % 2 ? "in" : "out"
      )
    )
  const still = at(0, 0)
  return {
    part,
    period: CALL,
    keys: [...keys, key(length, CALL, still), key(CALL, CALL, still)],
  }
}

/** The stop sign's shake (ADR 0099, decision 1), as marks-final.html's. */
const SHAKE = { rate: 45, length: 0.6 }
/** Woke's alarm clock rings, its bells faster than its body. */
const RING = { rate: 55, length: 0.7 }

/** The lids close to a slit: the eye shows this much of itself less. */
export const LID = 0.92

/** How long one line of reading takes, and its return. */
const LINE = 1.5
const READ = 0.85

/** Every loop a look plays, by its name in marks.css (`mark-<name>`). */
export const LOOPS = {
  // Open and done breathe; their eyes blink.
  breath: wave("size", BREATH, [0.988, 1.03], [1.012, 0.97]),
  blink: held("lid", BLINK, [
    [0, [1]],
    [0.12, [0]],
  ]),
  // Open looks around, as marks-final.html's.
  "look-around": held("look", 6, [
    [0, [0, 0]],
    [1, [-3.4, 0]],
    [2.6, [3.4, 0]],
    [4.4, [0, 0]],
  ]),
  // Asks hops twice, the second lower.
  hop: {
    part: "move",
    period: CALL,
    keys: [
      key(0, CALL, [0, 0], "out"),
      key(0.15, CALL, [0, -6], "in"),
      key(0.3, CALL, [0, 0]),
      key(0.35, CALL, [0, 0], "out"),
      key(0.5, CALL, [0, -4], "in"),
      key(0.65, CALL, [0, 0]),
      key(CALL, CALL, [0, 0]),
    ],
  },
  // Failed shakes side to side, and turns with it.
  shake: swing("move", SHAKE, (swing, left) => [2.4 * swing * left, 0]),
  "shake-turn": swing("turn", SHAKE, (swing, left) => [
    1.2 * 2.4 * swing * left,
  ]),
  // Woke rings: it lifts and settles, its bells swing, then it looks
  // round (ADR 0099, decision 1).
  ring: swing("move", RING, (swing, left) => [0.8 * swing * left, -1.5 * left]),
  "ring-turn": swing("turn", RING, (swing, left) => [3 * swing * left]),
  bells: swing("bell", RING, (swing, left) => [14 * swing * left]),
  "look-round": held("look", CALL, [
    [0, [0, 0]],
    [1.4, [-3.4, 0]],
    [2.4, [3.4, 0]],
    [3.4, [0, 0]],
  ]),
  // Later sleeps; offline sleeps deeper, and snores.
  sleep: wave("size", SLEEP, [1.02, 1.04], [0.98, 0.96]),
  snore: wave("size", SLEEP, [1.02, 1.045], [0.98, 0.955]),
  zz: {
    part: "z",
    period: 2.2,
    keys: [0, 0.25, 0.5, 0.75, 1].map((q) =>
      key(q * 2.2, 2.2, [12 * q, -24 * q, 1 + q, Math.sin(Math.PI * q)])
    ),
  },
  // The Agent thinks: eyes up, a slow sway, and a slower bob.
  sway: wave("turn", 4.5, [5], [-5]),
  bob: wave("move", 2.2, [0, -1.5], [0, 1.5]),
  ponder: wave("look", 7, [0.8, 0], [-0.8, 0]),
  "blink-slow": held("lid", 3.4, [
    [0, [1]],
    [0.11, [0]],
  ]),
  // At work, until it says what it does (ADR 0099, step 3): its eyes read
  // three lines, each to its end and back, half shut on the way back.
  work: wave("size", 3.1, [0.99, 1.02], [1.01, 0.98]),
  scan: {
    part: "look",
    period: 3 * LINE,
    keys: [0, 1, 2]
      .flatMap((line) => [
        key(line * LINE, 3 * LINE, [-3.2, 1.4 * line]),
        key((line + READ) * LINE, 3 * LINE, [3.2, 1.4 * line]),
      ])
      .concat([key(3 * LINE, 3 * LINE, [-3.2, 0])]),
  },
  "scan-lid": held("lid", LINE, [
    [0, [0]],
    [READ * LINE, [(1 - 0.25 / 0.62) / LID]],
  ]),
} satisfies Record<string, Loop>

type LoopName = keyof typeof LOOPS

/** Each look's loops (ADR 0099, decision 1). Rest has none, nor does a
 * look drawn still. */
export const LOOPED: Partial<Record<MarkState, readonly LoopName[]>> = {
  idle: ["breath", "look-around", "blink"],
  done: ["breath"],
  woke: ["ring", "ring-turn", "bells", "look-round", "blink"],
  asking: ["hop", "blink"],
  failed: ["shake", "shake-turn"],
  later: ["sleep"],
  offline: ["snore", "zz"],
  thinking: ["bob", "sway", "ponder", "blink-slow"],
  running: ["work", "scan", "scan-lid"],
}

/** Each `Ease` as a cubic Bézier, as CSS's `cubic-bezier()` takes it. */
export const BEZIER: Readonly<
  Record<"in" | "out" | "inOut", readonly [number, number, number, number]>
> = {
  in: [0.12, 0, 0.39, 0],
  out: [0.61, 1, 0.88, 1],
  inOut: [0.37, 0, 0.63, 1],
}

/** How far `ease` has gone at `x`, of 0 to 1, as CSS plays it. */
export function eased(ease: Ease, x: number): number {
  if (ease === "linear") return x
  if (ease === "hold") return x < 1 ? 0 : 1
  return bezierAt(BEZIER[ease], x)
}

/** `loop`'s values at `at` seconds of its mark's rhythm, as CSS plays its
 * keyframes. */
export function valueAt(loop: Loop, at: number): readonly number[] {
  const t = (((at % loop.period) + loop.period) % loop.period) / loop.period
  const { keys } = loop
  let i = 0
  while (i < keys.length - 2 && keys[i + 1]![0] <= t) i++
  const [from, a, ease] = keys[i]!
  const [to, b] = keys[i + 1]!
  const m = eased(ease, to > from ? (t - from) / (to - from) : 1)
  return a.map((value, n) => value + (b[n]! - value) * m)
}

/** How far each Agent's rhythm stands from the clock's, at most: an hour,
 * longer than any loop. */
const SPREAD = 3600
/** Where the rhythm's seconds start again: long enough that no mark sees
 * it, short enough to stay exact as CSS seconds. */
const SPAN = 1_000_000

/**
 * The seconds of `beat`'s rhythm at `wall`, the clock's seconds: the same
 * Thread on the same beat in every window, each Thread on its own (ADR
 * 0099, decision 4), from a stable hash of `beat`, its Thread's id.
 * marks.css starts each loop that far in, as a negative delay.
 */
export function phaseOf(beat: string, wall: number): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < beat.length; i++) {
    hash ^= beat.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (wall + ((hash >>> 0) / 2 ** 32) * SPREAD) % SPAN
}
