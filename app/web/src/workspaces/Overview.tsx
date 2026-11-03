import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { SpaceId } from "@banda/contract"
import { DEFAULT_OVERVIEW } from "@banda/contract/look"
import type { Label } from "@banda/ui/pane"
import { labelOf, useSaid } from "../registry"
import { useLookColumns, useLookOverview } from "../look"
import {
  drawnColumns,
  heightAt,
  minWidthOf,
  room,
  scrollOf,
  stackOf,
  stripOf,
  widthAt,
} from "./layout"
import {
  type Direction,
  type Entry,
  entries,
  find,
  focused,
  share,
  type Workspaces,
} from "./model"
import { lying, nudge, pushed } from "./moving"
import { type Carrying, landIn, useMoving } from "./useMoving"

/** Where a Pane lands before the overview is drawn: nowhere. */
const ASIDE = { land: () => ({}), scroll: () => false }

const ARROWS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
}

/** A tabbed column's group bar, as `Tabs` draws it (`h-6 gap-1`): its
 * height, and the gap between its segments, in rem. */
const TABS = { height: 1.5, gap: 0.25 }

/** The room beside a workspace, in pixels: its number. */
const NUMBER = 32

/** The screen a workspace fills, as a Strip draws it: the room its
 * columns have, the gaps, and the room the overview has for it, in
 * pixels. */
type Screen = {
  /** How far in from the Strip's left the screen shows: past the sidebar. */
  from: number
  inner: number
  height: number
  gap: number
  outer: number
  room: number
}

/**
 * Every workspace zoomed out, one under another, as niri's overview
 * (ADR 0025, decision 7): each a small copy of the screen, its columns
 * as wide as the Strip draws them, with `[columns] min`, scrolled as the
 * Strip is.
 *
 * The arrows pick a Pane, and up or down past a column's end go to the
 * workspace there; `Enter` goes to it. The window's keys work as ever:
 * `Alt+Shift+Arrows` move the Pane picked. Typing finds Panes by their
 * title or Space, and the arrows step through those. The mouse carries a
 * Pane as on a Strip, from anywhere on it: beside another, or between two
 * workspaces, where it makes a new one. A click on a Pane goes to it; on
 * a workspace, there. `Esc` goes back.
 *
 * What shows is the workspaces themselves, zoomed out under it over a dark
 * backdrop, as niri's: each stands under its row, so a Pane's tile here
 * lies over the Pane, and those take no clicks or keys while it is open.
 */
export function Overview({
  workspaces,
  spaceName,
  frame,
  onPick,
  onArrow,
  onGo,
  onClose,
}: {
  workspaces: Workspaces
  spaceName: (space: SpaceId) => string
  frame: Carrying["frame"]
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
  const [query, setQuery] = useState("")
  const said = useSaid()
  const picked = focused(workspaces)?.id
  const found = useMemo(
    () => (query ? matching(workspaces, query, spaceName, said) : undefined),
    [workspaces, query, spaceName, said]
  )

  // The keys come here while it is open, not to a Pane under it.
  useEffect(() => root.current?.focus(), [])
  // How big a screen is, from a Strip as drawn: every one is as big.
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => {
      const strip = document.querySelector<HTMLElement>("[data-strip]")
      if (!strip) return
      const { inner, gap, pad } = room(strip)
      const outer = parseFloat(getComputedStyle(strip).paddingRight) || 0
      const own = room(element)
      setScreen({
        from: pad - outer,
        inner,
        height: strip.clientHeight,
        gap,
        outer,
        room: own.inner - NUMBER,
      })
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [])
  const zoom = screen
    ? Math.min(most, screen.room / (screen.inner + 2 * screen.outer))
    : 0
  // The workspaces themselves, zoomed out under their rows: each stands
  // where its row is, and its Strip scrolls as the row does, or the row as
  // the Strip, whichever moved, so what shows is the Panes as they are.
  const from = (screen?.from ?? 0) * zoom
  const ids = workspaces.list.map((workspace) => workspace.id).join()
  useLayoutEffect(() => {
    const element = root.current
    if (!element || !zoom) return
    const all = [...element.querySelectorAll<HTMLElement>("[data-row]")]
      .map((row) => {
        const id = row.dataset.row ?? ""
        return { row, stack: stackOf(id), strip: stripOf(id) }
      })
      .flatMap(({ row, stack, strip }) =>
        stack && strip ? [{ row, stack, strip, x: NaN, y: NaN, at: NaN }] : []
      )
    let frame = 0
    const step = () => {
      // Every read, then every write: the page lays out once.
      const over = element.getBoundingClientRect()
      const read = all.map(({ row, strip }) => ({
        box: row.getBoundingClientRect(),
        row: row.scrollLeft,
        strip: strip.scrollLeft,
      }))
      all.forEach((one, i) => {
        const { box, row, strip } = read[i]
        const x = box.left - over.left - from
        const y = box.top - over.top
        if (x !== one.x || y !== one.y) {
          one.stack.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`
          one.x = x
          one.y = y
        }
        if (!Number.isNaN(one.at) && row !== one.at) {
          // The Person scrolled the row: the Strip goes with it.
          scrollOf(one.strip).stop()
          one.strip.scrollLeft = row / zoom
          one.at = row
        } else if (Number.isNaN(one.at) || Math.abs(strip * zoom - row) >= 1) {
          // The row as its Strip, as the browser rounds it.
          one.row.scrollLeft = strip * zoom
          one.at = one.row.scrollLeft
        }
      })
      frame = requestAnimationFrame(step)
    }
    step()
    return () => cancelAnimationFrame(frame)
  }, [zoom, from, ids])
  // The Pane picked, or its workspace, in view.
  const current = workspaces.list[workspaces.current]?.id
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
      dark: true,
      frame,
      go: onGo,
      land: (hit, x, y, pane) => {
        const between = hit.closest<HTMLElement>("[data-between]")
        if (!between) {
          const row = hit.closest<HTMLElement>("[data-row]")
          return row?.dataset.row
            ? landIn(row, row.dataset.row, x, y, pane)
            : {}
        }
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

  const type = (next: string) => {
    setQuery(next)
    const first = next
      ? matching(workspaces, next, spaceName, said)[0]
      : undefined
    if (first) onPick(first.id)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const { key } = event
    const direction = ARROWS[key]
    if (key === "Escape") {
      if (query) setQuery("")
      else onClose()
    } else if (key === "Enter") {
      onClose()
    } else if (direction && found) {
      // Through what was found, in order, around.
      const at = found.findIndex((entry) => entry.id === picked)
      const by = direction === "left" || direction === "up" ? -1 : 1
      const next = found.at((at + by) % found.length)
      if (next) onPick(next.id)
    } else if (direction) {
      onArrow(direction)
    } else if (key === "Backspace") {
      type(query.slice(0, -1))
    } else if (key.length === 1 && (key !== " " || query)) {
      type(query + key)
    } else {
      return
    }
    event.preventDefault()
  }

  const shown = new Set(found?.map((entry) => entry.id))
  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Overview"
      data-window-keys=""
      tabIndex={-1}
      className="absolute inset-0 z-10 overflow-y-auto px-6 pb-6 pl-[calc(--spacing(6)+var(--sidebar-inset))] outline-none"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <p
        role="status"
        className="sticky top-2 z-1 mx-auto mb-2 h-7 w-fit rounded-full border bg-popover px-3 py-1 text-sm text-popover-foreground shadow-sm empty:invisible"
      >
        {found &&
          (found.length
            ? `“${query}”: ${found.length} ${found.length === 1 ? "Pane" : "Panes"}`
            : `No Pane is called “${query}”`)}
      </p>
      {screen && zoom > 0 && (
        <ol
          className="mx-auto flex w-fit flex-col"
          style={{ "--gap-inner": `${screen.gap * zoom}px` } as CSSProperties}
        >
          {workspaces.list.map((workspace, i) => (
            <li key={workspace.id} className="flex flex-col">
              {/* Dropped here, a Pane makes a workspace of its own. */}
              <div data-between={i} className="ml-8 h-4" />
              <div className="flex gap-2">
                <span className="w-6 shrink-0 pt-0.5 text-center text-xs text-overview-foreground/60 tabular-nums">
                  {i + 1}
                </span>
                <Row
                  workspace={workspace}
                  number={i + 1}
                  current={i === workspaces.current}
                  picked={picked}
                  look={look}
                  zoom={zoom}
                  screen={screen}
                  spaceName={spaceName}
                  dim={found ? (entry) => !shown.has(entry.id) : undefined}
                  onPick={(entry) => {
                    onPick(entry)
                    onClose()
                  }}
                  onGo={() => {
                    onGo(workspace.id)
                    onClose()
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** One workspace, zoomed out: its columns as its Strip lays them out. */
function Row({
  workspace,
  number,
  current,
  picked,
  look,
  zoom,
  screen,
  spaceName,
  dim,
  onPick,
  onGo,
}: {
  workspace: Workspaces["list"][number]
  number: number
  current: boolean
  picked: string | undefined
  look: ReturnType<typeof useLookColumns>
  zoom: number
  screen: Screen
  spaceName: (space: SpaceId) => string
  dim: ((entry: Entry) => boolean) | undefined
  onPick: (entry: string) => void
  onGo: () => void
}) {
  const said = useSaid()
  return (
    <div
      data-row={workspace.id}
      role="group"
      aria-label={`Workspace ${number}`}
      aria-current={current || undefined}
      className="flex shrink-0 cursor-pointer gap-(--gap-inner) overflow-x-auto overflow-y-hidden rounded-lg ring-1 ring-overview-foreground/10 [scrollbar-width:none] hover:ring-overview-foreground/30 aria-[current]:ring-2 aria-[current]:ring-overview-foreground/70"
      style={{
        width: (screen.inner + 2 * screen.outer) * zoom,
        height: screen.height * zoom,
        padding: screen.outer * zoom,
      }}
      onClick={(event) => {
        event.stopPropagation()
        onGo()
      }}
    >
      {drawnColumns(workspace, look).map((column) => {
        return (
          <div
            key={column.id}
            data-column={column.id}
            className="flex h-full shrink-0 flex-col gap-(--gap-inner)"
            style={{
              width: widthAt(share(column.width) ?? 0.5),
              minWidth: minWidthOf(column.min * zoom),
            }}
          >
            {column.entries.map((entry, e) => {
              const { title } = labelOf(entry.pane, said.get(entry.id))
              const space = spaceName(entry.space)
              const active = column.active === e
              return (
                <div
                  key={entry.id}
                  role="button"
                  data-tile={entry.id}
                  data-handle=""
                  data-dim={dim?.(entry) || undefined}
                  aria-label={`${title} in ${space}`}
                  aria-current={entry.id === picked || undefined}
                  hidden={column.tabbed && !active}
                  // Clear: the Pane itself shows under it, zoomed out.
                  className="relative min-h-0 rounded-tile hover:bg-black/5 aria-[current]:ring-2 aria-[current]:ring-focus data-lifted:bg-overview/60 data-[dim]:bg-black/50"
                  style={{
                    flex: column.tabbed ? "1 1 0" : heightAt(column.heights[e]),
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onPick(entry.id)
                  }}
                >
                  {/* Over the column's group bar, each tab of it: one
                      carries its Pane. */}
                  {column.tabbed && active && (
                    <div
                      data-handle=""
                      className="absolute inset-x-0 top-0 flex"
                      style={{
                        height: TABS.height * zoom,
                        gap: TABS.gap * zoom,
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

/** The Panes whose title or Space has `query` in it, from the top down. */
function matching(
  workspaces: Workspaces,
  query: string,
  spaceName: (space: SpaceId) => string,
  said: ReadonlyMap<string, Label>
): Entry[] {
  const words = query.toLowerCase()
  return entries(workspaces).filter((entry) =>
    [
      labelOf(entry.pane, said.get(entry.id)).title,
      spaceName(entry.space),
    ].some((text) => text.toLowerCase().includes(words))
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
