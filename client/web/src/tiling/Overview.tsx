import { cn } from "@banda/ui/lib/utils"
import { projectLabel } from "@banda/ui/lib/projects"
import {
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { GripHorizontalIcon, PlusIcon, XIcon } from "lucide-react"
import { Button } from "@banda/ui/components/button"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { DEFAULT_OVERVIEW } from "@banda/contract/look"
import { labelOf, useSaid } from "../registry"
import { workspaceTo } from "./arrange"
import { moveOf, useLookColumns, useLookOverview } from "../look"
import { Moving } from "../motion"
import { followMoves, moved } from "@banda/ui/lib/frames"
import { fit, ROW } from "./fit"
import { type Shows, useShows } from "./shows"
import {
  drawnColumns,
  heightAt,
  holdScroll,
  releaseScroll,
  remInPx,
  room,
  scrolled,
  stackOf,
  stripOf,
} from "./layout"
import {
  type Direction,
  find,
  focused,
  groupAttributes,
  type Gone,
  keepsPlace,
  padded,
  share,
  type Workspaces,
} from "./model"
import { lying, nudge, pushed } from "./moving"
import type { Frame } from "./PaneFrame"
import { PaneSlot } from "./PaneSlot"
import { STEP_ASIDE, useReorder } from "./reorder"
import { type Carrying, landIn, refusing, useMoving } from "./useMoving"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"

/** Where a Pane lands before the overview is drawn: nowhere. */
const ASIDE = { land: () => ({}), scroll: () => false }

const ARROWS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
}

/** A Deck's bar of names, as `Tabs` draws it (`h-6 gap-1`): its
 * height, and the gap between its segments, in rem. */
const TABS = { height: 1.5, gap: 0.25 }

/** The room beside a workspace, in pixels: its number, and a gap. */
const NUMBER = 36
/** Its number's width, in pixels. */
const LABEL = 28
/** How far the selected workspace's plate is lit, out of 100, and every
 * plate's on glass, which has no desk of its own. */
const LIT = 7
const GLASS = 3

/** The screen a workspace fills, as a Strip draws it: the room its
 * columns have, the gaps, and the room the overview has for them all, in
 * pixels. */
type Screen = {
  /** How far in from the Strip's left the screen shows: past the sidebar. */
  from: number
  /** The Strip's width, which the overview keeps as it shows it whole. */
  width: number
  inner: number
  height: number
  gap: number
  outer: number
  room: { width: number; height: number }
  /** A rem, in pixels: a column's least width is in rem. */
  rem: number
}

/** A workspace as the overview fits it in: its zoom, its width drawn
 * whole at full size from its left outer gap to its right one, and each
 * column's width there, in pixels. */
type Fitted = { zoom: number; whole: number; wide: boolean; columns: number[] }

/**
 * Every workspace zoomed out, one under another, as niri's overview
 * (ADR 0025, decision 7): each a small copy of the screen, its columns
 * as wide as the Strip draws them, with `[columns] min`, scrolled as the
 * Strip is.
 *
 * Each shows whole, every column of it, not only the screen it fills, and
 * all of them fit in at once while they can be read (`fit`): a wide one is
 * drawn smaller, past that its row scrolls, and a line under it shows what
 * its screen shows.
 *
 * The arrows pick a Pane, and up or down past a column's end go to the
 * workspace there; `Enter` goes to it. The window's keys work as ever:
 * `Alt+Shift+Arrows` move the Pane picked. The mouse carries a
 * Pane as on a Strip, from anywhere on it: beside another, or between two
 * workspaces, where it makes a new one. A click on a Pane goes to it; on
 * a workspace, there. A workspace's number carries it, and its Panes,
 * up or down, the others stepping aside; the empty one at the bottom
 * stays. `Esc` puts one carried back, or goes back.
 *
 * What shows is the workspaces themselves, zoomed out over the desk's
 * theme or glass (ADR 0052): each stands under its row, so a Pane's tile here
 * lies over the Pane, and those take no clicks or keys while it is open.
 * Each is a plate of the desk, sized to what shows of its Strip: no frame
 * is drawn over it, so none jumps or blurs as it zooms.
 */
export function Overview({
  open,
  onExited,
  workspaces,
  projectOf,
  strict,
  gone,
  shows,
  frame,
  onPick,
  onArrow,
  onGo,
  onClose,
}: {
  /** Kept drawn while closing; the Panes take the focus once it lands. */
  open: boolean
  onExited: () => void
  workspaces: Workspaces
  projectOf: (project: ProjectId) => ProjectSummary | undefined
  /** In the row and solo, where a Project's workspace holds its Panes
   * only (ADR 0102). */
  strict: boolean
  /** Whether a Project's emptied workspace goes once the window leaves
   * it (`keepsPlace`). */
  gone: Gone
  /** The Thread each Pane shows, as its module lists it, and how it
   * calls the Person. */
  shows: Shows
  frame: Pick<Frame, "arrange" | "focus" | "close" | "run">
  /** Puts the focus on a Pane, and goes to its workspace. */
  onPick: (entry: string) => void
  /** Moves the focus as the arrows do here. */
  onArrow: (direction: Direction) => void
  /** Goes to workspace `id`. */
  onGo: (id: string) => void
  onClose: () => void
}) {
  const look = useLookColumns()
  // A zoom of 0 would draw nothing: the default stands in.
  const most = useLookOverview().zoom || DEFAULT_OVERVIEW.zoom
  const root = useRef<HTMLDivElement>(null)
  const [screen, setScreen] = useState<Screen>()
  const picked = focused(workspaces)?.id
  const current = workspaces.list[workspaces.current]?.id
  const index = workspaces.current
  const progress = useRef(0)
  const motion = useRef<Moving | null>(null)
  // The normal stack's origin moves too: picking another workspace while
  // zooming must not move every screen by a whole height in one frame.
  const originAt = useRef(index)
  const origin = useRef<Moving | null>(null)
  /** Asks it to draw in the next tick, while it is drawn. */
  const drawAgain = useRef<(() => void) | undefined>(undefined)

  // The keys come here while it is open, not to a Pane under it.
  useEffect(() => {
    if (open) root.current?.focus()
  }, [open])
  // How big a screen is, from a Strip as drawn: every one is as big.
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => {
      const strip = document.querySelector<HTMLElement>("[data-strip]")
      if (!strip) return
      const { gap, pad } = room(strip)
      const outer = parseFloat(getComputedStyle(strip).paddingRight) || 0
      // As the window lays the Strips out: the overview pins each to it.
      const width =
        strip.closest("[data-stack]")?.parentElement?.clientWidth ??
        strip.clientWidth
      const own = room(element)
      const style = getComputedStyle(element)
      setScreen({
        from: pad - outer,
        width,
        inner: width - pad - outer,
        height: strip.clientHeight,
        gap,
        outer,
        room: {
          width: own.inner - NUMBER,
          height:
            element.clientHeight -
            (parseFloat(style.paddingTop) || 0) -
            (parseFloat(style.paddingBottom) || 0),
        },
        rem: remInPx(),
      })
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [])
  // Each workspace whole, and all of them in the room there is.
  const fitted = useMemo(() => {
    if (!screen) return undefined
    const widths = workspaces.list.map((workspace) => {
      const drawn = drawnColumns(workspace, look, screen)
      const columns = drawn.map((column) =>
        Math.max(
          (share(column.width) ?? 0.5) * (screen.inner + screen.gap) -
            screen.gap,
          Math.min(screen.inner, column.min * screen.rem)
        )
      )
      // A Group's ends stand out half a gap, as the Strip draws them.
      const pads = drawn.reduce((sum, { ends }) => {
        const { left, right } = padded(ends)
        return sum + (+left + +right) * (screen.gap / 2)
      }, 0)
      const across =
        columns.reduce((sum, width) => sum + width, 0) +
        screen.gap * Math.max(0, columns.length - 1) +
        pads
      // A workspace is never narrower than its screen.
      const whole = Math.max(across, screen.inner) + 2 * screen.outer
      return { columns, whole: columns.length ? whole : 0 }
    })
    const { zoom, rows, wide } = fit({
      widths: widths.map((one) => one.whole),
      screen: { width: screen.inner + 2 * screen.outer, height: screen.height },
      room: screen.room,
      most,
    })
    const each = new Map<string, Fitted>(
      workspaces.list.map((workspace, i) => [
        workspace.id,
        {
          zoom: rows[i],
          whole: widths[i].whole || screen.inner + 2 * screen.outer,
          wide: wide[i],
          columns: widths[i].columns,
        },
      ])
    )
    return { zoom, each }
  }, [workspaces, look, screen, most])
  const zoom = fitted?.zoom ?? 0
  // What the frames read of the fit: they run outside React's renders.
  const fits = useRef(fitted?.each)
  useLayoutEffect(() => {
    fits.current = fitted?.each
  })
  const order = workspaces.list.map((workspace) => workspace.id)
  const ids = order.join()
  useLayoutEffect(() => {
    if (!zoom) return
    if (!origin.current) {
      // A workspace switch may still be moving when the overview opens.
      const first = document.querySelector<HTMLElement>("[data-stack]")
      if (first?.offsetHeight)
        originAt.current =
          -new DOMMatrixReadOnly(getComputedStyle(first).transform).m42 /
          first.offsetHeight
      origin.current = new Moving(
        (value) => {
          originAt.current = value
        },
        () => originAt.current
      )
    }
    origin.current.to(index, moveOf("overview"))
  }, [index, zoom])
  useLayoutEffect(() => {
    const element = root.current
    if (!element || !zoom) return
    const backdrop = document.querySelector<HTMLElement>(
      "[data-overview-backdrop]"
    )
    motion.current ??= new Moving(
      (value) => {
        progress.current = value
        const amount = Math.max(0, Math.min(1, value))
        // The stationary hit tiles and controls appear near the resting
        // view, so they do not look like a second set of moving windows.
        const ui = Math.max(0, (amount - 0.8) / 0.2)
        element.style.opacity = String(ui * ui * (3 - 2 * ui))
        if (backdrop) backdrop.style.opacity = String(amount)
      },
      () => progress.current
    )
    const moving = motion.current
    moving.to(open ? 1 : 0, moveOf("overview"))
  }, [open, zoom])
  useEffect(
    () => () => {
      motion.current?.stop()
      origin.current?.stop()
    },
    []
  )
  // Closed, every Strip clips its screen again, scrolled where it was
  // headed, and its plate is the screen.
  useLayoutEffect(
    () => () => {
      for (const strip of document.querySelectorAll<HTMLElement>(
        "[data-strip]"
      )) {
        strip.style.overflow = ""
        strip.style.width = ""
        strip.style.transform = ""
        releaseScroll(strip)
        const stack = strip.closest<HTMLElement>("[data-stack]")
        if (!stack) continue
        stack.style.width = ""
        stack.style.backgroundImage = ""
      }
    },
    []
  )
  useLayoutEffect(() => {
    const element = root.current
    if (!element || !zoom || !screen) return
    const focusClip = document.querySelector<HTMLElement>(
      "[data-overview-focus-clip]"
    )
    const focusFrame = focusClip?.querySelector<HTMLElement>(
      "[data-overview-focus]"
    )
    const glass = document.querySelector("[data-glass]") !== null
    const all = [...element.querySelectorAll<HTMLElement>("[data-row]")]
      .map((row) => {
        const id = row.dataset.row ?? ""
        const place = row.closest("li")
        const track = place?.querySelector<HTMLElement>("[data-shown]")
        return { id, row, place, track, stack: stackOf(id), strip: stripOf(id) }
      })
      .flatMap(({ id, row, place, track, stack, strip }) =>
        stack && strip
          ? [
              {
                id,
                row,
                place,
                track,
                stack,
                strip,
                drawn: "",
                shown: "",
                up: false,
              },
            ]
          : []
      )
    const { from, width, height } = screen
    // The look's, which no move changes: read once.
    const stroke = focusFrame
      ? parseFloat(getComputedStyle(focusFrame).outlineWidth)
      : 0
    const step = () => {
      // Every read, then every write: the page lays out once.
      const over = element.getBoundingClientRect()
      // A Person's spring may overshoot; a miniature never flips or grows
      // past its normal size. Moving keeps its raw progress and velocity.
      const amount = Math.max(0, Math.min(1, progress.current))
      // A move can reparent the Pane without changing its ID: read the
      // current element, rather than keeping the old section in a cache.
      const selected = document.querySelector<HTMLElement>(
        '[data-stack] [data-column] section[data-tile][data-selected="true"]'
      )
      const owner = selected?.closest("[data-stack]")
      // A row that steps aside for a workspace carried moves by its CSS.
      const stepping = element
        .getAnimations({ subtree: true })
        .some((animation) => animation.playState === "running")
      const read = all.map(({ row, strip, stack }) => {
        // Before it stops clipping, while its scroll is still there.
        holdScroll(strip)
        const mine = stack === owner && selected
        return {
          box: row.getBoundingClientRect(),
          row: row.scrollLeft,
          scroll: scrolled(strip),
          pane: mine ? selected.getBoundingClientRect() : undefined,
          strip: mine ? strip.getBoundingClientRect() : undefined,
          // Until it first shows whole, a Strip still clips, scrolled.
          shift: mine ? strip.scrollLeft : 0,
          corner: mine
            ? parseFloat(getComputedStyle(stack).borderTopLeftRadius)
            : 0,
          radius: mine
            ? parseFloat(getComputedStyle(selected).borderTopLeftRadius)
            : 0,
          border: mine
            ? parseFloat(getComputedStyle(selected).borderTopWidth)
            : 0,
        }
      })
      if (focusClip) focusClip.style.visibility = "hidden"
      let drew = false
      all.forEach((one, i) => {
        const fitted = fits.current?.get(one.id)
        if (!fitted) return
        const { box, row, scroll } = read[i]
        const zoomed = fitted.zoom
        const scale = 1 + (zoomed - 1) * amount
        // One carried by its number draws over the others, its Panes too.
        const up = one.place?.hasAttribute("data-lifted") ?? false
        if (up !== one.up) {
          one.stack.style.zIndex = up ? "1" : ""
          one.up = up
        }
        // What shows of the Strip, from its screen to its row, in its own
        // pixels from its left: the screen shows past the sidebar, the
        // row from there on, as far as it is scrolled.
        const left =
          (scroll + from) * (1 - amount) + (from + row / zoomed) * amount
        const across =
          (width - from) * (1 - amount) + (box.width / zoomed) * amount
        // Where that stands: on the screen, then under its row.
        const x = from * (1 - amount) + (box.left - over.left) * amount
        const normal = (i - originAt.current) * over.height
        const y = normal + (box.top - over.top - normal) * amount
        const lit = (i === index ? LIT : glass ? GLASS : 0) * amount
        const drawn = `${x} ${y} ${scale} ${left} ${across} ${lit}`
        if (drawn !== one.drawn) {
          drew = true
          one.drawn = drawn
          // The Strip shows whole, as wide as ever; its plate clips it.
          one.strip.style.overflow = "visible"
          one.strip.style.width = `${width}px`
          one.strip.style.transform = `translateX(${-left}px)`
          one.stack.style.width = `${across}px`
          one.stack.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
          one.stack.style.backgroundImage = lit
            ? `linear-gradient(${tint(lit)}, ${tint(lit)})`
            : ""
        }
        // What the screen shows, on the line under a wide one.
        if (one.track) {
          const shown = `${(scroll / fitted.whole) * 100}% ${((width - from) / fitted.whole) * 100}%`
          if (shown !== one.shown) {
            one.shown = shown
            const [at, wide] = shown.split(" ")
            one.track.style.left = at
            one.track.style.width = wide
          }
        }
        // One frame follows the actual Pane, outside the scaled screens
        // and the fading overview UI. Fractional CSS outlines on a scaled
        // element round to whole pixels and would pulse while zooming.
        const { pane, strip, shift, corner, radius, border } = read[i]
        if (
          focusClip &&
          focusFrame &&
          pane &&
          strip &&
          pane.width &&
          pane.height
        ) {
          // The Pane in the Strip's own pixels, as wide as ever.
          const was = strip.width / width
          const paneLeft =
            ((pane.left - strip.left) / was + shift - left) * scale
          const paneTop = ((pane.top - strip.top) / was) * scale
          const paneWidth = (pane.width / was) * scale
          const paneHeight = (pane.height / was) * scale
          const clipWidth = across * scale
          const clipHeight = height * scale
          // Tuck the frame in smoothly if a configured outer ring would
          // leave the plate. Keep the stroke itself steady.
          const margin = Math.max(
            0,
            Math.min(
              paneLeft,
              paneTop,
              clipWidth - paneLeft - paneWidth,
              clipHeight - paneTop - paneHeight
            ) - 0.5
          )
          const tuck = Math.max(0, stroke - border - margin)
          focusClip.style.visibility = "visible"
          focusClip.style.transform = `translate(${x}px, ${y}px)`
          focusClip.style.width = `${clipWidth}px`
          focusClip.style.height = `${clipHeight}px`
          focusClip.style.borderRadius = `${corner * scale}px`
          focusFrame.style.transform = `translate(${paneLeft + tuck}px, ${paneTop + tuck}px)`
          focusFrame.style.width = `${Math.max(0, paneWidth - 2 * tuck)}px`
          focusFrame.style.height = `${Math.max(0, paneHeight - 2 * tuck)}px`
          focusFrame.style.borderRadius = `${Math.max(0, radius * scale - tuck)}px`
        }
      })
      // The Panes went with their workspaces: a browser's page follows.
      if (drew) moved()
      if (!open && progress.current === 0 && !origin.current?.moving) {
        drawing.stop()
        onExited()
        return
      }
      // A row stepping aside moves on no tick of the clock: it draws on
      // while one does.
      if (stepping) drawing.again()
    }
    // In every tick something moves in, as its own springs, a Strip's
    // scroll or a workspace carried by its number: after the moves, so it
    // reads where they put the Panes, and before a browser's page, which
    // follows where it puts them. Once landed, it waits (ADR 0088,
    // decision 3).
    const drawing = followMoves(step, { first: true })
    const again = () => drawing.again()
    step()
    const quietly = { capture: true, passive: true }
    element.addEventListener("scroll", again, quietly)
    element.addEventListener("transitionrun", again, quietly)
    drawAgain.current = again
    return () => {
      drawing.stop()
      element.removeEventListener("scroll", again, quietly)
      element.removeEventListener("transitionrun", again, quietly)
      drawAgain.current = undefined
    }
  }, [zoom, screen, ids, index, open, onExited])
  // What it draws from changes with each of its renders, as a column's
  // width: it draws again.
  useLayoutEffect(() => drawAgain.current?.())
  // The Pane picked, or its workspace, in view.
  useEffect(() => {
    const element = root.current
    const at =
      element?.querySelector(`[data-tile="${picked}"]`) ??
      element?.querySelector(`[data-row="${current}"]`)
    at?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [picked, current, zoom])

  // The mouse carries a Pane here as on a Strip.
  const carrying = useRef<Carrying>({ on: true, frame, go: onGo, ...ASIDE })
  useLayoutEffect(() => {
    carrying.current = {
      on: true,
      ringed: true,
      frame,
      go: onGo,
      ...refusing(workspaces, strict, projectOf),
      land: (hit, x, y, pane, group) => {
        const between = hit.closest<HTMLElement>("[data-between]")
        if (!between) {
          const row = hit.closest<HTMLElement>("[data-row]")
          return row?.dataset.row
            ? landIn(row, row.dataset.row, x, y, pane, group)
            : {}
        }
        // A Group goes to a workspace there is, not a new one.
        if (group !== undefined) return {}
        const index = Number(between.dataset.between)
        if (stays(workspaces, pane, index)) return {}
        const { left, right, top, bottom } = between.getBoundingClientRect()
        return {
          place: { to: "workspace", index },
          hint: lying((top + bottom) / 2, left, right),
        }
      },
      // Its top and bottom scroll it; else a workspace's sides, that one.
      scroll: (x, y) => {
        const element = root.current
        if (!element) return false
        const { top, height } = element.getBoundingClientRect()
        if (nudge(element, "scrollTop", pushed(y, top, height))) return true
        const row = document
          .elementFromPoint(x, y)
          ?.closest<HTMLElement>("[data-row]")
        if (!row) return false
        const { left, width } = row.getBoundingClientRect()
        return nudge(row, "scrollLeft", pushed(x, left, width))
      },
    }
  })
  useMoving(root, carrying)
  // A workspace's number carries it up or down.
  const list = useRef<HTMLOListElement>(null)
  const reorder = useReorder(list, root, order, (id, index) =>
    frame.arrange(workspaceTo(id, index))
  )

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const { key } = event
    const direction = ARROWS[key]
    if (key === "Escape" || key === "Enter") onClose()
    else if (direction) onArrow(direction)
    else return
    event.preventDefault()
  }

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Overview"
      aria-hidden={!open || undefined}
      inert={!open}
      data-overview-state={open ? "open" : "closing"}
      data-window-keys=""
      tabIndex={-1}
      className="absolute inset-0 z-10 overflow-y-auto px-6 pt-2 pb-6 pl-[calc(--spacing(6)+var(--sidebar-inset))] opacity-0 outline-none"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      {screen && fitted && zoom > 0 && (
        <ol ref={list} className="mx-auto flex w-fit flex-col">
          {workspaces.list.map((workspace, i) => {
            const row = fitted.each.get(workspace.id)
            if (!row) return null
            const shown = Math.min(screen.room.width, row.whole * row.zoom)
            return (
              <li
                key={workspace.id}
                className="group/place relative flex flex-col transition-transform ease-out data-held:transition-none data-lifted:z-1 motion-reduce:transition-none"
                style={{ transitionDuration: `${STEP_ASIDE}ms` }}
              >
                {/* Dropped here, a Pane makes a workspace of its own. */}
                <div
                  data-between={i}
                  style={{ marginLeft: NUMBER, height: ROW.between }}
                />
                <div className="flex" style={{ gap: NUMBER - LABEL }}>
                  <WorkspaceLabel
                    number={i + 1}
                    current={i === workspaces.current}
                    movable={i < workspaces.list.length - 1}
                    onGo={() => {
                      if (!reorder.clicked()) return
                      onGo(workspace.id)
                      onClose()
                    }}
                    onPointerDown={(event) => reorder.press(event, i)}
                    onPointerMove={reorder.drag}
                    onPointerUp={reorder.drop}
                    onPointerCancel={reorder.cancel}
                    onLostPointerCapture={reorder.cancel}
                  />
                  <div className="flex flex-col" style={{ width: shown }}>
                    <Row
                      workspace={workspace}
                      number={i + 1}
                      current={i === workspaces.current}
                      picked={picked}
                      look={look}
                      fit={row}
                      width={shown}
                      zoom={zoom}
                      screen={screen}
                      projectOf={projectOf}
                      shows={shows}
                      onClosePane={frame.close}
                      onCloseWorkspace={
                        // An emptied Project's workspace goes when the
                        // Person closes it (ADR 0102, decision 2).
                        workspace.columns.length === 0 &&
                        keepsPlace(workspace, gone, strict)
                          ? () =>
                              frame.run("workspace.close", {
                                workspace: workspace.id,
                              })
                          : undefined
                      }
                      onPick={(entry) => {
                        onPick(entry)
                        onClose()
                      }}
                      onGo={() => {
                        onGo(workspace.id)
                        onClose()
                      }}
                    />
                    {/* What its screen shows of a workspace wider than it. */}
                    {row.wide && (
                      <div
                        aria-hidden
                        className="relative flex items-end"
                        style={{ height: ROW.track }}
                      >
                        <div className="relative h-0.5 w-full rounded-full bg-overview-foreground/10">
                          <div
                            data-shown=""
                            className="absolute inset-y-0 rounded-full bg-overview-foreground/45"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/** A lit plate's tint, `percent` of the overview's foreground. */
function tint(percent: number): string {
  return `color-mix(in oklab, var(--overview-foreground) ${percent}%, transparent)`
}

/** One workspace, zoomed out: its columns as its Strip lays them out, all
 * of them, as wide as its row has room for. */
function Row({
  workspace,
  number,
  current,
  picked,
  look,
  fit,
  width,
  zoom,
  screen,
  projectOf,
  shows,
  onPick,
  onClosePane,
  onCloseWorkspace,
  onGo,
}: {
  workspace: Workspaces["list"][number]
  number: number
  current: boolean
  picked: string | undefined
  look: ReturnType<typeof useLookColumns>
  fit: Fitted
  /** How wide the row is: the whole workspace, or the room there is. */
  width: number
  /** The zoom of an empty one. */
  zoom: number
  screen: Screen
  projectOf: (project: ProjectId) => ProjectSummary | undefined
  shows: Shows
  onPick: (entry: string) => void
  /** Closes a Pane, as Alt+W does: a middle click on it, or its cross. */
  onClosePane: (entry: string) => void
  /** Closes the workspace, as a middle click on it or its cross does;
   * none where it cannot be closed. */
  onCloseWorkspace?: () => void
  onGo: () => void
}) {
  const closeTitle = useKeyLabel()("pane.close", "Close")
  const said = useSaid()
  const { called } = useShows(shows, workspace)
  const empty = workspace.columns.length === 0
  const scale = empty ? zoom : fit.zoom
  return (
    <div
      data-row={workspace.id}
      data-empty={empty || undefined}
      role="group"
      aria-label={`Workspace ${number}`}
      aria-current={current || undefined}
      // An empty one is a slim place to drop a Pane, not a whole screen.
      className="flex shrink-0 cursor-pointer gap-(--gap-inner) overflow-x-auto overflow-y-hidden rounded-(--overview-plate) [scrollbar-width:none] group-data-lifted/place:shadow-[0_12px_28px_rgb(0_0_0/0.4)] data-empty:relative data-empty:items-center data-empty:justify-center data-empty:bg-overview-foreground/4 data-empty:text-overview-foreground/40 data-empty:transition-colors data-empty:hover:bg-overview-foreground/8 motion-reduce:transition-none"
      style={
        {
          width,
          height: empty ? ROW.empty : screen.height * scale,
          padding: screen.outer * scale,
          "--gap-inner": `${screen.gap * scale}px`,
          "--overview-radius": `calc(var(--tile-radius) * ${scale})`,
          "--overview-plate": `calc(var(--window-radius) * ${scale})`,
        } as CSSProperties
      }
      onClick={(event) => {
        event.stopPropagation()
        onGo()
      }}
      onAuxClick={(event) => {
        if (event.button === 1) onCloseWorkspace?.()
      }}
    >
      {empty && (
        <PlusIcon aria-label="Empty: drop a Pane here" className="size-3.5" />
      )}
      {onCloseWorkspace && (
        <Cross
          label={`Close workspace ${number}`}
          title="Close the workspace"
          // In the middle by its margins, not a translate: a press sets
          // the button's own, and the cross would drop off the row under
          // the pointer, so the click went to the row.
          className="inset-y-0 my-auto group-hover/place:opacity-100"
          onClose={onCloseWorkspace}
        />
      )}
      {drawnColumns(workspace, look, undefined).map((column, c) => {
        return (
          <div
            key={column.id}
            data-column={column.id}
            {...groupAttributes(column.group, column.ends)}
            className="flex h-full shrink-0 flex-col gap-(--gap-inner)"
            style={{ width: (fit.columns[c] ?? 0) * scale }}
          >
            {column.entries.map((entry, e) => {
              const { title } = labelOf(entry.pane, said.get(entry.id))
              const project = projectLabel(projectOf(entry.project))
              const active = column.active === e
              const call = called(entry)
              return (
                <div
                  key={entry.id}
                  role="button"
                  data-tile={entry.id}
                  data-handle=""
                  data-called={call ? "" : undefined}
                  aria-label={`${title} in ${project}`}
                  aria-current={entry.id === picked || undefined}
                  hidden={column.decked && !active}
                  // Clear: the Pane itself shows under it, zoomed out.
                  className={cn(
                    "group/over relative min-h-0 rounded-(--overview-radius) inset-ring-(--overview-frame) transition-[background-color,box-shadow] duration-150 hover:bg-overview-foreground/5 data-lifted:bg-black/50 motion-reduce:transition-none",
                    entry.id !== picked &&
                      (call ? "inset-ring-2" : "hover:inset-ring-1")
                  )}
                  style={
                    {
                      flex: column.decked
                        ? "1 1 0"
                        : heightAt(column.heights[e]),
                      "--overview-frame": call
                        ? "var(--attention)"
                        : "color-mix(in oklab, var(--overview-foreground) 35%, transparent)",
                    } as CSSProperties
                  }
                  onClick={(event) => {
                    event.stopPropagation()
                    onPick(entry.id)
                  }}
                  // The Pane under it, or the tab of it under it.
                  onAuxClick={(event) => {
                    if (event.button !== 1) return
                    const tab = (event.target as Element).closest<HTMLElement>(
                      "[data-pane]"
                    )
                    onClosePane(tab?.dataset.pane ?? entry.id)
                  }}
                >
                  {/* For the mouse; the keys close a Pane with Alt+W. The
                      focus stays with the overview, which takes the keys. */}
                  <Cross
                    label={`Close ${title}`}
                    title={closeTitle}
                    className="top-1.5 group-hover/over:opacity-100"
                    onClose={() => onClosePane(entry.id)}
                  />
                  {/* What the Apps show of it at a size to read: how its
                      Thread is, and what it asks when it calls. With
                      nothing to show, no label. */}
                  <span className="pointer-events-none absolute top-1.5 left-1.5 z-1 flex max-w-[calc(100%-3rem)] items-center gap-1 rounded-control border border-overview-foreground/15 bg-popover px-1.5 py-0.5 text-xs text-popover-foreground shadow-sm empty:hidden">
                    <PaneSlot
                      project={entry.project}
                      pane={entry.pane}
                      at="overview"
                      calling={call !== undefined}
                    />
                  </span>
                  {/* Over the column's group bar, each tab of it: one
                      carries its Pane. */}
                  {column.decked && active && (
                    <div
                      data-handle=""
                      className="absolute inset-x-0 top-0 flex"
                      style={{
                        height: TABS.height * scale,
                        gap: TABS.gap * scale,
                      }}
                    >
                      {column.entries.map((tab) => (
                        <span
                          key={tab.id}
                          data-pane={tab.id}
                          className="min-w-0 flex-1"
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/** A cross that closes what it stands on, shown under the pointer. The
 * focus stays with the overview, which takes the keys. */
function Cross({
  label,
  title,
  className,
  onClose,
}: {
  label: string
  title: string
  /** Where it stands, and what hover shows it. */
  className: string
  onClose: () => void
}) {
  return (
    <Button
      variant="secondary"
      size="icon-xs"
      tabIndex={-1}
      aria-label={label}
      title={title}
      className={cn(
        "absolute right-1.5 z-1 rounded-control border border-overview-foreground/20 bg-popover text-popover-foreground opacity-0 shadow-sm transition-opacity duration-150 hover:bg-popover hover:text-destructive motion-reduce:transition-none [@media(hover:none)]:opacity-100",
        className
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
    >
      <XIcon />
    </Button>
  )
}

/** A workspace's number, bright on the one picked; `movable`, the number
 * carries it up or down, and a click goes there. */
function WorkspaceLabel({
  number,
  current,
  movable,
  onGo,
  ...pointer
}: {
  number: number
  current: boolean
  movable: boolean
  onGo: () => void
} & Pick<
  HTMLAttributes<HTMLElement>,
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onLostPointerCapture"
>) {
  const keyFor = useKeyLabel()
  const moves = [keyFor("workspace.move-up"), keyFor("workspace.move-down")]
    .filter(Boolean)
    .join(", ")
  const look = cn(
    "group/number shrink-0 self-start rounded-control pt-0.5 pb-1 text-center text-sm font-medium tabular-nums transition-colors duration-150 select-none motion-reduce:transition-none",
    current
      ? "text-overview-foreground"
      : "text-overview-foreground/50 group-hover/place:text-overview-foreground/80"
  )
  // The empty one at the bottom stays: it has no handle.
  if (!movable) {
    return (
      <span className={look} style={{ width: LABEL }}>
        {number}
      </span>
    )
  }
  return (
    <button
      type="button"
      // The focus stays with the overview, which takes the keys.
      tabIndex={-1}
      aria-label={`Move workspace ${number}`}
      title={moves ? `Drag to move (${moves})` : "Drag to move"}
      className={cn(
        look,
        "cursor-grab group-data-lifted/place:cursor-grabbing group-data-lifted/place:bg-overview-foreground/15 hover:bg-overview-foreground/10 active:cursor-grabbing"
      )}
      style={{ width: LABEL }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation()
        onGo()
      }}
      {...pointer}
    >
      <span className="block">{number}</span>
      <GripHorizontalIcon
        aria-hidden
        className="mx-auto size-3 opacity-0 group-hover/number:opacity-70 group-data-lifted/place:opacity-70 [@media(hover:none)]:opacity-70"
      />
    </button>
  )
}

/** Whether `pane`, dropped as a workspace of its own at `index`, would
 * stay as it is: it is one already, just above or below. */
function stays(workspaces: Workspaces, pane: string, index: number): boolean {
  const spot = find(workspaces, pane)
  if (!spot) return false
  const alone = workspaces.list[spot.workspace].columns.flatMap(
    (column) => column.entries
  )
  return (
    alone.length === 1 &&
    (index === spot.workspace || index === spot.workspace + 1)
  )
}
