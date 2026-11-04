/**
 * How the overview fits the workspaces in (ADR 0025, decision 7): each
 * whole, all its columns, not only the screen its Strip shows; and all of
 * them at once, one under another, while they can be read.
 */

/** A wide workspace is drawn no smaller than this share of the others'
 * zoom: past it, its row scrolls sideways. */
export const NARROWEST = 0.6

/** The overview zooms out no further than this to fit every workspace in
 * its height, unless `[overview] zoom` says less: past it, it scrolls. */
export const LEAST = 0.15

/** What a row takes besides its screen, in pixels: the place to drop a
 * Pane above it, and the line under a wide one. */
export const ROW = { between: 16, track: 8, empty: 28 }

export type Fitting = {
  /** Each workspace's width, drawn whole at full size, in pixels: its
   * columns, the gaps and the outer gap on either side; 0 for an empty one. */
  widths: readonly number[]
  /** The screen a workspace fills at full size, in pixels. */
  screen: { width: number; height: number }
  /** The room the overview has for a row, and for them all, in pixels. */
  room: { width: number; height: number }
  /** `[overview] zoom`: how far it zooms out, at most. */
  most: number
}

export type Fit = {
  /** The zoom of a workspace one screen wide, and of an empty one. */
  zoom: number
  /** Each workspace's own zoom: a wide one may be drawn smaller. */
  rows: number[]
  /** Whether each is wider than its screen: a line under it shows which
   * part of it the screen shows. */
  wide: boolean[]
}

export function fit({ widths, screen, room, most }: Fitting): Fit {
  const wide = widths.map((width) => width > screen.width + 0.5)
  const rows = (zoom: number) =>
    widths.map((width) =>
      width > 0
        ? Math.max(zoom * NARROWEST, Math.min(zoom, room.width / width))
        : zoom
    )
  const height = (zoom: number) =>
    rows(zoom).reduce(
      (sum, row, i) =>
        sum +
        ROW.between +
        (widths[i] > 0 ? screen.height * row : ROW.empty) +
        (wide[i] ? ROW.track : 0),
      0
    )
  let zoom = Math.max(0, Math.min(most, room.width / screen.width))
  if (zoom > 0 && height(zoom) > room.height) {
    // The largest zoom that fits, down to the least.
    let low = Math.min(zoom, LEAST)
    let high = zoom
    for (let i = 0; i < 24; i++) {
      const middle = (low + high) / 2
      if (height(middle) > room.height) high = middle
      else low = middle
    }
    zoom = low
  }
  return { zoom, rows: rows(zoom), wide }
}
