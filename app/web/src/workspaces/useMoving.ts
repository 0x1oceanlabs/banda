import { cn } from "@banda/ui/lib/utils"
/**
 * The mouse moves Panes, as niri's (ADR 0025, decision 6): a Pane's header
 * or its tab, dragged, carries it, and so does `Alt` and the left button
 * from anywhere on it. The insert hint shows where it lands, beside
 * another Pane, and letting go moves it there with the same command the
 * keys send. Near the Strip's edge the Strip scrolls under it; over a
 * workspace's number in the bar it lands on that workspace, and held there
 * a moment goes to it. `Esc` puts it back.
 *
 * The Strip and the overview each say where it lands among what they
 * draw, and what scrolls at their edges (`Carrying`); the rest is this.
 */
import { type RefObject, useEffect } from "react"
import type { Place } from "@banda/contract/workspaces"
import type { Plan } from "./arrange"
import { room, scrollOf, stripOf } from "./layout"
import {
  type Lane,
  landingAt,
  nudge,
  pushed,
  type Rect,
  standing,
  swallowClick,
} from "./moving"
import type { Frame } from "./PaneFrame"
import { THRESHOLD } from "./sizing"

/** Where a carried Pane lands, and the hint that shows it; none where
 * it would stay. */
export type Landed = { place?: Place; hint?: Rect }

/** What the moving reads as it goes, as the window draws now. */
export type Carrying = {
  /** It takes the mouse: on screen, not covered, nothing zoomed. */
  on: boolean
  frame: Pick<Frame, "arrange" | "focus">
  /** Goes to workspace `id`, as its number in the bar does. */
  go: (id: string) => void
  /** Where `pane` lands with the pointer at `x`, `y`, over `hit`. */
  land: (hit: Element, x: number, y: number, pane: string) => Landed
  /** Scrolls, a frame's worth, what the pointer at `x`, `y` holds
   * against its edge: whether anything moved. */
  scroll: (x: number, y: number) => boolean
  /** A contrasting ring keeps the hint visible over the overview. */
  ringed?: boolean
}

/** How long, in milliseconds, a Pane held over a workspace's number goes
 * to that workspace. */
const HOLD = 500

/** A column's index past the last: the engine puts it last. */
const LAST = 1_000_000

/** What a press on a handle takes for its own, so it carries nothing. */
const CONTROLS = "input, textarea, select, a, [contenteditable], button"

/** A tab: in a Deck's bar, or in the overview's tile. */
const TAB = "[data-handle] > [data-pane]"

const GHOST_LOOK =
  "pointer-events-none fixed top-0 left-0 z-50 max-w-60 truncate rounded-md border bg-popover px-2.5 py-1.5 text-sm text-popover-foreground shadow-md"
const HINT_LOOK =
  "pointer-events-none fixed top-0 left-0 z-50 hidden rounded-full bg-focus"
/** The hint on the overview's backdrop, where the focus colour may not show. */
const HINT_RING = "ring-1 ring-overview-foreground/70"

/** A press that carries the Pane once it moves `THRESHOLD`. */
type Press = {
  pointer: number
  pane: string
  /** What looks lifted as it goes: its tile, or its tab. */
  lifted: HTMLElement
  x: number
  y: number
}

/** A Pane carried. */
type Carry = Press & {
  ghost: HTMLElement
  hint: HTMLElement
  /** Where it lands, if let go now. */
  place?: Place
  /** The workspace's number under the pointer, and the hold there. */
  drop?: { number: HTMLElement; hold: ReturnType<typeof setTimeout> }
  /** The edge's scroll, as it runs. */
  frame: number
}

export function useMoving(
  root: RefObject<HTMLDivElement | null>,
  carrying: RefObject<Carrying>
) {
  useEffect(() => {
    const element = root.current
    if (!element) return
    const html = document.documentElement
    let press: Press | undefined
    let carry: Carry | undefined

    const onDown = (event: PointerEvent) => {
      if (!carrying.current.on || press) return
      if (event.button !== 0 || event.ctrlKey || event.metaKey) return
      if (event.shiftKey || !(event.target instanceof Element)) return
      const target = event.target
      const at = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      }
      const tab = target.closest<HTMLElement>(TAB)
      const tile = tab ? null : target.closest<HTMLElement>("[data-tile]")
      if (tab?.dataset.pane) {
        press = { ...at, pane: tab.dataset.pane, lifted: tab }
      } else if (!tile?.dataset.tile) {
        return
      } else if (event.altKey) {
        // The Pane's from anywhere on it: nothing in it hears the press.
        event.preventDefault()
        event.stopPropagation()
        element.setPointerCapture(event.pointerId)
        press = { ...at, pane: tile.dataset.tile, lifted: tile }
      } else {
        // By its handle; a click there stays the handle's until it moves.
        const handle = target.closest("[data-handle]")
        if (!handle || !tile.contains(handle) || target.closest(CONTROLS)) {
          return
        }
        press = { ...at, pane: tile.dataset.tile, lifted: tile }
      }
      window.addEventListener("pointermove", onMove, true)
      window.addEventListener("pointerup", onUp, true)
      window.addEventListener("pointercancel", onCancel, true)
    }

    const lift = (from: Press) => {
      if (!element.hasPointerCapture(from.pointer)) {
        element.setPointerCapture(from.pointer)
      }
      getSelection()?.removeAllRanges()
      html.dataset.drag = "move"
      from.lifted.dataset.lifted = ""
      const ghost = document.createElement("div")
      ghost.className = GHOST_LOOK
      ghost.textContent =
        element
          .querySelector(`[data-tile="${from.pane}"]`)
          ?.getAttribute("aria-label") ?? ""
      const hint = document.createElement("div")
      hint.className = cn(HINT_LOOK, carrying.current.ringed && HINT_RING)
      document.body.append(ghost, hint)
      carry = { ...from, ghost, hint, frame: requestAnimationFrame(edge) }
      window.addEventListener("keydown", onKey, true)
    }

    /** Where the Pane lands with the pointer at `x`, `y`, drawn. */
    const aim = (x: number, y: number) => {
      if (!carry) return
      carry.x = x
      carry.y = y
      carry.ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`
      const hit = document.elementFromPoint(x, y)
      const number = hit?.closest<HTMLElement>("[data-workspace]") ?? undefined
      dropOn(number)
      const workspace = number?.dataset.workspace
      const { place, hint }: Landed = workspace
        ? { place: { to: "column", workspace, index: LAST } }
        : hit
          ? carrying.current.land(hit, x, y, carry.pane)
          : {}
      carry.place = place
      carry.hint.classList.toggle("hidden", !hint)
      if (!hint) return
      const { left, top, width, height } = hint
      carry.hint.style.transform = `translate(${left}px, ${top}px)`
      carry.hint.style.width = `${width}px`
      carry.hint.style.height = `${height}px`
    }

    /** Takes workspace number `number` as where the Pane lands; held
     * there, it goes to that workspace. */
    const dropOn = (number: HTMLElement | undefined) => {
      if (!carry || carry.drop?.number === number) return
      if (carry.drop) {
        clearTimeout(carry.drop.hold)
        delete carry.drop.number.dataset.drop
        carry.drop = undefined
      }
      const id = number?.dataset.workspace
      if (!number || !id) return
      number.dataset.drop = ""
      const hold = setTimeout(() => carrying.current.go(id), HOLD)
      carry.drop = { number, hold }
    }

    // Near an edge, what is there scrolls under the Pane: faster the
    // nearer the edge.
    function edge() {
      if (!carry) return
      carry.frame = requestAnimationFrame(edge)
      const { x, y } = carry
      if (!carry.drop && carrying.current.scroll(x, y)) aim(x, y)
    }

    const finish = (keep: boolean) => {
      press = undefined
      window.removeEventListener("pointermove", onMove, true)
      window.removeEventListener("pointerup", onUp, true)
      window.removeEventListener("pointercancel", onCancel, true)
      if (!carry) return
      dropOn(undefined)
      const { pane, ghost, hint, place, frame, lifted } = carry
      carry = undefined
      cancelAnimationFrame(frame)
      ghost.remove()
      hint.remove()
      delete lifted.dataset.lifted
      delete html.dataset.drag
      window.removeEventListener("keydown", onKey, true)
      // The click the release makes is the carry's, not what it ends on.
      swallowClick()
      if (!keep || !place) return
      const plan: Plan = {
        command: { method: "workspaces.move_pane", params: { pane, place } },
        want: pane,
      }
      void carrying.current.frame.arrange(plan)
    }

    const onMove = (event: PointerEvent) => {
      if (press?.pointer !== event.pointerId) return
      const { clientX: x, clientY: y } = event
      if (!carry) {
        if (Math.hypot(x - press.x, y - press.y) < THRESHOLD) return
        // A gap's sizing took the same press first: it is the sizing's.
        if (html.dataset.drag) return finish(false)
        lift(press)
      }
      aim(x, y)
    }
    const onUp = (event: PointerEvent) => {
      if (press?.pointer !== event.pointerId) return
      // `Alt` and a click, moving nothing: the Pane takes the focus, as a
      // click on it would.
      if (!carry && element.hasPointerCapture(event.pointerId)) {
        carrying.current.frame.focus(press.pane)
      }
      finish(true)
    }
    const onCancel = (event: PointerEvent) => {
      if (press?.pointer === event.pointerId) finish(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      finish(false)
    }

    element.addEventListener("pointerdown", onDown, true)
    element.addEventListener("lostpointercapture", onCancel)
    return () => {
      finish(false)
      element.removeEventListener("pointerdown", onDown, true)
      element.removeEventListener("lostpointercapture", onCancel)
    }
  }, [root, carrying])
}

/** A Strip's `land` and `scroll`, for workspace `id`'s: beside its Panes,
 * and its sides scroll it sideways. */
export function inStrip(
  id: string | undefined
): Pick<Carrying, "land" | "scroll"> {
  if (id === undefined) return { land: () => ({}), scroll: () => false }
  return {
    land: (hit, x, y, pane) => {
      const strip = stripOf(id)
      return strip?.contains(hit) ? landIn(strip, id, x, y, pane) : {}
    },
    scroll: (x, y) => {
      const strip = stripOf(id)
      if (!strip) return false
      const { left, top, bottom } = strip.getBoundingClientRect()
      if (y < top || y > bottom) return false
      const { pad, inner } = room(strip)
      const by = pushed(x, left + pad, inner)
      if (by) scrollOf(strip).stop()
      return nudge(strip, "scrollLeft", by)
    },
  }
}

/**
 * Where `pane`, carried to `x`, `y` over `board`, the columns of
 * `workspace` as a Strip or the overview lays them out, lands, and its
 * hint: beside the Pane there, or, on an empty workspace, its first
 * column.
 */
export function landIn(
  board: HTMLElement,
  workspace: string,
  x: number,
  y: number,
  pane: string
): Landed {
  const lanes = lanesOf(board)
  const { pad, gap } = room(board)
  if (lanes.length === 0) {
    const { left, top, bottom } = board.getBoundingClientRect()
    return {
      place: { to: "column", workspace, index: 0 },
      hint: standing(left + pad, top, bottom),
    }
  }
  const landing = landingAt(lanes, x, y, pane, gap)
  if (!landing) return {}
  const { side, hint } = landing
  return { place: { to: "beside", pane: landing.pane, side }, hint }
}

/** The columns as the window draws them, for `landingAt`. */
function lanesOf(strip: HTMLElement): Lane[] {
  const columns = strip.querySelectorAll<HTMLElement>(":scope > [data-column]")
  return [...columns].map((column) => {
    const { left, right, top, bottom } = column.getBoundingClientRect()
    const tiles = [
      ...column.querySelectorAll<HTMLElement>(":scope > [data-tile]"),
    ]
    const tabs = [...column.querySelectorAll<HTMLElement>(TAB)]
    return {
      id: column.dataset.column ?? "",
      left,
      right,
      top,
      bottom,
      panes: tiles.map((tile) => tile.dataset.tile ?? ""),
      ...(tabs.length > 0
        ? { tiles: [], tabs: tabs.map((tab) => tab.getBoundingClientRect()) }
        : { tiles: tiles.map((tile) => tile.getBoundingClientRect()) }),
    }
  })
}
