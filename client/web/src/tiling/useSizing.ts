/**
 * The mouse sizes a Strip's columns and Panes, as niri's (ADR 0025,
 * decision 5): the gap right of a column, dragged, sizes its width, and
 * the gap between two Panes their heights; the mod and the right button
 * size the Pane under the pointer from anywhere, sideways the width, up
 * and down the height. A double click on a gap makes the column the whole
 * screen wide, and back, or the heights even.
 *
 * The drag draws itself as the pointer moves, and letting go sends the
 * same commands as the keys; the engine's event draws them for good.
 */
import { type RefObject, useEffect } from "react"
import type { Columns as Look } from "@banda/contract/look"
import type { Plan } from "./arrange"
import { type ColumnMotion, columnIn, floorIn, heightAt, room } from "./layout"
import { drawn, type Entry, heightsOf, share, type Width } from "./model"
import type { Frame } from "./PaneFrame"
import { aimed } from "./tiles"
import {
  type Box,
  grabAt,
  heightsFor,
  REACH,
  THRESHOLD,
  widthFor,
} from "./sizing"
import { useHoldsMod } from "@banda/ui/hooks/use-key-of"

/** A column as the Strip draws it. */
export type Sized = {
  id: string
  /** Its width as drawn: the whole screen's when it is `full`. */
  width: Width
  full?: true
  min: number
  decked: boolean
  heights: readonly number[]
  entries: readonly Entry[]
  active: number
}

/** What the sizing reads as it starts, as the Strip draws now. */
export type Sizing = {
  /** It takes the mouse: on screen, not zoomed. */
  on: boolean
  columns: readonly Sized[]
  look: Look
  frame: Pick<Frame, "arrange">
}

/** The least a Pane is dragged to, in pixels: its header and a line. */
const LEAST = 48

const CURSOR = { width: "col-resize", height: "row-resize" } as const

/** One part of a drag: a width or the heights of a column. */
type Part = {
  /** Draws the size the pointer at `x`, `y` comes to. */
  draw: (x: number, y: number) => void
  /** The commands that keep it; none when it drew nothing new. */
  plans: () => Plan[]
  /** Draws it as it was. */
  undo: () => void
  /** Once its commands are drawn or refused: draws what the Strip does. */
  settle: () => void
}

/** Where the drag sizes: the cursor it shows wherever the pointer goes. */
type Way = keyof typeof CURSOR | "both"

/** The share a drag comes to: where it started, and as far as the pointer
 * went from `p0`, once it went `THRESHOLD` when it `waits`. */
function pulled(waits: boolean) {
  let started = !waits
  return (from: number, p: number, p0: number, scale: number) => {
    started ||= Math.abs(p - p0) >= THRESHOLD
    return started ? from + (p - p0) / scale : undefined
  }
}

export function useSizing(
  strip: RefObject<HTMLDivElement | null>,
  motion: RefObject<ColumnMotion>,
  sizing: RefObject<Sizing>
) {
  const holdsMod = useHoldsMod()
  useEffect(() => {
    const element = strip.current
    if (!element) return
    const root = document.documentElement
    let drag: { pointer: number; part: Part } | undefined
    // The gap the look draws, read as the pointer comes in.
    let gap = room(element).gap
    let cursor = ""
    /** Heights sent and not drawn yet, by Pane. */
    const sent = new Map<string, Width | undefined>()

    const tilesOf = (column: HTMLElement) => [
      ...column.querySelectorAll<HTMLElement>(":scope > [data-tile]"),
    ]
    /** The gap under the pointer, measured only where one can be: not
     * inside a tile, unless the gap is thinner than the hand. */
    const grab = (event: MouseEvent) => {
      if (tileAt(event.target) !== undefined && gap >= REACH) return undefined
      const boxes: Box[] = sizing.current.columns.flatMap((column) => {
        const at = columnIn(element, column.id)
        if (!at) return []
        const { left, right, top, bottom } = at.getBoundingClientRect()
        const tiles = stacks(column)
          ? tilesOf(at).map((tile) => tile.getBoundingClientRect())
          : []
        return [{ id: column.id, left, right, top, bottom, tiles }]
      })
      const held = grabAt(boxes, event.clientX, event.clientY, gap)
      const column = sizing.current.columns.find((c) => c.id === held?.column)
      return held && column ? { held, column } : undefined
    }

    /** Sizes `column`'s width by how far the pointer goes from `x0`. */
    const widthPart = (column: Sized, x0: number, waits: boolean): Part => {
      const project = room(element)
      const scale = project.inner + project.gap
      const floor = floorIn(project, column.min)
      // As drawn: a width let go of a moment ago may not be the Strip's yet.
      const from = drawn(
        motion.current.shareOf(column.id) ?? share(column.width) ?? 0.5,
        floor
      )
      const { presets, snap } = sizing.current.look
      const pull = pulled(waits)
      let width: Width | undefined
      return {
        draw: (x) => {
          const wanted = pull(from, x, x0, scale)
          if (wanted === undefined) return
          const first = width === undefined
          width = widthFor(wanted, { steps: presets, snap, scale }, floor)
          motion.current.hand(column.id, share(width) ?? from)
          // The Tiles it may bring in show from its first step.
          if (first) aimed(element)
        },
        plans: () =>
          width === undefined ||
          (!column.full && Math.abs((share(width) ?? 0) - from) < 1e-9)
            ? []
            : [
                {
                  command: {
                    method: "workspaces.size",
                    params: { column: column.id, width },
                  },
                },
              ],
        undo: () => motion.current.hand(column.id, from),
        settle: () => {
          motion.current.letGo()
          aimed(element)
        },
      }
    }

    /** Sizes Pane `pane` of `column` by how far the pointer goes from
     * `y0`. */
    const heightPart = (
      column: Sized,
      pane: number,
      y0: number,
      waits: boolean
    ): Part => {
      const tiles = tilesOf(columnIn(element, column.id)!)
      const scale = tiles[0].parentElement!.clientHeight + gap
      // As drawn: heights let go of a moment ago may not be the Strip's yet.
      const own = column.entries.map((entry) =>
        sent.has(entry.id) ? sent.get(entry.id) : entry.height
      )
      const entriesWith = (heights: readonly (Width | undefined)[]) =>
        column.entries.map((entry, i) => ({ ...entry, height: heights[i] }))
      const stack = {
        heights: heightsOf({
          id: column.id,
          entries: entriesWith(own),
          active: 0,
        }),
        own,
      }
      const { heights: steps, snap } = sizing.current.look
      const show = (heights: readonly number[]) =>
        tiles.forEach((tile, i) => {
          tile.style.flex = heightAt(heights[i])
        })
      const pull = pulled(waits)
      let after: (Width | undefined)[] | undefined
      return {
        draw: (_, y) => {
          const wanted = pull(stack.heights[pane], y, y0, scale)
          if (wanted === undefined) return
          after = heightsFor(
            stack,
            pane,
            wanted,
            { steps, snap, scale },
            (LEAST + gap) / scale
          )
          show(
            heightsOf({ id: column.id, entries: entriesWith(after), active: 0 })
          )
        },
        plans: () =>
          (after ?? []).flatMap((height, i) => {
            const entry = column.entries[i]
            if (height === own[i]) return []
            sent.set(entry.id, height)
            return [
              {
                command: {
                  method: "workspaces.height",
                  params: {
                    pane: entry.id,
                    ...(height !== undefined && { height }),
                  },
                },
              } satisfies Plan,
            ]
          }),
        undo: () => show(stack.heights),
        // React writes a tile's height only when it changes: the Strip's
        // own, drawn again, whatever the engine said.
        settle: () => {
          for (const entry of column.entries) sent.delete(entry.id)
          const now = sizing.current.columns.find((c) => c.id === column.id)
          if (now?.heights.length === tiles.length) show(now.heights)
        },
      }
    }

    const start = (event: PointerEvent, part: Part, way: Way) => {
      event.preventDefault()
      event.stopPropagation()
      element.setPointerCapture(event.pointerId)
      root.dataset.drag = way
      drag = { pointer: event.pointerId, part }
      window.addEventListener("keydown", onKey, true)
    }

    const finish = (keep: boolean) => {
      if (!drag) return
      const { part } = drag
      drag = undefined
      delete root.dataset.drag
      window.removeEventListener("keydown", onKey, true)
      const plans = keep ? part.plans() : []
      if (!plans.length) part.undo()
      const { arrange } = sizing.current.frame
      void Promise.all(plans.map(arrange)).then(part.settle)
    }

    const onEnter = () => {
      gap = room(element).gap
    }

    const onDown = (event: PointerEvent) => {
      const { on, columns } = sizing.current
      if (!on || drag) return
      const { clientX: x, clientY: y } = event
      const plain =
        !event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey
      if (event.button === 0 && plain) {
        const at = grab(event)
        if (!at) return
        const { held, column } = at
        if (held.kind === "width") {
          start(event, widthPart(column, x, false), "width")
        } else {
          start(event, heightPart(column, held.pane, y, false), "height")
        }
        return
      }
      // The mod and the right button; one key more is the program's.
      if (event.button !== 2 || !holdsMod(event)) return
      const tile = tileAt(event.target)
      const column = columns.find((c) =>
        c.entries.some((entry) => entry.id === tile)
      )
      if (!tile || !column) return
      const pane = column.entries.findIndex((entry) => entry.id === tile)
      const parts = [widthPart(column, x, true)]
      if (stacks(column)) parts.push(heightPart(column, pane, y, true))
      start(
        event,
        {
          draw: (x, y) => parts.forEach((part) => part.draw(x, y)),
          // The Pane sized takes the focus once it is drawn.
          plans: () =>
            parts
              .flatMap((part) => part.plans())
              .map((plan, i, all) =>
                i === all.length - 1 ? { ...plan, want: tile } : plan
              ),
          undo: () => parts.forEach((part) => part.undo()),
          settle: () => parts.forEach((part) => part.settle()),
        },
        parts.length > 1 ? "both" : "width"
      )
    }

    const onMove = (event: PointerEvent) => {
      if (drag) {
        if (drag.pointer === event.pointerId) {
          drag.part.draw(event.clientX, event.clientY)
        }
        return
      }
      // The cursor says a gap can be dragged.
      const at = sizing.current.on ? grab(event) : undefined
      const next = at ? CURSOR[at.held.kind] : ""
      if (next !== cursor) element.style.cursor = cursor = next
    }

    const onUp = (event: PointerEvent) => {
      if (drag?.pointer === event.pointerId) finish(true)
    }
    const onLost = (event: PointerEvent) => {
      if (drag?.pointer === event.pointerId) finish(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      finish(false)
    }

    const onDouble = (event: MouseEvent) => {
      const { on, frame } = sizing.current
      if (!on || event.button !== 0) return
      const at = grab(event)
      if (!at) return
      const { held, column } = at
      event.preventDefault()
      event.stopPropagation()
      void frame.arrange(
        held.kind === "width"
          ? {
              command: {
                method: "workspaces.maximize",
                params: { column: column.id, full: !column.full },
              },
              // The column filled takes the focus, so it stays in view.
              want: column.entries[column.active]?.id,
            }
          : {
              command: {
                method: "workspaces.even",
                params: { column: column.id },
              },
            }
      )
    }

    // The mod and the right button size; no menu comes up under them.
    const onMenu = (event: MouseEvent) => {
      if (!holdsMod(event) || !sizing.current.on) return
      if (tileAt(event.target) === undefined) return
      event.preventDefault()
      event.stopPropagation()
    }

    element.addEventListener("pointerenter", onEnter)
    element.addEventListener("pointerdown", onDown, true)
    element.addEventListener("pointermove", onMove)
    element.addEventListener("pointerup", onUp)
    element.addEventListener("lostpointercapture", onLost)
    element.addEventListener("dblclick", onDouble, true)
    element.addEventListener("contextmenu", onMenu, true)
    return () => {
      finish(false)
      element.removeEventListener("pointerenter", onEnter)
      element.removeEventListener("pointerdown", onDown, true)
      element.removeEventListener("pointermove", onMove)
      element.removeEventListener("pointerup", onUp)
      element.removeEventListener("lostpointercapture", onLost)
      element.removeEventListener("dblclick", onDouble, true)
      element.removeEventListener("contextmenu", onMenu, true)
    }
  }, [strip, motion, sizing, holdsMod])
}

/** Whether `column` shows its Panes one above another, two or more. */
function stacks(column: Sized): boolean {
  return !column.decked && column.entries.length > 1
}

/** The ID of the tile `target` is in, if it is in one. */
function tileAt(target: EventTarget | null): string | undefined {
  return target instanceof Element
    ? target.closest<HTMLElement>("[data-tile]")?.dataset.tile
    : undefined
}
