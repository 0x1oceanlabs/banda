/**
 * Moving a widget on the bar with the mod held (ADR 0064): what the Bar
 * draws in each part while one is carried, and the `[bar]` it writes once
 * it is let go.
 */
import { type RefObject, useEffect, useLayoutEffect, useState } from "react"
import { useHoldsMod } from "@banda/ui/hooks/use-key-of"
import { type Layout, moved, same } from "./arrange"
import { PARTS, type Part } from "./placed"
import type { Drawn } from "./Widgets"

/** Each part's ids, as drawn. */
export function layoutOf(
  widgets: Partial<Record<Part, readonly Drawn[]>>
): Layout {
  const ids = (part: Part) => (widgets[part] ?? []).map((one) => one.id)
  return { left: ids("left"), center: ids("center"), right: ids("right") }
}

/** A widget picked up with the mod: where it would go, and where the pointer
 * holds it. */
type Drag = {
  id: string
  part: Part
  index: number
  /** Released here, it goes back. */
  away: boolean
  /** Where the pointer took it, from its corner. */
  grab: { x: number; y: number }
  at: { x: number; y: number }
}

/**
 * Moving a widget with the mod (ADR 0064): a press with the mod picks it up, it
 * follows the pointer while the others make room, and a release writes
 * where it stands; `Escape`, or a release away from the bar, puts it back.
 * What it wrote stands until the look reads it back.
 */
export function useArranging(
  header: RefObject<HTMLElement | null>,
  shown: Layout,
  write: (after: Layout) => void
) {
  const holdsMod = useHoldsMod()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [pending, setPending] = useState<Layout | null>(null)
  const base = pending && !same(pending, shown) ? pending : shown
  // What it wrote stands a while, until the look reads the file back.
  useEffect(() => {
    if (!pending) return
    const late = setTimeout(() => setPending(null), 3000)
    return () => clearTimeout(late)
  }, [pending])
  const layout = drag ? moved(base, drag.id, drag.part, drag.index) : base
  // The widget held follows the pointer from the place it would take.
  useLayoutEffect(() => {
    const bar = header.current
    if (!bar || !drag) return
    const held = bar.querySelector<HTMLElement>(
      `[data-widget="${CSS.escape(drag.id)}"]`
    )
    if (!held) return
    held.style.transform = ""
    const place = held.getBoundingClientRect()
    const x = drag.at.x - drag.grab.x - place.left
    const y = drag.at.y - drag.grab.y - place.top
    held.style.transform = `translate(${x}px, ${y}px)`
    return () => {
      held.style.transform = ""
    }
  })
  useEffect(() => {
    const bar = header.current
    if (!bar) return
    const target = (id: string, x: number, y: number) => {
      const box = bar.getBoundingClientRect()
      const share = (x - box.left) / box.width
      const part: Part =
        share < 1 / 3 ? "left" : share > 2 / 3 ? "right" : "center"
      const others = base[part].filter((one) => one !== id)
      let index = others.length
      for (const [i, other] of others.entries()) {
        const at = bar
          .querySelector(`[data-widget="${CSS.escape(other)}"]`)
          ?.getBoundingClientRect()
        if (!at || at.width === 0) continue
        if (x < at.left + at.width / 2) {
          index = i
          break
        }
      }
      return { part, index, away: y > box.bottom + 48 }
    }
    const down = (event: PointerEvent) => {
      if (!holdsMod(event) || event.button !== 0) return
      const held = (event.target as Element).closest<HTMLElement>(
        "[data-widget]"
      )
      const id = held?.dataset.widget
      const part = id && PARTS.find((one) => base[one].includes(id))
      if (!held || !id || !part) return
      event.preventDefault()
      event.stopPropagation()
      bar.setPointerCapture(event.pointerId)
      const box = held.getBoundingClientRect()
      setDrag({
        id,
        part,
        index: base[part].indexOf(id),
        away: false,
        grab: { x: event.clientX - box.left, y: event.clientY - box.top },
        at: { x: event.clientX, y: event.clientY },
      })
    }
    const move = (event: PointerEvent) => {
      if (!drag) return
      const at = { x: event.clientX, y: event.clientY }
      setDrag({ ...drag, ...target(drag.id, at.x, at.y), at })
    }
    const up = (event: PointerEvent) => {
      if (!drag) return
      setDrag(null)
      // Where the pointer lets go: on a busy page the release can come
      // with the last moves, before any of them is drawn, and `drag` is
      // then a step behind it.
      const { part, index, away } = target(
        drag.id,
        event.clientX,
        event.clientY
      )
      const after = moved(base, drag.id, part, index)
      if (away || same(after, base)) return
      setPending(after)
      write(after)
    }
    const cancel = () => setDrag(null)
    // With the mod, a widget is held, not clicked.
    const click = (event: MouseEvent) => {
      if (!holdsMod(event)) return
      if (!(event.target as Element).closest("[data-widget]")) return
      event.preventDefault()
      event.stopPropagation()
    }
    const key = (event: KeyboardEvent) => {
      if (!drag || event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      setDrag(null)
    }
    bar.addEventListener("pointerdown", down, { capture: true })
    bar.addEventListener("pointermove", move)
    bar.addEventListener("pointerup", up)
    bar.addEventListener("pointercancel", cancel)
    bar.addEventListener("click", click, { capture: true })
    window.addEventListener("keydown", key, { capture: true })
    return () => {
      bar.removeEventListener("pointerdown", down, { capture: true })
      bar.removeEventListener("pointermove", move)
      bar.removeEventListener("pointerup", up)
      bar.removeEventListener("pointercancel", cancel)
      bar.removeEventListener("click", click, { capture: true })
      window.removeEventListener("keydown", key, { capture: true })
    }
  }, [header, base, drag, write, holdsMod])
  return {
    layout,
    dragging: drag?.id,
    over: drag && !drag.away ? drag.part : undefined,
  }
}
