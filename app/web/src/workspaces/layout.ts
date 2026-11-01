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
  /** Its place in the layout, as last seen. */
  left: number
}

/** The columns of one Strip as they move. */
export class ColumnMotion {
  #columns = new Map<string, Moved>()

  /**
   * After each drawing: a column whose width changed grows to it from the
   * width it had; one the layout put elsewhere is drawn where it was, and
   * goes to its place.
   */
  sync(strip: HTMLElement, columns: readonly { id: string; width: Width }[]) {
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
    for (const id of this.#columns.keys()) {
      if (!seen.has(id)) {
        this.#columns.get(id)?.size.stop()
        this.#columns.get(id)?.slide.stop()
        this.#columns.delete(id)
      }
    }
    // The widths are as drawn now: what moved the rest is a column that
    // opened, closed or changed its place.
    for (const moved of this.#columns.values()) {
      const left = moved.element.offsetLeft
      const by = left - moved.left
      moved.left = left
      if (Math.abs(by) < 0.5) continue
      moved.slide.to(0, moveOf("move"), moved.slide.value - by)
    }
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
    }
    return moved
  }
}
