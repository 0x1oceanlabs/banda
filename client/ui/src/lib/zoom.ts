/**
 * How a Pane zooms what it shows, as a browser zooms a page: Ctrl or ⌘
 * with + − 0, through the same steps from 50 to 200 % (ADR 0037, decision
 * 6). A Visual's preview, a terminal and a Thread zoom so.
 */
import type { Key } from "./keys"

/** The zooms there are. */
export const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

/** A step of the zoom: in, out, or back to 100 %. */
export type ZoomStep = 1 | -1 | 0

/** The zoom's actions, each a Pane's own (ADR 0071, decision 1): what
 * each does, by its id's last word, its title for what it zooms, as "the
 * terminal", and its keys. `+` is Shift and `=` on most keyboards. */
export const ZOOM_KEYS: readonly {
  does: "zoom-in" | "zoom-out" | "zoom-reset"
  by: ZoomStep
  title: (what: string) => string
  keys: Key[]
}[] = [
  {
    does: "zoom-in",
    by: 1,
    title: (what) => `Zoom ${what} in`,
    keys: [
      { code: "Equal", primary: true },
      { code: "Equal", primary: true, shift: true },
    ],
  },
  {
    does: "zoom-out",
    by: -1,
    title: (what) => `Zoom ${what} out`,
    keys: [{ code: "Minus", primary: true }],
  },
  {
    does: "zoom-reset",
    by: 0,
    title: (what) => `${what[0].toUpperCase()}${what.slice(1)} at its own size`,
    keys: [{ code: "Digit0", primary: true }],
  },
]

/** The id of a zoom action of the scope whose actions start `prefix`. */
export function zoomId(prefix: string, does: string): string {
  return `${prefix}.${does}`
}

/** The zoom a step `by` from `now`, one of {@link ZOOMS}: it stays at
 * either end. */
export function zoomBy(now: number, by: ZoomStep): number {
  if (by === 0) return 1
  const at = ZOOMS.indexOf(now)
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at + by))]
}

const kept = new Map<string, number>()

/** The zoom kept for `what`, as a terminal or a Thread: its own, as its
 * Pane moves between workspaces or pops out, until the window starts
 * again. */
export function zoomOf(what: string): number {
  return kept.get(what) ?? 1
}

/** Keeps `zoom` for `what`, till the window starts again. */
export function keepZoom(what: string, zoom: number): void {
  if (zoom === 1) kept.delete(what)
  else kept.set(what, zoom)
}
