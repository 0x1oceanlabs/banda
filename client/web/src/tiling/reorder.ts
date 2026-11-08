/**
 * The overview's workspaces dragged by their numbers into another order
 * (ADR 0025, decision 7), as niri's overview drags a workspace: the one
 * carried follows the pointer, the ones it passes step aside, and on the
 * drop the engine moves it (`workspaces.move_workspace`). Each row draws
 * the workspace itself under it, so the Panes go along as it moves.
 */
import {
  type PointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react"
import { cancelFrame, onMove } from "@banda/ui/lib/frames"
import { nudge, pushed, swallowClick } from "./moving"
import { THRESHOLD } from "./sizing"

/** How long the ones passed take to step aside, in milliseconds. */
export const STEP_ASIDE = 150

/** Where a place is drawn, from the top of what scrolls, in pixels. */
type Box = { top: number; height: number }

/**
 * The index the workspace at `from`, carried `by` pixels, lands at: its
 * middle past the middle of each it passes. Never at the last, the empty
 * one at the bottom, which stays there.
 */
export function landing(places: Box[], from: number, by: number): number {
  const own = places[from]
  if (!own) return from
  const middle = own.top + own.height / 2 + by
  const last = places.length - 1
  return places.filter(
    (place, i) =>
      i !== from && i < last && place.top + place.height / 2 < middle
  ).length
}

/** How far each place is drawn from where it stands, with the one at
 * `from` going to `to`: the ones between step aside by its height. */
export function offsets(places: Box[], from: number, to: number): number[] {
  const height = places[from]?.height ?? 0
  return places.map((_, i) => {
    if (i === from) {
      const at = places[to]
      if (!at) return 0
      return to < from
        ? at.top - places[from].top
        : at.top + at.height - places[from].top - height
    }
    if (from < i && i <= to) return -height
    if (to <= i && i < from) return height
    return 0
  })
}

type Drag = {
  from: number
  to: number
  /** The pointer's start and now, on screen. */
  start: number
  y: number
  /** How far it is carried, drawn last. */
  by: number
  /** How far `scroller` was scrolled at the start, and where it shows. */
  scrolled: number
  view: Box
  places: Box[]
  items: HTMLElement[]
  /** Past the threshold: a drag, not a click. */
  on: boolean
  frame: number
  /** What hears `Esc` while it is on. */
  key?: (event: KeyboardEvent) => void
}

/**
 * Drags the workspaces in `list`, each an item in the order of `ids`, in
 * `scroller`, which scrolls as the pointer nears its top or bottom; a drop
 * `move`s one, and settles once that is done. The one carried is marked
 * `data-lifted`, and `data-held` while it follows the pointer.
 */
export function useReorder(
  list: RefObject<HTMLElement | null>,
  scroller: RefObject<HTMLElement | null>,
  ids: readonly string[],
  move: (id: string, index: number) => Promise<unknown>
) {
  const drag = useRef<Drag | undefined>(undefined)
  const dropped = useRef<HTMLElement[] | undefined>(undefined)
  // The last press was a drag: its release is no click.
  const dragged = useRef(false)

  // Once the engine's order shows, each item stands where it was carried
  // to: the offsets go with no motion.
  const order = ids.join()
  useLayoutEffect(() => {
    const items = dropped.current
    dropped.current = undefined
    if (items) settle(items, false)
  }, [order])

  const draw = (d: Drag) => {
    const at = offsets(d.places, d.from, d.to)
    d.items.forEach((item, i) => {
      const y = i === d.from && d.on ? d.by : at[i]
      item.style.transform = y ? `translateY(${y}px)` : ""
    })
  }
  // A move on the window's clock, once a tick: near the top or the bottom
  // what scrolls does, and the one carried follows the pointer; the
  // overview draws its workspace after it.
  const follow = (d: Drag) => {
    const element = scroller.current
    if (element) {
      nudge(element, "scrollTop", pushed(d.y, d.view.top, d.view.height))
    }
    const by = d.y - d.start + (element?.scrollTop ?? 0) - d.scrolled
    if (by !== d.by) {
      d.by = by
      d.to = landing(d.places, d.from, by)
      draw(d)
    }
    d.frame = onMove(() => follow(d))
  }
  const end = (d: Drag) => {
    drag.current = undefined
    release(d)
  }
  /** Puts a workspace carried back where it was. */
  const cancel = () => {
    const d = drag.current
    if (!d) return
    end(d)
    if (d.on) settle(d.items, true)
  }
  useEffect(
    () => () => {
      const d = drag.current
      if (d) release(d)
    },
    [drag]
  )

  return {
    /** Takes a workspace by its number. */
    press(event: PointerEvent<HTMLElement>, index: number) {
      const items = [...(list.current?.children ?? [])] as HTMLElement[]
      const element = scroller.current
      if (event.button !== 0 || items.length !== ids.length || !element) return
      if (document.documentElement.dataset.drag) return
      event.currentTarget.setPointerCapture(event.pointerId)
      dragged.current = false
      const { top, height } = element.getBoundingClientRect()
      drag.current = {
        from: index,
        to: index,
        start: event.clientY,
        y: event.clientY,
        by: 0,
        scrolled: element.scrollTop,
        view: { top, height },
        // Where each stands, not where a motion has it now: `scroller` is
        // what they are placed in.
        places: items.map((item) => ({
          top: item.offsetTop,
          height: item.offsetHeight,
        })),
        items,
        on: false,
        frame: 0,
      }
    },
    drag(event: PointerEvent<HTMLElement>) {
      const d = drag.current
      if (!d) return
      d.y = event.clientY
      if (d.on || Math.abs(d.y - d.start) < THRESHOLD) return
      dragged.current = true
      lift(d, (event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        cancel()
      })
      follow(d)
    },
    drop() {
      const d = drag.current
      if (!d) return
      end(d)
      if (!d.on) return
      swallowClick()
      if (d.to === d.from) return settle(d.items, true)
      // It goes to its place, and stays there until the order shows.
      d.on = false
      d.items[d.from].removeAttribute("data-held")
      draw(d)
      dropped.current = d.items
      void move(ids[d.from], d.to).finally(() => {
        // Refused, or drawn some other way: back to where they stand.
        if (dropped.current !== d.items) return
        dropped.current = undefined
        settle(d.items, true)
      })
    },
    cancel,
    /** Whether a click on a number is one, not the end of a drag. */
    clicked: () => !dragged.current,
  }
}

/** The one carried: over the others, held to the pointer, and the only
 * drag of the window until it is let go; `key` hears `Esc`. */
function lift(d: Drag, key: (event: KeyboardEvent) => void) {
  d.on = true
  d.key = key
  document.documentElement.dataset.drag = "move"
  d.items[d.from].setAttribute("data-lifted", "")
  d.items[d.from].setAttribute("data-held", "")
  window.addEventListener("keydown", key, true)
}

/** A drag let go, kept or not. */
function release(d: Drag) {
  cancelFrame(d.frame)
  if (!d.on) return
  delete document.documentElement.dataset.drag
  if (d.key) window.removeEventListener("keydown", d.key, true)
}

/** Every item back in its place, moving there or not. */
function settle(items: HTMLElement[], moving: boolean) {
  for (const item of items) {
    if (moving) item.removeAttribute("data-held")
    else item.setAttribute("data-held", "")
    item.style.transform = ""
  }
  const done = () => {
    for (const item of items) {
      item.removeAttribute("data-held")
      item.removeAttribute("data-lifted")
    }
  }
  if (moving) window.setTimeout(done, STEP_ASIDE)
  else requestAnimationFrame(done)
}
