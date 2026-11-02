import { Component, useEffect, useLayoutEffect, useRef } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { columnsOf, moveOf, useLookColumns } from "../look"
import { Moving } from "../motion"
import { Choices, minOf } from "../registry"
import type { Chime } from "@banda/ui/sound"
import { displayOf, type Entry, share, widthIn, type Workspace } from "./model"
import {
  ColumnMotion,
  minWidthOf,
  type Place,
  places,
  room,
  widthAt,
} from "./layout"
import { type Frame, PaneFrame } from "./PaneFrame"
import { Tabs } from "./Tabs"
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
  called,
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
  /** How the Thread a Pane shows calls the Person, if it does. */
  called: (entry: Entry) => Chime | undefined
  frame: Frame
  /** Opens a first Pane on this empty workspace. */
  onStart: (pane: PaneState) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const focus = workspace.columns[workspace.focus]?.id
  const look = useLookColumns()
  const columns = workspace.columns.map((column) => ({
    ...column,
    width: widthIn(workspace, column, look),
    tabbed: displayOf(column, look) === "tabs",
    min: minOf(column, look.min),
  }))
  const widths = columns.map((c) => `${c.width} ${c.min}`).join()
  const empty = workspace.columns.length === 0

  // Columns grow, shrink and go to new places on the look's springs.
  const motion = useRef(new ColumnMotion())
  useLayoutEffect(() => {
    motion.current.sync(scroller.current, columns)
  })
  useEffect(() => () => motion.current.stop(), [])

  // What a scroll needs, as it is now: the columns, and for a swipe's end
  // the focus and the frame.
  const now = useRef({ focus, frame, columns })
  useLayoutEffect(() => {
    now.current = { focus, frame, columns }
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
              spaceName={mixed ? spaceName(entry.space) : undefined}
              frame={frame}
              hidden={column.tabbed && column.active !== e}
              header={
                column.tabbed && column.active === e ? (
                  <Tabs
                    entries={column.entries}
                    active={column.active}
                    called={called}
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
  const { center } = columnsOf()
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
  const entry = strip.querySelector<HTMLElement>(
    `:scope > [data-column="${picked.id}"]`
  )?.dataset.entry
  if (picked.id !== focus && entry) frame.focus(entry)
}
