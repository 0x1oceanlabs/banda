import { Button } from "@banda/ui/components/button"
import { cn } from "@banda/ui/lib/utils"
import { GripHorizontalIcon } from "lucide-react"
import { Component, memo, useEffect, useLayoutEffect, useRef } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Center } from "@banda/contract/look"
import type { PaneState } from "@banda/ui/pane"
import { columnsOf, moveOf, useLookColumns, useLookGroups } from "../look"
import { Choices } from "../registry"
import {
  type Entry,
  groupAttributes,
  isFree,
  keepsPlace,
  runOf,
  share,
  type Workspace,
} from "./model"
import {
  ColumnMotion,
  columnIn,
  drawnColumns,
  minWidthOf,
  type Place,
  places,
  type Reveal,
  room,
  scrollOf,
  shownShare,
  widthAt,
} from "./layout"
import { type Shows, useGroups, useShows } from "./shows"
import { type Frame, PaneFrame } from "./PaneFrame"
import { aimed, drawnStrip, leftStrip } from "./tiles"

import { Tabs } from "./Tabs"
import { pixels, scrollsSideways, SWIPE_END, Swipe, type Way } from "./swipe"
import { THRESHOLD } from "./sizing"
import { useSizing } from "./useSizing"
import { usePlates } from "./usePlates"
import { useHoldsMod } from "@banda/ui/hooks/use-key-of"

/** How far, in pixels, the mod and the middle button go up or down to step
 * to the next workspace. */
const VIEW_STEP = 48

/**
 * One workspace, as niri's Strip: columns side by side, each its share of
 * the screen's width, scrolling sideways. The focused column always comes
 * fully into view, by the least scroll that shows it.
 *
 * A sideways swipe moves the Strip with the fingers, the mod held or not; where
 * it ends, the column most in view takes the focus and comes fully into
 * view. Over what scrolls sideways by itself, a swipe without the mod is that
 * Pane's. A swipe up or down is the Pane's under the pointer: the Strip
 * never moves by itself.
 *
 * the mod and the middle button drag the view, as niri's `Mod` and the
 * middle button: sideways the Strip follows the pointer, and lands as a
 * swipe does; up or down, the workspaces step once.
 *
 * It is drawn again only as its own props change, or what `shows` says
 * of its Panes (ADR 0088, decision 7).
 */
export const Strip = memo(function Strip({
  workspace,
  live,
  selected,
  modules,
  projectOf,
  strict,
  gone,
  shows,
  marked,
  away,
  zoomed,
  reveal: asked,
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
  /** Keeps the selection visible while the overview owns the keys. */
  selected: boolean
  modules: readonly string[]
  projectOf: (project: ProjectId) => ProjectSummary | undefined
  /** In the row and solo, where a Project's workspace holds its Panes
   * only (ADR 0102). */
  strict: boolean
  /** The Projects known to have no Threads, whose emptied workspace goes
   * once the window leaves it (`keepsPlace`). */
  gone: readonly ProjectId[]
  /** What its Panes show, as their Apps list it, and how each calls. */
  shows: Shows
  /** An Agent opened it, and the Person has not looked at it yet. */
  marked: (entry: Entry) => boolean
  /** The Panes in windows of their own, which stand-ins keep the places of. */
  away: ReadonlySet<string>
  /** The Pane shown over the whole window, if one is (`Alt+Shift+F`). */
  zoomed: string | undefined
  /** Counts Alt+C: each time it does, the focused column goes to the
   * middle of the screen, once. */
  /** A column to show once, as asked: Alt+C's, or a Thread picked. */
  reveal?: Reveal
  /** How far the sidebar reaches over its left, in rem, which pads it
   * (`--sidebar-inset`): as it changes, the Strip is drawn again, and its
   * columns slide to where the padding puts them, as on any move. */
  inset: number
  frame: Frame
  /** The mod and the middle button dragged up or down step once. */
  onStep: (by: 1 | -1) => void
  /** Opens a first Pane on this empty workspace. */
  onStart: (pane: PaneState) => void
}) {
  const holdsMod = useHoldsMod()
  const scroller = useRef<HTMLDivElement>(null)
  const focus = workspace.columns[workspace.focus]?.id
  const look = useLookColumns()
  const groups = useLookGroups()
  const columns = drawnColumns(workspace, look)
  const focusedGroup = workspace.columns[workspace.focus]?.group
  // Whether each Pane shows an Item, and how it calls; each Group's
  // owner: its state and its name.
  const { item, called } = useShows(shows, workspace)
  const owned = useGroups(shows, workspace)
  // Each Group's colour, by its owner's state; its plate moves with it.
  const states = new Map(
    columns.flatMap(({ group }) =>
      group === undefined ? [] : [[group, owned.get(group)?.state]]
    )
  )
  usePlates(scroller, states, groups.working === "sheen")
  // The zoomed Pane, the focused one, covers the workspace; the rest
  // hide under it, their pages too.
  const zooms = live && zoomed !== undefined
  // What moves the columns: their order and their widths. A column moved
  // along the Strip keeps the focus, and the Strip follows it.
  const layout = columns.map((c) => `${c.id} ${c.width} ${c.min}`).join()
  const empty = workspace.columns.length === 0
  // A Project's workspace says whose it is: emptied, where it keeps its
  // place (ADR 0102, decision 2), and by its own Group's tag (decision 4).
  const whose =
    workspace.project === undefined
      ? undefined
      : projectOf(workspace.project)?.name
  const kept = empty && keepsPlace(workspace, gone, strict)

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
  }, [focus, layout])
  // The room changes when the window does, or the sidebar comes or goes
  // over the Strip's left: the focused column comes whole into view again.
  useEffect(() => {
    const strip = scroller.current
    if (!strip) return
    const watch = new ResizeObserver(() => {
      reveal(strip, places(strip, now.current.columns), now.current.focus)
      aimed(strip)
    })
    watch.observe(strip)
    return () => watch.disconnect()
  }, [])
  // Alt+C: the focused column to the middle; a Thread picked: its Group's
  // first column to the left, so every Agent comes to the same place
  // (ADR 0065). Once each, when its Pane is drawn.
  const revealed = useRef(asked)
  useLayoutEffect(() => {
    const strip = scroller.current
    if (!strip || !live || !asked || asked === revealed.current) return
    const { columns } = now.current
    const at = columns.findIndex((column) =>
      column.entries.some((entry) => entry.id === asked.entry)
    )
    if (at < 0) return
    revealed.current = asked
    const all = places(strip, columns)
    if (asked.how === "middle") {
      reveal(strip, all, columns[at].id, undefined, "always")
    } else {
      const first = columns[runOf(columns, at).start].id
      reveal(strip, all, first, undefined, "left")
    }
  }, [asked, live, workspace])
  // Each Tile's state, from what the Strip shows and where it is headed,
  // once it scrolled where its focus goes, above, so a Tile a key brings
  // into view shows before it slides in (ADR 0088, decision 4).
  useLayoutEffect(() => {
    const strip = scroller.current
    if (!strip) return
    drawnStrip(strip, {
      workspace: workspace.id,
      columns,
      motion: motion.current,
      tiles: [
        ...strip.querySelectorAll<HTMLElement>(
          ":scope > [data-column] > section[data-tile]"
        ),
      ].map((element) => ({
        element,
        column: element.parentElement?.dataset.column ?? "",
        covered: element.hidden !== false,
        over: element.dataset.zoomed !== undefined,
      })),
    })
  })
  useLayoutEffect(() => {
    const strip = scroller.current
    return () => {
      if (strip) leftStrip(strip)
    }
  }, [])
  useEffect(() => {
    const strip = scroller.current
    if (!strip) return
    const swipe = new Swipe()
    let mine = false
    let ending: ReturnType<typeof setTimeout> | undefined
    const onWheel = (event: WheelEvent) => {
      const { x, y } = pixels(event)
      const held = holdsMod(event)
      if (swipe.add(x, y, event.timeStamp)) {
        mine =
          held ||
          (!event.defaultPrevented && !scrollsSideways(event.target, strip))
      }
      if (held) event.preventDefault()
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
  }, [holdsMod])

  useEffect(() => {
    const strip = scroller.current
    if (!strip) return
    const root = document.documentElement
    let drag:
      | { pointer: number; x: number; y: number; scroll: number; way?: Way }
      | undefined
    const onDown = (event: PointerEvent) => {
      if (event.button !== 1 || !holdsMod(event)) return
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
  }, [holdsMod])

  // A Group's handle shows while the pointer is over any of its columns.
  const hovered = useRef<string | undefined>(undefined)
  const hover = (group: string | undefined) => {
    const strip = scroller.current
    if (!strip || group === hovered.current) return
    hovered.current = group
    for (const handle of strip.querySelectorAll<HTMLElement>(
      "[data-group-handle]"
    )) {
      handle.toggleAttribute("data-hover", handle.dataset.groupHandle === group)
    }
  }

  const projects = new Set(
    workspace.columns.flatMap((column) => column.entries.map((e) => e.project))
  )
  // A Pane says its Project where others' stand by it, and on a free
  // workspace of the row and solo (ADR 0102, decision 6).
  const mixed = projects.size > 1 || (strict && isFree(workspace))
  return (
    <div
      ref={scroller}
      data-strip={workspace.id}
      onPointerOver={(event) => {
        const target = event.target instanceof Element ? event.target : null
        hover(target?.closest<HTMLElement>("[data-column]")?.dataset.group)
      }}
      onPointerLeave={() => hover(undefined)}
      className="relative flex h-full gap-(--gap-inner) overflow-hidden p-(--gap-outer) pl-[calc(var(--gap-outer)+var(--sidebar-inset))]"
    >
      <Before read={() => motion.current.before(scroller.current)} />
      {/* The Strip stays when its last Pane goes, so that Pane fades out
          here, over these words. */}
      {empty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 pl-[calc(--spacing(6)+var(--sidebar-inset))]">
          <p className="text-center text-sm text-balance text-muted-foreground">
            {kept
              ? `${whose ?? "This Project"}'s workspace is empty. It keeps its place until you close it.`
              : "This workspace is empty. Open a Pane:"}
          </p>
          <Choices modules={modules} onPick={onStart} />
          {/* It goes when the Person closes it (ADR 0102, decision 2). */}
          {kept && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() =>
                frame.run("workspace.close", { workspace: workspace.id })
              }
            >
              Close the workspace
            </Button>
          )}
        </div>
      )}
      {columns.map((column, c) => {
        const here = workspace.focus === c
        const bar = column.decked && !zooms
        const { group, ends } = column
        const lit = group !== undefined && selected && focusedGroup === group
        const own = group !== undefined && group === workspace.own
        return (
          <div
            key={column.id}
            data-column={column.id}
            data-entry={column.entries[column.active]?.id}
            {...groupAttributes(group, ends)}
            // A group bar sits nearer its tile than tiles to each other.
            className={cn(
              "relative flex h-full shrink-0 flex-col",
              bar ? "gap-1" : "gap-(--gap-inner)"
            )}
            style={{
              // Shares of the room the Strip shows, gaps between them
              // included; never so narrow its Panes cannot be read.
              width: widthAt(share(column.width) ?? 0.5),
              minWidth: minWidthOf(column.min),
            }}
          >
            {group !== undefined && !zooms && (
              <div
                aria-hidden
                data-group-plate={group}
                data-state={states.get(group)}
                data-first={ends.first ? "" : undefined}
                data-last={ends.last ? "" : undefined}
                data-focused={lit ? "" : undefined}
              />
            )}
            {group !== undefined &&
              ends.first &&
              !zooms &&
              (groups.handle ? (
                <GroupHandle
                  group={group}
                  name={
                    owned.get(group)?.name ??
                    // The own Group has no owner: its tag is the Project's
                    // name (ADR 0102, decision 4).
                    (own ? whose : undefined)
                  }
                  pane={column.entries[0]?.id}
                  panes={columns
                    .slice(c, runOf(columns, c).end)
                    .reduce((sum, one) => sum + one.entries.length, 0)}
                />
              ) : (
                // With the handle off, the own Group still bears its tag.
                own && whose !== undefined && <OwnTag name={whose} />
              ))}
            {bar && (
              <Tabs
                entries={column.entries}
                active={column.active}
                focused={selected && here}
                called={called}
                marked={marked}
                frame={frame}
              />
            )}
            {column.entries.map((entry, e) => (
              <PaneFrame
                key={entry.id}
                entry={entry}
                modules={modules}
                focused={live && here && column.active === e}
                selected={selected && here && column.active === e}
                marked={marked(entry)}
                away={away.has(entry.id)}
                zoomed={entry.id === zoomed}
                height={column.decked ? undefined : column.heights[e]}
                item={item(entry)}
                project={projectOf(entry.project)}
                mixed={mixed}
                frame={frame}
                hidden={
                  zooms
                    ? entry.id !== zoomed
                    : column.decked && column.active !== e
                }
              />
            ))}
          </div>
        )
      })}
    </div>
  )
})

/** A Group's handle and the own Group's tag: a pill on its top edge. */
const PILL =
  "absolute top-[calc(-1*var(--group-pad)-0.375rem)] left-3 z-10 flex h-3 items-center rounded-full bg-popover px-1.5 text-[0.625rem] leading-3 text-muted-foreground ring-1 ring-border select-none"

/**
 * A Group's handle (ADR 0065, decision 6): on its top edge, it shows
 * under the pointer, says the Group's name and its number of Panes, and
 * carries the whole Group when dragged (`useMoving`).
 */
function GroupHandle({
  group,
  name,
  pane,
  panes,
}: {
  group: string
  /** Its owner's name; left out, a Group no one owns. */
  name?: string
  /** Its first Pane, which the carrying names it by. */
  pane: string | undefined
  panes: number
}) {
  const label = `${name ?? "Group"} · ${panes} ${panes === 1 ? "Pane" : "Panes"}`
  return (
    <div
      data-group-handle={group}
      data-pane={pane}
      role="button"
      aria-label={label}
      title="Drag to move the Group"
      className={cn(
        PILL,
        "cursor-grab gap-1 opacity-0 shadow-sm transition-opacity duration-150 data-hover:opacity-100 data-lifted:opacity-100 motion-reduce:transition-none"
      )}
    >
      <GripHorizontalIcon aria-hidden className="size-2.5" />
      {label}
    </div>
  )
}

/**
 * The Project's own Group's tag (ADR 0102, decision 4): the Project's
 * name, where the Group's handle would stand, there while the handle is
 * off. It only says; the handle carries.
 */
function OwnTag({ name }: { name: string }) {
  return (
    <div
      data-group-tag=""
      className={cn(PILL, "pointer-events-none whitespace-nowrap")}
    >
      {name}
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
  center: Center | "left" = columnsOf().center
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
  if (center === "left") to = column.left - pad
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
  const shares = all.map((place) => shownShare(place, view))
  const most = Math.max(...shares) - 0.01
  const at = all.findIndex((place) => place.id === focus)
  const picked = all
    .map((place, i) => ({ place, i }))
    .filter(({ i }) => shares[i] >= most)
    .sort((a, b) => Math.abs(a.i - at) - Math.abs(b.i - at))[0]?.place
  if (!picked) return
  reveal(strip, all, picked.id, focus)
  // Where it goes shows from now, before it slides in.
  aimed(strip)
  const entry = columnIn(strip, picked.id)?.dataset.entry
  if (picked.id !== focus && entry) frame.focus(entry)
}
