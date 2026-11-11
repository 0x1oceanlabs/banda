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
import type { Shown } from "./mark-state"

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
 * bells, offline's snores, the cover of the `>_`'s cursor, and the dot a
 * fetch sends out or the limit's sand drips. */
export type Part =
  "move" | "turn" | "size" | "look" | "lid" | "bell" | "z" | "cursor" | "dot"

/** How a keyframe goes to the next: straight, held until the next, or as
 * a sine's quarter (`in`, `out`) or half (`inOut`). */
export type Ease = "linear" | "hold" | "in" | "out" | "inOut"

/** A keyframe: where in the period, as a fraction; its values, by its
 * loop's part (a move's x and y, a turn's degrees, a size's x and y, a
 * look's x and y, how shut a lid is, a bell's degrees, a snore's x, y,
 * size and opacity, how much the cursor's cover hides it, a dot's x, y
 * and size); how it goes to the next. */
export type Key = readonly [at: number, values: readonly number[], ease: Ease]

export type Loop = {
  readonly part: Part
  /** Seconds. */
  readonly period: number
  readonly keys: readonly Key[]
}

/** Each `Ease` as a cubic Bézier, as CSS's `cubic-bezier()` takes it. */
export const BEZIER: Readonly<
  Record<"in" | "out" | "inOut", readonly [number, number, number, number]>
> = {
  in: [0.12, 0, 0.39, 0],
  out: [0.61, 1, 0.88, 1],
  inOut: [0.37, 0, 0.63, 1],
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
/** One stroke of an edit, and a lap of the search's lens; seconds as
 * marks.css writes them. */
const STROKE = round(2 / 3)
const SWEEP = round((2 * Math.PI) / 1.3)
/** A slow drift of a stuck one's eyes. */
const DRIFT = round(5 * Math.PI)
/** A line typed, of which the keys take the first part. */
const TYPE = 1.3
const TYPING = 0.85
/** The `>_`'s cursor blinks as a terminal's: 530 ms shown, 530 hidden. */
const CURSOR = 0.53
/** A fetch's dot goes out and back. */
const FETCH = 2.4

/** `loop`, whose lids close an eye open `open` of its size, for a mark
 * whose eyes are open in full: each closes the more by that. */
function lidded(loop: Loop, open: number): Loop {
  return {
    ...loop,
    keys: loop.keys.map(([at, [closed], ease]) => [
      at,
      [round((1 - open * (1 - LID * closed!)) / LID)],
      ease,
    ]),
  }
}

/** A part still, its values `values`. */
const still = (part: Part, values: readonly number[]): Loop => ({
  part,
  period: 1,
  keys: [key(0, 1, values), key(1, 1, values)],
})

/** One stretch of a series: how long it lasts, the loop it plays, and
 * what it adds to that loop's values. */
type Stretch = readonly [seconds: number, loop: Loop, add?: readonly number[]]

/** Seconds a stretch of a series takes to blend in from the last. */
const SEAM = 0.35

/** The times in `loop` it has a key, after `from` and before `to`
 * seconds, its period after period. */
function keyTimes(loop: Loop, from: number, to: number): number[] {
  const times: number[] = []
  for (let lap = 0; lap * loop.period < to; lap++)
    for (const [at] of loop.keys.slice(0, -1)) {
      const t = (lap + at) * loop.period
      if (t > from && t < to) times.push(t)
    }
  return times
}

/** How `loop` goes on at `t` seconds: as its key there does. */
function easeAt(loop: Loop, t: number): Ease {
  const q = (((t % loop.period) + loop.period) % loop.period) / loop.period
  return loop.keys.findLast(([at]) => at <= q)![2]
}

/**
 * `part` through `stretches` in turn, as one loop: each plays its own
 * loop for its seconds, the values of each moved by what it adds, and
 * blends into the next over `SEAM` from where the last stood, as
 * marks-final.html's series does. So a calm series of what an Agent does
 * is one CSS loop too, with no class swapped on a timer.
 */
function series(part: Part, stretches: readonly Stretch[]): Loop {
  const period = round(stretches.reduce((sum, [seconds]) => sum + seconds, 0))
  const at = ([, loop, add]: Stretch, t: number) =>
    valueAt(loop, t).map((value, i) => value + (add?.[i] ?? 0))
  const end = (stretch: Stretch) => at(stretch, stretch[0])
  const keys: Key[] = []
  let start = 0
  stretches.forEach((stretch, i) => {
    const [seconds, loop] = stretch
    keys.push(key(start, period, end(stretches.at(i - 1)!), "inOut"))
    for (const t of [SEAM, ...keyTimes(loop, SEAM, seconds)])
      keys.push(key(start + t, period, at(stretch, t), easeAt(loop, t)))
    start += seconds
  })
  keys.push(key(period, period, end(stretches.at(-1)!)))
  return { part, period, keys }
}

/** It reads: its eyes run along three lines, each to its end and back,
 * half shut on the way back, as it swells a little. */
const WORK = wave("size", 3.1, [0.99, 1.02], [1.01, 0.98])
const SCAN: Loop = {
  part: "look",
  period: 3 * LINE,
  keys: [0, 1, 2]
    .flatMap((line) => [
      key(line * LINE, 3 * LINE, [-3.2, 1.4 * line]),
      key((line + READ) * LINE, 3 * LINE, [3.2, 1.4 * line]),
    ])
    .concat([key(3 * LINE, 3 * LINE, [-3.2, 0])]),
}
const SCAN_LID = held("lid", LINE, [
  [0, [0]],
  [READ * LINE, [(1 - 0.25 / 0.62) / LID]],
])

/** It writes its reply: its eyes go along the line as it types, back to
 * its start once it is typed, the body tapping a little at each key. */
const TYPED: Loop = {
  part: "look",
  period: TYPE,
  keys: [
    key(0, TYPE, [-3, 0]),
    key(TYPING, TYPE, [3, 0], "hold"),
    key(TYPE, TYPE, [-3, 0]),
  ],
}
/** A key every seventh of a second, while it types. */
const TAP = 1 / 7
const TAPS: Loop = {
  part: "size",
  period: TYPE,
  keys: [
    ...[0, 1, 2, 3, 4, 5].flatMap((at) => [
      key(at * TAP, TYPE, [1, 1], "out"),
      key((at + 0.25) * TAP, TYPE, [1.012, 0.97], "in"),
      key((at + 0.5) * TAP, TYPE, [1, 1]),
    ]),
    key(TYPE, TYPE, [1, 1]),
  ],
}

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
  // What an Agent at work does (ADR 0099, decision 2), as marks-final.html
  // draws it. It thinks: eyes up, a slow sway, and a slower bob.
  sway: wave("turn", 4.5, [5], [-5]),
  bob: wave("move", 2.2, [0, -1.5], [0, 1.5]),
  ponder: wave("look", 7, [0.8, 0], [-0.8, 0]),
  "blink-slow": held("lid", 3.4, [
    [0, [1]],
    [0.11, [0]],
  ]),
  // It reads.
  work: WORK,
  scan: SCAN,
  "scan-lid": SCAN_LID,
  // It searches: one eye a lens, sweeping a figure of eight.
  sweep: {
    part: "look",
    period: SWEEP,
    keys: Array.from({ length: 17 }, (_, i) => {
      const a = (i / 16) * 2 * Math.PI
      return key((i / 16) * SWEEP, SWEEP, [
        2.6 * Math.cos(a),
        1.8 * Math.sin(2 * a),
      ])
    }),
  },
  // It edits: it tilts with each stroke, its eyes on the line, and
  // presses a little at each end of it.
  stroke: wave("turn", STROKE, [2.5], [-2.5]),
  "stroke-look": wave("look", STROKE, [1.5, 0], [-1.5, 0]),
  "stroke-press": {
    part: "size",
    period: STROKE,
    keys: [0, 1, 2, 3, 4].map((at) =>
      key((at * STROKE) / 4, STROKE, [1, at % 2 ? 1 : 0.985], "inOut")
    ),
  },
  // It runs a command: its eyes are `>_`, the cursor blinking.
  cursor: held("cursor", 2 * CURSOR, [
    [0, [0]],
    [CURSOR, [1]],
  ]),
  // It fetches: it looks far up, and a dot goes out and comes back.
  fetch: {
    part: "dot",
    period: FETCH,
    keys: [
      key(0, FETCH, [102, 6.5, 1], "inOut"),
      key(FETCH / 2, FETCH, [116, -3.5, 1], "inOut"),
      key(FETCH, FETCH, [102, 6.5, 1]),
    ],
  },
  "blink-far": held("lid", 2.9, [
    [0, [1]],
    [0.12, [0]],
  ]),
  // It writes its reply.
  type: TYPED,
  taps: TAPS,
  // Anything else: a calm series of the above, as marks-final.html's: it
  // reads a while, writes, then glances up. Its eyes are open as a reading
  // one's, round, and their lids close them a little more as it writes:
  // its glance up is not the mock's wide open, which lids cannot draw.
  "series-size": series("size", [
    [4.5, WORK],
    [3.9, TAPS],
    [1.8, still("size", [1, 1])],
  ]),
  "series-look": series("look", [
    [4.5, SCAN],
    [3.9, TYPED, [0, 2.2]],
    [1.8, still("look", [2.6, -4.6])],
  ]),
  "series-lid": series("lid", [
    [4.5, SCAN_LID],
    [3.9, lidded(still("lid", [0]), 0.5 / 0.62)],
    [
      1.8,
      held("lid", 1.8, [
        [0, [0]],
        [0.7, [1]],
        [0.82, [0]],
      ]),
    ],
  ]),
  "series-turn": series("turn", [
    [8.4, still("turn", [0])],
    [1.8, still("turn", [-2])],
  ]),
  // It compacts the context: it squeezes, its eyes shut, and lets go.
  squeeze: wave("size", 2.2, [1, 1], [0.8, 1.06]),
  "squeeze-lid": held("lid", 2.2, [
    [0, [0]],
    [0.51, [1]],
    [1.69, [0]],
  ]),
  // Stuck, with nothing said for minutes: its half-shut eyes drift, and
  // it breathes as one asleep.
  drift: wave("look", DRIFT, [2, 0], [-2, 0]),
  drowse: wave("size", SLEEP, [1, 1.031], [1, 0.969]),
  // At its limit: it dozes, and sand drips beside it.
  doze: wave("size", SLEEP, [1, 1.03], [1, 0.97]),
  sand: {
    part: "dot",
    period: 1.8,
    keys: [0, 0.25, 0.5, 0.75, 1].map((q) =>
      key(q * 1.8, 1.8, [106, 8.5 + 26 * q, Math.sin(Math.PI * q)])
    ),
  },
} satisfies Record<string, Loop>

type LoopName = keyof typeof LOOPS

/** The loops that call the Person, the rhythm's second layer: asks hops,
 * failed shakes, woke rings and looks round. The open Thread's mark plays
 * none of them, and its other loops play on (ADR 0099, decision 5). */
export const CALLS: ReadonlySet<LoopName> = new Set<LoopName>([
  "hop",
  "shake",
  "shake-turn",
  "ring",
  "ring-turn",
  "bells",
  "look-round",
])

/** Each look's loops (ADR 0099, decision 1), and for one at work, those of
 * what its Agent does (decision 2). Rest has none, nor does a look drawn
 * still. */
export const LOOPED: Partial<Record<Shown, readonly LoopName[]>> = {
  idle: ["breath", "look-around", "blink"],
  done: ["breath"],
  woke: ["ring", "ring-turn", "bells", "look-round", "blink"],
  asking: ["hop", "blink"],
  failed: ["shake", "shake-turn"],
  later: ["sleep"],
  offline: ["snore", "zz"],
  think: ["bob", "sway", "ponder", "blink-slow"],
  read: ["work", "scan", "scan-lid"],
  search: ["sweep"],
  edit: ["stroke", "stroke-look", "stroke-press"],
  execute: ["cursor"],
  fetch: ["fetch", "blink-far"],
  reply: ["type", "taps"],
  other: ["series-size", "series-look", "series-lid", "series-turn"],
  compacting: ["squeeze", "squeeze-lid"],
  stuck: ["drift", "drowse"],
  limit: ["doze", "sand"],
}

/** Seconds into its period `loop` is still from: its values stay its
 * last ones from there to the period's end. */
function stillFrom({ keys, period }: Loop): number {
  const last = keys.at(-1)![1]
  const same = (values: readonly number[]) =>
    values.every((value, i) => value === last[i])
  let from = keys.length - 1
  while (from > 0 && same(keys[from - 1]![1])) from--
  return keys[from]![0] * period
}

/** Seconds into `CALL` each look's call ends: the last of its call loops
 * to come to rest. None for a look that calls no one. */
const CALL_ENDS: Partial<Record<Shown, number>> = Object.fromEntries(
  Object.entries(LOOPED).flatMap(([look, names]) => {
    const calls = names.filter((name) => CALLS.has(name))
    return calls.length
      ? [[look, Math.max(...calls.map((name) => stillFrom(LOOPS[name])))]]
      : []
  })
)

/** Seconds left of the call `look` is in at `at` seconds of its mark's
 * rhythm: 0 between two calls, and for a look that calls no one. */
export function callLeft(look: Shown, at: number): number {
  const end = CALL_ENDS[look] ?? 0
  const into = ((at % CALL) + CALL) % CALL
  return into < end ? end - into : 0
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
