import { useContext, useEffect, useLayoutEffect, useState } from "react"
import { useMessageScroller } from "@banda/ui/components/message-scroller"
import { cancelFrame, onDraw } from "@banda/ui/lib/frames"
import { TileContext } from "@banda/ui/lib/tile"

/** The Threads whose place it remembers, the latest left last. */
const KEEP = 50
/** Where a Person left a Thread: the message at the top of its Pane, once
 * they scrolled up; or, left at its end, how many messages they saw. A
 * count, not the last one's id: a reply's draft gives its place to the
 * reply under a new id. */
type Place = { top: string } | { seen: number }
/** Each Thread's place, while the window lives. */
const places = new Map<string, Place>()
/** Closer to the end than this, in px, a Thread is at its end: the
 * scroller's own `scrollEdgeThreshold`. */
const AT_END = 8
/** The peek over a message the scroller moves near the top, in px: the
 * line before it shows above. Its Provider takes it too. */
export const PEEK = 64
/** How long after a Thread comes back what it holds may still be drawn,
 * in ms: a hidden Tile's commits wait up to a second (`useLive`). */
const RETURNING = 1200
/** How long what came is still drawn once it is, in ms, from when it is
 * found: markdown, code and Mermaid take their room after the text. */
const HOLD = 2000
const MESSAGE = "[data-message-id]"

function keep(thread: string, place: Place | undefined) {
  places.delete(thread)
  if (place === undefined) return
  places.set(thread, place)
  if (places.size > KEEP) places.delete(places.keys().next().value!)
}

/** The message at the top of `view`. */
function topOf(view: HTMLElement): string | undefined {
  const top = view.getBoundingClientRect().top
  for (const item of view.querySelectorAll<HTMLElement>(MESSAGE))
    if (item.getBoundingClientRect().bottom > top) return item.dataset.messageId
  return undefined
}

/** How many messages `view` shows; none for an empty Thread. */
function seenOf(view: HTMLElement): number | undefined {
  return view.querySelectorAll(MESSAGE).length || undefined
}

/** Where its Person leaves `view`: the message at its top, once they
 * scrolled up by hand (`up`); else the messages they saw. */
function placeOf(view: HTMLElement, up: boolean): Place | undefined {
  if (up) {
    const top = topOf(view)
    return top === undefined ? undefined : { top }
  }
  const seen = seenOf(view)
  return seen === undefined ? undefined : { seen }
}

/** Keys that scroll a Thread up. */
const UP_KEYS = new Set(["PageUp", "ArrowUp", "Home"])
/** How long after a hand's move a scroll is its, in ms. */
const HAND = 600

/**
 * Whether the Person scrolled `view` up by hand (ADR 0094, decision 2):
 * a wheel, a touch, a key, its scrollbar or the minimap moved it, and it
 * has not come back to the end since. The scroller's own moves, as it
 * places a message just sent, are not theirs; it keeps its mode to
 * itself. Returns how to stop.
 */
function watchHand(view: HTMLElement, heard: (up: boolean) => void) {
  const watching = new AbortController()
  const on = { passive: true, signal: watching.signal }
  let moved = -Infinity
  const hand = () => (moved = performance.now())
  view.addEventListener("wheel", (event) => event.deltaY < 0 && hand(), on)
  view.addEventListener("touchmove", hand, on)
  view.addEventListener(
    "keydown",
    (event) =>
      (UP_KEYS.has(event.key) || (event.key === " " && event.shiftKey)) &&
      hand(),
    on
  )
  // Its scrollbar is the viewport itself; the minimap is beside it.
  ;(view.parentElement ?? view).addEventListener(
    "pointerdown",
    ({ target }) =>
      (target === view ||
        (target instanceof Element &&
          target.closest('nav[aria-label="Your messages"]'))) &&
      hand(),
    on
  )
  view.addEventListener(
    "scroll",
    () => {
      const { scrollHeight, scrollTop, clientHeight } = view
      if (scrollHeight - scrollTop - clientHeight <= AT_END) heard(false)
      else if (performance.now() - moved < HAND) heard(true)
    },
    on
  )
  return () => watching.abort()
}

type Scroll = ReturnType<typeof useMessageScroller>["scrollToMessage"]

/** What came while a Thread was away, looked for as it comes back: once
 * the scroller settled (two frames), the first message not seen goes
 * near the top, if its start is above the screen. */
class Coming {
  private seen: { count: number; until: number } | null = null
  private frame = 0
  private holding: AbortController | undefined
  /** Whether its Person scrolled up by hand, from `watchHand`. */
  up = false

  private readonly view: React.RefObject<HTMLDivElement | null>
  private readonly scroll: Scroll

  constructor(view: React.RefObject<HTMLDivElement | null>, scroll: Scroll) {
    this.view = view
    this.scroll = scroll
  }

  back(count: number) {
    this.holding?.abort()
    this.seen = { count, until: performance.now() + RETURNING }
    this.again()
  }

  /** Looks again, if it still looks. */
  again() {
    if (!this.seen) return
    cancelFrame(this.frame)
    this.frame = onDraw(() => {
      this.frame = onDraw(() => this.look())
    })
  }

  stop() {
    cancelFrame(this.frame)
    this.seen = null
    this.holding?.abort()
  }

  private look() {
    const its = this.seen
    const view = this.view.current
    if (!its || !view) return
    if (performance.now() > its.until) {
      this.seen = null
      return
    }
    const count = view.querySelectorAll(MESSAGE).length
    // Nothing came yet: what was held may be drawn still.
    if (count === its.count) return
    this.seen = null
    // Fewer, as a rewind leaves: nothing to place by.
    if (count > its.count) this.hold(view, its.count)
  }

  /**
   * Keeps the start of what came on screen, the `seen`th message on,
   * while it is still drawn: at the end, the scroller follows it as it
   * grows, past its start. Moved near the top once, it stays.
   */
  private hold(view: HTMLElement, seen: number) {
    const until = performance.now() + HOLD
    const firstOf = () => view.querySelectorAll<HTMLElement>(MESSAGE)[seen]
    let first = firstOf()
    const place = () => {
      // A draft gives its place to its message.
      if (!first?.isConnected) first = firstOf()
      if (!first) return true
      const top = view.getBoundingClientRect().top
      if (first.getBoundingClientRect().top >= top) return false
      this.scroll(first.dataset.messageId!, {
        align: "start",
        scrollMargin: PEEK,
      })
      return true
    }
    if (place()) return
    this.holding = new AbortController()
    view.addEventListener(
      "scroll",
      () => {
        if (performance.now() > until || this.up || place())
          this.holding?.abort()
      },
      { passive: true, signal: this.holding.signal }
    )
  }
}

/**
 * Keeps where a Person left `thread`, and takes them back there when it
 * opens again (ADR 0010, decision 8): where they scrolled up to, or, left
 * at its end, the first message they did not see, near the top (ADR 0094,
 * decision 3). Inside the Thread's message scroller, whose viewport is
 * `viewport`; `last` is its last message, to look again as what was held
 * away is drawn. It shows nothing.
 */
export function ScrollPlace({
  thread,
  viewport,
  last,
}: {
  thread: string
  viewport: React.RefObject<HTMLDivElement | null>
  last: string | undefined
}) {
  const { scrollToMessage } = useMessageScroller()
  const tile = useContext(TileContext)
  const [coming] = useState(() => new Coming(viewport, scrollToMessage))

  // Another Thread in its Pane: the place is kept as it goes.
  useLayoutEffect(() => {
    const kept = places.get(thread)
    if (kept && "top" in kept) scrollToMessage(kept.top, { align: "start" })
    if (kept && "seen" in kept) coming.back(kept.seen)
    // Its ref is gone by the time this cleans up; the element is not.
    const view = viewport.current
    return () => keep(thread, view ? placeOf(view, coming.up) : undefined)
  }, [thread, scrollToMessage, viewport, coming])

  useEffect(() => {
    const view = viewport.current
    if (!view) return
    return watchHand(view, (up) => (coming.up = up))
  }, [viewport, coming])

  // Its Tile hidden: how many messages it showed is noted as it stops
  // showing, unless the Person scrolled up; the scroller keeps that place.
  useEffect(() => {
    let state = tile.now().state
    let left: number | undefined
    const stop = tile.watch(({ state: now }) => {
      if (now === state) return
      const was = state
      state = now
      const view = viewport.current
      if (!view) return
      if (was === "shown") left = coming.up ? undefined : seenOf(view)
      if (was === "hidden" && left !== undefined) {
        coming.back(left)
        left = undefined
      }
    })
    return () => {
      stop()
      coming.stop()
    }
  }, [tile, viewport, coming])

  // What was held while it was away is drawn: look again.
  useLayoutEffect(() => {
    coming.again()
  }, [coming, last])

  return null
}
