import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useState,
} from "react"
import { remInPx } from "../workspaces/layout"
import { dragged, HIDES, MIN, WIDTH, widest } from "./width"

/**
 * The sidebar's right edge, which the mouse drags to size it. A line
 * shows on it under the pointer, and the width beside it while it is
 * dragged; the Strip follows at once. A double-click puts 16rem back.
 * Dragged past the narrowest, letting go hides the sidebar, which comes
 * back as wide as it was; Esc puts it back as it was. The keys size it
 * too: ← and → a rem (with Shift, four), Home, End, and Enter for 16rem.
 */
export function Edge({
  width,
  columnMin,
  onWidth,
  onHide,
  onHiding,
}: {
  /** As wide as the sidebar is, in rem. */
  width: number
  /** The narrowest column, in rem, which the window keeps room for. */
  columnMin: number
  onWidth: (rem: number) => void
  onHide: () => void
  /** Whether letting go now would hide the sidebar. */
  onHiding: (hiding: boolean) => void
}) {
  const [drag, setDrag] = useState<{
    rem: number
    top: number
    hides: boolean
  }>()
  const widestNow = () => widest(window.innerWidth / remInPx(), columnMin)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const root = document.documentElement
    root.dataset.drag = "width"
    // Drawn straight into the page while the pointer moves, once a frame,
    // and kept on letting go: the Shell draws again only then.
    const draw = (rem: number) =>
      root.style.setProperty("--sidebar-width", `${rem}rem`)
    const px = remInPx()
    const x0 = event.clientX
    const top = element.getBoundingClientRect().top
    const most = widestNow()
    let now = { rem: width, top: event.clientY - top, hides: false }
    let frame = 0
    let done = false

    const move = (moved: PointerEvent) => {
      const rem = width + (moved.clientX - x0) / px
      const hides = rem < HIDES
      if (hides !== now.hides) onHiding(hides)
      now = { rem: dragged(rem, most), top: moved.clientY - top, hides }
      frame ||= requestAnimationFrame(() => {
        frame = 0
        draw(now.rem)
        setDrag(now)
      })
    }
    const finish = (keep: boolean) => {
      if (done) return
      done = true
      cancelAnimationFrame(frame)
      element.removeEventListener("pointermove", move)
      element.removeEventListener("pointerup", up)
      element.removeEventListener("lostpointercapture", lost)
      window.removeEventListener("keydown", onKey, true)
      delete root.dataset.drag
      setDrag(undefined)
      if (now.hides) onHiding(false)
      if (keep && now.hides) {
        draw(width)
        onHide()
      } else if (keep) {
        draw(now.rem)
        onWidth(now.rem)
      } else {
        draw(width)
      }
    }
    const up = () => finish(true)
    const lost = () => finish(false)
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return
      key.preventDefault()
      key.stopPropagation()
      finish(false)
    }
    element.addEventListener("pointermove", move)
    element.addEventListener("pointerup", up)
    element.addEventListener("lostpointercapture", lost)
    window.addEventListener("keydown", onKey, true)
    setDrag(now)
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const by = event.shiftKey ? 4 : 1
    const most = widestNow()
    const to = {
      ArrowLeft: width - by,
      ArrowRight: width + by,
      Home: MIN,
      End: most,
      Enter: WIDTH,
    }[event.key]
    if (to === undefined) return
    event.preventDefault()
    onWidth(dragged(to, most))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      aria-valuemin={MIN}
      aria-valuemax={widestNow()}
      aria-valuenow={width}
      tabIndex={0}
      data-dragging={drag ? "" : undefined}
      className="group/edge absolute inset-y-(--gap-outer) left-[calc(var(--gap-outer)+var(--sidebar-width)-2px)] z-30 w-2 cursor-col-resize touch-none outline-none sidebar-desk:inset-y-0 sidebar-desk:left-[calc(var(--sidebar-width)-2px)]"
      onPointerDown={onPointerDown}
      onDoubleClick={() => onWidth(WIDTH)}
      onKeyDown={onKeyDown}
    >
      <span className="pointer-events-none absolute inset-y-3 left-px w-0.5 rounded-full bg-(--focus) opacity-0 transition-opacity duration-150 group-hover/edge:opacity-60 group-hover/edge:delay-150 group-focus-visible/edge:opacity-100 group-data-dragging/edge:opacity-100 group-data-dragging/edge:delay-0" />
      {drag && (
        <span
          className="pointer-events-none absolute left-full ml-2 rounded-md bg-foreground px-2 py-0.5 text-xs whitespace-nowrap text-background tabular-nums shadow-md"
          style={{ top: Math.max(0, drag.top - 12) }}
        >
          {drag.hides
            ? "Let go to hide"
            : drag.rem === WIDTH
              ? "Default width"
              : `${Math.round(drag.rem * remInPx())} px`}
        </span>
      )}
    </div>
  )
}
