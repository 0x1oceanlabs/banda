/**
 * Whether the Person is at this window: a key, pointer or wheel input in
 * it within the last minute (ADR 0096, decision 3). A window left in front
 * with no one at it marks nothing seen, so a Thread it shows still calls
 * the Person on their other machine. Each window counts its own inputs by
 * its own clock: no time goes to another machine.
 */
import { MINUTE } from "@banda/ui/lib/words"

/** How long after an input the Person counts as there. */
export const PRESENT_FOR = MINUTE

/** What counts as the Person at the window. */
const INPUTS = ["keydown", "pointerdown", "pointermove", "wheel"] as const

/**
 * Runs `act` now if the Person is there, else at their first input after;
 * the function it gives back calls a wait off.
 */
export type WhenPresent = (act: () => void) => () => void

/** Runs `act` now, with nothing to call off. */
const atOnce: WhenPresent = (act) => {
  act()
  return () => undefined
}

/** The inputs to `target`, counted from as `now` tells. */
export function presence(
  target: EventTarget,
  now: () => number = () => performance.now()
): WhenPresent {
  let last = -Infinity
  // Where the pointer was last heard: nowhere yet.
  let at: { x: number; y: number } | undefined
  const waiting = new Set<() => void>()
  const heard = (event: Event) => {
    if (event.type === "pointermove") {
      // A page that moves under a pointer at rest moves it too, with
      // nobody there: only a pointer that went somewhere counts. The
      // first says only where it is, as a window that starts again under
      // a pointer at rest hears one with nobody there.
      const { screenX: x, screenY: y } = event as PointerEvent
      const moved = at !== undefined && (x !== at.x || y !== at.y)
      at = { x, y }
      if (!moved) return
    }
    last = now()
    if (waiting.size === 0) return
    const acts = [...waiting]
    waiting.clear()
    for (const act of acts) act()
  }
  for (const input of INPUTS)
    target.addEventListener(input, heard, { capture: true, passive: true })
  return (act) => {
    if (now() - last < PRESENT_FOR) return atOnce(act)
    // Its own, so calling off one wait leaves another of the same act.
    const once = () => act()
    waiting.add(once)
    return () => void waiting.delete(once)
  }
}

/**
 * This window's: it counts from the moment the module loads, as the
 * window starts, so the click that opens a Thread counts too. With no
 * window, as in a test, nothing waits.
 */
export const whenPresent: WhenPresent =
  typeof window === "undefined" ? atOnce : presence(window)
