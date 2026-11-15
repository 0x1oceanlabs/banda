/**
 * Wheel events as swipes, the way niri reads a touchpad. A touchpad sends
 * one swipe as a run of wheel events, its glide after the fingers lift
 * included; a mouse wheel sends one event a notch. Each swipe goes one way,
 * sideways or up and down, picked as it starts and kept to its end, so a
 * hand's drift in a long scroll up a Thread moves nothing sideways.
 */

/** A pause this long, in milliseconds, ends a swipe. */
export const SWIPE_END = 160

/** How far a swipe goes, in pixels, before it picks its way. */
const PICK = 8

/** A pixel count for a wheel event's line and page units. */
const LINE = 16
const PAGE = 800

/** Which way a swipe goes. */
export type Way = "sideways" | "upright"

/** The pixels a wheel event moves by, whatever unit it came in. */
export function pixels(event: {
  deltaX: number
  deltaY: number
  deltaMode: number
}): { x: number; y: number } {
  const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? PAGE : 1
  return { x: event.deltaX * unit, y: event.deltaY * unit }
}

/**
 * The swipe under way: how far it has gone each way, and the way it goes
 * once it has picked one. It picks sideways only when it goes clearly more
 * sideways than up or down.
 */
export class Swipe {
  x = 0
  y = 0
  way: Way | undefined
  /** Whether the last event is the one it picked its way on. */
  picked = false
  private last = -Infinity

  /** Takes one wheel event, sent at `at` milliseconds. True when the event
   * begins a new swipe. */
  add(x: number, y: number, at: number): boolean {
    const begins = at - this.last > SWIPE_END
    this.last = at
    if (begins) {
      this.x = 0
      this.y = 0
      this.way = undefined
    }
    this.x += x
    this.y += y
    this.picked = this.way === undefined && Math.hypot(this.x, this.y) >= PICK
    if (this.picked) {
      this.way =
        Math.abs(this.x) > 2 * Math.abs(this.y) ? "sideways" : "upright"
    }
    return begins
  }
}

/**
 * How far what lies between `target` and `stop` can still scroll sideways
 * by itself, back (to the left) and on (to the right), as a wide table or
 * a long line of code does: the most of them, each way. A sideways swipe
 * begun over room its way is that thing's own.
 */
export function sidewaysRoom(target: EventTarget | null, stop: Element) {
  const room = { back: 0, on: 0 }
  for (
    let element = target instanceof Element ? target : null;
    element && element !== stop;
    element = element.parentElement
  ) {
    const { overflowX, direction } = getComputedStyle(element)
    if (overflowX !== "auto" && overflowX !== "scroll") continue
    // From its start: the left edge, or the right one in a right-to-left
    // text, where `scrollLeft` counts down from zero.
    const gone = Math.abs(element.scrollLeft)
    const rest = element.scrollWidth - element.clientWidth - gone
    const [back, on] = direction === "rtl" ? [rest, gone] : [gone, rest]
    room.back = Math.max(room.back, back)
    room.on = Math.max(room.on, on)
  }
  return room
}
