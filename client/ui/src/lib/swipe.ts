/**
 * Wheel events as swipes, the way niri reads a touchpad, for the window
 * and for a browser's page alike. A touchpad sends
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

/** How far something can still scroll sideways: back (to the left) and on
 * (to the right). */
export type Room = { back: number; on: number }

/**
 * How far what a wheel event went through on its way, its `path`, can
 * still scroll sideways by itself, up to `stop`, as a wide table or a long
 * line of code does: the most of them, each way. With no `stop`, up to
 * the page itself and what its view scrolls. A sideways swipe begun over
 * room its way is that thing's own (ADR 0025).
 */
export function sidewaysRoom(
  path: readonly EventTarget[],
  stop: Element | null
): Room {
  const room = { back: 0, on: 0 }
  for (const element of path) {
    if (element === stop) break
    if (!(element instanceof Element)) continue
    const style = getComputedStyle(element)
    if (!scrolls(element, style.overflowX)) continue
    // From its start: the left edge, or the right one in a right-to-left
    // text, where `scrollLeft` counts down from zero.
    const gone = Math.abs(element.scrollLeft)
    const rest = element.scrollWidth - element.clientWidth - gone
    const [back, on] = style.direction === "rtl" ? [rest, gone] : [gone, rest]
    room.back = Math.max(room.back, back)
    room.on = Math.max(room.on, on)
  }
  return room
}

/** Whether a swipe that has gone `x` sideways began over `room` its way:
 * more of it than a pixel's rounding. */
export function hasRoom(room: Room, x: number): boolean {
  return (x < 0 ? room.back : room.on) > 1
}

/**
 * Whether `element`, whose `overflow-x` is `overflow`, scrolls sideways. A
 * page's view scrolls by its root, or by its body in a page of the old
 * kind, and says so as `visible`; it takes the body's `overflow-x` when
 * the root sets none. The other of the two scrolls nothing by itself,
 * but a body under a root that sets its own.
 */
function scrolls(element: Element, overflow: string): boolean {
  const own = overflow === "auto" || overflow === "scroll"
  const {
    documentElement: root,
    body,
    scrollingElement,
  } = element.ownerDocument
  if (element !== root && element !== body) return own
  const ofRoot = getComputedStyle(root).overflowX
  if (element !== (scrollingElement ?? root)) {
    return own && element === body && ofRoot !== "visible"
  }
  const ofView =
    ofRoot === "visible" && body ? getComputedStyle(body).overflowX : ofRoot
  return ofView === "visible" || ofView === "auto" || ofView === "scroll"
}
