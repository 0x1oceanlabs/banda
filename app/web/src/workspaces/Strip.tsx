import { useEffect, useLayoutEffect, useRef } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { columnsOf, moveOf } from "../look"
import { Moving } from "../motion"
import { Choices } from "../registry"
import { share, type Workspace } from "./model"
import { ColumnMotion, type Place, places, widthAt } from "./layout"
import { type Frame, PaneFrame } from "./PaneFrame"
import { pixels, scrollsSideways, SWIPE_END, Swipe } from "./swipe"

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

  // Columns grow, shrink and go to new places on the look's springs.
  const motion = useRef(new ColumnMotion())
  useLayoutEffect(() => {
    motion.current.sync(scroller.current, workspace.columns)
  })
  useEffect(() => () => motion.current.stop(), [])

  // What a scroll needs, as it is now: the columns, and for a swipe's end
  // the focus and the frame.
  const now = useRef({ focus, frame, columns: workspace.columns })
  useLayoutEffect(() => {
    now.current = { focus, frame, columns: workspace.columns }
  })

  // The column focused before, for `center = "on-overflow"`.
  const before = useRef(focus)
  useLayoutEffect(() => {
    const strip = scroller.current
    if (strip) {
      reveal(strip, places(strip, now.current.columns), focus, before.current)
    }
    before.current = focus
  }, [focus, widths])
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
        () =>
          land(
            strip,
            places(strip, now.current.columns),
            now.current.focus,
            now.current.frame
          ),
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
          className="relative flex h-full shrink-0 flex-col gap-(--gap-inner)"
          style={{
            // Shares of the room the Strip shows, gaps between them included.
            width: widthAt(share(column.width) ?? 0.5),
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

/**
 * Scrolls the Strip to show the column `id` whole, as the look's `center`
 * says: by the least scroll; to the middle; or to the middle only when it
 * does not fit beside `before`, the column focused before it, else by the
 * least scroll that shows both. It aims at where the columns end up, and
 * from where the scroll is headed, so a second step goes on from the first.
 */
function reveal(
  strip: HTMLElement,
  all: readonly Place[],
  id: string | undefined,
  before?: string
) {
  const column = all.find((place) => place.id === id)
  if (!column) return
  const scroll = scrollOf(strip)
  const at = scroll.target
  const width = strip.clientWidth
  // The look's outer gap stays in view beside what shows.
  const pad = parseFloat(getComputedStyle(strip).paddingLeft) || 0
  const least = (start: number, end: number) =>
    start < at ? start : end > at + width ? end - width : at
  const middle = (column.left + column.right) / 2 - width / 2
  const { center } = columnsOf()
  let to = least(column.left - pad, column.right + pad)
  if (center === "always") to = middle
  const previous = all.find((place) => place.id === before)
  if (center === "on-overflow" && previous && previous !== column) {
    const start = Math.min(column.left, previous.left) - pad
    const end = Math.max(column.right, previous.right) + pad
    to = end - start <= width ? least(start, end) : middle
  }
  const most = Math.max(0, (all.at(-1)?.right ?? 0) + pad - width)
  const target = Math.max(0, Math.min(most, to))
  if (target !== at) scroll.to(target, moveOf("strip"))
}

/**
 * Where a sideways swipe ends: the focused column keeps the focus while no
 * other is more in view; else the one most in view nearest to it takes it.
 * Either comes whole into view.
 */
function land(
  strip: HTMLElement,
  all: readonly Place[],
  focus: string | undefined,
  frame: Frame
) {
  const view = {
    from: strip.scrollLeft,
    to: strip.scrollLeft + strip.clientWidth,
  }
  const shares = all.map((place) => {
    const shown =
      Math.min(place.right, view.to) - Math.max(place.left, view.from)
    return Math.max(0, shown) / (place.right - place.left)
  })
  const most = Math.max(...shares) - 0.01
  const at = all.findIndex((place) => place.id === focus)
  const picked = all
    .map((place, i) => ({ place, i }))
    .filter(({ i }) => shares[i] >= most)
    .sort((a, b) => Math.abs(a.i - at) - Math.abs(b.i - at))[0]?.place
  if (!picked) return
  reveal(strip, all, picked.id, focus)
  const entry = strip.querySelector<HTMLElement>(
    `:scope > [data-column="${picked.id}"]`
  )?.dataset.entry
  if (picked.id !== focus && entry) frame.focus(entry)
}
