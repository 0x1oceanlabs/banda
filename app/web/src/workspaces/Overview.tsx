import { cn } from "@banda/ui/lib/utils"
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
import { GripHorizontalIcon, SearchIcon, XIcon } from "lucide-react"
import { Button } from "@banda/ui/components/button"
import type { SpaceId } from "@banda/contract"
import { DEFAULT_OVERVIEW } from "@banda/contract/look"
import type { Label, Listed } from "@banda/ui/pane"
import type { Chime } from "@banda/ui/sound"
import { labelOf, useSaid } from "../registry"
import { workspaceTo } from "./arrange"
import { ThreadMark } from "../sidebar/Row"
import { moveOf, useLookColumns, useLookOverview } from "../look"
import { Moving } from "../motion"
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
import type { Frame } from "./PaneFrame"
import { STEP_ASIDE, useReorder } from "./reorder"
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

/** How tall an empty workspace is drawn, in pixels: a place to drop. */
const EMPTY = 40

/** The room beside a workspace, in pixels: its label, and a gap. */
const NUMBER = 48
/** Its label's width, in pixels: its number and its count. */
const LABEL = 40

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
 * a workspace, there. A workspace's number carries it, and its Panes,
 * up or down, the others stepping aside; the empty one at the bottom
 * stays. `Esc` puts one carried back, or goes back.
 *
 * What shows is the workspaces themselves, zoomed out over the desk's
 * theme or glass (ADR 0052): each stands under its row, so a Pane's tile here
 * lies over the Pane, and those take no clicks or keys while it is open.
 */
export function Overview({
  open,
  onExited,
  workspaces,
  spaceName,
  listed,
  called,
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
  spaceName: (space: SpaceId) => string
  /** The Thread a Pane shows, as its module lists it, if it shows one. */
  listed: (entry: Entry) => Listed | undefined
  /** How the Thread a Pane shows calls the Person, if it does. */
  called: (entry: Entry) => Chime | undefined
  frame: Pick<Frame, "arrange" | "focus" | "close">
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
  const current = workspaces.list[workspaces.current]?.id
  const index = workspaces.current
  const progress = useRef(0)
  const motion = useRef<Moving | null>(null)
  // The normal stack's origin moves too: picking another workspace while
  // zooming must not move every screen by a whole height in one frame.
  const originAt = useRef(index)
  const origin = useRef<Moving | null>(null)
  const found = useMemo(
    () => (query ? matching(workspaces, query, spaceName, said) : undefined),
    [workspaces, query, spaceName, said]
  )

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
        const opacity = String(Math.max(0, Math.min(1, value)))
        element.style.opacity = opacity
        if (backdrop) backdrop.style.opacity = opacity
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
  useLayoutEffect(() => {
    const element = root.current
    if (!element || !zoom) return
    const all = [...element.querySelectorAll<HTMLElement>("[data-row]")]
      .map((row) => {
        const id = row.dataset.row ?? ""
        const place = row.closest("li")
        return { row, place, stack: stackOf(id), strip: stripOf(id) }
      })
      .flatMap(({ row, place, stack, strip }) =>
        stack && strip
          ? [
              {
                row,
                place,
                stack,
                strip,
                x: NaN,
                y: NaN,
                scale: NaN,
                at: NaN,
                up: false,
              },
            ]
          : []
      )
    let frame = 0
    const step = () => {
      // Every read, then every write: the page lays out once.
      const over = element.getBoundingClientRect()
      // A Person's spring may overshoot; a miniature never flips or grows
      // past its normal size. Moving keeps its raw progress and velocity.
      const amount = Math.max(0, Math.min(1, progress.current))
      const scale = 1 + (zoom - 1) * amount
      const read = all.map(({ row, strip }) => ({
        box: row.getBoundingClientRect(),
        row: row.scrollLeft,
        strip: strip.scrollLeft,
      }))
      all.forEach((one, i) => {
        const { box, row, strip } = read[i]
        // One carried by its number draws over the others, its Panes too.
        const up = one.place?.hasAttribute("data-lifted") ?? false
        if (up !== one.up) {
          one.stack.style.zIndex = up ? "1" : ""
          one.up = up
        }
        const x = (box.left - over.left - from) * amount
        const normal = (i - originAt.current) * over.height
        const y = normal + (box.top - over.top - normal) * amount
        if (x !== one.x || y !== one.y || scale !== one.scale) {
          one.stack.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
          one.x = x
          one.y = y
          one.scale = scale
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
      if (!open && progress.current === 0 && !origin.current?.moving) {
        onExited()
        return
      }
      frame = requestAnimationFrame(step)
    }
    step()
    return () => cancelAnimationFrame(frame)
  }, [zoom, from, ids, open, onExited])
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
  // A workspace's number carries it up or down.
  const list = useRef<HTMLOListElement>(null)
  const reorder = useReorder(list, root, order, (id, index) =>
    frame.arrange(workspaceTo(id, index))
  )

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
      aria-hidden={!open || undefined}
      inert={!open}
      data-overview-state={open ? "open" : "closing"}
      data-window-keys=""
      tabIndex={-1}
      className="absolute inset-0 z-10 overflow-y-auto px-6 pb-6 pl-[calc(--spacing(6)+var(--sidebar-inset))] opacity-0 outline-none"
      style={
        {
          "--overview-radius": `calc(var(--tile-radius) * ${zoom})`,
        } as CSSProperties
      }
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <p
        role="status"
        className={cn(
          "sticky top-3 z-2 mx-auto mb-2 flex h-9 w-fit max-w-full items-center gap-2 rounded-lg border border-overview-foreground/15 bg-popover px-3 text-sm shadow-sm",
          found ? "text-popover-foreground" : "text-muted-foreground"
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <SearchIcon aria-hidden className="size-3.5 shrink-0 opacity-70" />
        <span className="truncate">
          {found
            ? found.length
              ? `“${query}”: ${panes(found.length)}`
              : `No Pane is called “${query}”`
            : "Type to find a Pane"}
        </span>
      </p>
      {screen && zoom > 0 && (
        <ol
          ref={list}
          className="mx-auto flex w-fit flex-col"
          style={{ "--gap-inner": `${screen.gap * zoom}px` } as CSSProperties}
        >
          {workspaces.list.map((workspace, i) => (
            <li
              key={workspace.id}
              className="group/place relative flex flex-col transition-transform ease-out data-held:transition-none data-lifted:z-1 motion-reduce:transition-none"
              style={{ transitionDuration: `${STEP_ASIDE}ms` }}
            >
              {/* Dropped here, a Pane makes a workspace of its own. */}
              <div
                data-between={i}
                className="h-4"
                style={{ marginLeft: NUMBER }}
              />
              <div className="flex" style={{ gap: NUMBER - LABEL }}>
                <WorkspaceLabel
                  workspace={workspace}
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
                <Row
                  workspace={workspace}
                  number={i + 1}
                  current={i === workspaces.current}
                  picked={picked}
                  look={look}
                  zoom={zoom}
                  screen={screen}
                  spaceName={spaceName}
                  listed={listed}
                  called={called}
                  dim={found ? (entry) => !shown.has(entry.id) : undefined}
                  onClosePane={frame.close}
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
  listed,
  called,
  dim,
  onPick,
  onClosePane,
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
  listed: (entry: Entry) => Listed | undefined
  called: (entry: Entry) => Chime | undefined
  dim: ((entry: Entry) => boolean) | undefined
  onPick: (entry: string) => void
  /** Closes a Pane, as Alt+W does: a middle click on it, or its cross. */
  onClosePane: (entry: string) => void
  onGo: () => void
}) {
  const said = useSaid()
  const empty = workspace.columns.length === 0
  return (
    <div
      data-row={workspace.id}
      data-empty={empty || undefined}
      role="group"
      aria-label={`Workspace ${number}`}
      aria-current={current || undefined}
      // An empty one is a slim place to drop a Pane, not a whole screen.
      className="flex shrink-0 cursor-pointer gap-(--gap-inner) overflow-x-auto overflow-y-hidden rounded-(--overview-radius) outline-1 outline-overview-foreground/15 transition-[outline-color,box-shadow] duration-150 [scrollbar-width:none] group-data-lifted/place:shadow-[0_12px_28px_rgb(0_0_0/0.4)] hover:outline-overview-foreground/35 aria-[current]:outline-overview-foreground/50 data-empty:items-center data-empty:justify-center data-empty:text-xs data-empty:text-overview-foreground/50 data-empty:outline-dashed motion-reduce:transition-none"
      style={{
        width: (screen.inner + 2 * screen.outer) * zoom,
        height: empty ? EMPTY : screen.height * zoom,
        padding: screen.outer * zoom,
      }}
      onClick={(event) => {
        event.stopPropagation()
        onGo()
      }}
    >
      {empty && "Empty: drop a Pane here"}
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
              const thread = listed(entry)
              const call = called(entry)
              return (
                <div
                  key={entry.id}
                  role="button"
                  data-tile={entry.id}
                  data-handle=""
                  data-dim={dim?.(entry) || undefined}
                  data-called={call ? "" : undefined}
                  aria-label={`${title} in ${space}`}
                  aria-current={entry.id === picked || undefined}
                  hidden={column.tabbed && !active}
                  // Clear: the Pane itself shows under it, zoomed out.
                  className="group/over relative min-h-0 rounded-(--overview-radius) inset-ring-(--overview-frame) transition-[background-color,box-shadow] duration-150 hover:bg-overview-foreground/5 hover:inset-ring-1 aria-[current]:inset-ring-2 data-called:inset-ring-2 data-lifted:bg-black/50 data-[dim]:bg-black/50 motion-reduce:transition-none"
                  style={
                    {
                      flex: column.tabbed
                        ? "1 1 0"
                        : heightAt(column.heights[e]),
                      "--overview-frame":
                        entry.id === picked
                          ? "var(--focus)"
                          : call
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
                  <Button
                    variant="secondary"
                    size="icon-xs"
                    tabIndex={-1}
                    aria-label={`Close ${title}`}
                    title="Close (Alt+W)"
                    className="absolute top-1.5 right-1.5 z-1 rounded-md border border-overview-foreground/20 bg-popover text-popover-foreground opacity-0 shadow-sm transition-opacity duration-150 group-hover/over:opacity-100 hover:bg-popover hover:text-destructive motion-reduce:transition-none [@media(hover:none)]:opacity-100"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation()
                      onClosePane(entry.id)
                    }}
                  >
                    <XIcon />
                  </Button>
                  {/* How its Thread is, at a size to read, and what it asks
                      when it calls. */}
                  {thread && (call || thread.mark !== "rest") && (
                    <span className="pointer-events-none absolute top-1.5 left-1.5 z-1 flex max-w-[calc(100%-3rem)] items-center gap-1 rounded-md border border-overview-foreground/15 bg-popover px-1.5 py-0.5 text-xs text-popover-foreground shadow-sm">
                      <ThreadMark listed={thread} className="size-3.5" />
                      {call && thread.calls && (
                        <span className="min-w-0 truncate">{thread.calls}</span>
                      )}
                    </span>
                  )}
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

/** A workspace's number, and how many Panes it holds; `movable`, the
 * number carries it up or down, and a click goes there. */
function WorkspaceLabel({
  workspace,
  number,
  current,
  movable,
  onGo,
  ...pointer
}: {
  workspace: Workspaces["list"][number]
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
  const count = workspace.columns.reduce(
    (n, column) => n + column.entries.length,
    0
  )
  const look = cn(
    "group/number shrink-0 self-start rounded-md pt-0.5 pb-1 text-center tabular-nums transition-colors duration-150 select-none motion-reduce:transition-none",
    current ? "text-overview-foreground" : "text-overview-foreground/60"
  )
  const said = (
    <>
      <span className="block text-sm font-medium">{number}</span>
      {count > 0 && (
        <span className="block text-[10px] opacity-70">{panes(count)}</span>
      )}
    </>
  )
  // The empty one at the bottom stays: it has no handle.
  if (!movable) {
    return (
      <span className={look} style={{ width: LABEL }}>
        {said}
      </span>
    )
  }
  return (
    <button
      type="button"
      // The focus stays with the overview, which takes the keys.
      tabIndex={-1}
      aria-label={`Move workspace ${number}`}
      title="Drag to move (Alt+Shift+PageUp/PageDown)"
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
      {said}
      <GripHorizontalIcon
        aria-hidden
        className="mx-auto size-3 opacity-0 group-hover/number:opacity-70 group-data-lifted/place:opacity-70 [@media(hover:none)]:opacity-70"
      />
    </button>
  )
}

/** "1 Pane", "3 Panes". */
function panes(n: number): string {
  return `${n} ${n === 1 ? "Pane" : "Panes"}`
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
