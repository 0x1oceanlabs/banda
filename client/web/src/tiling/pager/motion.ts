/**
 * The Pager's cells as they move (ADR 0024), on the look's `workspace`
 * move, with the screen: one that comes in widens from nothing, one that
 * goes narrows to nothing where it was, and the mark of the one on screen
 * goes to it. Widths are in rem, so they grow with `[font] size`.
 */
import { moveOf } from "../../look"
import { Moving } from "../../motion"

/** A workspace's place in the Pager, and how wide it is drawn, in rem. */
type Cell = { id: string; width: number }

/** A Moving that writes `write` and remembers where it is. */
function moving(at: number, write: (value: number) => void): Moving {
  let value = at
  return new Moving(
    (next) => {
      value = next
      write(next)
    },
    () => value
  )
}

type Moved = { element: HTMLElement; size: Moving; gone?: true }

export class PagerMotion {
  #cells = new Map<string, Moved>()
  #mark: Moving | undefined

  /**
   * After each drawing of `nav`, whose children are the cells by their
   * `data-workspace`: each goes to its width from the one it had, and
   * `mark` to `left`.
   */
  sync(
    nav: HTMLElement | null,
    cells: readonly Cell[],
    mark: HTMLElement | null,
    left: number
  ) {
    if (!nav || !mark) return
    const first = this.#cells.size === 0
    const move = moveOf("workspace")
    const ids = new Set(cells.map((cell) => cell.id))
    const was = [...this.#cells.keys()]
    // One that went is put back where it was, out of reach, and narrows.
    was.forEach((id, i) => {
      if (ids.has(id)) return
      const moved = this.#cells.get(id)!
      const next = was.slice(i + 1).find((other) => ids.has(other))
      const { element } = moved
      element.inert = true
      element.setAttribute("aria-hidden", "true")
      element.removeAttribute("data-workspace")
      nav.insertBefore(
        element,
        next ? nav.querySelector(`[data-workspace="${next}"]`) : null
      )
      moved.gone = true
      moved.size.to(0, move)
    })
    const now = new Map<string, Moved>()
    for (const cell of cells) {
      const known = this.#cells.get(cell.id)
      if (known) {
        if (known.size.target !== cell.width) known.size.to(cell.width, move)
        now.set(cell.id, known)
        continue
      }
      const element = nav.querySelector<HTMLElement>(
        `:scope > [data-workspace="${cell.id}"]`
      )
      if (!element) continue
      const moved: Moved = {
        element,
        size: moving(0, (width) => {
          element.style.width = `${width}rem`
          if (width === 0 && moved.gone) element.remove()
        }),
      }
      moved.size.to(cell.width, first ? { kind: "off" } : move)
      now.set(cell.id, moved)
    }
    this.#cells = now
    if (!this.#mark) {
      this.#mark = moving(left, (x) => {
        mark.style.translate = `${x}rem 0`
      })
      this.#mark.to(left, { kind: "off" })
    } else if (this.#mark.target !== left) {
      this.#mark.to(left, move)
    }
  }

  stop() {
    for (const { size } of this.#cells.values()) size.stop()
    this.#mark?.stop()
  }
}
