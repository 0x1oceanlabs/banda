/**
 * How wide the sidebar is, which its right edge drags: in rem, so it
 * grows with `[font] size`. Banda draws it 16rem wide (`--sidebar-width`
 * in globals.css); a drag takes it from 13rem to 32rem, and never so wide
 * that no column fits beside it, which would hide it (ADR 0025,
 * decision 10).
 */
export const WIDTH = 16
export const MIN = 13
export const MAX = 32
/** Dragged this far, letting go hides the sidebar instead. */
export const HIDES = 9
/** How near 16rem a drag sticks to it. */
const STICKS = 0.375

/**
 * The widest the sidebar goes in a window `window` rem wide, whose
 * columns are at least `column` rem: a rem is left for the gaps.
 */
export function widest(window: number, column: number): number {
  return Math.max(MIN, Math.min(MAX, window - column - 1))
}

/**
 * The width a drag to `rem` comes to: a quarter rem at a time, 16 when
 * near it, from 13 to `max`.
 */
export function dragged(rem: number, max: number): number {
  const at = Math.abs(rem - WIDTH) < STICKS ? WIDTH : Math.round(rem * 4) / 4
  return Math.min(max, Math.max(MIN, at))
}

/** A width kept from before, as one Banda draws now. */
export function kept(rem: number): number {
  return Number.isFinite(rem) && rem > 0
    ? Math.min(MAX, Math.max(MIN, rem))
    : WIDTH
}
