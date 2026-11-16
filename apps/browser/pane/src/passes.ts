/**
 * What runs in a browser's page itself, from its preload
 * (apps/browser/desktop/src/preload.ts): neither the desktop nor the Pane.
 */
import { hasRoom, pixels, sidewaysRoom, Swipe } from "@banda/ui/lib/swipe"
import type { Swiped } from "./desktop"

/**
 * Tells of each wheel event of a sideways swipe the page has no use for,
 * so the window's Strip moves by it as it does over any Pane (ADR 0025).
 * A swipe is read as the window reads one (`Swipe`): it goes one way, and
 * whose it is, is said once, as it picks that way. Begun over what could
 * still scroll its way in the page, the page's own view too, it is the
 * page's to its end; an event of it the page took for itself stays the
 * page's. Only the Person's hand counts, never an event the page made
 * up. Runs in the page, from its preload.
 */
export function passSwipes(page: Window, tell: (swiped: Swiped) => void) {
  const swipe = new Swipe()
  let room = { back: 0, on: 0 }
  let passes = false
  const onWheel = (event: WheelEvent) => {
    if (!event.isTrusted) return
    const { x, y } = pixels(event)
    if (swipe.add(x, y, event.timeStamp)) {
      room = sidewaysRoom(event.composedPath(), null)
      passes = false
    }
    if (swipe.way !== "sideways") return
    if (swipe.picked) passes = !hasRoom(room, swipe.x)
    if (!passes) return
    // What it went before it picked its way goes with the event it
    // picked on, as the Strip makes it up over any Pane.
    const swiped = swipe.picked
      ? { deltaX: swipe.x, deltaY: swipe.y }
      : { deltaX: x, deltaY: y }
    // Once the page's own listeners have heard the event.
    page.setTimeout(() => {
      if (!event.defaultPrevented) tell(swiped)
    })
  }
  // Before the page's listeners, so none keeps a swipe from being read.
  page.addEventListener("wheel", onWheel, { capture: true, passive: true })
}
