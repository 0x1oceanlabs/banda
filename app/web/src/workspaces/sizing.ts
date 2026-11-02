/**
 * The mouse's sizing, as niri's (ADR 0025, decisions 5 and 6): what a
 * press takes hold of, and the size a drag comes to. Pure: the window
 * measures, these decide, so each is tested on its own.
 */
import { free, share, type Width } from "./model"

/** A column as the Strip lays it out, in the window's pixels: its sides,
 * and the top and bottom of each Pane it stacks, when it stacks two or
 * more. */
export type Box = {
  id: string
  left: number
  right: number
  top: number
  bottom: number
  tiles: readonly { top: number; bottom: number }[]
}

/** What a press takes hold of: the gap right of a column, which sizes
 * its width, or the gap under one of its Panes, which sizes its height. */
export type Grab =
  | { kind: "width"; column: string }
  | { kind: "height"; column: string; pane: number }

/** How wide a gap is to the hand, in pixels, however thin the look draws
 * it: half of it on each side of the gap's middle. */
export const REACH = 8

/**
 * The gap at `x`, `y`, if one is: the one right of a column, the last
 * one's too, or one between two Panes of a column. The first column's
 * left has none: nothing is there to size.
 */
export function grabAt(
  boxes: readonly Box[],
  x: number,
  y: number,
  gap: number
): Grab | undefined {
  const half = Math.max(gap, REACH) / 2
  for (const box of boxes) {
    if (y < box.top || y > box.bottom) continue
    if (Math.abs(x - (box.right + gap / 2)) <= half) {
      return { kind: "width", column: box.id }
    }
  }
  for (const box of boxes) {
    if (x < box.left || x > box.right) continue
    for (let pane = 0; pane + 1 < box.tiles.length; pane++) {
      const middle = (box.tiles[pane].bottom + box.tiles[pane + 1].top) / 2
      if (Math.abs(y - middle) <= half) {
        return { kind: "height", column: box.id, pane }
      }
    }
  }
  return undefined
}

/** How a dragged size comes to rest: the steps it holds at, how near, in
 * pixels, and how many pixels a whole share is. */
export type Steps = {
  steps: readonly Width[]
  snap: number
  scale: number
}

/** `at`, kept between `least` and `most`, and held at the nearest step
 * there within `snap` pixels of it, if one is. */
function held(
  at: number,
  { steps, snap, scale }: Steps,
  least: number,
  most: number
) {
  at = Math.min(most, Math.max(least, at))
  let best: { step: Width; off: number } | undefined
  for (const step of steps) {
    const value = share(step)
    if (value === undefined || value < least || value > most) continue
    const off = Math.abs(value - at) * scale
    if (off <= snap && (!best || off < best.off)) best = { step, off }
  }
  return best?.step ?? free(at)
}

/** The width a column dragged to `at` of the room takes: never under
 * `floor`, the least it is drawn at, nor over the whole. */
export function widthFor(at: number, steps: Steps, floor = 0): Width {
  return held(at, steps, floor, 1)
}

/** A column's Panes as they stand: each one's share as drawn, and its own
 * height, if it has one. */
export type Stack = {
  heights: readonly number[]
  own: readonly (Width | undefined)[]
}

/**
 * Each Pane's own height once Pane `pane` is sized to `at` of the column.
 * The gap under it moves, or over it for the last: only it and the Pane
 * across that gap change, sharing what the two had, so every other stays
 * where it is. The one across keeps no height of its own when no other
 * Pane is without one, so the shares still fill the column. Neither gets
 * less than `least`.
 */
export function heightsFor(
  stack: Stack,
  pane: number,
  at: number,
  steps: Steps,
  least = 0
): (Width | undefined)[] {
  const { heights, own } = stack
  const across = pane + 1 < heights.length ? pane + 1 : pane - 1
  if (across < 0) return [...own]
  const both = heights[pane] + heights[across]
  const low = Math.min(least, both / 2)
  const height = held(at, steps, low, both - low)
  const othersFree = own.some(
    (width, i) => i !== pane && i !== across && width === undefined
  )
  const after = [...own]
  after[pane] = height
  after[across] = othersFree ? free(both - (share(height) ?? at)) : undefined
  return after
}
