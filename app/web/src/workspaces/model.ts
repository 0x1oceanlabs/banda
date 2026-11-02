/**
 * The workspaces, as niri lays them out (ADR 0005, decisions 5 and 7).
 *
 * - The workspaces sit one under another; there is always one empty
 *   workspace at the bottom, and an empty one in the middle goes away once
 *   the Person leaves it.
 * - A workspace is a Strip: columns side by side that scroll sideways, each
 *   holding Panes one above another.
 * - A Pane belongs to a Space; one workspace can mix Panes of any Spaces.
 *
 * Every change is a pure function from one state to the next, so plain
 * tests cover the rules; the window only draws the state.
 */
import {
  type AgentId,
  type JsonValue,
  newId,
  type SpaceId,
} from "@banda/contract"
import {
  type Columns,
  DEFAULT_COLUMNS,
  type Display,
} from "@banda/contract/look"
import type { PaneState, Place } from "@banda/ui/pane"

/**
 * One Pane on a workspace: what it shows, the Space it belongs to, and
 * the Agent that opened it, if one did (ADR 0029).
 */
export type Entry = {
  id: string
  space: SpaceId
  pane: PaneState
  by?: AgentId
}

/**
 * A column's share of the screen's width, as a fraction such as `"1/3"`,
 * or `"1"`. Alt+Ctrl+Arrows step it through the look's presets.
 */
export type Width = string

/** What the look says of widths (`[columns]`): the steps, a new column's,
 * and a column's alone on its workspace. Banda's own till the look comes. */
export type Sizes = Pick<Columns, "presets" | "default" | "alone">
export const SIZES: Sizes = DEFAULT_COLUMNS

/** A width's share of the screen, more than 0 and at most 1; `undefined`
 * when it is no width. */
export function share(width: Width): number | undefined {
  const [top, bottom = "1"] = width.split("/")
  const value = Number(top) / Number(bottom)
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : undefined
}

/** Panes one above another, sharing the column's height. */
export type Column = {
  id: string
  entries: Entry[]
  /** The entry that has the focus when the column does. */
  active: number
  /**
   * The width the Person gave it. Left out, the look's: `alone` while it is
   * the only column on its workspace, `default` once another opens.
   */
  width?: Width
  /** It takes the whole screen over its width (`maximize`). */
  full?: true
  /** How it shows its Panes; left out, as the look's `display` says. */
  display?: Display
}

export type Workspace = {
  id: string
  columns: Column[]
  /** The column that has the focus. */
  focus: number
}

export type Workspaces = {
  /** From the top down; the last one is always empty. */
  list: Workspace[]
  /** The one on screen. */
  current: number
}

export type Direction = "left" | "right" | "up" | "down"

/** A start: one empty workspace. */
export function start(): Workspaces {
  return { list: [blank()], current: 0 }
}

function blank(): Workspace {
  return { id: newId(), columns: [], focus: 0 }
}

export function current(state: Workspaces): Workspace {
  return state.list[state.current]
}

/** The Pane that has the focus: the current workspace's. */
export function focused(state: Workspaces): Entry | undefined {
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  return column?.entries[column.active]
}

/** Every entry of every workspace, from the top down, left to right. */
export function entries(state: Workspaces): Entry[] {
  return state.list.flatMap((workspace) =>
    workspace.columns.flatMap((column) => column.entries)
  )
}

/** The width a column of `workspace` is drawn at. */
export function widthIn(
  workspace: Workspace,
  column: Column,
  sizes: Sizes = SIZES
): Width {
  if (column.full) return "1"
  if (column.width !== undefined) return column.width
  return workspace.columns.length === 1 ? sizes.alone : sizes.default
}

/** How a column shows its Panes: one above another, or as tabs. */
export function displayOf(
  column: Column,
  look: Pick<Columns, "display"> = DEFAULT_COLUMNS
): Display {
  return column.display ?? look.display
}

/** The entries of a column on screen: all, or in tabs the one shown. */
export function shownIn(
  column: Column,
  look: Pick<Columns, "display"> = DEFAULT_COLUMNS
): Entry[] {
  return displayOf(column, look) === "tabs"
    ? column.entries.slice(column.active, column.active + 1)
    : column.entries
}

/** The workspaces that hold Panes, and the current one: the bar's numbers. */
export function shown(state: Workspaces): number[] {
  return state.list.flatMap((workspace, i) =>
    workspace.columns.length > 0 || i === state.current ? [i] : []
  )
}

export type Spot = { workspace: number; column: number; entry: number }

/** Where an entry stands, by its ID. */
export function find(state: Workspaces, id: string): Spot | undefined {
  for (const [w, workspace] of state.list.entries()) {
    for (const [c, column] of workspace.columns.entries()) {
      const e = column.entries.findIndex((entry) => entry.id === id)
      if (e >= 0) return { workspace: w, column: c, entry: e }
    }
  }
  return undefined
}

/** Two entries show the same Pane when their Space, kind and args are. */
export function samePane(
  a: { space: SpaceId; pane: PaneState },
  b: { space: SpaceId; pane: PaneState }
): boolean {
  return (
    a.space === b.space &&
    a.pane.kind === b.pane.kind &&
    canonical(a.pane.args) === canonical(b.pane.args)
  )
}

function canonical(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

/** The Panes `before` shows and `after` does not: they left every workspace. */
export function left(before: Workspaces, after: Workspaces): Entry[] {
  const stays = entries(after)
  return entries(before).filter(
    (entry) => !stays.some((other) => samePane(entry, other))
  )
}

/** Puts the focus on an entry, and goes to its workspace. */
export function focusEntry(state: Workspaces, id: string): Workspaces {
  const spot = find(state, id)
  if (!spot) return state
  const workspace = state.list[spot.workspace]
  const column = workspace.columns[spot.column]
  if (
    state.current === spot.workspace &&
    workspace.focus === spot.column &&
    column.active === spot.entry
  ) {
    return normalize(state)
  }
  const list = replace(state.list, spot.workspace, {
    ...workspace,
    focus: spot.column,
    columns: replace(workspace.columns, spot.column, {
      ...column,
      active: spot.entry,
    }),
  })
  return normalize({ list, current: spot.workspace })
}

export type Opening = {
  /** The entry that opens it; the focused one when left out. */
  from?: string
  /** Where; see {@link Place}. Left out, the window picks. */
  place?: Place
  /** A new column's width; the look's when left out (`Column.width`). */
  width?: Width
  /** False leaves the focus where it is. */
  focus?: boolean
  /** A new tile even when one shows the same Pane: New Thread, New Pane,
   * as a browser's new window. */
  again?: true
}

/**
 * Shows a Pane of a Space and focuses it.
 *
 * - An entry already showing the same Pane gets the focus instead, on
 *   whichever workspace it is, unless it opens `again` or `here`.
 * - `here` replaces the opener's Pane; `below` adds it under the opener,
 *   in the same column; `right` adds a column right of the opener's.
 * - Left out, the Pane takes the place of the one of its kind that the
 *   opener's workspace shows, or adds a column on the right.
 * - With `focus: false` the focus goes back where it was.
 */
export function open(
  state: Workspaces,
  space: SpaceId,
  pane: PaneState,
  opening: Opening = {}
): Workspaces {
  const next = placed(state, space, pane, opening)
  const was = opening.focus === false && focused(state)
  return was ? focusEntry(next, was.id) : next
}

function placed(
  state: Workspaces,
  space: SpaceId,
  pane: PaneState,
  opening: Opening
): Workspaces {
  const place = opening.place
  const showing =
    !opening.again &&
    place !== "here" &&
    entries(state).find((entry) => samePane(entry, { space, pane }))
  if (showing)
    return opening.focus === false ? state : focusEntry(state, showing.id)

  const from = (opening.from && find(state, opening.from)) || focusedSpot(state)
  const w = from?.workspace ?? state.current
  const workspace = state.list[w]
  const entry: Entry = { id: newId(), space, pane }

  if (from && place === "here") {
    return showIn(state, from, entry)
  }
  if (from && place === "below") {
    const column = workspace.columns[from.column]
    const stacked = [...column.entries]
    stacked.splice(from.entry + 1, 0, entry)
    return focusEntry(
      setWorkspace(state, w, {
        ...workspace,
        columns: replace(workspace.columns, from.column, {
          ...column,
          entries: stacked,
        }),
      }),
      entry.id
    )
  }
  if (place === undefined) {
    const kin = workspace.columns
      .flatMap((column, c) =>
        column.entries.map((other, e) => ({ other, c, e }))
      )
      .find(({ other }) => other.pane.kind === pane.kind)
    if (kin) {
      return showIn(state, { workspace: w, column: kin.c, entry: kin.e }, entry)
    }
  }
  const column: Column = {
    id: newId(),
    entries: [entry],
    active: 0,
    width: opening.width,
  }
  const at = from ? from.column + 1 : workspace.columns.length
  const columns = [...workspace.columns]
  columns.splice(at, 0, column)
  return focusEntry(setWorkspace(state, w, { ...workspace, columns }), entry.id)
}

function focusedSpot(state: Workspaces): Spot | undefined {
  const entry = focused(state)
  return entry && find(state, entry.id)
}

/** Puts `entry` where the entry at `spot` was, and focuses it. */
function showIn(state: Workspaces, spot: Spot, entry: Entry): Workspaces {
  const workspace = state.list[spot.workspace]
  const column = workspace.columns[spot.column]
  return focusEntry(
    setWorkspace(state, spot.workspace, {
      ...workspace,
      columns: replace(workspace.columns, spot.column, {
        ...column,
        entries: replace(column.entries, spot.entry, entry),
      }),
    }),
    entry.id
  )
}

/**
 * Shows a Pane on this workspace, as `opening` says: one another workspace
 * shows moves here, and one this workspace shows gets the focus (the
 * Banda menu's Shift+Enter, ADR 0017).
 */
export function bring(
  state: Workspaces,
  space: SpaceId,
  pane: PaneState,
  opening: Opening = {}
): Workspaces {
  const away = entries(state).find(
    (entry) =>
      samePane(entry, { space, pane }) &&
      find(state, entry.id)?.workspace !== state.current
  )
  return away
    ? normalize(open(remove(state, away.id), space, pane, opening))
    : open(state, space, pane, opening)
}

/**
 * Closes an entry. Its column goes when it was the last there, and the
 * focus moves to the neighbour that took its place.
 */
export function close(state: Workspaces, id: string): Workspaces {
  return normalize(remove(state, id))
}

/** Takes an entry out, as `close` does, but keeps every workspace. */
function remove(state: Workspaces, id: string): Workspaces {
  const spot = find(state, id)
  if (!spot) return state
  const workspace = state.list[spot.workspace]
  const column = workspace.columns[spot.column]
  const rest = column.entries.filter((entry) => entry.id !== id)
  const columns =
    rest.length === 0
      ? workspace.columns.filter((_, c) => c !== spot.column)
      : replace(workspace.columns, spot.column, {
          ...column,
          entries: rest,
          active: Math.min(
            column.active > spot.entry ? column.active - 1 : column.active,
            rest.length - 1
          ),
        })
  const focus =
    rest.length === 0 && workspace.focus >= spot.column
      ? Math.max(0, workspace.focus - 1)
      : workspace.focus
  return setWorkspace(state, spot.workspace, {
    ...workspace,
    columns,
    focus: Math.min(focus, Math.max(0, columns.length - 1)),
  })
}

/** Moves the focus: sideways between columns, up and down in a column. */
export function move(state: Workspaces, direction: Direction): Workspaces {
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  if (!column) return state
  if (direction === "left" || direction === "right") {
    const focus = clamp(
      workspace.focus + (direction === "right" ? 1 : -1),
      workspace.columns.length
    )
    if (focus === workspace.focus) return state
    return setWorkspace(state, state.current, { ...workspace, focus })
  }
  const active = clamp(
    column.active + (direction === "down" ? 1 : -1),
    column.entries.length
  )
  if (active === column.active) return state
  return setWorkspace(state, state.current, {
    ...workspace,
    columns: replace(workspace.columns, workspace.focus, { ...column, active }),
  })
}

/**
 * Moves the focused Pane: sideways, its whole column swaps with the next;
 * up and down, the Pane swaps with the next in its column.
 */
export function shift(state: Workspaces, direction: Direction): Workspaces {
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  if (!column) return state
  if (direction === "left" || direction === "right") {
    const to = workspace.focus + (direction === "right" ? 1 : -1)
    if (to < 0 || to >= workspace.columns.length) return state
    return setWorkspace(state, state.current, {
      ...workspace,
      columns: swap(workspace.columns, workspace.focus, to),
      focus: to,
    })
  }
  const to = column.active + (direction === "down" ? 1 : -1)
  if (to < 0 || to >= column.entries.length) return state
  return setWorkspace(state, state.current, {
    ...workspace,
    columns: replace(workspace.columns, workspace.focus, {
      ...column,
      entries: swap(column.entries, column.active, to),
      active: to,
    }),
  })
}

const EPSILON = 1e-6

function alike(a: number, b: number | undefined): boolean {
  return b !== undefined && Math.abs(a - b) < EPSILON
}

/** The share a column of share `at` is drawn at: at least `floor`, the
 * share its `min` asks for, and at most the whole room. */
export function drawn(at: number, floor: number): number {
  return Math.min(1, Math.max(at, floor))
}

/**
 * Steps the focused column's width to the next of `presets`, wider or
 * narrower, as niri does: from whatever width it has, the nearest preset
 * past it. It steps by the width the column is drawn at: in a window where
 * `floor` (the share the column is never drawn narrower than) makes two
 * presets look the same, it goes past both, and where no step shows, it
 * stays. With `wrap`, past the widest it goes to the narrowest, and back,
 * as niri's Mod+R does.
 */
export function widen(
  state: Workspaces,
  by: 1 | -1,
  sizes: Sizes = SIZES,
  { floor = 0, wrap = false }: { floor?: number; wrap?: boolean } = {}
): Workspaces {
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  if (!column) return state
  const now = drawn(share(widthIn(workspace, column, sizes)) ?? 0.5, floor)
  // Of the presets drawn alike, the widest stands for them all.
  const steps = sizes.presets
    .flatMap((width) => {
      const at = share(width)
      return at === undefined ? [] : [{ width, at, shows: drawn(at, floor) }]
    })
    .sort((a, b) => a.at - b.at)
    .filter((step, i, all) => !alike(step.shows, all[i + 1]?.shows))
  let next =
    by > 0
      ? steps.find((step) => step.shows > now + EPSILON)
      : steps.findLast((step) => step.shows < now - EPSILON)
  if (!next && wrap) next = by > 0 ? steps[0] : steps.at(-1)
  if (!next || alike(next.shows, now)) return state
  return withFocused(state, { ...column, width: next.width, full: undefined })
}

/**
 * Makes the focused column the whole screen wide, or gives it back its
 * width, as niri's maximize-column does.
 */
export function maximize(state: Workspaces): Workspaces {
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  if (!column) return state
  return withFocused(state, { ...column, full: column.full ? undefined : true })
}

/** Puts `column` in the place of the focused one. */
function withFocused(state: Workspaces, column: Column): Workspaces {
  const workspace = current(state)
  return setWorkspace(state, state.current, {
    ...workspace,
    columns: replace(workspace.columns, workspace.focus, column),
  })
}

/**
 * Shows the focused column's Panes as tabs, or one above another again, as
 * niri's toggle-column-tabbed-display and Hyprland's togglegroup.
 */
export function tabs(
  state: Workspaces,
  look: Pick<Columns, "display"> = DEFAULT_COLUMNS
): Workspaces {
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  if (!column) return state
  const display = displayOf(column, look) === "tabs" ? "stack" : "tabs"
  return withFocused(state, { ...column, display })
}

/**
 * Takes the focused Pane into the column on that side, as its last; one
 * that shares its column goes out to a column of its own there instead,
 * as niri's consume-or-expel-window-left and right.
 */
export function consume(state: Workspaces, side: "left" | "right"): Workspaces {
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  const entry = column?.entries[column.active]
  if (!entry) return state
  const columns = [...workspace.columns]
  if (column.entries.length > 1) {
    const rest = column.entries.filter((other) => other !== entry)
    columns[workspace.focus] = {
      ...column,
      entries: rest,
      active: Math.min(column.active, rest.length - 1),
    }
    const at = side === "right" ? workspace.focus + 1 : workspace.focus
    columns.splice(at, 0, { id: newId(), entries: [entry], active: 0 })
  } else {
    const to = workspace.focus + (side === "right" ? 1 : -1)
    const target = columns[to]
    if (!target) return state
    columns[to] = { ...target, entries: [...target.entries, entry] }
    columns.splice(workspace.focus, 1)
  }
  return focusEntry(
    setWorkspace(state, state.current, { ...workspace, columns }),
    entry.id
  )
}

/** Goes to a workspace by its place from the top; past the last, to the last. */
export function go(state: Workspaces, index: number): Workspaces {
  const to = clamp(index, state.list.length)
  if (to === state.current) return state
  return normalize({ ...state, current: to })
}

/** Goes to the empty workspace at the bottom: a new one, as the bar's
 * `+` makes. */
export function fresh(state: Workspaces): Workspaces {
  return go(state, state.list.length - 1)
}

/** Whether the workspace on screen is the empty one at the bottom, so
 * there is no newer one to go to. */
export function onFresh(state: Workspaces): boolean {
  return state.current === state.list.length - 1
}

/** Goes to the workspace above or below. */
export function step(state: Workspaces, by: 1 | -1): Workspaces {
  return go(state, state.current + by)
}

/**
 * Sends the focused Pane to a workspace, as a column on its right, and
 * follows it there. Past the last, it goes to the empty one at the bottom.
 */
export function send(state: Workspaces, index: number): Workspaces {
  const entry = focused(state)
  const to = clamp(index, state.list.length)
  if (!entry || to === state.current) return state
  const target = state.list[to]
  const width = current(state).columns[current(state).focus]?.width
  const moved: Column = { id: newId(), entries: [entry], active: 0, width }
  const without = remove(state, entry.id)
  return focusEntry(
    setWorkspace(without, to, {
      ...target,
      columns: [...target.columns, moved],
    }),
    entry.id
  )
}

/**
 * Keeps the rules of the list: empty workspaces go, except the current one
 * and the one at the bottom, which is always there and always empty.
 */
export function normalize(state: Workspaces): Workspaces {
  const now = state.list[state.current]
  let list = state.list.filter(
    (workspace) => workspace.columns.length > 0 || workspace === now
  )
  const last = list[list.length - 1]
  if (!last || last.columns.length > 0) {
    // The spare at the bottom stays the same one, so it keeps its place.
    const spare = state.list[state.list.length - 1]
    list = [...list, spare && spare.columns.length === 0 ? spare : blank()]
  }
  const at = list.indexOf(now)
  const next = { list, current: at >= 0 ? at : list.length - 1 }
  return same(state, next) ? state : next
}

function same(a: Workspaces, b: Workspaces): boolean {
  return (
    a.current === b.current &&
    a.list.length === b.list.length &&
    a.list.every((workspace, i) => workspace === b.list[i])
  )
}

function setWorkspace(
  state: Workspaces,
  index: number,
  workspace: Workspace
): Workspaces {
  return { ...state, list: replace(state.list, index, workspace) }
}

function replace<T>(list: readonly T[], index: number, item: T): T[] {
  return list.map((old, i) => (i === index ? item : old))
}

function swap<T>(list: readonly T[], a: number, b: number): T[] {
  const copy = [...list]
  ;[copy[a], copy[b]] = [copy[b], copy[a]]
  return copy
}

export function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(index, length - 1))
}

/** The workspaces kept from before, or null when they are not workspaces. */
export function parse(value: unknown): Workspaces | null {
  if (!isObject(value) || !Array.isArray(value.list)) return null
  if (typeof value.current !== "number") return null
  const list: Workspace[] = []
  for (const workspace of value.list) {
    if (!isObject(workspace) || typeof workspace.id !== "string") return null
    if (!Array.isArray(workspace.columns)) return null
    const columns: Column[] = []
    for (const column of workspace.columns) {
      if (!isObject(column) || typeof column.id !== "string") return null
      if (!Array.isArray(column.entries) || column.entries.length === 0)
        return null
      const kept = column.entries.filter(isEntry)
      if (kept.length !== column.entries.length) return null
      const width = isWidth(column.width) ? column.width : undefined
      const full = column.full === true || undefined
      const display = isDisplay(column.display) ? column.display : undefined
      const active =
        typeof column.active === "number"
          ? clamp(column.active, kept.length)
          : 0
      columns.push({
        id: column.id,
        entries: kept,
        active,
        width,
        full,
        display,
      })
    }
    const focus =
      typeof workspace.focus === "number"
        ? clamp(workspace.focus, Math.max(1, columns.length))
        : 0
    list.push({ id: workspace.id, columns, focus })
  }
  if (list.length === 0) return null
  return normalize({ list, current: clamp(value.current, list.length) })
}

function isDisplay(value: unknown): value is Display {
  return value === "stack" || value === "tabs"
}

function isWidth(value: unknown): value is Width {
  return typeof value === "string" && share(value) !== undefined
}

function isEntry(value: unknown): value is Entry {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.space === "string" &&
    isObject(value.pane) &&
    typeof value.pane.kind === "string" &&
    isObject(value.pane.args)
  )
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
