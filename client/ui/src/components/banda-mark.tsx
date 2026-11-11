import { useEffect, useId, useRef } from "react"
import { onDraw } from "../lib/frames"
import {
  LID,
  LOOPED,
  LOOPS,
  type Part,
  phaseOf,
  valueAt,
} from "../lib/mark-rhythm"
import { cn } from "../lib/utils"
import type { Listed } from "../pane"
import {
  type MarkDoing,
  type MarkState,
  type Shown,
  shownOf,
  works,
} from "../lib/mark-state"
import { type Held, heldDoing, HOLD } from "../status"

export {
  loudest,
  MARK_ORDER,
  type MarkDoing,
  type MarkState,
  works,
} from "../lib/mark-state"

/** A Group's colour, by its Agent's state, as the sidebar marks it:
 * none for a Group with no Agent, or one at rest (ADR 0065, decision 6).
 * An element with it as `data-state` takes it as `--group-color`, as a
 * Group's plate, the bar's map and a lent tab's chip do. */
export type GroupState = "working" | "asking" | "done" | "failed"

export function groupState(
  mark: MarkState | undefined
): GroupState | undefined {
  if (!mark) return undefined
  if (works(mark)) return "working"
  if (mark === "asking" || mark === "done") return mark
  if (mark === "failed" || mark === "offline") return "failed"
  return undefined
}

/** A colour of the theme a mark's Agent is drawn in, by its name. */
export type MarkColor = "attention" | "destructive" | "added" | "woke" | "muted"

/**
 * The colour each look's Agent is drawn in (ADR 0099, decision 1): a
 * question's, a failure's, done's green and woke's yellow, which call the
 * Person, and offline muted, as it sleeps. The rest take the text's. The
 * one list both a live mark (`toneOf`) and a still one (`stillMark`) read.
 */
const COLOR_OF: Partial<Record<MarkState, MarkColor>> = {
  asking: "attention",
  failed: "destructive",
  done: "added",
  woke: "woke",
  offline: "muted",
}

/** The colour of a look that calls its Person (ADR 0099, decision 1),
 * on a card's mark and its time alone (ADR 0098, decision 8); none for
 * the rest. */
export type CallColor = Exclude<MarkColor, "muted">

/** The colour `look` calls its Person in; none for a look that calls no
 * one, offline among them. */
export function callColor(look: MarkState): CallColor | undefined {
  const color = COLOR_OF[look]
  return color === "muted" ? undefined : color
}

/** Each colour as a class, written out whole so that Tailwind finds it. */
export const COLOR_CLASS: Readonly<Record<MarkColor, string>> = {
  attention: "text-attention",
  destructive: "text-destructive",
  added: "text-added",
  woke: "text-woke",
  muted: "text-muted-foreground",
}

/** The colour a mark's look is drawn in, as a class: a call's, or
 * offline's muted; none for the rest, which take the text's. */
export function toneOf(mark: MarkState): string | undefined {
  const color = COLOR_OF[mark]
  return color && COLOR_CLASS[color]
}

/** The class of the logo's hat: its look's colour, and at work a working
 * Mark's blue (ADR 0107, decision 3). An Agent's tile alone at work is
 * coloured by who draws it, a Thread's mark by its weight, the bar's
 * counts grey. */
function hatOf(mark: MarkState, variant: "logo" | "agent") {
  return variant === "logo" && works(mark) ? "text-mark-working" : toneOf(mark)
}

/** Plain words for each state, for a title or a screen reader. */
export const MARK_WORDS: Record<MarkState, string> = {
  rest: "Nothing runs",
  idle: "Open",
  working: "Working",
  asking: "Asks you",
  done: "Done",
  failed: "Failed",
  offline: "Offline",
  woke: "Woke",
  later: "Later",
}

/** Where a mark's masks reach, in its user space: past every pose. */
const REACH = { x: "-60", y: "-90", width: "260", height: "260" } as const

/** Each eye's two lids, the top one first. */
const LIDS = ["top", "bottom", "top", "bottom"] as const

export function BandaMark({
  state = "rest",
  doing,
  variant = "logo",
  playful = 30,
  news = false,
  tone = true,
  beat = "",
  label,
  className,
}: {
  state?: MarkState
  /** What its Agent does, at work (`lookOf`): shown once what it showed
   * held (`heldDoing`), and said by `data-doing`. Without, the logo's
   * calm series. */
  doing?: MarkDoing
  /** `logo`: the three tiles; `agent`: the Agent's tile alone. */
  variant?: "logo" | "agent"
  /** Seconds between the logo's tricks while at rest; 0 for none. */
  playful?: number
  /**
   * Whether the look it is first drawn in is news: done flips into it and
   * woke arrives asleep, as on a toast that tells it. Without, a mark
   * drawn for the first time starts in its look as if it had been there
   * (ADR 0099, decision 4); one drawn for a Thread whose mark went just
   * before, in another look, is that mark moved, and plays the change.
   */
  news?: boolean
  /** Whether its Agent takes its look's colour (`toneOf`); without, it is
   * the text's, as the bar's counts are when their Person turns colour
   * off. */
  tone?: boolean
  /** Whose rhythm it keeps, its Thread's id: one Thread's mark moves on
   * the same beat wherever it shows, on every machine, and each Thread on
   * its own. */
  beat?: string
  /** Names the mark for a screen reader; without it the mark is decoration. */
  label?: string
  className?: string
}) {
  const svg = useRef<SVGSVGElement>(null)
  const animator = useRef<Animator | null>(null)
  const holes = `banda-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const eyes = `${holes}-eyes`

  useEffect(() => {
    const element = svg.current
    if (!element) return
    const created = new Animator(element, variant)
    animator.current = created
    return () => {
      created.dispose()
      animator.current = null
    }
  }, [variant])

  useEffect(() => {
    animator.current?.set({ state, doing, playful, news, beat })
  }, [state, doing, playful, news, beat, variant])

  const logo = variant === "logo"
  return (
    <svg
      ref={svg}
      viewBox={logo ? "0 0 100 100" : "48 -6 56 56"}
      data-slot="banda-mark"
      data-look={state}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("size-5 shrink-0 overflow-visible", className)}
    >
      <defs>
        <mask id={holes} maskUnits="userSpaceOnUse" {...REACH}>
          <rect {...REACH} fill="#fff" />
          <ellipse data-eye fill="#000" />
          <ellipse data-eye fill="#000" />
          <path
            data-glyph
            fill="none"
            stroke="#000"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
        {/* The eyes alone, where the lids show as they close. */}
        <mask id={eyes} maskUnits="userSpaceOnUse" {...REACH}>
          <ellipse data-lens fill="#fff" />
          <ellipse data-lens fill="#fff" />
        </mask>
      </defs>
      {logo && (
        <>
          <rect
            x="0"
            y="0"
            width="42"
            height="100"
            rx="15"
            fill="currentColor"
          />
          <rect
            x="52"
            y="55"
            width="48"
            height="45"
            rx="15"
            fill="currentColor"
          />
        </>
      )}
      {/* The Agent: its hat and what it does take its look's colour,
          and on the logo only they do; the two tiles under it stay the
          text's (ADR 0099, decision 9). */}
      <g
        data-agent
        fill="currentColor"
        className={tone ? hatOf(state, variant) : undefined}
      >
        {/* Its snores, where marks.css's rise from; still, where a still
            mark draws them. */}
        <g data-zz opacity="0" fontWeight="700">
          {[0, 1, 2].map((at) => (
            <text
              key={at}
              className="mark-loop mark-z"
              x={RISING.x}
              y={RISING.y}
              fontSize={RISING.size}
              opacity={RISING.opacity}
            >
              z
            </text>
          ))}
        </g>
        {/* The dot a fetch sends out and the limit's sand: drawn about its
            own middle, where marks.css's loops move it from. */}
        <circle data-dot className="mark-loop mark-dot" r="0" opacity="0.9" />
        {/* Its pose, in the four turns `drawnOf` writes, each with the
            loop marks.css plays inside it: where it stands, how it leans,
            its size, then its spin, which no loop takes. */}
        <g data-move>
          <g className="mark-loop mark-move">
            <g data-turn>
              <g className="mark-loop mark-turn">
                <g data-size>
                  <g className="mark-loop mark-size">
                    <g data-spin>
                      {/* Its eyes look about while the body stays: the
                          group the eyes' mask holds moves, and the body
                          in it moves back. */}
                      <g className="mark-loop mark-look">
                        <g mask={`url(#${holes})`}>
                          <g className="mark-loop mark-unlook">
                            <path data-body />
                          </g>
                        </g>
                      </g>
                      <g className="mark-loop mark-look">
                        <g mask={`url(#${eyes})`}>
                          {LIDS.map((lid, at) => (
                            <rect
                              key={at}
                              className="mark-loop mark-lid"
                              data-lid={lid}
                            />
                          ))}
                        </g>
                        {/* What covers the `>_`'s cursor as it blinks. */}
                        <path
                          data-cursor
                          className="mark-loop mark-cursor"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="4.6"
                          strokeLinecap="round"
                        />
                      </g>
                      <g data-bells opacity="0">
                        {[0, 1].map((at) => (
                          <g key={at} data-bell>
                            <g className="mark-loop mark-bell">
                              <path d={BELL} />
                            </g>
                          </g>
                        ))}
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
        {/* The slot of its sub-agents' satellites (ADR 0099, decision 3),
            which the sub-agents' work draws: in the Agent's colour, a
            working Mark's blue (ADR 0107, decision 3). */}
        <g data-satellites />
      </g>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// The motion, in layers (ADR 0099, decision 4). A look's loops and calls
// play as CSS keyframes on the SVG's groups (marks.css), on the compositor:
// they cost the main thread nothing. News, a look that changes, plays on the
// window's clock for as long as it lasts, writing the SVG's attributes, as
// the logo's tricks do; then it hands the look back to the keyframes, from
// the pose they take it on.

/** How its eyes are drawn: round, open or shut or half shut; as strokes,
 * happy or crossed; or, at work, as a terminal's `>_`, or one a line and
 * the other a lens. */
type Eye = "open" | "closed" | "half" | "happy" | "cross" | "prompt" | "lens"

/** A dot beside the hat, out of its turns: where it stands, its radius,
 * and how much of it shows, by its size. */
type Dot = { x: number; y: number; r: number; size: number }

/** How much of each shape: square, circle, triangle, octagon. Sums to 1. */
type Weights = [number, number, number, number]

/** One frame of the character. */
type Pose = {
  w: Weights
  tx: number
  ty: number
  /** Degrees, on top of the hat's tilt. */
  rot: number
  /** A whole turn about its centre, for a flip. */
  spin: number
  sx: number
  sy: number
  /** Where the eyes look, and how open they are. */
  ex: number
  ey: number
  open: number
  big: number
  eye: Eye
  /** How much it snores. */
  zz: number
  /** How much the eyes show at all: 0 at rest. */
  eyes: number
  /** How much its alarm clock's two bells show, woke's. */
  bells: number
  /** Degrees the bells swing as they ring. */
  ring: number
  /** How much the `>_`'s cursor shows, as it blinks. */
  cursor: number
  /** The dot a fetch sends out, or the limit's sand; none but for those. */
  dot: Dot | null
}

const BASE: Pose = {
  w: [1, 0, 0, 0],
  tx: 0,
  ty: 0,
  rot: 0,
  spin: 0,
  sx: 1,
  sy: 1,
  ex: 0,
  ey: 0,
  open: 1,
  big: 1,
  eye: "open",
  zz: 0,
  eyes: 1,
  bells: 0,
  ring: 0,
  cursor: 1,
  dot: null,
}

const TILT = -8
/** Seconds of the jump into a new shape. */
const LEAP = 0.6
/** Seconds a look blends into the next. */
const BLEND = 0.45
/** Seconds of done's flip, and of woke's arrival: asleep, then a stretch. */
const FLIP = 1.2
const ARRIVE = 1.6
const CX = 76
const CY = 22.5
const POINTS = 160

/**
 * Each shape as a polygon grown by a radius (a Minkowski sum), sampled by
 * the direction of its outline's normal. Shapes sampled alike blend into
 * one another and stay soft and convex at every step.
 */
const SHAPES: {
  corners: [number, number][]
  radius: number
  eyes: [number, number]
}[] = [
  {
    corners: [
      [-9, -7.5],
      [9, -7.5],
      [9, 7.5],
      [-9, 7.5],
    ],
    radius: 15,
    eyes: [-1.5, 8.6],
  },
  { corners: [[0, 0]], radius: 23.5, eyes: [-1, 8.2] },
  {
    corners: [
      [0, -16.5],
      [16, 12.5],
      [-16, 12.5],
    ],
    radius: 8.5,
    eyes: [6.5, 7],
  },
  // A stop sign: eight corners on a circle, a flat side up.
  {
    corners: Array.from({ length: 8 }, (_, i): [number, number] => {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8
      return [18.6 * Math.cos(a), 18.6 * Math.sin(a)]
    }),
    radius: 4.2,
    eyes: [-0.5, 8.2],
  },
]

const OUTLINES = SHAPES.map(({ corners, radius }) => {
  const xs = new Float32Array(POINTS)
  const ys = new Float32Array(POINTS)
  for (let i = 0; i < POINTS; i++) {
    const a = (i / POINTS) * Math.PI * 2 - Math.PI / 2
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    let best = corners[0]!
    let far = -Infinity
    for (const corner of corners) {
      const d = corner[0] * ux + corner[1] * uy
      if (d > far + 1e-9) {
        far = d
        best = corner
      }
    }
    xs[i] = best[0] + radius * ux
    ys[i] = best[1] + radius * uy
  }
  return { xs, ys }
})

const SQUARE = 0
const CIRCLE = 1
const TRIANGLE = 2
const OCTAGON = 3

/** Each look's shape: calm, at work whatever it does, asking the Person,
 * or stopped. */
const SHAPE_OF: Record<Shown, number> = {
  rest: SQUARE,
  idle: SQUARE,
  done: SQUARE,
  offline: SQUARE,
  woke: SQUARE,
  later: SQUARE,
  think: CIRCLE,
  read: CIRCLE,
  search: CIRCLE,
  edit: CIRCLE,
  execute: CIRCLE,
  fetch: CIRCLE,
  reply: CIRCLE,
  other: CIRCLE,
  compacting: CIRCLE,
  stuck: CIRCLE,
  limit: CIRCLE,
  asking: TRIANGLE,
  failed: OCTAGON,
}

/** Woke's bell: a dome, drawn above the hat, one on each side. */
const BELL = "M-7 1.5A7 7 0 0 1 7 1.5Z"

const sin = Math.sin
const PI = Math.PI
const clamp = (t: number) => Math.max(0, Math.min(1, t))
const ease = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
const lerp = (a: number, b: number, m: number) => a + (b - a) * m
const blink = (time: number, every: number) => (time % every < 0.12 ? 0.08 : 1)

function only(index: number): Weights {
  const w: Weights = [0, 0, 0, 0]
  w[index] = 1
  return w
}

function between(from: number, to: number, m: number): Weights {
  const w: Weights = [0, 0, 0, 0]
  w[from] += 1 - m
  w[to] += m
  return w
}

/** Up, down and a squash at the landing, from 0 to 1 and back. */
function hop(t: number, start: number, length: number): number {
  const q = (t - start) / length
  if (q < 0 || q > 1) return 0
  if (q < 0.45) return ease(q / 0.45)
  if (q < 0.8) return 1 - ease((q - 0.45) / 0.35)
  return -0.18 * sin((PI * (q - 0.8)) / 0.2)
}

function jumped(pose: Pose, lift: number): Pose {
  const up = Math.max(lift, 0)
  const squash = Math.min(lift, 0)
  return {
    ...pose,
    ty: pose.ty - 11 * up,
    rot: pose.rot - 12 * up,
    sx: pose.sx * (1 - squash * 0.25),
    sy: pose.sy * (1 + squash * 0.9),
  }
}

type Context = { seed: number; look: [number, number] | null }

/** A pose as a function of the seconds since it began and of the clock. */
type Motion = (t: number, time: number, at: Context) => Pose

/** Asleep, its eyes closed: later's still pose; offline's snores too. */
const ASLEEP: Pose = { ...BASE, ty: 1.5, rot: 7, ey: 2.5, eye: "closed" }

/** At work: a circle. */
const WORKS: Pose = { ...BASE, w: only(CIRCLE) }
/** Reading, its eyes on the line, half shut: what any other work stands
 * still as too. */
const READING: Pose = { ...WORKS, ex: -1.5, ey: 1.5, open: 0.62 }

/**
 * The still pose of each look, and of each thing an Agent at work does, as
 * `marks-final.html` draws them (ADR 0099, decision 8): for a Person who
 * asked for less motion, or `[motion] off`, and for a notification's icon.
 */
const STILL: Record<Shown, Pose> = {
  rest: { ...BASE, eyes: 0 },
  idle: BASE,
  think: { ...WORKS, ex: 2.6, ey: -3.2 },
  read: READING,
  search: { ...WORKS, eye: "lens" },
  edit: { ...WORKS, ex: 1.5, ey: 3.4, open: 0.55 },
  execute: { ...WORKS, eye: "prompt", ex: -0.5 },
  fetch: {
    ...WORKS,
    ex: 2.8,
    ey: -3,
    dot: { x: CX + 34, y: CY - 22, r: 2.8, size: 1 },
  },
  reply: { ...WORKS, ey: 3.4, open: 0.5 },
  other: READING,
  compacting: { ...WORKS, sx: 0.84, sy: 1.04, eye: "closed" },
  stuck: { ...WORKS, eye: "half", ty: 1.5, rot: 5 },
  limit: {
    ...WORKS,
    eye: "closed",
    ey: 2,
    rot: 5,
    dot: { x: CX + 30, y: CY, r: 2.6, size: 1 },
  },
  asking: { ...BASE, w: only(TRIANGLE), rot: -6, ex: -2.5, ey: 1.5, big: 1.12 },
  done: { ...BASE, eye: "happy" },
  // Upright, as a stop sign stands: the hat's tilt taken back.
  failed: { ...BASE, w: only(OCTAGON), rot: -TILT, eye: "cross" },
  // Both asleep, but only offline with zz, and Later with none (ADR
  // 0099, decision 1).
  offline: { ...ASLEEP, zz: 1 },
  woke: { ...BASE, big: 1.12, bells: 1 },
  later: ASLEEP,
}

/** Reading, between its loops' moves: as `read` and `other` stand. */
const READ_BASE: Pose = { ...WORKS, ey: 1.2, open: 0.62 }

/** Each look's pose between its loops' moves, as marks-final.html's
 * motions stand: what marks.css moves it from. The loops of `other` play
 * reading, writing and a glance in turn, from a reading one's pose. */
const BASES: Record<Shown, Pose> = {
  ...STILL,
  failed: { ...STILL.failed, ty: 1 },
  think: { ...STILL.think, ty: -3, rot: -4 },
  read: READ_BASE,
  fetch: { ...STILL.fetch, dot: { x: CX + 26, y: CY - 16, r: 2.8, size: 1 } },
  other: READ_BASE,
  compacting: { ...WORKS, open: 0.7 },
  stuck: { ...STILL.stuck, ex: -1, sx: 1.02, sy: 0.97 },
  limit: { ...STILL.limit, dot: { x: CX + 30, y: CY - 14, r: 2.6, size: 0 } },
}

/** What each part's loop does to a pose, by its values. */
const MOVES: Record<Part, (pose: Pose, values: readonly number[]) => void> = {
  move: (pose, [x, y]) => {
    pose.tx += x!
    pose.ty += y!
  },
  turn: (pose, [degrees]) => {
    pose.rot += degrees!
  },
  size: (pose, [x, y]) => {
    pose.sx *= x!
    pose.sy *= y!
  },
  look: (pose, [x, y]) => {
    pose.ex += x!
    pose.ey += y!
  },
  lid: (pose, [closed]) => {
    pose.open *= 1 - LID * closed!
  },
  bell: (pose, [degrees]) => {
    pose.ring += degrees!
  },
  cursor: (pose, [covered]) => {
    pose.cursor *= 1 - covered!
  },
  // A dot's loop places it whole.
  dot: (pose, [x, y, size]) => {
    if (pose.dot) pose.dot = { ...pose.dot, x: x!, y: y!, size: size! }
  },
  // The snores play only in marks.css: news hides them while it lasts.
  z: () => {},
}

/** `pose` moved by `look`'s loops as they stand at `at`, seconds of its
 * mark's rhythm: what marks.css draws then. */
function looped(pose: Pose, look: Shown, at: number): Pose {
  const moved = { ...pose }
  for (const name of LOOPED[look] ?? []) {
    const loop = LOOPS[name]
    MOVES[loop.part](moved, valueAt(loop, at))
  }
  return moved
}

/** Woke arrives asleep, stretches, then rings (ADR 0099, decision 1), as
 * marks-final.html's `arrives`. */
function arrive(t: number, at: number): Pose {
  const asleep = looped(BASES.later, "later", at)
  if (t < 1) return asleep
  const into = looped(BASES.woke, "woke", at)
  if (t >= ARRIVE) return into
  const q = (t - 1) / (ARRIVE - 1)
  const stretch = sin(PI * q)
  const pose = mix(asleep, into, ease(q))
  return {
    ...pose,
    sy: pose.sy * (1 + 0.16 * stretch),
    sx: pose.sx * (1 - 0.05 * stretch),
    ty: pose.ty - 3 * stretch,
    eye: q < 0.35 ? "closed" : into.eye,
    open: q < 0.35 ? 1 : lerp(0.2, into.open, (q - 0.35) / 0.65),
  }
}

/** What the logo does when it wakes at rest: one of these, then still again. */
const TRICKS = {
  morph: (t: number, _time: number, at: Context): Pose => {
    const to = at.seed > 0.5 ? 2 : 1
    const m = ease(clamp((t - 0.5) / 0.45)) - ease(clamp((t - 2.3) / 0.45))
    const pose: Pose = {
      ...BASE,
      w: between(0, to, m),
      ex: t < 1.3 ? 0 : t < 1.8 ? -3.4 : t < 2.2 ? 3.4 : 0,
      ey: (t > 0.1 && t < 0.5) || (t > 1.9 && t < 2.3) ? -2.6 : 0,
      open: t > 1.05 && t < 1.17 ? 0.08 : 1,
    }
    return jumped(pose, hop(t, 0.3, 0.9) + hop(t, 2.1, 0.9))
  },
  flip: (t: number): Pose => {
    const pose: Pose = { ...BASE, eye: t > 0.2 ? "happy" : "open" }
    if (t < 0.25) {
      const c = ease(t / 0.25)
      return { ...pose, sy: 1 - 0.15 * c, sx: 1 + 0.08 * c }
    }
    if (t < 0.95) {
      const q = (t - 0.25) / 0.7
      const a = sin(PI * q)
      return {
        ...pose,
        ty: -24 * a,
        spin: 360 * ease(q),
        w: [1 - a, a, 0, 0],
        sy: 1 + 0.06 * a,
      }
    }
    if (t < 1.2) {
      const a = sin((PI * (t - 0.95)) / 0.25)
      return { ...pose, sy: 1 - 0.14 * a, sx: 1 + 0.08 * a }
    }
    return pose
  },
  peek: (t: number): Pose => {
    const to = t < 0.3 ? 0 : t < 1.1 ? -1 : t < 1.9 ? 1 : 0
    const from = t < 1.1 ? 0 : t < 1.9 ? -1 : 1
    const s = ease(
      clamp(
        t < 1.1 ? (t - 0.3) / 0.3 : t < 1.9 ? (t - 1.1) / 0.3 : (t - 1.9) / 0.3
      )
    )
    const v = lerp(from, to, s)
    return {
      ...BASE,
      ex: 3.6 * v,
      rot: 4 * v,
      tx: 1.5 * v,
      open: t > 2.05 && t < 2.17 ? 0.08 : 1,
    }
  },
  dance: (t: number): Pose => {
    if (t >= 1.7) return { ...BASE, open: 0.75 }
    const p = (t % 0.42) / 0.42
    const up = sin(PI * p)
    const hit = p < 0.2 ? 1 - p / 0.2 : 0
    const side = Math.floor(t / 0.42) % 2 ? 1 : -1
    return {
      ...BASE,
      open: 0.75,
      ty: -5 * up,
      rot: 6 * side * up,
      sx: 1 + 0.1 * hit,
      sy: 1 - 0.13 * hit + 0.05 * up,
      ex: 2 * side,
    }
  },
  ponder: (t: number): Pose => {
    const m = ease(clamp((t - 0.2) / 0.6)) - ease(clamp((t - 2.1) / 0.6))
    return {
      ...BASE,
      w: between(0, 2, m),
      ex: 2.6 * m,
      ey: -3 * m,
      rot: 3 * sin(t * 3) * m,
      ty: -2 * m,
      open: t > 1.4 && t < 1.52 ? 0.08 : 1,
    }
  },
} satisfies Record<string, Motion>

type Trick = keyof typeof TRICKS
const TRICK_LENGTH: Record<Trick, number> = {
  morph: 3.2,
  flip: 1.9,
  peek: 2.6,
  dance: 2,
  ponder: 2.8,
}
const TRICK_NAMES = Object.keys(TRICK_LENGTH) as Trick[]

const REST: Motion = () => STILL.rest
const WAKE: Motion = (t) => {
  const s = sin(PI * clamp(t / 0.45))
  return {
    ...BASE,
    sy: 1 + 0.08 * s,
    sx: 1 - 0.03 * s,
    ey: -1,
  }
}
const LOOK: Motion = (_t, time, at) => {
  const b = sin((2 * PI * time) / 2.4)
  const look = at.look ?? [0, 0]
  return {
    ...BASE,
    sx: 1 - 0.012 * b,
    sy: 1 + 0.03 * b,
    ex: look[0],
    ey: look[1],
    rot: look[0] * 0.9,
    big: 1.06,
    open: blink(time, 3.1),
  }
}

function mix(a: Pose, b: Pose, m: number): Pose {
  return {
    w: [
      lerp(a.w[0], b.w[0], m),
      lerp(a.w[1], b.w[1], m),
      lerp(a.w[2], b.w[2], m),
      lerp(a.w[3], b.w[3], m),
    ],
    tx: lerp(a.tx, b.tx, m),
    ty: lerp(a.ty, b.ty, m),
    rot: lerp(a.rot, b.rot, m),
    spin: lerp(a.spin, b.spin, m),
    sx: lerp(a.sx, b.sx, m),
    sy: lerp(a.sy, b.sy, m),
    ex: lerp(a.ex, b.ex, m),
    ey: lerp(a.ey, b.ey, m),
    open: lerp(a.open, b.open, m),
    big: lerp(a.big, b.big, m),
    eye: m < 0.5 ? a.eye : b.eye,
    zz: lerp(a.zz, b.zz, m),
    eyes: lerp(a.eyes, b.eyes, m),
    bells: lerp(a.bells, b.bells, m),
    ring: lerp(a.ring, b.ring, m),
    cursor: lerp(a.cursor, b.cursor, m),
    dot: m < 0.5 ? a.dot : b.dot,
  }
}

const f = (n: number) => n.toFixed(2)

/** What a mark's `data-news` says while news plays. */
type Stage = "blend" | "leap" | "flip" | "asleep" | "stretch"

/** What the clock draws for a while: news, or the logo's trick or glance. */
type Playing = {
  motion: Motion
  /** Seconds it blends in from `from`, the pose it began at. */
  blend: number
  /** Seconds it lasts. */
  until: number
  stage?: (t: number) => Stage
  /** What plays after it; without, the mark settles. */
  then?: (time: number) => void
  began: number
  from: Pose
}

/** The looks whose first draw may be news: done flips, woke arrives. */
const ARRIVES = new Set<Shown>(["done", "woke"])

/** The news a mark plays as it takes `look`, on `beat`'s rhythm. */
function newsOf(
  look: Shown,
  beat: string,
  leaps: boolean
): Pick<Playing, "motion" | "blend" | "until" | "stage"> {
  const at = (time: number) => phaseOf(beat, wallOf(time))
  if (look === "done")
    return {
      motion: (t, time) => looped(TRICKS.flip(t), "done", at(time)),
      blend: BLEND,
      until: FLIP,
      stage: () => "flip",
    }
  if (look === "woke")
    return {
      motion: (t, time) => arrive(t, at(time)),
      blend: BLEND,
      until: ARRIVE,
      stage: (t) => (t < 1 ? "asleep" : "stretch"),
    }
  return {
    motion: (_t, time) => looped(BASES[look], look, at(time)),
    blend: BLEND,
    until: BLEND,
    stage: () => (leaps ? "leap" : "blend"),
  }
}

/** The clock's seconds at `time`, the page's: what a rhythm keeps to. */
const wallOf = (time: number) => time + performance.timeOrigin / 1000

// The marks with news draw on the window's clock, last in its tick (ADR
// 0088, decision 3), so what reads the layout there reads before them; the
// rest ask for no tick at all, so the clock stops while no news plays.
const marks = new Set<Animator>()
/** The marks that draw in the next tick. */
const due = new Set<Animator>()
let asked = 0
function tick(now: number) {
  asked = 0
  const time = now / 1000
  for (const mark of [...due]) {
    due.delete(mark)
    if (mark.frame(time)) due.add(mark)
  }
  if (due.size > 0 && !asked) asked = onDraw(tick)
}

/** `mark` draws in the next tick. */
function draw(mark: Animator) {
  due.add(mark)
  asked ||= onDraw(tick)
}

let pointer: [number, number] | null = null
let moved = -Infinity
function onPointer(event: PointerEvent) {
  pointer = [event.clientX, event.clientY]
  moved = performance.now()
  // Where each mark whose eyes follow stands is read here, as the pointer
  // moves, and never in a tick, which reads no layout (ADR 0088, decision
  // 9).
  for (const mark of marks) mark.measure()
}

const lessMotion =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-reduced-motion: reduce)")
    : undefined

const page = typeof document === "undefined" ? undefined : document

/** Whether marks stand still: the Person asked for less motion, or for
 * none (`[motion] off`, `html[data-still]`), as marks.css reads it too. */
function stillNow(): boolean {
  return (
    (lessMotion?.matches ?? false) ||
    (page?.documentElement.hasAttribute("data-still") ?? false)
  )
}

/** Every mark again, still or moving, as the Person now asks. */
function restyle() {
  for (const mark of marks) mark.restyle()
}

/**
 * `marks` on their rhythm again, as they come back into view or the window
 * shows, or as one shows another Thread: their loops start over from where
 * their rhythm is now. Every phase is set before any animation is read, so
 * the page works its style out once for them all.
 */
function back(marks: readonly Animator[]) {
  const now = performance.now() / 1000
  const looping = marks.filter((mark) => mark.rephase(now))
  for (const animation of looping.flatMap((mark) => mark.animations()))
    animation.currentTime = 0
}

/** The window shown or hidden: the marks' loops play or pause with it. */
function onShown() {
  back([...marks].filter((mark) => mark.show()))
}

/** One watch over every mark in view, the lists' and the bar's. */
let seen: IntersectionObserver | undefined
const byElement = new Map<Element, Animator>()

function seenNow(): IntersectionObserver | undefined {
  if (typeof IntersectionObserver !== "function") return undefined
  seen ??= new IntersectionObserver((entries) =>
    back(
      entries.flatMap((entry) => {
        const mark = byElement.get(entry.target)
        return mark?.show(entry.isIntersecting) ? [mark] : []
      })
    )
  )
  return seen
}

/**
 * The Threads' marks that just went, by their beat: the look each showed,
 * its pose then, and when. A Thread's mark drawn again soon after is that
 * mark moved, not drawn for the first time, so a look that changed as it
 * moved is news. The keyed list keeps a card's node as it changes part,
 * but a card is drawn afresh as `ThreadRow` changes its root, as one that
 * leaves the tab while the list holds does, and the Banda menu and a
 * Pane's header draw theirs anew.
 */
const gone = new Map<string, { look: Shown; pose: Pose; at: number }>()
/** Seconds a mark that went is the one drawn again. */
const MOVED = 1

/** What `beat`'s mark that went showed, if it went less than `MOVED` ago
 * and in another look than `look`; it is taken either way. */
function movedFrom(
  beat: string,
  look: Shown,
  now: number
): { look: Shown; pose: Pose } | undefined {
  const left = gone.get(beat)
  gone.delete(beat)
  return left && now - left.at < MOVED && left.look !== look ? left : undefined
}

let stillness: MutationObserver | undefined

/** Listens for what every mark follows, as the first one comes. */
function watch() {
  addEventListener("pointermove", onPointer, { passive: true })
  lessMotion?.addEventListener("change", restyle)
  if (!page) return
  page.addEventListener("visibilitychange", onShown)
  stillness = new MutationObserver(restyle)
  stillness.observe(page.documentElement, {
    attributes: true,
    attributeFilter: ["data-still"],
  })
}

/** Stops listening, as the last mark goes. */
function unwatch() {
  removeEventListener("pointermove", onPointer)
  lessMotion?.removeEventListener("change", restyle)
  page?.removeEventListener("visibilitychange", onShown)
  stillness?.disconnect()
  stillness = undefined
  seen?.disconnect()
  seen = undefined
}

/** What one pose draws: the hat's outline and turns, its eyes, lids and
 * glyph. */
type Drawn = {
  d: string
  /** Its four turns, from the outermost: where it stands, how it leans,
   * its size and its spin. */
  turns: [string, string, string, string]
  /** Each eye's ellipse; `rx` 0 when it does not show. */
  eyes: { cx: number; cy: number; rx: number; ry: number }[]
  /** Each eye's two lids, top then bottom: the rect each covers once
   * marks.css closes it, from the eye's edge to its slit; none for an
   * eye that does not blink. */
  lids: { x: number; y: number; width: number; height: number }[]
  /** Eyes drawn as strokes: happy, crossed, `>_` or a lens; empty for
   * round ones. */
  glyph: string
  /** The `>_`'s cursor, which its cover hides as it blinks; empty for
   * other eyes. */
  cursor: string
  /** How much the eyes show at all. */
  shown: number
  /** Where each of woke's two bells hangs, inside the hat's turn. */
  bells: string[]
}

/** The radius of a searching eye's lens. */
const LENS = 5.2
/** Where the bells hang while they do not show: nowhere. */
const NO_BELLS: string[] = []
/** How far a lid reaches past its eye, so a closed eye leaves no rim. */
const PAD = 0.6
const NO_LID = { x: 0, y: 0, width: 0, height: 0 }

/** One of the three z's it snores: where it stands, how big, how much it
 * shows. */
type Snore = { x: number; y: number; size: number; opacity: number }

/**
 * Where each z of a live snore stands, unseen, for marks.css's `mark-zz`
 * to move it from, about this point (`.mark-z`'s transform-origin): up
 * and to the right of the hat's corner, growing as it shows and fades, as
 * marks-final.html's snores rise.
 */
const RISING: Snore = { x: 100, y: 4, size: 8, opacity: 0 }

/** The snore still: three z's, each larger, stepping up from the hat's
 * corner, inside a still mark's box (`STILL_BOX`). */
const STILL_ZZ: readonly (readonly [x: number, y: number, size: number])[] = [
  [95.5, 3, 6],
  [98.5, -2.5, 8],
  [102, -8, 9.5],
]

/** Its three z's still, `amount` of each shown. */
function snoresOf(amount: number): Snore[] {
  return STILL_ZZ.map(([x, y, size]) => ({ x, y, size, opacity: amount }))
}

function drawnOf(p: Pose): Drawn {
  // The outline and the eyes' place: each shape's, by how much of it.
  // Plain loops, as it runs for each mark that moves, on every tick.
  const { w } = p
  let d = ""
  for (let i = 0; i < POINTS; i++) {
    let x = CX
    let y = CY
    for (let k = 0; k < w.length; k++) {
      x += w[k]! * OUTLINES[k]!.xs[i]!
      y += w[k]! * OUTLINES[k]!.ys[i]!
    }
    d += `${i ? "L" : "M"}${f(x)} ${f(y)}`
  }
  d += "Z"
  let eyeY = 0
  let eyeGap = 0
  for (let k = 0; k < w.length; k++) {
    eyeY += w[k]! * SHAPES[k]!.eyes[0]
    eyeGap += w[k]! * SHAPES[k]!.eyes[1]
  }
  const turns: Drawn["turns"] = [
    `translate(${f(p.tx)} ${f(p.ty)})`,
    `rotate(${f(TILT + p.rot)} 54 45)`,
    `translate(76 45) scale(${f(p.sx)} ${f(p.sy)}) translate(-76 -45)`,
    `rotate(${f(p.spin)} ${CX} ${CY})`,
  ]

  const ex = CX + p.ex
  const ey = CY + eyeY + p.ey
  const gap = eyeGap * Math.min(p.big, 1.06)
  const xs = [ex - gap, ex + gap]
  const shown = clamp(p.eyes)
  const round = p.eye === "open" || p.eye === "closed" || p.eye === "half"
  const closed = p.eye === "closed"
  const half = p.eye === "half"
  const eyes = xs.map((x) =>
    shown < 0.02 || !round
      ? { cx: x, cy: ey, rx: 0, ry: 0 }
      : {
          cx: x,
          cy: ey + (half ? 1.6 : 0),
          rx: (closed ? 5.4 : 4.9 * p.big) * Math.min(1, shown * 1.6),
          ry: (closed ? 1.7 : half ? 3.2 : 7 * p.big * p.open) * shown,
        }
  )
  const lids = eyes.flatMap(({ cx, cy, rx, ry }) => {
    if (rx === 0 || closed) return [NO_LID, NO_LID]
    const x = cx - rx - PAD
    const width = 2 * (rx + PAD)
    const height = PAD + LID * ry
    return [
      { x, y: cy - ry - PAD, width, height },
      { x, y: cy + (1 - LID) * ry, width, height },
    ]
  })
  const stroked = shown >= 0.02 && !round
  const [left, right] = xs as [number, number]
  // The `>_`'s cursor, under the right eye's place.
  const cursor =
    stroked && p.eye === "prompt"
      ? `M${f(right - 4.2)} ${f(ey + 4.2)}L${f(right + 4.2)} ${f(ey + 4.2)}`
      : ""
  const glyph = !stroked
    ? ""
    : p.eye === "prompt"
      ? `M${f(left - 3.4)} ${f(ey - 4.6)}L${f(left + 2.8)} ${f(ey)}L${f(left - 3.4)} ${f(ey + 4.6)}` +
        (p.cursor > 0.5 ? cursor : "")
      : p.eye === "lens"
        ? // One eye a line, the other a lens with its handle.
          `M${f(left)} ${f(ey - 2.6)}L${f(left)} ${f(ey + 2.6)}` +
          `M${f(right - LENS)} ${f(ey)}a${LENS} ${LENS} 0 1 0 ${2 * LENS} 0a${LENS} ${LENS} 0 1 0 ${-2 * LENS} 0` +
          `M${f(right + 0.7 * LENS)} ${f(ey + 0.7 * LENS)}l3.4 3.4`
        : xs
            .map((x) =>
              p.eye === "happy"
                ? `M${f(x - 4.6)} ${f(ey + 2.6)}Q${f(x)} ${f(ey - 6.5)} ${f(x + 4.6)} ${f(ey + 2.6)}`
                : `M${f(x - 3.6)} ${f(ey - 3.6)}L${f(x + 3.6)} ${f(ey + 3.6)}M${f(x + 3.6)} ${f(ey - 3.6)}L${f(x - 3.6)} ${f(ey + 3.6)}`
            )
            .join("")
  // They rise into place as they show; while they do not, nothing places
  // them.
  const bells =
    p.bells > 0
      ? [-1, 1].map(
          (side) =>
            `translate(${f(CX + side * 17)} ${f(CY - 25 - 4 * (1 - p.bells))}) rotate(${f(side * 38 + p.ring)})`
        )
      : NO_BELLS
  return { d, turns, eyes, lids, glyph, cursor, shown, bells }
}

/**
 * The Agent's tile awake, as its outline with small eyes and nothing in
 * it: a place an Agent may take, as the browser's button that lends a tab
 * (ADR 0083, decision 4). Drawn in the text's colour.
 */
export function EmptyMark({ className }: { className?: string }) {
  const drawn = drawnOf(STILL.idle)
  return (
    <svg
      viewBox="48 -6 56 56"
      data-slot="empty-mark"
      aria-hidden
      className={cn("size-4 shrink-0 overflow-visible", className)}
    >
      <g transform={drawn.turns.join(" ")}>
        <path
          d={drawn.d}
          fill="none"
          stroke="currentColor"
          strokeWidth="4.6"
          strokeLinejoin="round"
        />
        {drawn.eyes.map(({ cx, cy }, at) => (
          <circle key={at} cx={cx} cy={cy} r={3.2} fill="currentColor" />
        ))}
      </g>
    </svg>
  )
}

/**
 * How much a Thread's look that calls no one weighs, as a class (ADR 0099,
 * decision 10): open the text's, work and sleep lighter, the more so on a
 * light theme. A call's colour is on its Agent (`toneOf`), and wins.
 */
const WEIGHT_OF: Partial<Record<MarkState, string>> = {
  idle: "text-mark-open",
  working: "text-mark-working",
  later: "text-mark-later",
}

/** A Thread's mark, as the sidebar, the Banda menu and its Pane's header
 * show it, in its colour or its weight: its `look` and, at work, what its
 * Agent does (`lookOf`), or, where none is given, its mark. It keeps its
 * Thread's own rhythm. */
export function ThreadMark({
  listed,
  look = listed.mark,
  doing,
  className,
}: {
  listed: Listed
  look?: MarkState
  doing?: MarkDoing
  className?: string
}) {
  // A Thread's id is a UUIDv7, the same on every machine and unlike any
  // other's, where the name a machine gives its host is its own.
  return (
    <BandaMark
      variant="agent"
      state={look}
      doing={doing}
      playful={0}
      beat={listed.id}
      label={MARK_WORDS[look]}
      className={cn("size-4 shrink-0", WEIGHT_OF[look], className)}
    />
  )
}

/** The colours a still mark is drawn in, as CSS colours: the text's, and
 * each `MarkColor` (ADR 0099, decision 1). */
export type MarkColors = { body: string } & Record<MarkColor, string>

/**
 * A still mark's box: wide enough for woke's bells, the asks triangle's
 * tip and offline's zz, as a live mark draws them over its own, with the
 * hat about its middle.
 */
const STILL_BOX = { x: 40, y: -14, size: 68 }

/** A still mark's size in pixels: two to each unit of its box, as a live
 * mark's 56 drew in 112. */
const STILL_PX = STILL_BOX.size * 2

/**
 * The Agent's tile, still in `state`, as one SVG of its own: a picture of
 * the mark for outside the window, such as a system notification's icon.
 */
export function stillMark(state: MarkState, colors: MarkColors): string {
  const p = STILL[shownOf(state)]
  const drawn = drawnOf(p)
  const fill = colors[COLOR_OF[state] ?? "body"]
  const eyes = drawn.eyes
    .filter((eye) => eye.rx > 0)
    .map(
      (eye) =>
        `<ellipse cx="${f(eye.cx)}" cy="${f(eye.cy)}" rx="${f(eye.rx)}" ry="${f(eye.ry)}" fill="#000"/>`
    )
    .join("")
  const glyph = drawn.glyph
    ? `<path d="${drawn.glyph}" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`
    : ""
  const bells = drawn.bells
    .map((at) => `<path d="${BELL}" transform="${at}"/>`)
    .join("")
  // Its zz stand beside the hat, not in its turn, as a live mark's do.
  const snores =
    p.zz > 0
      ? snoresOf(p.zz)
          .map(
            ({ x, y, size, opacity }) =>
              `<text x="${f(x)}" y="${f(y)}" font-size="${f(size)}" opacity="${f(opacity)}">z</text>`
          )
          .join("")
      : ""
  const zz =
    snores &&
    `<g fill="${fill}" font-family="system-ui, sans-serif" font-weight="700">${snores}</g>`
  const { x, y, size } = STILL_BOX
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${size} ${size}" width="${STILL_PX}" height="${STILL_PX}">`,
    `<defs><mask id="m" maskUnits="userSpaceOnUse" x="-60" y="-90" width="260" height="260">`,
    `<rect x="-60" y="-90" width="260" height="260" fill="#fff"/>${eyes}${glyph}</mask></defs>`,
    `<g transform="${drawn.turns.join(" ")}" fill="${fill}">`,
    `<path d="${drawn.d}" mask="url(#m)"/>${bells}`,
    `</g>${zz}</svg>`,
  ].join("")
}

/** The SVG parts a mark's motion writes. */
type Parts = {
  /** The pose's four turns, from the outermost. */
  turns: Element[]
  body: Element
  /** The eyes as the body's holes, and as what the lids may cover. */
  eyes: Element[]
  lenses: Element[]
  lids: Element[]
  glyph: Element
  /** The cover of the `>_`'s cursor. */
  cursor: Element
  dot: Element
  zz: Element
  /** Each z it snores. */
  snores: Element[]
  bells: Element
  bell: Element[]
}

/** What a mark is asked to draw, as `BandaMark`'s props say it. */
type Asked = {
  state: MarkState
  doing?: MarkDoing
  playful: number
  news: boolean
  beat: string
}

// The marks whose Agent's doing waits for the one shown to have held, and
// until when, in ms (`heldDoing`): one timer waits for the first of them
// all, never one for each mark.
const holding = new Map<Animator, number>()
let holdTimer: ReturnType<typeof setTimeout> | undefined

/** `mark` takes what it was asked again at `at`. */
function holdUntil(mark: Animator, at: number) {
  if (holding.get(mark) === at) return
  holding.set(mark, at)
  planHolds()
}

/** `mark` waits for nothing. */
function unhold(mark: Animator) {
  if (holding.delete(mark)) planHolds()
}

function planHolds() {
  clearTimeout(holdTimer)
  holdTimer = undefined
  if (holding.size === 0) return
  const first = Math.min(...holding.values())
  holdTimer = setTimeout(releaseHolds, Math.max(0, first - performance.now()))
}

function releaseHolds() {
  holdTimer = undefined
  const now = performance.now()
  for (const [mark, at] of [...holding])
    if (at <= now) {
      holding.delete(mark)
      mark.release(at)
    }
  planHolds()
}

/**
 * One mark's motion, as `BandaMark` drives it: its look's pose, and the
 * loops marks.css plays from it; news on the window's clock as its look
 * changes, and the logo's tricks.
 */
export class Animator {
  private readonly svg: SVGSVGElement
  private readonly logo: boolean
  private readonly parts: Parts

  /** What it draws: its look, or what its Agent at work does. */
  private shown: Shown = "rest"
  /** What it was last asked to draw, which it takes again as a doing that
   * waited may show. */
  private asked: Asked | undefined
  /** What its Agent at work shows as doing, and since when, in ms; none
   * unless at work. */
  private held: Held | undefined
  private beat = ""
  /** It has drawn a look: what comes next is news. */
  private drawn = false
  private playing: Playing | null = null
  /** Until when it jumps, because its shape changes. */
  private leap = -Infinity
  private playful = 30
  private visible = true
  private paused = false
  private hovered = false
  /** Where it stood as the pointer last moved, while its eyes follow. */
  private box: DOMRect | undefined
  /** What wakes the logo at rest for its next trick. */
  private timer: ReturnType<typeof setTimeout> | undefined
  private last: Pose = STILL.rest
  private stage: Stage | undefined
  /** Whether its z's stand where a still mark draws them; the SVG first
   * draws them where marks.css's snores rise from. */
  private snoresStill = false
  private readonly context: Context = {
    seed: Math.random(),
    look: null,
  }

  constructor(svg: SVGSVGElement, variant: "logo" | "agent") {
    this.svg = svg
    this.logo = variant === "logo"
    const one = (selector: string) => svg.querySelector(selector)!
    const all = (selector: string) => [...svg.querySelectorAll(selector)]
    this.parts = {
      turns: ["[data-move]", "[data-turn]", "[data-size]", "[data-spin]"].map(
        one
      ),
      body: one("[data-body]"),
      eyes: all("[data-eye]"),
      lenses: all("[data-lens]"),
      lids: all("[data-lid]"),
      glyph: one("[data-glyph]"),
      cursor: one("[data-cursor]"),
      dot: one("[data-dot]"),
      zz: one("[data-zz]"),
      snores: all("[data-zz] text"),
      bells: one("[data-bells]"),
      bell: all("[data-bell]"),
    }
    if (marks.size === 0) watch()
    marks.add(this)
    byElement.set(svg, this)
    seenNow()?.observe(svg)
    if (this.logo) {
      svg.addEventListener("pointerenter", this.enter)
      svg.addEventListener("pointerleave", this.leave)
    }
  }

  dispose() {
    if (this.drawn && this.beat) {
      const now = performance.now() / 1000
      for (const [beat, left] of gone)
        if (now - left.at >= MOVED) gone.delete(beat)
      gone.set(this.beat, {
        look: this.shown,
        pose: this.shownAt(now),
        at: now,
      })
    }
    marks.delete(this)
    due.delete(this)
    unhold(this)
    byElement.delete(this.svg)
    seen?.unobserve(this.svg)
    if (marks.size === 0) unwatch()
    clearTimeout(this.timer)
    if (this.logo) {
      this.svg.removeEventListener("pointerenter", this.enter)
      this.svg.removeEventListener("pointerleave", this.leave)
    }
  }

  set(asked: Asked) {
    this.asked = asked
    this.take(performance.now())
  }

  /** Takes what it was asked again at `at`, in ms, as a doing waited
   * until then to show. */
  release(at: number) {
    if (this.asked) this.take(Math.max(performance.now(), at))
  }

  /** Draws what it was asked, as of `ms`. */
  private take(ms: number) {
    const { state, doing, playful, news, beat } = this.asked!
    const now = ms / 1000
    this.playful = playful
    const look = this.logo && state === "idle" ? "rest" : state
    const shown = shownOf(look, this.hold(look, doing, ms))
    if (this.drawn && shown === this.shown) {
      // Another Thread's mark now, it keeps that Thread's rhythm.
      if (beat !== this.beat) {
        this.beat = beat
        back([this])
      }
      return
    }
    // Where it moves from, on the rhythm it kept until now; or, drawn
    // again just after its Thread's mark went, where that one was.
    const moved = this.drawn || !beat ? undefined : movedFrom(beat, shown, now)
    const first = !this.drawn && !moved
    const was = moved?.look ?? this.shown
    const from = moved?.pose ?? this.shownAt(now)
    this.beat = beat
    this.drawn = true
    this.shown = shown
    // A mark drawn for the first time starts in its look, as if it had
    // been there (ADR 0099, decision 4).
    if (stillNow() || (first && !(news && ARRIVES.has(shown)))) {
      this.settle(now)
      return
    }
    // A change of shape leaps into the new one; done flips anyway.
    const leaps =
      !first && shown !== "done" && SHAPE_OF[shown] !== SHAPE_OF[was]
    if (leaps) this.leap = now + LEAP
    const played = newsOf(shown, beat, leaps)
    this.play(played, now, first ? played.motion(0, now, this.context) : from)
  }

  /**
   * What its Agent shows as doing at `ms`, if it is at work in `look`, and
   * now does `doing` (ADR 0099, decision 2): what it showed until that
   * held `HOLD`, then the latest, which waits that long on one timer for
   * every mark (`holdUntil`); `data-doing` says it. None otherwise.
   */
  private hold(
    look: MarkState,
    doing: MarkDoing | undefined,
    ms: number
  ): MarkDoing | undefined {
    if (!works(look)) {
      this.held = undefined
      unhold(this)
      this.svg.removeAttribute("data-doing")
      return undefined
    }
    const held = heldDoing(this.held, doing, ms)
    this.held = held
    if (held.doing === doing) unhold(this)
    else holdUntil(this, held.since + HOLD)
    this.svg.setAttribute("data-doing", shownOf(look, held.doing))
    return held.doing
  }

  /** What it shows at `now`: what it last drew, moved by the loops marks.css
   * plays on it since. */
  private shownAt(now: number): Pose {
    if (this.playing || stillNow() || !LOOPED[this.shown]) return this.last
    return looped(
      BASES[this.shown],
      this.shown,
      phaseOf(this.beat, wallOf(now))
    )
  }

  private play(
    played: Omit<Playing, "began" | "from">,
    now: number,
    from: Pose
  ) {
    clearTimeout(this.timer)
    this.timer = undefined
    this.playing = { ...played, began: now, from }
    draw(this)
  }

  /** Draws what plays at `time`, in seconds: whether it plays on, and
   * wants the next tick. */
  frame(time: number): boolean {
    const playing = this.playing
    if (!playing) return false
    // Unseen, or still, it skips to the end of what it plays.
    if (!this.visible || stillNow()) {
      this.end(time)
      return this.playing !== null
    }
    const t = time - playing.began
    this.context.look = this.hovered ? this.looking() : null
    let pose = playing.motion(t, time, this.context)
    const m = ease(clamp(t / playing.blend))
    if (m < 1) pose = mix(playing.from, pose, m)
    if (time < this.leap) pose = jumped(pose, hop(time, this.leap - LEAP, LEAP))
    this.say(playing.stage?.(t))
    this.paint(pose)
    if (t < playing.until || time < this.leap) return true
    this.end(time)
    return this.playing !== null
  }

  /** What played ends: what comes after it plays, or it settles. */
  private end(time: number) {
    const then = this.playing?.then
    this.playing = null
    this.leap = -Infinity
    if (then) then(time)
    else this.settle(time)
  }

  /**
   * Draws its look as it stands between moves, and hands its motion to
   * marks.css: its loops, from where its rhythm is at `time`. Still, it
   * draws the look's still pose, and nothing moves.
   */
  private settle(time: number) {
    this.playing = null
    this.leap = -Infinity
    const still = stillNow()
    this.paint(still ? STILL[this.shown] : BASES[this.shown])
    this.snore(still)
    this.say(undefined)
    if (!still && LOOPED[this.shown]) {
      this.phase(time)
      this.svg.setAttribute("data-loop", this.shown)
    } else this.svg.removeAttribute("data-loop")
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.logo && this.shown === "rest" && !still) this.later(time)
  }

  /** Its z's where a still mark draws them, `still`, or where marks.css's
   * snores rise from, unseen until they do; its pose says how much they
   * show. */
  private snore(still: boolean) {
    if (still === this.snoresStill) return
    this.snoresStill = still
    const snores = still ? snoresOf(1) : [RISING, RISING, RISING]
    this.parts.snores.forEach((z, i) => {
      const { x, y, size, opacity } = snores[i]!
      z.setAttribute("x", f(x))
      z.setAttribute("y", f(y))
      z.setAttribute("font-size", f(size))
      z.setAttribute("opacity", f(opacity))
    })
  }

  /** Where its loops start, on its rhythm at `time`. */
  private phase(time: number) {
    this.svg.style.setProperty(
      "--mark-phase",
      `${(-phaseOf(this.beat, wallOf(time))).toFixed(3)}s`
    )
  }

  /** What `data-news` says: the news that plays, or none. */
  private say(stage: Stage | undefined) {
    if (stage === this.stage) return
    this.stage = stage
    if (stage) this.svg.setAttribute("data-news", stage)
    else this.svg.removeAttribute("data-news")
  }

  /** Whether it shows, in view and in a window shown: its loops pause
   * while it does not. True when they play again now. */
  show(visible = this.visible): boolean {
    this.visible = visible
    const paused = !visible || (page?.hidden ?? false)
    if (paused === this.paused) return false
    this.paused = paused
    this.svg.toggleAttribute("data-paused", paused)
    if (!paused && this.playing) draw(this)
    return !paused
  }

  /** Its loops' start on its rhythm at `now`, after a pause held them
   * where they were: whether it has loops to start over (`back`). */
  rephase(now: number): boolean {
    if (this.playing || !this.svg.hasAttribute("data-loop")) return false
    this.phase(now)
    return true
  }

  /** The CSS animations marks.css plays on its groups. */
  animations(): Animation[] {
    return this.svg.getAnimations({ subtree: true })
  }

  /** The Person asked for motion, or for none (ADR 0099, decision 8). */
  restyle() {
    if (this.drawn) this.settle(performance.now() / 1000)
  }

  /** When the logo at rest wakes next, for a trick. */
  private later(now: number) {
    if (this.playful <= 0) return
    const next = now + this.playful * (0.75 + Math.random() * 0.5)
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        this.rouse()
      },
      (next - now) * 1000
    )
  }

  /** The logo at rest wakes and plays a trick, unless it is not seen. */
  private rouse() {
    const now = performance.now() / 1000
    if (this.shown !== "rest" || this.hovered || this.playing) return
    if (this.paused || stillNow()) {
      this.later(now)
      return
    }
    const trick = TRICK_NAMES[Math.floor(Math.random() * TRICK_NAMES.length)]!
    this.play(
      {
        motion: WAKE,
        blend: 0.2,
        until: 0.45,
        then: (time) => this.trick(trick, time),
      },
      now,
      this.last
    )
  }

  private trick(trick: Trick, now: number) {
    this.context.seed = Math.random()
    this.play(
      {
        motion: TRICKS[trick],
        blend: 0.3,
        until: TRICK_LENGTH[trick],
        then: (time) =>
          this.play({ motion: REST, blend: 0.6, until: 0.6 }, time, this.last),
      },
      now,
      this.last
    )
  }

  private readonly enter = () => {
    if (this.shown !== "rest" || stillNow()) return
    this.hovered = true
    this.measure()
    this.play(
      { motion: LOOK, blend: 0.3, until: Infinity },
      performance.now() / 1000,
      this.last
    )
  }

  private readonly leave = () => {
    if (!this.hovered) return
    this.hovered = false
    if (this.shown !== "rest") return
    this.trick(Math.random() < 0.5 ? "flip" : "morph", performance.now() / 1000)
  }

  /** Reads where the hovered logo stands, for its eyes: as the pointer
   * moves, not in a tick. */
  measure() {
    this.box =
      this.visible && this.hovered
        ? this.svg.getBoundingClientRect()
        : undefined
  }

  /** Where the hovered logo's eyes turn to follow the pointer. */
  private looking(): [number, number] | null {
    const { box } = this
    if (!box || !pointer || performance.now() - moved > 2500) return null
    const x = box.left + box.width * 0.76
    const y = box.top + box.height * 0.22
    const dx = pointer[0] - x
    const dy = pointer[1] - y
    const d = Math.hypot(dx, dy) || 1
    const g = Math.min(1, d / 120)
    return [(dx / d) * 3.6 * g, (dy / d) * 3 * g]
  }

  private paint(p: Pose) {
    this.last = p
    const drawn = drawnOf(p)
    const { parts } = this
    parts.body.setAttribute("d", drawn.d)
    parts.turns.forEach((group, i) =>
      group.setAttribute("transform", drawn.turns[i]!)
    )
    drawn.eyes.forEach(({ cx, cy, rx, ry }, i) => {
      for (const eye of [parts.eyes[i]!, parts.lenses[i]!]) {
        if (rx === 0) {
          eye.setAttribute("rx", "0")
          eye.setAttribute("ry", "0")
          continue
        }
        eye.setAttribute("cx", f(cx))
        eye.setAttribute("cy", f(cy))
        eye.setAttribute("rx", f(rx))
        eye.setAttribute("ry", f(ry))
      }
    })
    drawn.lids.forEach(({ x, y, width, height }, i) => {
      const lid = parts.lids[i]!
      lid.setAttribute("x", f(x))
      lid.setAttribute("y", f(y))
      lid.setAttribute("width", f(width))
      lid.setAttribute("height", f(height))
    })
    parts.glyph.setAttribute("d", drawn.glyph)
    if (drawn.glyph) parts.glyph.setAttribute("stroke-opacity", f(drawn.shown))
    parts.cursor.setAttribute("d", drawn.cursor)
    const { dot } = p
    parts.dot.setAttribute("r", dot ? f(dot.r) : "0")
    if (dot)
      parts.dot.setAttribute(
        "transform",
        `translate(${f(dot.x)} ${f(dot.y)}) scale(${f(dot.size)})`
      )
    parts.zz.setAttribute("opacity", f(clamp(p.zz)))
    parts.bells.setAttribute("opacity", f(clamp(p.bells)))
    if (p.bells > 0)
      parts.bell.forEach((bell, i) =>
        bell.setAttribute("transform", drawn.bells[i]!)
      )
  }
}
