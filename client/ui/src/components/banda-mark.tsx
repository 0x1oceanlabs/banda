import { useEffect, useId, useRef } from "react"
import { onDraw } from "../lib/frames"
import { cn } from "../lib/utils"
import type { Listed } from "../pane"
import { type MarkState, works } from "../lib/mark-state"

export { loudest, MARK_ORDER, type MarkState, works } from "../lib/mark-state"

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

/** Each colour as a class, written out whole so that Tailwind finds it. */
const COLOR_CLASS: Record<MarkColor, string> = {
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
  const works = mark === "running" || mark === "thinking"
  return variant === "logo" && works ? "text-mark-working" : toneOf(mark)
}

/** Plain words for each state, for a title or a screen reader. */
export const MARK_WORDS: Record<MarkState, string> = {
  rest: "Nothing runs",
  idle: "Open",
  thinking: "Thinking",
  running: "Working",
  asking: "Asks you",
  done: "Done",
  failed: "Failed",
  offline: "Offline",
  woke: "Woke",
  later: "Later",
}

export function BandaMark({
  state = "rest",
  variant = "logo",
  playful = 30,
  news = true,
  tone = true,
  label,
  className,
}: {
  state?: MarkState
  /** `logo`: the three tiles; `agent`: the Agent's tile alone. */
  variant?: "logo" | "agent"
  /** Seconds between the logo's tricks while at rest; 0 for none. */
  playful?: number
  /**
   * Whether the state it is first drawn in is news: `done` flips into it.
   * False for a mark drawn again for what already was, as a list opening.
   */
  news?: boolean
  /** Whether its Agent takes its look's colour (`toneOf`); without, it is
   * the text's, as the bar's counts are when their Person turns colour
   * off. */
  tone?: boolean
  /** Names the mark for a screen reader; without it the mark is decoration. */
  label?: string
  className?: string
}) {
  const svg = useRef<SVGSVGElement>(null)
  const animator = useRef<Animator | null>(null)
  const mask = `banda-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`

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
    animator.current?.set({ state, playful, news })
  }, [state, playful, news, variant])

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
        <mask
          id={mask}
          maskUnits="userSpaceOnUse"
          x="-60"
          y="-90"
          width="260"
          height="260"
        >
          <rect x="-60" y="-90" width="260" height="260" fill="#fff" />
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
        <g data-zz fontWeight="700">
          <text>z</text>
          <text>z</text>
          <text>z</text>
        </g>
        <g data-hat>
          <path data-body mask={`url(#${mask})`} />
          <g data-bells opacity="0">
            <path d={BELL} />
            <path d={BELL} />
          </g>
        </g>
      </g>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// The motion. It writes the SVG's attributes straight, once a frame, so React
// renders the mark only when its props change.

type Eye = "open" | "closed" | "happy" | "cross"

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
}

const TILT = -8
/** Seconds of the jump into a new shape. */
const LEAP = 0.6
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

/** Each state's shape: calm, at work, asking the Person, or stopped. */
const SHAPE_OF: Record<MarkState, number> = {
  rest: SQUARE,
  idle: SQUARE,
  done: SQUARE,
  offline: SQUARE,
  woke: SQUARE,
  later: SQUARE,
  thinking: CIRCLE,
  running: CIRCLE,
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
const blink = (time: number, every = 3.7) => (time % every < 0.12 ? 0.08 : 1)

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

/**
 * The still pose of each state, as `marks-final.html` draws them (ADR
 * 0099, decision 8): for a Person who asked for less motion, a
 * notification's icon, and the looks that have no motion yet.
 */
const STILL: Record<MarkState, Pose> = {
  rest: { ...BASE, eyes: 0 },
  idle: BASE,
  thinking: { ...BASE, w: only(CIRCLE), ex: 2.6, ey: -3.2 },
  running: { ...BASE, w: only(CIRCLE), ex: -2.6, ey: 2.6, open: 0.6 },
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

/** The motions that hold one pose: drawn once, the clock stops for them. */
const STANDING = new Set<Motion>()

function standing(pose: Pose): Motion {
  const motion: Motion = () => pose
  STANDING.add(motion)
  return motion
}

const STATES: Record<Exclude<MarkState, "rest">, Motion> = {
  idle: (_t, time, at) => {
    const b = sin((2 * PI * (time + at.seed)) / 2.6)
    const p = (time + at.seed) % 6
    const look =
      at.look ??
      (p < 1 ? [0, 0] : p < 2.6 ? [-3.4, 0] : p < 4.4 ? [3.4, 0] : [0, 0])
    return {
      ...BASE,
      w: only(SQUARE),
      sx: 1 - 0.012 * b,
      sy: 1 + 0.03 * b,
      ex: look[0],
      ey: look[1],
      open: blink(time + at.seed),
    }
  },
  thinking: (_t, time) => {
    const s = sin(time * 2.2)
    return {
      ...BASE,
      w: [0.12 + 0.1 * s, 0.76, 0.12 - 0.1 * s, 0],
      ty: -3 + 1.5 * sin(time * 2.8),
      rot: -4 + 5 * sin(time * 1.4),
      ex: 2.6 + 0.8 * sin(time * 0.9),
      ey: -3.2,
      open: blink(time * 1.1),
    }
  },
  running: (_t, time, at) => {
    const p = ((time + at.seed) % 0.5) / 0.5
    const up = sin(PI * p)
    const hit = p < 0.18 ? 1 - p / 0.18 : 0
    return {
      ...BASE,
      w: only(CIRCLE),
      ty: -5 * up,
      rot: -3 * up,
      sx: 1 + 0.09 * hit - 0.03 * up,
      sy: 1 - 0.12 * hit + 0.04 * up,
      ex: -2.6,
      ey: 2.6,
      open: 0.6,
    }
  },
  asking: (_t, time, at) => {
    const p = (time + at.seed) % 2.2
    let ty = 0
    if (p < 0.3) ty = -7 * sin((PI * p) / 0.3)
    else if (p > 0.35 && p < 0.65) ty = -5 * sin((PI * (p - 0.35)) / 0.3)
    const look = at.look ?? [-2.5, 1.5]
    return {
      ...BASE,
      w: only(TRIANGLE),
      ty,
      rot: -6,
      ex: look[0],
      ey: look[1],
      big: 1.12,
      open: blink(time, 4.3),
    }
  },
  // Once: a flip, then it smiles until the state changes.
  done: (t, time) => {
    if (t < TRICK_LENGTH.flip) return TRICKS.flip(t)
    const b = sin((2 * PI * time) / 2.4)
    return {
      ...BASE,
      w: only(SQUARE),
      eye: "happy",
      sx: 1 - 0.012 * b,
      sy: 1 + 0.03 * b,
    }
  },
  // The stop sign shakes as the triangle did, every 2 s, until the
  // Mark's own rhythm comes (ADR 0099, decision 4).
  failed: (_t, time, at) => {
    const p = (time + at.seed) % 2
    const shake = p < 0.6 ? sin(time * 45) * 2.4 * (1 - p / 0.6) : 0
    return {
      ...BASE,
      w: only(OCTAGON),
      tx: shake,
      ty: 1,
      rot: -TILT + shake * 1.2,
      eye: "cross",
    }
  },
  offline: (_t, time) => {
    const b = sin((2 * PI * time) / 3.6)
    return {
      ...BASE,
      w: only(SQUARE),
      ty: 1.5,
      rot: 7,
      sx: 1 + 0.02 * b,
      sy: 1 + 0.045 * b,
      ey: 2.5,
      eye: "closed",
      zz: 1,
    }
  },
  // Still, until the Mark's motion comes (ADR 0099, decision 1): woke to
  // stretch and ring, later to breathe in its sleep.
  woke: standing(STILL.woke),
  later: standing(STILL.later),
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

const REST = standing(STILL.rest)
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
  }
}

const f = (n: number) => n.toFixed(2)

// Every mark draws on the window's clock, last in its tick (ADR 0088,
// decision 3), so what reads the layout there reads before it: one that
// moves asks for the next tick, and one at rest, out of sight or still
// asks for none, so the clock stops while no mark moves.
const marks = new Set<Animator>()
let asked = 0
function tick(now: number) {
  asked = 0
  let moving = false
  for (const mark of marks) if (mark.frame(now / 1000)) moving = true
  if (moving) wake()
}

/** The marks draw in the next tick. */
function wake() {
  asked ||= onDraw(tick)
}

let pointer: [number, number] | null = null
let moved = -Infinity
function onPointer(event: PointerEvent) {
  pointer = [event.clientX, event.clientY]
  moved = performance.now()
}

const lessMotion =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-reduced-motion: reduce)")
    : undefined

/** What one pose draws: the hat's outline and turn, its eyes, their glyph. */
type Drawn = {
  d: string
  transform: string
  /** Each eye's ellipse; `rx` 0 when it does not show. */
  eyes: { cx: number; cy: number; rx: number; ry: number }[]
  /** Happy or crossed eyes, drawn as strokes; empty for round ones. */
  glyph: string
  /** How much the eyes show at all. */
  shown: number
  /** Where each of woke's two bells hangs, inside the hat's turn. */
  bells: string[]
}

/** Where the bells hang while they do not show: nowhere. */
const NO_BELLS: string[] = []

/** One of the three z's it snores: where it stands, how big, how much it
 * shows. */
type Snore = { x: number; y: number; size: number; opacity: number }

/** The snore still: three z's, each larger, stepping up from the hat's
 * corner, inside a still mark's box (`STILL_BOX`). */
const STILL_ZZ: readonly (readonly [x: number, y: number, size: number])[] = [
  [95.5, 3, 6],
  [98.5, -2.5, 8],
  [102, -8, 9.5],
]

/** Where its three z's are, `amount` of them shown: on the clock, each
 * rising from the hat's corner as it grows and fades; with no `time`,
 * still. */
function snoresOf(amount: number, time?: number): Snore[] {
  if (time === undefined)
    return STILL_ZZ.map(([x, y, size]) => ({ x, y, size, opacity: amount }))
  return [0, 1, 2].map((i) => {
    const phase = (time * 0.45 + i / 3) % 1
    return {
      x: 100 + phase * 12,
      y: 4 - phase * 24,
      size: 8 + phase * 8,
      opacity: sin(PI * phase) * amount,
    }
  })
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
  const transform = `translate(${f(p.tx)} ${f(p.ty)}) rotate(${f(TILT + p.rot)} 54 45) translate(76 45) scale(${f(p.sx)} ${f(p.sy)}) translate(-76 -45) rotate(${f(p.spin)} ${CX} ${CY})`

  const ex = CX + p.ex
  const ey = CY + eyeY + p.ey
  const gap = eyeGap * Math.min(p.big, 1.06)
  const xs = [ex - gap, ex + gap]
  const shown = clamp(p.eyes)
  const round = p.eye === "open" || p.eye === "closed"
  const closed = p.eye === "closed"
  const eyes = xs.map((x) =>
    shown < 0.02 || !round
      ? { cx: x, cy: ey, rx: 0, ry: 0 }
      : {
          cx: x,
          cy: ey,
          rx: (closed ? 5.4 : 4.9 * p.big) * Math.min(1, shown * 1.6),
          ry: (closed ? 1.7 : 7 * p.big * p.open) * shown,
        }
  )
  const glyph =
    shown < 0.02 || round
      ? ""
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
            `translate(${f(CX + side * 17)} ${f(CY - 25 - 4 * (1 - p.bells))}) rotate(${f(side * 38)})`
        )
      : NO_BELLS
  return { d, transform, eyes, glyph, shown, bells }
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
      <g transform={drawn.transform}>
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
  thinking: "text-mark-working",
  running: "text-mark-working",
  later: "text-mark-later",
}

/** A Thread's mark, as the sidebar and the Banda menu show it, in its
 * colour or its weight: its `look` (`lookOf`), or, where none is given
 * yet, its mark. */
export function ThreadMark({
  listed,
  look = listed.mark,
  news,
  className,
}: {
  listed: Listed
  look?: MarkState
  /** As `BandaMark`'s. */
  news?: boolean
  className?: string
}) {
  return (
    <BandaMark
      variant="agent"
      state={look}
      playful={0}
      news={news}
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
  const p = STILL[state]
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
    `<g transform="${drawn.transform}" fill="${fill}">`,
    `<path d="${drawn.d}" mask="url(#m)"/>${bells}`,
    `</g>${zz}</svg>`,
  ].join("")
}

/** One mark's motion, as `BandaMark` drives it: it writes the SVG's
 * attributes on the window's clock. */
export class Animator {
  private readonly svg: SVGSVGElement
  private readonly logo: boolean
  private readonly hat: SVGGElement
  private readonly body: SVGPathElement
  private readonly eyes: SVGEllipseElement[]
  private readonly glyph: SVGPathElement
  private readonly zz: SVGTextElement[]
  private readonly bells: SVGGElement
  private readonly bell: SVGPathElement[]
  private readonly seen: IntersectionObserver

  private state: MarkState = "rest"
  /** Until when it jumps, because its shape changes. */
  private leap = -Infinity
  private playful = 30
  private visible = true
  private hovered = false
  private motion: Motion = REST
  private began = 0
  private from: Pose = { ...BASE, eyes: 0 }
  private fromAt = -Infinity
  private blend = 0.35
  private next = Infinity
  /** What wakes the logo at rest at `next`, as the clock does not; and
   * the `next` it was set for. */
  private timer: ReturnType<typeof setTimeout> | undefined
  private timerAt = Infinity
  private last: Pose = { ...BASE, eyes: 0 }
  private settled = false
  private readonly context: Context = {
    seed: Math.random(),
    look: null,
  }

  constructor(svg: SVGSVGElement, variant: "logo" | "agent") {
    this.svg = svg
    this.logo = variant === "logo"
    this.hat = svg.querySelector("[data-hat]")!
    this.body = svg.querySelector("[data-body]")!
    this.eyes = [...svg.querySelectorAll<SVGEllipseElement>("[data-eye]")]
    this.glyph = svg.querySelector("[data-glyph]")!
    this.zz = [...svg.querySelectorAll<SVGTextElement>("[data-zz] text")]
    this.bells = svg.querySelector("[data-bells]")!
    this.bell = [...svg.querySelectorAll<SVGPathElement>("[data-bells] path")]
    this.seen = new IntersectionObserver(([entry]) => {
      this.visible = entry?.isIntersecting ?? true
      if (this.visible) wake()
    })
    this.seen.observe(svg)
    svg.addEventListener("pointerenter", this.enter)
    svg.addEventListener("pointerleave", this.leave)
    if (marks.size === 0) {
      addEventListener("pointermove", onPointer, { passive: true })
      lessMotion?.addEventListener("change", wake)
    }
    marks.add(this)
    wake()
    this.paint(this.last, 0)
  }

  dispose() {
    marks.delete(this)
    if (marks.size === 0) {
      removeEventListener("pointermove", onPointer)
      lessMotion?.removeEventListener("change", wake)
    }
    clearTimeout(this.timer)
    this.seen.disconnect()
    this.svg.removeEventListener("pointerenter", this.enter)
    this.svg.removeEventListener("pointerleave", this.leave)
  }

  set({
    state,
    playful,
    news,
  }: {
    state: MarkState
    playful: number
    news: boolean
  }) {
    const now = performance.now() / 1000
    this.playful = playful
    const shown = this.logo && state === "idle" ? "rest" : state
    wake()
    if (shown === this.state && this.began) {
      this.settled = false
      return
    }
    // A change of shape is news: it jumps into the new one.
    // Done jumps anyway: it flips.
    if (
      this.began &&
      shown !== "done" &&
      SHAPE_OF[shown] !== SHAPE_OF[this.state]
    ) {
      this.leap = now + LEAP
    }
    this.state = shown
    if (shown === "rest") {
      this.go(REST, now, 0.6)
      this.later(now)
    } else {
      this.next = Infinity
      // Done that is no news smiles without the flip.
      const flipped =
        !this.began && !news && shown === "done" ? TRICK_LENGTH.flip : 0
      this.go(STATES[shown], now - flipped, LEAP * 0.8)
    }
  }

  private go(motion: Motion, now: number, blend: number) {
    this.from = this.last
    this.fromAt = now
    this.blend = blend
    this.motion = motion
    this.began = now
    this.settled = false
  }

  /** When the logo at rest wakes next. */
  private later(now: number) {
    this.next =
      this.logo && this.playful > 0
        ? now + this.playful * (0.75 + Math.random() * 0.5)
        : Infinity
  }

  private play(trick: Trick, now: number) {
    this.context.seed = Math.random()
    this.go(TRICKS[trick], now, 0.3)
    this.next = now + TRICK_LENGTH[trick]
  }

  private readonly enter = () => {
    if (!this.logo || this.state !== "rest" || this.still()) return
    this.hovered = true
    this.go(LOOK, performance.now() / 1000, 0.3)
    this.next = Infinity
    wake()
  }

  private readonly leave = () => {
    if (!this.hovered) return
    this.hovered = false
    if (this.state !== "rest") return
    this.play(Math.random() < 0.5 ? "flip" : "morph", performance.now() / 1000)
    wake()
  }

  private still() {
    return lessMotion?.matches ?? false
  }

  /** Draws the mark at `time`, in seconds: whether it moves on, and
   * wants the next tick. */
  frame(time: number): boolean {
    if (!this.visible) return false
    if (this.still()) {
      if (!this.settled) {
        this.paint(STILL[this.state])
        this.settled = true
      }
      return false
    }
    if (this.state === "rest" && !this.hovered && time >= this.next) {
      if (this.motion === REST) {
        this.go(WAKE, time, 0.2)
        this.next = time + 0.45
      } else if (this.motion === WAKE) {
        this.play(
          TRICK_NAMES[Math.floor(Math.random() * TRICK_NAMES.length)]!,
          time
        )
      } else {
        this.go(REST, time, 0.6)
        this.later(time)
      }
    }
    const holds = STANDING.has(this.motion)
    if (holds && time - this.fromAt > this.blend && this.settled)
      return this.sleep()

    this.context.look = this.looking()
    let pose = this.motion(time - this.began, time, this.context)
    const m = ease(clamp((time - this.fromAt) / this.blend))
    if (m < 1) pose = mix(this.from, pose, m)
    if (time < this.leap) pose = jumped(pose, hop(time, this.leap - LEAP, LEAP))
    this.paint(pose, time)
    this.settled = holds && m >= 1 && time >= this.leap
    return this.settled ? this.sleep() : true
  }

  /** At rest: no tick until the logo wakes at `next`, by a timer, set
   * once for each `next`, however often other marks tick meanwhile. */
  private sleep(): false {
    if (this.timer !== undefined && this.timerAt === this.next) return false
    clearTimeout(this.timer)
    this.timer = undefined
    this.timerAt = this.next
    if (this.next !== Infinity)
      this.timer = setTimeout(
        () => {
          // A tick's time is when its frame began, which may come before
          // the timer: woken short of `next`, it sleeps again.
          this.timer = undefined
          wake()
        },
        Math.max(0, this.next * 1000 - performance.now())
      )
    return false
  }

  /** Where the eyes turn to follow the pointer, when they should. */
  private looking(): [number, number] | null {
    const follows =
      this.hovered || this.state === "idle" || this.state === "asking"
    if (!follows || !pointer || performance.now() - moved > 2500) return null
    const box = this.svg.getBoundingClientRect()
    const x = box.left + box.width * (this.logo ? 0.76 : 0.5)
    const y = box.top + box.height * (this.logo ? 0.22 : 0.5)
    const dx = pointer[0] - x
    const dy = pointer[1] - y
    const d = Math.hypot(dx, dy) || 1
    const g = Math.min(1, d / 120)
    return [(dx / d) * 3.6 * g, (dy / d) * 3 * g]
  }

  /** Draws `p`: at `time` on the clock, or, with none, as a still pose. */
  private paint(p: Pose, time?: number) {
    this.last = p
    const drawn = drawnOf(p)
    this.body.setAttribute("d", drawn.d)
    this.hat.setAttribute("transform", drawn.transform)
    this.eyes.forEach((eye, i) => {
      const { cx, cy, rx, ry } = drawn.eyes[i]!
      if (rx === 0) {
        eye.setAttribute("rx", "0")
        eye.setAttribute("ry", "0")
        return
      }
      eye.setAttribute("cx", f(cx))
      eye.setAttribute("cy", f(cy))
      eye.setAttribute("rx", f(rx))
      eye.setAttribute("ry", f(ry))
    })
    this.glyph.setAttribute("d", drawn.glyph)
    if (drawn.glyph) this.glyph.setAttribute("stroke-opacity", f(drawn.shown))
    const snores = snoresOf(p.zz, time)
    this.zz.forEach((z, i) => {
      const { x, y, size, opacity } = snores[i]!
      z.setAttribute("x", f(x))
      z.setAttribute("y", f(y))
      z.setAttribute("font-size", f(size))
      z.setAttribute("opacity", f(opacity))
    })
    this.bells.setAttribute("opacity", f(clamp(p.bells)))
    if (p.bells > 0)
      this.bell.forEach((bell, i) =>
        bell.setAttribute("transform", drawn.bells[i]!)
      )
  }
}
