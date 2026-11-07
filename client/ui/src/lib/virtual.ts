/**
 * Which rows of a long list of rows of one height are drawn, for where it
 * is scrolled (ADR 0073, decision 14: the virtual list). Rows taller in
 * all than a page may be are scaled into that height: the scroll then
 * moves through them faster than a pixel each, and the rows drawn are
 * placed where the view is. Pure, so plain tests cover it.
 */

/** The most a list is drawn tall, in px: Chromium lays out nothing much
 * taller than 33 million, and a zoomed page counts more. */
export const MOST_HEIGHT = 15_000_000

export type Rows = {
  count: number
  /** Each row's height, in px. */
  row: number
  /** How tall the rows' part of the view is, in px. */
  view: number
  /** How many rows are drawn past each end of the view. */
  overscan?: number
  most?: number
}

/** What a list draws: rows `first` to `last`, both in (none when `last`
 * is below `first`), each at its `top`; and how tall it is. */
export type Drawn = {
  first: number
  last: number
  /** How tall the rows' part is drawn, in px. */
  height: number
  /** Where row `index` is drawn, from the top of the rows' part. */
  top: (index: number) => number
}

/** How far down the rows the view's top is, in px of the rows whole, for
 * `scroll`. */
function offsetOf(rows: Rows, scroll: number): number {
  const { count, row, view, most = MOST_HEIGHT } = rows
  const whole = count * row
  const room = Math.min(whole, most) - view
  return room > 0 ? (Math.min(scroll, room) / room) * (whole - view) : 0
}

/** The rows drawn with the view scrolled to `scroll`. */
export function drawnAt(rows: Rows, scroll: number): Drawn {
  const { count, row, view, overscan = 6, most = MOST_HEIGHT } = rows
  const offset = offsetOf(rows, scroll)
  const first = Math.max(0, Math.floor(offset / row) - overscan)
  const last = Math.min(
    count - 1,
    Math.ceil((offset + view) / row) - 1 + overscan
  )
  const height = Math.min(count * row, most)
  // One to one, a row stays where it is; scaled, it is placed in the view.
  const shift = Math.min(scroll, Math.max(0, height - view)) - offset
  return { first, last, height, top: (index) => index * row + shift }
}

/** Where to scroll for row `index` to show at the view's top, in its
 * middle, or as near as it is when it shows already. */
export function scrollFor(
  rows: Rows,
  index: number,
  align: "start" | "center" | "nearest",
  scroll: number
): number {
  const { count, row, view, most = MOST_HEIGHT } = rows
  const whole = count * row
  const room = Math.min(whole, most) - view
  if (room <= 0) return 0
  const now = offsetOf(rows, scroll)
  const at = index * row
  const wanted =
    align === "start"
      ? at
      : align === "center"
        ? at - (view - row) / 2
        : at < now
          ? at
          : at + row > now + view
            ? at + row - view
            : now
  const offset = Math.min(Math.max(0, wanted), whole - view)
  return (offset / (whole - view)) * room
}
