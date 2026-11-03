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
import type { Label } from "@banda/ui/pane"
import { labelOf, useSaid } from "../registry"
import { useLookColumns } from "../look"
import {
  drawnColumns,
  heightAt,
  minWidthOf,
  room,
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

/** The most the overview zooms the workspaces out to: half, as niri's. */
const ZOOM = 0.5

const ARROWS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
}

/** The room beside a workspace, in pixels: its number. */
const NUMBER = 32

/** The screen a workspace fills, as a Strip draws it: the room its
 * columns have, the gaps, and the room the overview has for it, in
 * pixels. */
type Screen = {
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
 * Strip is; each Pane by its icon, title and Space.
 *
 * The arrows pick a Pane, and up or down past a column's end go to the
 * workspace there; `Enter` goes to it. The window's keys work as ever:
 * `Alt+Shift+Arrows` move the Pane picked. Typing finds Panes by their
 * title or Space, and the arrows step through those. The mouse carries a
 * Pane as on a Strip, from anywhere on it: beside another, or between two
 * workspaces, where it makes a new one. A click on a Pane goes to it; on
 * a workspace, there. `Esc` goes back.
 *
 * It draws the layout, not the Panes' pictures.
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
      const { inner, gap } = room(strip)
      const outer = parseFloat(getComputedStyle(strip).paddingRight) || 0
      const own = room(element)
      setScreen({
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
    ? Math.min(ZOOM, screen.room / (screen.inner + 2 * screen.outer))
    : 0
  // Each workspace scrolled as its Strip is, once it is drawn.
  const scrolled = useRef(false)
  useLayoutEffect(() => {
    if (!zoom || scrolled.current) return
    scrolled.current = true
    for (const row of root.current?.querySelectorAll<HTMLElement>(
      "[data-row]"
    ) ?? []) {
      row.scrollLeft = (stripOf(row.dataset.row ?? "")?.scrollLeft ?? 0) * zoom
    }
  }, [zoom])
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
      className="absolute inset-0 z-10 overflow-y-auto bg-muted/80 px-6 pb-6 pl-[calc(--spacing(6)+var(--sidebar-inset))] backdrop-blur-sm outline-none"
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
                <span className="w-6 shrink-0 pt-0.5 text-center text-xs text-muted-foreground tabular-nums">
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
      className="flex shrink-0 cursor-pointer gap-(--gap-inner) overflow-x-auto overflow-y-hidden rounded-lg bg-background ring-1 ring-border [scrollbar-width:none] hover:ring-ring/60 aria-[current]:ring-2 aria-[current]:ring-ring"
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
      {workspace.columns.length === 0 && (
        <span className="m-auto text-xs text-muted-foreground">Empty</span>
      )}
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
              const { title, Icon } = labelOf(entry.pane, said.get(entry.id))
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
                  className="flex min-h-0 flex-col justify-center gap-1 overflow-hidden rounded-md border bg-muted/40 p-2 text-xs hover:border-ring/60 hover:bg-muted aria-[current]:border-focus aria-[current]:ring-1 aria-[current]:ring-focus data-[dim]:opacity-40"
                  style={{
                    flex: column.tabbed ? "1 1 0" : heightAt(column.heights[e]),
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onPick(entry.id)
                  }}
                >
                  {column.tabbed && active && (
                    <div data-handle="" className="flex min-w-0 gap-1">
                      {column.entries.map((tab, t) => (
                        <span
                          key={tab.id}
                          data-pane={tab.id}
                          className="min-w-0 truncate rounded-sm px-1 text-muted-foreground data-[active]:bg-muted data-[active]:text-foreground"
                          data-active={t === column.active || undefined}
                        >
                          {labelOf(tab.pane, said.get(tab.id)).title}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="flex min-w-0 items-center gap-1.5 font-medium">
                    {Icon && <Icon className="size-3.5 shrink-0" />}
                    <span className="truncate">{title}</span>
                  </span>
                  <span className="truncate text-muted-foreground">
                    {space}
                  </span>
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
