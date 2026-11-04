/**
 * How a Pane zooms what it shows, as a browser zooms a page: Ctrl or ⌘
 * with + − 0, through the same steps from 50 to 200 % (ADR 0037, decision
 * 6). A Visual's preview and a terminal zoom so.
 */
import { type Key, matches, type Pressed } from "./keys"

/** The zooms there are. */
export const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

/** The keys that zoom: `by` steps in or out, 0 back to 100 %. `+` is
 * Shift and `=` on most keyboards. */
export const ZOOM_KEYS: readonly (Key & { by: number })[] = [
  { code: "Equal", ctrl: true, by: 1 },
  { code: "Equal", ctrl: true, shift: true, by: 1 },
  { code: "Minus", ctrl: true, by: -1 },
  { code: "Digit0", ctrl: true, by: 0 },
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
