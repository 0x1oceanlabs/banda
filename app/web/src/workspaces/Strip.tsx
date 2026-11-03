import { Component, useEffect, useLayoutEffect, useRef } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type { Listed, PaneState } from "@banda/ui/pane"
import { columnsOf, moveOf, useLookColumns } from "../look"
import { Choices } from "../registry"
import type { Chime } from "@banda/ui/sound"
import { type Entry, share, type Workspace } from "./model"
import {
  ColumnMotion,
  columnIn,
  drawnColumns,
  minWidthOf,
  type Place,
  places,
  room,
  scrollOf,
  widthAt,
} from "./layout"
import { type Frame, PaneFrame } from "./PaneFrame"
import { Tabs } from "./Tabs"
import { pixels, scrollsSideways, SWIPE_END, Swipe, type Way } from "./swipe"
import { THRESHOLD } from "./sizing"
import { useSizing } from "./useSizing"

/** How far, in pixels, `Alt` and the middle button go up or down to step
 * to the next workspace. */
const VIEW_STEP = 48

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
 *
 * `Alt` and the middle button drag the view, as niri's `Mod` and the
 * middle button: sideways the Strip follows the pointer, and lands as a
 * swipe does; up or down, the workspaces step once.
 */
export function Strip({
  workspace,
  live,
  engine,
  modules,
  spaceName,
  called,
  marked,
  zoomed,
  center,
  listed,
  frame,
  onStep,
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
  /** How the Thread a Pane shows calls the Person, if it does. */
  called: (entry: Entry) => Chime | undefined
  /** An Agent opened it, and the Person has not looked at it yet. */
  marked: (entry: Entry) => boolean
  /** The Pane shown over the whole window, if one is (`Alt+Shift+F`). */
  zoomed: string | undefined
  /** Counts Alt+C: each time it does, the focused column goes to the
   * middle of the screen, once. */
  center: number
  /** The listed thing a Pane shows, as its module lists it. */
  listed: (entry: Entry) => Listed | undefined
  frame: Frame
  /** `Alt` and the middle button dragged up or down step once. */
  onStep: (by: 1 | -1) => void
  /** Opens a first Pane on this empty workspace. */
  onStart: (pane: PaneState) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const focus = workspace.columns[workspace.focus]?.id
  const look = useLookColumns()
  const columns = drawnColumns(workspace, look)
  // The zoomed Pane, the focused one, covers the workspace; the rest
  // hide under it, their pages too.
  const zooms = live && zoomed !== undefined
  const widths = columns.map((c) => `${c.width} ${c.min}`).join()
  const empty = workspace.columns.length === 0

  // Columns grow, shrink and go to new places on the look's springs.
  const motion = useRef(new ColumnMotion())
  useLayoutEffect(() => {
    motion.current.sync(scroller.current, columns)
  })
  useEffect(() => () => motion.current.stop(), [])

  // What a scroll needs, as it is now: the columns, and for a swipe's end
  // the focus and the frame; what the mouse's sizing reads too.
  const now = useRef({ focus, frame, columns, look, on: false, onStep })
  useLayoutEffect(() => {
    now.current = { focus, frame, columns, look, on: live && !zooms, onStep }
  })
  useSizing(scroller, motion, now)

  // The column focused before, for `center = "on-overflow"`.
  const before = useRef(focus)
  useLayoutEffect(() => {
    const strip = scroller.current
    if (strip) {
      reveal(strip, places(strip, now.current.columns), focus, before.current)
    }
    before.current = focus
  }, [focus, widths])
  // The room changes when the window does, or the sidebar comes or goes
  // over the Strip's left: the focused column comes whole into view again.
  useEffect(() => {
    const strip = scroller.current
    if (!strip) return
    const watch = new ResizeObserver(() =>
      reveal(strip, places(strip, now.current.columns), now.current.focus)
    )
    watch.observe(strip)
    return () => watch.disconnect()
  }, [])
  // Alt+C: the focused column to the middle, once.
  const centered = useRef(center)
  useLayoutEffect(() => {
    const strip = scroller.current
    if (center === centered.current) return
    centered.current = center
    if (strip && live) {
      const all = places(strip, now.current.columns)
      reveal(strip, all, now.current.focus, undefined, "always")
    }
  }, [center, live])
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
  }, [])

  useEffect(() => {
    const strip = scroller.current
    if (!strip) return
    const root = document.documentElement
    let drag:
      | { pointer: number; x: number; y: number; scroll: number; way?: Way }
      | undefined
    const onDown = (event: PointerEvent) => {
      if (event.button !== 1 || !event.altKey || event.ctrlKey) return
      if (!now.current.on || drag) return
      event.preventDefault()
      event.stopPropagation()
      strip.setPointerCapture(event.pointerId)
      scrollOf(strip).stop()
      drag = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scroll: strip.scrollLeft,
      }
      root.dataset.drag = "view"
    }
    const onMove = (event: PointerEvent) => {
      if (drag?.pointer !== event.pointerId) return
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      if (!drag.way && Math.max(Math.abs(dx), Math.abs(dy)) >= THRESHOLD) {
        drag.way = Math.abs(dx) >= Math.abs(dy) ? "sideways" : "upright"
      }
      if (drag.way === "sideways") strip.scrollLeft = drag.scroll - dx
      if (drag.way === "upright" && Math.abs(dy) >= VIEW_STEP) {
        // Pulled up, the next one comes up from below.
        now.current.onStep(dy < 0 ? 1 : -1)
        finish()
      }
    }
    const finish = () => {
      if (!drag) return
      const { way } = drag
      drag = undefined
      delete root.dataset.drag
      if (way === "sideways") {
        const { columns, focus, frame } = now.current
        land(strip, places(strip, columns), focus, frame)
      }
    }
    const onUp = (event: PointerEvent) => {
      if (drag?.pointer === event.pointerId) finish()
    }
    strip.addEventListener("pointerdown", onDown, true)
    strip.addEventListener("pointermove", onMove)
    strip.addEventListener("pointerup", onUp)
    strip.addEventListener("lostpointercapture", onUp)
    return () => {
      finish()
      strip.removeEventListener("pointerdown", onDown, true)
      strip.removeEventListener("pointermove", onMove)
      strip.removeEventListener("pointerup", onUp)
      strip.removeEventListener("lostpointercapture", onUp)
    }
  }, [])

  const spaces = new Set(
    workspace.columns.flatMap((column) => column.entries.map((e) => e.space))
  )
  const mixed = spaces.size > 1
  return (
    <div
      ref={scroller}
      data-strip={workspace.id}
      className="relative flex h-full gap-(--gap-inner) overflow-hidden p-(--gap-outer) pl-[calc(var(--gap-outer)+var(--sidebar-inset))]"
    >
      <Before read={() => motion.current.before(scroller.current)} />
      {/* The Strip stays when its last Pane goes, so that Pane fades out
          here, over these words. */}
      {empty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 pl-[calc(--spacing(6)+var(--sidebar-inset))]">
          <p className="text-sm text-muted-foreground">
            This workspace is empty. Open a Pane:
          </p>
          <Choices modules={modules} onPick={onStart} />
        </div>
      )}
      {columns.map((column, c) => (
        <div
          key={column.id}
          data-column={column.id}
          data-entry={column.entries[column.active]?.id}
          className="relative flex h-full shrink-0 flex-col gap-(--gap-inner)"
          style={{
            // Shares of the room the Strip shows, gaps between them
            // included; never so narrow its Panes cannot be read.
            width: widthAt(share(column.width) ?? 0.5),
            minWidth: minWidthOf(column.min),
          }}
        >
          {column.entries.map((entry, e) => (
            <PaneFrame
              key={entry.id}
              entry={entry}
              engine={engine}
              modules={modules}
              focused={live && workspace.focus === c && column.active === e}
              marked={marked(entry)}
              zoomed={entry.id === zoomed}
              height={column.tabbed ? undefined : column.heights[e]}
              listed={listed(entry)}
              spaceName={spaceName(entry.space)}
              mixed={mixed}
              frame={frame}
              hidden={
                zooms
                  ? entry.id !== zoomed
                  : column.tabbed && column.active !== e
              }
              header={
                column.tabbed && column.active === e && !zooms ? (
                  <Tabs
                    entries={column.entries}
                    active={column.active}
                    called={called}
                    marked={marked}
                    frame={frame}
                  />
                ) : undefined
              }
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Calls `read` just before React changes the page, as it is still:
 * what `getSnapshotBeforeUpdate` is for, and only a class has it. */
class Before extends Component<{ read: () => void }> {
  getSnapshotBeforeUpdate() {
    this.props.read()
    return null
  }
  // React wants it beside getSnapshotBeforeUpdate.
  componentDidUpdate() {}
  render() {
    return null
  }
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
  before?: string,
  center = columnsOf().center
) {
  const column = all.find((place) => place.id === id)
  if (!column) return
  const scroll = scrollOf(strip)
  const at = scroll.target
  // What shows: `inner` wide, `pad` in from the left, past the outer gap
  // and the sidebar floating there.
  const { pad, inner } = room(strip)
  const least = (left: number, right: number) =>
    left - pad < at
      ? left - pad
      : right - pad - inner > at
        ? right - pad - inner
        : at
  const middle = (column.left + column.right - inner) / 2 - pad
  let to = least(column.left, column.right)
  if (center === "always") to = middle
  const previous = all.find((place) => place.id === before)
  if (center === "on-overflow" && previous && previous !== column) {
    const left = Math.min(column.left, previous.left)
    const right = Math.max(column.right, previous.right)
    to = right - left <= inner ? least(left, right) : middle
  }
  const most = Math.max(0, (all.at(-1)?.right ?? 0) - pad - inner)
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
  const { pad, inner } = room(strip)
  const view = {
    from: strip.scrollLeft + pad,
    to: strip.scrollLeft + pad + inner,
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
  const entry = columnIn(strip, picked.id)?.dataset.entry
  if (picked.id !== focus && entry) frame.focus(entry)
}
