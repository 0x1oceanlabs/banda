/**
 * How a Pane zooms what it shows, as a browser zooms a page: Ctrl or ⌘
 * with + − 0, through the same steps from 50 to 200 % (ADR 0037, decision
 * 6). A Visual's preview, a terminal and a Thread zoom so.
 */
import { type Key, matches, type Pressed } from "./keys"

/** The zooms there are. */
export const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

/** The keys that zoom: `by` steps in or out, 0 back to 100 %. `+` is
 * Shift and `=` on most keyboards. */
export const ZOOM_KEYS: readonly (Key & { by: number })[] = [
  { code: "Equal", primary: true, by: 1 },
  { code: "Equal", primary: true, shift: true, by: 1 },
  { code: "Minus", primary: true, by: -1 },
  { code: "Digit0", primary: true, by: 0 },
]

/** The zoom after `event`, from `now`, one of {@link ZOOMS}; none for a
 * key that does not zoom. It stays at either end. */
export function zoomAfter(event: Pressed, now: number): number | null {
  const bind = ZOOM_KEYS.find((key) => matches(event, key))
  if (!bind) return null
  if (bind.by === 0) return 1
  const at = ZOOMS.indexOf(now)
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at + bind.by))]
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
