/**
 * The satellite: the one small shape that stands for a sub-agent wherever
 * it shows, its shape its state (ADR 0103, decision 12). It is the Mark's
 * grammar with no eyes and no motion of its own: a square is calm, a
 * circle works, a triangle needs the Person, an octagon failed. The shapes
 * are the design reference's kit's (`docs/design/kit/sub.js`), and read in
 * greyscale. Pure, so plain tests cover it; `components/satellite.tsx`
 * draws it, and the Mark's orbit draws the same shapes.
 */

export type SatelliteState =
  | "working"
  | "asks"
  | "failed"
  | "done"
  | "stopped"
  /** A Crew's agent that waits for a slot. */
  | "queued"
  /** Cut off from Banda: a restart, its Harness stopping. */
  | "lost"

/** The sizes it is drawn at, in px: 8 in a Crew's strip, 10 at a row's
 * start, 12 in a Pane's header and its status bar. */
export type SatelliteSize = 8 | 10 | 12

/** Each state in Banda's words, as a screen reader and a tooltip say it. */
export const SATELLITE_WORDS: Record<SatelliteState, string> = {
  working: "Working",
  asks: "Asks",
  failed: "Failed",
  done: "Done",
  stopped: "Stopped",
  queued: "Queued",
  lost: "Lost",
}

/** The colour each state is drawn in, by the look's tokens: the text,
 * thinned, but where it calls. Done is calm, never green: green is the
 * Thread's. */
export const SATELLITE_COLOURS: Record<SatelliteState, string> = {
  working: "var(--sat-working)",
  asks: "var(--attention)",
  failed: "var(--destructive)",
  done: "var(--sat-done)",
  stopped: "var(--sat-stopped)",
  queued: "var(--sat-queued)",
  lost: "var(--sat-lost)",
}

/** The shape a state is of: a change within one blends, a change to
 * another leaps. */
export type Family = "circle" | "triangle" | "octagon" | "square"

export const FAMILIES: Record<SatelliteState, Family> = {
  working: "circle",
  queued: "circle",
  asks: "triangle",
  failed: "octagon",
  done: "square",
  stopped: "square",
  lost: "square",
}

/** One SVG element in a box `size` px wide, its attributes as React
 * names them. It draws in `currentColor`. */
export type SatelliteShape = {
  tag: "circle" | "rect" | "path" | "polygon"
  attrs: Record<string, string | number>
}

/** A number as an attribute holds it: two decimals at most. */
const n2 = (value: number) => Math.round(value * 100) / 100

/** The shape of `state` in a box `size` px wide, as the kit draws it. */
export function shapeOf(state: SatelliteState, size: number): SatelliteShape {
  const S = size
  const c = S / 2
  const sw = S >= 16 ? 1.5 : S >= 12 ? 1.25 : 1
  const pad = Math.max(1, Math.round(S * 0.09))
  const side = S - 2 * pad
  const rx = side * 0.3
  const at = (x: number, y: number) => `${n2(x)} ${n2(y)}`
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: sw,
  }
  switch (state) {
    case "working":
      return {
        tag: "circle",
        attrs: {
          cx: n2(c),
          cy: n2(c),
          r: n2(side / 2 + S * 0.06),
          fill: "currentColor",
        },
      }
    case "queued": {
      // A dashed ring, its dashes from the top.
      const r = side / 2 + S * 0.06 - sw / 2
      const dashes = S <= 8 ? 5 : S <= 12 ? 6 : 8
      const one = (2 * Math.PI * r) / dashes
      return {
        tag: "circle",
        attrs: {
          cx: n2(c),
          cy: n2(c),
          r: n2(r),
          ...line,
          strokeDasharray: `${n2(one * 0.55)} ${n2(one * 0.45)}`,
          transform: `rotate(-90 ${at(c, c)})`,
        },
      }
    }
    case "done":
      return {
        tag: "rect",
        attrs: {
          x: pad,
          y: pad,
          width: side,
          height: side,
          rx: n2(rx),
          fill: "currentColor",
        },
      }
    case "stopped":
      return {
        tag: "rect",
        attrs: {
          x: n2(pad + sw / 2),
          y: n2(pad + sw / 2),
          width: n2(side - sw),
          height: n2(side - sw),
          rx: n2(Math.max(0.5, rx - sw / 2)),
          ...line,
        },
      }
    case "lost": {
      // The outlined square with its top right corner gone.
      const x0 = pad + sw / 2
      const s = side - sw
      const q = Math.max(0.5, rx - sw / 2)
      const g = Math.max(0.8, S * 0.1)
      const arc = `A${n2(q)} ${n2(q)} 0 0 1 `
      const d =
        `M${at(x0 + s, x0 + q + g)}V${n2(x0 + s - q)}${arc}${at(x0 + s - q, x0 + s)}` +
        `H${n2(x0 + q)}${arc}${at(x0, x0 + s - q)}V${n2(x0 + q)}${arc}${at(x0 + q, x0)}` +
        `H${n2(x0 + s - q - g)}`
      return { tag: "path", attrs: { d, ...line, strokeLinecap: "round" } }
    }
    case "asks": {
      // Rounded by a round-joined stroke as wide as the corner.
      const k = S * 0.14
      const W = S * 1.04
      const H = S * 0.92
      const top = (S - H) / 2 - S * 0.02
      const points = [
        at(c, top + k),
        at(c + W / 2 - k, top + H - k),
        at(c - W / 2 + k, top + H - k),
      ].join(" ")
      return {
        tag: "polygon",
        attrs: {
          points,
          fill: "currentColor",
          stroke: "currentColor",
          strokeWidth: n2(2 * k),
          strokeLinejoin: "round",
        },
      }
    }
    case "failed": {
      // As wide as the box, its flats on whole pixels so it reads as cut
      // corners and not a circle even at 8 px; its corners eased by a
      // round join.
      const k = S >= 12 ? 0.75 : 0.5
      const cut = Math.round(S * 0.293 * 2) / 2 - k * 0.414
      const lo = k
      const hi = S - k
      const points = [
        [lo + cut, lo],
        [hi - cut, lo],
        [hi, lo + cut],
        [hi, hi - cut],
        [hi - cut, hi],
        [lo + cut, hi],
        [lo, hi - cut],
        [lo, lo + cut],
      ]
        .map(([x, y]) => at(x, y))
        .join(" ")
      return {
        tag: "polygon",
        attrs: {
          points,
          fill: "currentColor",
          stroke: "currentColor",
          strokeWidth: 2 * k,
          strokeLinejoin: "round",
        },
      }
    }
  }
}

/** How a satellite goes to its state: still, as a first draw is and
 * everything is under reduced motion; blending within its shape; or
 * leaping to a new one. */
export type SatelliteMotion = "still" | "blend" | "leap"

/** How long a blend takes, in ms (ADR 0103, decision 12), and so how
 * long the shape it leaves takes to go; a leap takes 600. The look's
 * `sat-*` keyframes say the same. */
export const BLEND_MS = 450

/**
 * How a satellite drawn in `was` goes to `now`: a first draw has no news
 * and is still, as is one under reduced motion or `[motion] off`
 * (`still`); a change within a shape blends, one to another shape leaps.
 */
export function motionOf(
  was: SatelliteState | undefined,
  now: SatelliteState,
  still: boolean
): SatelliteMotion {
  if (was === undefined || was === now || still) return "still"
  return FAMILIES[was] === FAMILIES[now] ? "blend" : "leap"
}
