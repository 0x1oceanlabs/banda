import { useEffect, useState } from "react"
import {
  BLEND_MS,
  FAMILIES,
  motionOf,
  SATELLITE_COLOURS,
  SATELLITE_WORDS,
  type SatelliteMotion,
  type SatelliteSize,
  type SatelliteState,
  shapeOf,
} from "../lib/satellite"
import { cn } from "../lib/utils"

export type { SatelliteSize, SatelliteState } from "../lib/satellite"

const lessMotion =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-reduced-motion: reduce)")
    : undefined

/** Whether the Person asked for less motion, or `[motion] off` stills the
 * window (`html[data-still]`). */
function still(): boolean {
  if (lessMotion?.matches) return true
  return (
    typeof document !== "undefined" &&
    document.documentElement.hasAttribute("data-still")
  )
}

/** One drawing of a state, as it shows and as it goes. */
type Drawn = { state: SatelliteState; motion: SatelliteMotion; n: number }

/**
 * A sub-agent's satellite (ADR 0103, decision 12): its shape is its state,
 * in its state's colour from the look's tokens. It has no motion of its
 * own: a change within a shape blends in 0.45 s, one to another shape
 * leaps in 0.6 s, and a first draw, or any under reduced motion, is still.
 * It names its state for a screen reader, or `label` in its place.
 */
export function Satellite({
  state,
  size = 10,
  label,
  className,
}: {
  state: SatelliteState
  size?: SatelliteSize
  /** What a screen reader hears in place of the state's word. */
  label?: string
  className?: string
}) {
  // What it shows, and what it shows no longer while that fades.
  const [now, setNow] = useState<Drawn>({ state, motion: "still", n: 0 })
  const [gone, setGone] = useState<Drawn | null>(null)
  if (now.state !== state) {
    const motion = motionOf(now.state, state, still())
    setNow({ state, motion, n: now.n + 1 })
    setGone(motion === "still" ? null : now)
  }
  useEffect(() => {
    if (!gone) return
    // Gone once it has faded, as long as a blend takes.
    const timer = setTimeout(() => setGone(null), BLEND_MS + 10)
    return () => clearTimeout(timer)
  }, [gone])
  return (
    <span
      role="img"
      aria-label={label ?? SATELLITE_WORDS[state]}
      data-slot="satellite"
      data-sat={state}
      className={cn(
        "inline-grid shrink-0 leading-none transition-[color] duration-[450ms] motion-reduce:transition-none",
        className
      )}
      style={{ width: size, height: size, color: SATELLITE_COLOURS[state] }}
    >
      {gone && <Shape key={gone.n} drawn={gone} size={size} out />}
      <Shape key={now.n} drawn={now} size={size} />
    </span>
  )
}

function Shape({
  drawn: { state, motion },
  size,
  out,
}: {
  drawn: Drawn
  size: number
  out?: boolean
}) {
  const { tag: Tag, attrs } = shapeOf(state, size)
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      data-shape={FAMILIES[state]}
      data-sat-motion={out ? "out" : motion === "still" ? undefined : motion}
      // Its own size, which a trace's icon slot keeps.
      className="col-start-1 row-start-1 size-full overflow-visible"
    >
      <Tag {...attrs} />
    </svg>
  )
}
