// The gang, drawn at build: each of them a tile with eyes whose shape is
// its state, as the Mark's (ADR 0099), painted as in the picture "BANDA".
// These write SVG markup; the page's script only moves the pupils and
// switches a character's state.

export type GangState =
  "calm" | "working" | "asks" | "failed" | "done" | "woke" | "later"

type Shape = "square" | "circle" | "triangle" | "octagon"

const SHAPE: Record<GangState, Shape> = {
  calm: "square",
  working: "circle",
  asks: "triangle",
  failed: "octagon",
  done: "square",
  woke: "square",
  later: "square",
}

/** The paint each state wears (site.css). */
export const PAINT: Record<GangState, string> = {
  calm: "var(--gang-calm)",
  working: "var(--gang-working)",
  asks: "var(--gang-asks)",
  failed: "var(--gang-failed)",
  done: "var(--gang-done)",
  woke: "var(--gang-woke)",
  later: "var(--gang-later)",
}

const INK = "var(--gallery-ink)"
const GESSO = "var(--paint-gesso)"

/** Every layer of a character shares this box, so they stack exactly. */
export const VIEW = { x: -170, y: -180, w: 340, h: 360 }
export const VIEWBOX = `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`

/** Where the eyes sit, and how big. */
export const EYE = { x: 34, y: 12, r: 27, pupil: 10.5 }

export type EyeKind = "open" | "x" | "happy" | "sleep"

export function eyeKind(state: GangState): EyeKind {
  if (state === "failed") return "x"
  if (state === "done") return "happy"
  if (state === "later") return "sleep"
  return "open"
}

const fill = (paint: string) => `style="fill:${paint}"`
const stroke = (paint: string) => `style="stroke:${paint}"`

/** A small, steady noise, so a build draws the same hand every time. */
function noise(seed: number) {
  let s = (seed * 9301 + 49297) % 233280
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280 - 0.5
  }
}

/** A circle drawn by hand: its radius wavers a little, smoothly. The
 * eyes animate, so they get no filter, only this. */
export function handCircle(cx: number, cy: number, r: number, seed: number) {
  const n = 10
  const next = noise(seed)
  const points = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    const rr = r * (1 + next() * 0.09)
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]
  })
  // Catmull-Rom through the points, as cubic curves.
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  return `${d}Z`
}

function polygon(shape: Shape) {
  if (shape === "square")
    return {
      points: [
        [-60, -54],
        [60, -54],
        [60, 66],
        [-60, 66],
      ],
      round: 36,
    }
  if (shape === "triangle")
    return {
      points: [
        [0, -82],
        [84, 72],
        [-84, 72],
      ],
      round: 28,
    }
  const points = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    return [+(80 * Math.cos(a)).toFixed(1), +(80 * Math.sin(a) + 6).toFixed(1)]
  })
  return { points, round: 14 }
}

/** The body: an ink outline, the state's paint inside. A round stroke
 * as wide as the corner rounds the polygon's corners. */
export function body(state: GangState) {
  const paint = PAINT[state]
  const outline = 8
  const shape = SHAPE[state]
  if (shape === "circle")
    return (
      `<circle cy="8" r="${96 + outline}" ${fill(INK)}/>` +
      `<circle cy="8" r="96" ${fill(paint)}/>`
    )
  const { points, round } = polygon(shape)
  const pts = points.map((p) => p.join(",")).join(" ")
  return (
    `<polygon points="${pts}" style="fill:${INK};stroke:${INK}" stroke-width="${2 * round + 2 * outline}" stroke-linejoin="round"/>` +
    `<polygon points="${pts}" style="fill:${paint};stroke:${paint}" stroke-width="${2 * round}" stroke-linejoin="round"/>`
  )
}

export function legs(seed: number) {
  const d = (seed % 3) - 1
  const leg = (x1: number, x2: number) =>
    `<path d="M${x1} 96 L${x2} 150" ${stroke(INK)} stroke-width="10" stroke-linecap="round"/>`
  return (
    leg(-34, -40 + d * 6) +
    leg(34, 40 + d * 4) +
    `<ellipse cx="${-50 + d * 6}" cy="153" rx="20" ry="9" ${fill(INK)}/>` +
    `<ellipse cx="${50 + d * 4}" cy="153" rx="20" ry="9" ${fill(INK)}/>`
  )
}

/** Paint that ran down from the body as it dried. */
export function drips(state: GangState, seed: number) {
  const paint = PAINT[state]
  return [
    [-30, 24],
    [8, 46],
    [44, 16],
  ]
    .map(([x, base], i) => {
      const length = base + ((seed * 7 + i * 13) % 17)
      return (
        `<path d="M${x} 86 V${96 + length}" ${stroke(paint)} stroke-width="7" stroke-linecap="round"/>` +
        `<circle cx="${x}" cy="${98 + length}" r="5.5" ${fill(paint)}/>`
      )
    })
    .join("")
}

/** What a state carries: the one who asks raises a hand, the one who
 * woke from Later has its bells. */
export function extras(state: GangState, arm: boolean) {
  const paint = PAINT[state]
  if (state === "asks" && arm)
    return (
      `<path d="M70 34 Q118 18 124 -46" fill="none" ${stroke(INK)} stroke-width="11" stroke-linecap="round"/>` +
      `<circle cx="124" cy="-56" r="16" style="fill:${paint};stroke:${INK}" stroke-width="7"/>`
    )
  if (state === "woke")
    return [-62, 62]
      .map(
        (x) =>
          `<circle cx="${x}" cy="-92" r="17" style="fill:${paint};stroke:${INK}" stroke-width="7"/>` +
          `<circle cx="${x}" cy="-74" r="4" ${fill(INK)}/>`
      )
      .join("")
  return ""
}

/** The eyes that do not move: crossed out, happy arcs or asleep. They
 * belong to the still body, under its filter. */
export function stillEyes(kind: EyeKind) {
  const { x, y, r } = EYE
  if (kind === "happy")
    return [-x, x]
      .map(
        (cx) =>
          `<path d="M${cx - 17} ${y + 8} Q${cx} ${y - 22} ${cx + 17} ${y + 8}" fill="none" ${stroke(INK)} stroke-width="10" stroke-linecap="round"/>`
      )
      .join("")
  if (kind === "sleep")
    return [-x, x]
      .map(
        (cx) =>
          `<path d="M${cx - 15} ${y} H${cx + 15}" ${stroke(INK)} stroke-width="9" stroke-linecap="round"/>`
      )
      .join("")
  if (kind === "x")
    return [-x, x]
      .map(
        (cx) =>
          `<circle cx="${cx}" cy="${y}" r="${r}" style="fill:${GESSO};stroke:${INK}" stroke-width="7"/>` +
          `<path d="M${cx - 10} ${y - 10} L${cx + 10} ${y + 10} M${cx + 10} ${y - 10} L${cx - 10} ${y + 10}" ${stroke(INK)} stroke-width="8" stroke-linecap="round"/>`
      )
      .join("")
  return ""
}

/** The open eyes' whites, by hand; the pupils go over them. */
export function eyeWhites(seed: number) {
  const { x, y, r } = EYE
  return [-x, x]
    .map(
      (cx, i) =>
        `<path d="${handCircle(cx, y, r, seed * 3 + i)}" style="fill:${GESSO};stroke:${INK}" stroke-width="7"/>`
    )
    .join("")
}

export function pupils() {
  const { x, y, pupil } = EYE
  return [-x, x]
    .map((cx) => `<circle cx="${cx}" cy="${y}" r="${pupil}" ${fill(INK)}/>`)
    .join("")
}

/** A sub-agent, circling the one at work. */
export function satellite(state: GangState) {
  return `<circle cx="118" cy="-70" r="17" style="fill:${PAINT[state]};stroke:${INK}" stroke-width="7"/>`
}
