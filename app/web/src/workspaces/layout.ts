/**
 * Where a Strip's columns go, and how they get there (ADR 0007, decision
 * 9): a column that changes its width grows or shrinks on the look's
 * `resize`, and the columns a change puts elsewhere go there on its
 * `move`, as niri's do, instead of jumping.
 */
import { moveOf } from "../look"
import { Moving } from "../motion"
import { share, type Width } from "./model"

/** A column's place once every move is done, in the Strip's scroll. */
export interface Place {
  id: string
  left: number
  right: number
}

/** The Strip's room, as CSS has it. */
function room(strip: HTMLElement) {
  const style = getComputedStyle(strip)
  const pad = parseFloat(style.paddingLeft) || 0
  const gap = parseFloat(style.columnGap) || 0
  const inner = strip.clientWidth - pad - (parseFloat(style.paddingRight) || 0)
  return { pad, gap, inner }
}

/**
 * Where the columns end up, from their widths, as CSS lays them out: so a
 * scroll aims at where a column will be, not where a move has it now.
 */
export function places(
  strip: HTMLElement,
  columns: readonly { id: string; width: Width }[]
): Place[] {
  const { pad, gap, inner } = room(strip)
  let left = pad
  return columns.map((column) => {
    const width = (share(column.width) ?? 0.5) * (inner + gap) - gap
    const place = { id: column.id, left, right: left + width }
    left += width + gap
    return place
  })
}

/** A column's width at `at`, a share of the room, as the Strip draws it. */
export function widthAt(at: number): string {
  return `calc(${at} * (100% + var(--gap-inner)) - var(--gap-inner))`
}

type Moved = {
  element: HTMLElement
  /** Its share of the room, as drawn now. */
  size: Moving
  /** How far it is drawn from its place, sideways, in pixels. */
  slide: Moving
  /** Its place and size in the layout, as last seen. */
  left: number
  width: number
}

type Tile = {
  element: HTMLElement
  column: string
  top: number
  height: number
}

type Columns = readonly {
  id: string
  width: Width
  entries: readonly { id: string }[]
}[]

/**
 * The columns and tiles of one Strip as they move: they grow, shrink and
 * go to new places, a tile that comes fades in, and one that goes fades
 * out where it was while the rest close in.
 */
export class ColumnMotion {
  #columns = new Map<string, Moved>()
  #tiles = new Map<string, Tile>()
  #started = false
  #strip: HTMLElement | null = null

  /**
   * After each drawing: a column whose width changed grows to it from the
   * width it had; one the layout put elsewhere is drawn where it was, and
   * goes to its place; a tile not seen before comes in, and one gone goes.
   * What is there the first time is simply there.
   */
  sync(strip: HTMLElement | null, columns: Columns) {
    const first = !this.#started
    this.#started = true
    // An emptied workspace drew no Strip: what was in the last one is gone.
    if (strip !== this.#strip) {
      this.stop()
      this.#columns.clear()
      this.#tiles.clear()
      this.#strip = strip
    }
    if (!strip) return
    const seen = new Set<string>()
    for (const column of columns) {
      const element = strip.querySelector<HTMLElement>(
        `:scope > [data-column="${column.id}"]`
      )
      if (!element) continue
      seen.add(column.id)
      const target = share(column.width) ?? 0.5
      const known = this.#columns.get(column.id)
      if (!known) {
        this.#columns.set(column.id, this.#start(element, target))
        continue
      }
      known.element = element
      if (Math.abs(known.size.target - target) > 1e-9) {
        known.size.to(target, moveOf("resize"))
      }
    }
    const tiles = new Map<string, Tile>()
    for (const column of columns) {
      for (const entry of column.entries) {
        const element = strip.querySelector<HTMLElement>(
          `[data-tile="${entry.id}"]`
        )
        if (!element) continue
        tiles.set(entry.id, { element, column: column.id, top: 0, height: 0 })
        if (!first && !this.#tiles.has(entry.id)) come(element)
      }
    }
    for (const [id, tile] of this.#tiles) {
      if (tiles.has(id)) continue
      // A tile of a column that went goes with its column.
      const column = this.#columns.get(tile.column)
      if (seen.has(tile.column) && column) {
        go(tile.element, column.element, {
          top: tile.top,
          height: tile.height,
          left: 0,
          width: column.width,
        })
      }
    }
    for (const [id, moved] of this.#columns) {
      if (seen.has(id)) continue
      moved.size.stop()
      moved.slide.stop()
      this.#columns.delete(id)
      const pad = parseFloat(getComputedStyle(strip).paddingTop) || 0
      go(moved.element, strip, {
        top: pad,
        height: strip.clientHeight - 2 * pad,
        left: moved.left + moved.slide.value,
        width: moved.width,
      })
    }
    // The widths are as drawn now: what moved the rest is a column that
    // opened, closed or changed its place.
    for (const moved of this.#columns.values()) {
      const left = moved.element.offsetLeft
      const by = left - moved.left
      moved.left = left
      moved.width = moved.element.offsetWidth
      if (Math.abs(by) < 0.5) continue
      moved.slide.to(0, moveOf("move"), moved.slide.value - by)
    }
    for (const tile of tiles.values()) {
      tile.top = tile.element.offsetTop
      tile.height = tile.element.offsetHeight
    }
    this.#tiles = tiles
  }

  stop() {
    for (const moved of this.#columns.values()) {
      moved.size.stop()
      moved.slide.stop()
    }
  }

  #start(element: HTMLElement, at: number): Moved {
    let width = at
    let offset = 0
    const moved: Moved = {
      element,
      size: new Moving(
        (next) => {
          width = next
          moved.element.style.width = widthAt(next)
          // Its neighbours moved with it: that is where they are now.
          for (const other of this.#columns.values()) {
            other.left = other.element.offsetLeft
            other.width = other.element.offsetWidth
          }
        },
        () => width
      ),
      slide: new Moving(
        (next) => {
          offset = next
          moved.element.style.translate = next === 0 ? "" : `${next}px 0`
        },
        () => offset
      ),
      left: element.offsetLeft,
      width: element.offsetWidth,
    }
    return moved
  }
}

/** How small a tile is as it comes and goes: niri's is a little smaller. */
const SMALL = 0.94

/** Shows a tile coming in: from nothing, a little smaller, to itself. */
function come(element: HTMLElement) {
  let shown = 0
  new Moving(
    (at) => {
      shown = at
      const done = at >= 1
      element.style.opacity = done ? "" : String(at)
      element.style.scale = done ? "" : String(SMALL + (1 - SMALL) * at)
    },
    () => shown
  ).to(1, moveOf("open"), 0)
}

/**
 * Shows a tile or a column going, after the window let it go: the element
 * it was is put back where it was, over its old place, out of reach, and
 * fades out a little smaller. Whatever it held is gone already; this is
 * how it looked.
 */
function go(
  element: HTMLElement,
  into: HTMLElement,
  where: { top: number; height: number; left: number; width: number }
) {
  const move = moveOf("close")
  if (move.kind === "off") return
  element.inert = true
  element.setAttribute("aria-hidden", "true")
  element.removeAttribute("data-column")
  element.removeAttribute("data-tile")
  Object.assign(element.style, {
    position: "absolute",
    top: `${where.top}px`,
    left: `${where.left}px`,
    width: `${where.width}px`,
    height: `${where.height}px`,
    translate: "",
    pointerEvents: "none",
    zIndex: "1",
  })
  into.append(element)
  let shown = 1
  new Moving(
    (at) => {
      shown = at
      element.style.opacity = String(at)
      element.style.scale = String(SMALL + (1 - SMALL) * at)
      if (at <= 0) element.remove()
    },
    () => shown
  ).to(0, move, 1)
}
