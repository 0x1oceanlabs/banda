import { cn } from "@banda/ui/lib/utils"
/**
 * The mouse moves Panes, as niri's (ADR 0025, decision 6): a Pane's header
 * or its tab, dragged, carries it, and so do the mod and the left button
 * from anywhere on it. The insert hint shows where it lands, beside
 * another Pane, and letting go moves it there with the same command the
 * keys send. Near the Strip's edge the Strip scrolls under it; over a
 * workspace's number in the bar it lands on that workspace, and held there
 * a moment goes to it. `Esc` puts it back.
 *
 * A grouped Pane goes alone, and its whole Group with the mod held, as
 * its Group's handle carries it (ADR 0065, decisions 3 and 5): the mod
 * pressed or let go on the way switches between the two, and a note
 * under the Pane's name says which.
 *
 * The Strip and the overview each say where it lands among what they
 * draw, and what scrolls at their edges (`Carrying`); the rest is this.
 */
import { type RefObject, useEffect, useRef } from "react"
import type { Place } from "@banda/contract/workspaces"
import type { Plan } from "./arrange"
import { room, scrollOf, stripOf } from "./layout"
import {
  carriesGroup,
  groupLandingAt,
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
import { useHoldsMod, useMod } from "@banda/ui/hooks/use-key-of"
import { modLabel } from "@banda/ui/lib/keys"

/** Where a carried Pane lands, and the hint that shows it; none where
 * it would stay. At a Group's end, inside the Group or out of it. */
export type Landed = { place?: Place; hint?: Rect; grouped?: boolean }

/** What the moving reads as it goes, as the window draws now. */
export type Carrying = {
  /** It takes the mouse: on screen, not covered, nothing zoomed. */
  on: boolean
  frame: Pick<Frame, "arrange" | "focus">
  /** Goes to workspace `id`, as its number in the bar does. */
  go: (id: string) => void
  /** Where `pane` lands with the pointer at `x`, `y`, over `hit`; or,
   * carried whole, the whole of `group`. */
  land: (
    hit: Element,
    x: number,
    y: number,
    pane: string,
    group?: string
  ) => Landed
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

/** A Group's handle, which carries the whole Group (ADR 0065). */
const GROUP_HANDLE = "[data-group-handle]"

const GHOST_LOOK =
  "pointer-events-none fixed top-0 left-0 z-50 flex max-w-60 flex-col rounded-md border bg-popover px-2.5 py-1.5 text-sm text-popover-foreground shadow-md"
/** The note under the ghost's name: whether the Group goes too. */
const NOTE_LOOK = "truncate text-xs text-muted-foreground empty:hidden"
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
  /** The Group it is in: its ID, and one of its columns, which names it
   * to the engine. */
  group?: { id: string; column: string }
  /** Carried by its Group's handle, which always takes the whole Group. */
  byHandle?: boolean
}

/** A Pane carried. */
type Carry = Press & {
  ghost: HTMLElement
  /** Under the ghost's name: whether the Group goes too. */
  note: HTMLElement
  hint: HTMLElement
  /** The whole Group goes, and what looks lifted for it now; unset
   * until the first move says. */
  whole?: boolean
  looks: HTMLElement[]
  /** Where it lands, if let go now. */
  place?: Place
  grouped?: boolean
  /** The workspace's number under the pointer, and the hold there. */
  drop?: { number: HTMLElement; hold: ReturnType<typeof setTimeout> }
  /** The edge's scroll, as it runs. */
  frame: number
}

export function useMoving(
  root: RefObject<HTMLDivElement | null>,
  carrying: RefObject<Carrying>
) {
  const holdsMod = useHoldsMod()
  // The mod the note names, read as the keys change.
  const mod = useMod()
  const named = useRef(mod)
  useEffect(() => {
    named.current = mod
  }, [mod])
  useEffect(() => {
    const element = root.current
    if (!element) return
    const html = document.documentElement
    let press: Press | undefined
    let carry: Carry | undefined

    const onDown = (event: PointerEvent) => {
      if (!carrying.current.on || press) return
      // The mod and the left button carry a Pane; a tab is carried with
      // no Ctrl or Super, which are the Pane's.
      const held = holdsMod(event)
      if (event.button !== 0 || (!held && (event.ctrlKey || event.metaKey)))
        return
      if (event.shiftKey || !(event.target instanceof Element)) return
      const target = event.target
      const at = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      }
      const tab = target.closest<HTMLElement>(TAB)
      const tile = tab ? null : target.closest<HTMLElement>("[data-tile]")
      const handle = target.closest<HTMLElement>(GROUP_HANDLE)
      // A Pane's, with the Group it is in, if any.
      const byPane = (pane: string, lifted: HTMLElement): Press => ({
        ...at,
        pane,
        lifted,
        group: groupOf(lifted),
      })
      const group = handle && groupOf(handle)
      if (handle?.dataset.pane && group) {
        // The Group, by a Pane of it, which the press's path names.
        event.preventDefault()
        press = {
          ...at,
          pane: handle.dataset.pane,
          lifted: handle,
          group,
          byHandle: true,
        }
      } else if (tab?.dataset.pane) {
        press = byPane(tab.dataset.pane, tab)
      } else if (!tile?.dataset.tile) {
        return
      } else if (held) {
        // The Pane's from anywhere on it: nothing in it hears the press.
        event.preventDefault()
        event.stopPropagation()
        element.setPointerCapture(event.pointerId)
        press = byPane(tile.dataset.tile, tile)
      } else {
        // By its handle; a click there stays the handle's until it moves.
        const handle = target.closest("[data-handle]")
        if (!handle || !tile.contains(handle) || target.closest(CONTROLS)) {
          return
        }
        press = byPane(tile.dataset.tile, tile)
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
      const name = document.createElement("span")
      name.className = "truncate"
      name.textContent = from.byHandle
        ? (from.lifted.getAttribute("aria-label") ?? "")
        : (element
            .querySelector(`[data-tile="${from.pane}"]`)
            ?.getAttribute("aria-label") ?? "")
      const note = document.createElement("span")
      note.className = NOTE_LOOK
      ghost.append(name, note)
      const hint = document.createElement("div")
      hint.className = cn(HINT_LOOK, carrying.current.ringed && HINT_RING)
      document.body.append(ghost, hint)
      carry = {
        ...from,
        ghost,
        note,
        hint,
        looks: [from.lifted],
        frame: requestAnimationFrame(edge),
      }
      window.addEventListener("keydown", onKey, true)
      window.addEventListener("keyup", onKey, true)
    }

    /** Whether the whole Group goes, the mod `held` or not: the note says
     * so, and the Group's columns look lifted, or the Pane alone does.
     * Whether that changed. */
    const takeGroup = (held: boolean) => {
      if (!carry) return false
      const { group, byHandle, lifted } = carry
      const mod = modLabel(named.current)
      const { whole, note } = carriesGroup(
        { grouped: !!group, byHandle },
        held,
        mod
      )
      if (whole === carry.whole) return false
      carry.whole = whole
      carry.note.textContent = note ?? ""
      for (const one of carry.looks) delete one.dataset.lifted
      // The handle stays shown, lifted with its Group.
      carry.looks =
        whole && group
          ? [...columnsOf(lifted, group.id), ...(byHandle ? [lifted] : [])]
          : [lifted]
      for (const one of carry.looks) one.dataset.lifted = ""
      return true
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
      const { place, hint, grouped }: Landed = workspace
        ? { place: { to: "column", workspace, index: LAST } }
        : hit
          ? carrying.current.land(
              hit,
              x,
              y,
              carry.pane,
              carry.whole ? carry.group?.id : undefined
            )
          : {}
      carry.place = place
      carry.grouped = grouped
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
      const { pane, ghost, hint, place, grouped, frame, looks, group, whole } =
        carry
      carry = undefined
      cancelAnimationFrame(frame)
      ghost.remove()
      hint.remove()
      for (const one of looks) delete one.dataset.lifted
      delete html.dataset.drag
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("keyup", onKey, true)
      // The click the release makes is the carry's, not what it ends on.
      swallowClick()
      if (!keep || !place) return
      // The whole Group, to a column's place.
      const command: Plan["command"] =
        group && whole && place.to === "column"
          ? {
              method: "workspaces.move_group",
              params: {
                column: group.column,
                workspace: place.workspace,
                index: place.index,
              },
            }
          : {
              method: "workspaces.move_pane",
              params: {
                pane,
                place,
                ...(grouped !== undefined && { grouped }),
              },
            }
      const plan: Plan = { command, want: pane }
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
      takeGroup(holdsMod(event))
      aim(x, y)
    }
    const onUp = (event: PointerEvent) => {
      if (press?.pointer !== event.pointerId) return
      // The mod and a click, moving nothing: the Pane takes the focus, as a
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
      // The mod pressed or let go: the Group goes too, or no longer.
      if (carry && takeGroup(holdsMod(event))) aim(carry.x, carry.y)
      if (event.type !== "keydown" || event.key !== "Escape") return
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
  }, [root, carrying, holdsMod])
}

/** The Group a column of which holds `element`: its ID, and that
 * column's, which names it to the engine. */
function groupOf(element: Element): Press["group"] {
  const column = element.closest<HTMLElement>("[data-column]")
  const id = column?.dataset.group
  return id && column.dataset.column
    ? { id, column: column.dataset.column }
    : undefined
}

/** The columns of Group `group` beside the one that holds `element`. */
function columnsOf(element: Element, group: string): HTMLElement[] {
  const board = element.closest("[data-column]")?.parentElement
  return board
    ? [
        ...board.querySelectorAll<HTMLElement>(
          `:scope > [data-column][data-group="${CSS.escape(group)}"]`
        ),
      ]
    : []
}

/** A Strip's `land` and `scroll`, for workspace `id`'s: beside its Panes,
 * and its sides scroll it sideways. */
export function inStrip(
  id: string | undefined
): Pick<Carrying, "land" | "scroll"> {
  if (id === undefined) return { land: () => ({}), scroll: () => false }
  return {
    land: (hit, x, y, pane, group) => {
      const strip = stripOf(id)
      return strip?.contains(hit) ? landIn(strip, id, x, y, pane, group) : {}
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
 * column. Carried by its handle, the whole of `group` lands between two
 * columns.
 */
export function landIn(
  board: HTMLElement,
  workspace: string,
  x: number,
  y: number,
  pane: string,
  group?: string
): Landed {
  const lanes = lanesOf(board)
  const { pad, gap } = room(board)
  if (group !== undefined && lanes.length > 0) {
    const landing = groupLandingAt(lanes, x, group, gap)
    if (!landing) return {}
    const { index, hint } = landing
    return { place: { to: "column", workspace, index }, hint }
  }
  if (lanes.length === 0) {
    const { left, top, bottom } = board.getBoundingClientRect()
    return {
      place: { to: "column", workspace, index: 0 },
      hint: standing(left + pad, top, bottom),
    }
  }
  const landing = landingAt(lanes, x, y, pane, gap)
  if (!landing) return {}
  const { side, hint, grouped } = landing
  return { place: { to: "beside", pane: landing.pane, side }, hint, grouped }
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
      ...(column.dataset.group && { group: column.dataset.group }),
      ...(tabs.length > 0
        ? { tiles: [], tabs: tabs.map((tab) => tab.getBoundingClientRect()) }
        : { tiles: tiles.map((tile) => tile.getBoundingClientRect()) }),
    }
  })
}
