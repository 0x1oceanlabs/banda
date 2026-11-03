/**
 * Where a Pane carried by the mouse lands, as niri's insert hint (ADR
 * 0025, decisions 5 and 6): beside another Pane, as the engine's
 * `beside` place says. Pure: the window measures the columns, this
 * decides from them and the pointer, and says where to draw the hint.
 */
import type { Side } from "@banda/contract/workspaces"
import type { Box } from "./sizing"

/** A rectangle in the window's pixels. */
export type Rect = { left: number; top: number; width: number; height: number }

/** A column as the Strip lays it out, in the window's pixels: its tiles
 * are each Pane's, one or more, when it does not show them as tabs. */
export type Lane = Box & {
  /** Its Panes, top down, by ID. */
  panes: readonly string[]
  /** Its row of tabs, one per Pane, when it shows them as tabs. */
  tabs?: readonly { left: number; right: number; top: number; bottom: number }[]
}

/** Where the Pane lands: beside `pane`, on `side`, and the hint for it. */
export type Landing = { pane: string; side: Side; hint: Rect }

/** How wide a column's edge is to the pointer, at most, in pixels: a
 * quarter of the column, never more. */
export const EDGE = 96

/** How thick the insert hint is drawn, in pixels. */
const HINT = 4

/** The insert hint standing at `x`, from `top` to `bottom`. */
export function standing(x: number, top: number, bottom: number): Rect {
  return { left: x - HINT / 2, top, width: HINT, height: bottom - top }
}

/** The insert hint lying at `y`, from `left` to `right`. */
export function lying(y: number, left: number, right: number): Rect {
  return { left, top: y - HINT / 2, width: right - left, height: HINT }
}

/**
 * Where `moving`, carried to `x`, `y`, lands among `lanes`: a column's
 * edge, or the gap beside it, makes it a column on that side; a column's
 * middle puts it over or under the Pane there; a row of tabs, or a tabbed
 * column's page, makes it a tab. None where it would stay where it is.
 */
export function landingAt(
  lanes: readonly Lane[],
  x: number,
  y: number,
  moving: string,
  gap: number
): Landing | undefined {
  if (!lanes.length) return undefined
  const at = lanes.findIndex((lane) => x < lane.right + gap / 2)
  const c = at < 0 ? lanes.length - 1 : at
  const lane = lanes[c]
  const edge = Math.min((lane.right - lane.left) / 4, EDGE)
  const sideways = (side: "left" | "right"): Landing | undefined => {
    // Its own column, alone, stays where it is beside its neighbours.
    const own = (l: Lane | undefined) =>
      l?.panes.length === 1 && l.panes[0] === moving
    if (own(lane) || own(lanes[side === "left" ? c - 1 : c + 1])) {
      return undefined
    }
    const pane = lane.panes.find((id) => id !== moving)!
    const middle = side === "left" ? lane.left - gap / 2 : lane.right + gap / 2
    return { pane, side, hint: standing(middle, lane.top, lane.bottom) }
  }
  if (at < 0 || x > lane.right - edge) return sideways("right")
  if (x < lane.left + edge) return sideways("left")

  const stays = (pane: string, side: "above" | "below") => {
    const i = lane.panes.indexOf(pane)
    const next = lane.panes[side === "above" ? i - 1 : i + 1]
    return pane === moving || next === moving
  }
  if (lane.tabs) {
    // Over the tabs, beside the tab under the pointer; elsewhere, last.
    const row = lane.tabs[0]
    const over = row && y >= row.top && y <= row.bottom
    const i = over
      ? lastIfNone(
          lane.tabs.findIndex((tab) => x < tab.right),
          lane.tabs
        )
      : lane.tabs.length - 1
    const tab = lane.tabs[i]
    const before = over && x < (tab.left + tab.right) / 2
    const pane = lane.panes[i]
    const side = before ? "above" : "below"
    if (!pane || stays(pane, side)) return undefined
    const at = before ? tab.left : tab.right
    return { pane, side, hint: standing(at, tab.top, tab.bottom) }
  }
  const t = lastIfNone(
    lane.tiles.findIndex((tile) => y < tile.bottom + gap / 2),
    lane.tiles
  )
  const tile = lane.tiles[t]
  const pane = lane.panes[t]
  if (!tile || !pane) return undefined
  const side = y < (tile.top + tile.bottom) / 2 ? "above" : "below"
  if (stays(pane, side)) return undefined
  const middle = side === "above" ? tile.top - gap / 2 : tile.bottom + gap / 2
  return { pane, side, hint: lying(middle, lane.left, lane.right) }
}

/** `found`, or the last of `list` when nothing was. */
function lastIfNone(found: number, list: readonly unknown[]): number {
  return found < 0 ? list.length - 1 : found
}

/** How fast the Strip scrolls with the pointer `by` pixels into its edge,
 * of `EDGE`: from nothing at the edge's start to `fastest` against it. */
export function edgeSpeed(by: number, fastest = 24): number {
  const into = Math.min(1, Math.max(0, by / EDGE))
  return into * into * fastest
}

/** Scrolls `element` by `by`: whether it moved. */
export function nudge(
  element: HTMLElement,
  side: "scrollTop" | "scrollLeft",
  by: number
): boolean {
  if (!by) return false
  const was = element[side]
  element[side] += by
  return element[side] !== was
}

/** How far, in pixels, what shows `size` from `from` scrolls this frame
 * with the pointer at `at`: back near its start, on near its end. */
export function pushed(at: number, from: number, size: number): number {
  return edgeSpeed(at - (from + size - EDGE)) - edgeSpeed(from + EDGE - at)
}
