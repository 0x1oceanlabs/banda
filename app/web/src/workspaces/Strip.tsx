import { useEffect, useLayoutEffect, useRef } from "react"
import type { Engine, SpaceId } from "@bandaso/contract"
import type { PaneState } from "@bandaso/ui/pane"
import { moveOf } from "../look"
import { Moving } from "../motion"
import { Choices } from "../registry"
import type { Width, Workspace } from "./model"
import { type Frame, PaneFrame } from "./PaneFrame"
import { pixels, scrollsSideways, SWIPE_END, Swipe } from "./swipe"

const SHARE: Record<Width, number> = {
  "1/3": 1 / 3,
  "1/2": 1 / 2,
  "2/3": 2 / 3,
  "1": 1,
}

/**
 * One workspace, as niri's Strip: columns side by side, each its share of
 * the screen's width, scrolling sideways. The focused column always comes
 * fully into view, by the least scroll that shows it.
 *
 * A sideways swipe moves the Strip with the fingers, Alt held or not; where
 * it ends, the column most in view takes the focus and comes fully into
 * view. Over what scrolls sideways by itself, a swipe without Alt is that
 * Pane's. A swipe up or down is the Pane's under the pointer: the Strip
 * never moves by itself.
 */
export function Strip({
  workspace,
  live,
  engine,
  modules,
  spaceName,
  frame,
  onStart,
}: {
  workspace: Workspace
  /**
   * Whether it takes clicks and keys: it is on screen and the overview does
   * not cover it. Only then its focus is a Pane's.
   */
  live: boolean
  engine: Engine
  modules: readonly string[]
  spaceName: (space: SpaceId) => string
  frame: Frame
  /** Opens a first Pane on this empty workspace. */
  onStart: (pane: PaneState) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const focus = workspace.columns[workspace.focus]?.id
  const widths = workspace.columns.map((column) => column.width).join()
  const empty = workspace.columns.length === 0

  useLayoutEffect(() => {
    const strip = scroller.current
    const column = strip?.querySelector<HTMLElement>(`[data-column="${focus}"]`)
    if (strip && column) reveal(strip, column)
  }, [focus, widths])

  // What a swipe's end needs, as it is then.
  const now = useRef({ focus, frame })
  useLayoutEffect(() => {
    now.current = { focus, frame }
  })
  useEffect(() => {
    const strip = scroller.current
    if (!strip) return
    const swipe = new Swipe()
    let mine = false
    let ending: ReturnType<typeof setTimeout> | undefined
    const onWheel = (event: WheelEvent) => {
      const { x, y } = pixels(event)
      if (swipe.add(x, y, event.timeStamp)) {
        mine =
          event.altKey ||
          (!event.defaultPrevented && !scrollsSideways(event.target, strip))
      }
      if (event.altKey) event.preventDefault()
      if (!mine || swipe.way !== "sideways") return
      // The fingers take the Strip from wherever the spring has it.
      scrollOf(strip).stop()
      strip.scrollLeft += x
      clearTimeout(ending)
      ending = setTimeout(
        () => land(strip, now.current.focus, now.current.frame),
        SWIPE_END
      )
    }
    strip.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      strip.removeEventListener("wheel", onWheel)
      clearTimeout(ending)
    }
  }, [empty])

  if (empty) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-muted-foreground">
          This workspace is empty. Open a Pane:
        </p>
        <Choices modules={modules} onPick={onStart} />
      </div>
    )
  }

  const spaces = new Set(
    workspace.columns.flatMap((column) => column.entries.map((e) => e.space))
  )
  const mixed = spaces.size > 1
  return (
    <div
      ref={scroller}
      className="relative flex h-full gap-(--gap-inner) overflow-hidden p-(--gap-outer)"
    >
      {workspace.columns.map((column, c) => (
        <div
          key={column.id}
          data-column={column.id}
          data-entry={column.entries[column.active]?.id}
          className="flex h-full shrink-0 flex-col gap-(--gap-inner)"
          style={{
            // Shares of the room the Strip shows, gaps between them included.
            width: `calc(${SHARE[column.width]} * (100% + var(--gap-inner)) - var(--gap-inner))`,
          }}
        >
          {column.entries.map((entry, e) => (
            <PaneFrame
              key={entry.id}
              entry={entry}
              engine={engine}
              modules={modules}
              focused={live && workspace.focus === c && column.active === e}
              spaceName={mixed ? spaceName(entry.space) : undefined}
              frame={frame}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

const scrolls = new WeakMap<HTMLElement, Moving>()

/** The Strip's scroll, moving on the look's spring. */
function scrollOf(strip: HTMLElement): Moving {
  let scroll = scrolls.get(strip)
  if (!scroll) {
    scroll = new Moving(
      (left) => {
        strip.scrollLeft = left
      },
      () => strip.scrollLeft
    )
    scrolls.set(strip, scroll)
  }
  return scroll
}

/** Scrolls the Strip by the least that shows `column` whole, measured
 * from where it is headed, so a second step goes on from the first. */
function reveal(strip: HTMLElement, column: HTMLElement) {
  const scroll = scrollOf(strip)
  const at = scroll.target
  // The look's outer gap stays in view beside the column.
  const gap = parseFloat(getComputedStyle(strip).paddingLeft) || 0
  const start = column.offsetLeft - gap
  const end = column.offsetLeft + column.offsetWidth + gap
  const most = strip.scrollWidth - strip.clientWidth
  const to =
    start < at
      ? start
      : end > at + strip.clientWidth
        ? end - strip.clientWidth
        : at
  const target = Math.max(0, Math.min(most, to))
  if (target !== at) scroll.to(target, moveOf("strip"))
}

/**
 * Where a sideways swipe ends: the focused column keeps the focus while no
 * other is more in view; else the one most in view nearest to it takes it.
 * Either comes whole into view.
 */
function land(strip: HTMLElement, focus: string | undefined, frame: Frame) {
  const columns = [...strip.querySelectorAll<HTMLElement>("[data-column]")]
  const shares = columns.map((column) => {
    const from = Math.max(column.offsetLeft, strip.scrollLeft)
    const to = Math.min(
      column.offsetLeft + column.offsetWidth,
      strip.scrollLeft + strip.clientWidth
    )
    return Math.max(0, to - from) / column.offsetWidth
  })
  const most = Math.max(...shares) - 0.01
  const at = columns.findIndex((column) => column.dataset.column === focus)
  const picked = columns
    .map((column, i) => ({ column, i }))
    .filter(({ i }) => shares[i] >= most)
    .sort((a, b) => Math.abs(a.i - at) - Math.abs(b.i - at))[0]?.column
  if (!picked) return
  reveal(strip, picked)
  const entry = picked.dataset.entry
  if (picked.dataset.column !== focus && entry) frame.focus(entry)
}
