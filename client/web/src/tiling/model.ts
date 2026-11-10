/**
 * The workspaces, as niri lays them out (ADR 0005, decisions 5 and 7).
 *
 * - The workspaces sit one under another; there is always one empty
 *   workspace at the bottom, and an empty one in the middle goes away once
 *   the Person leaves it, but a Project's, which the engine keeps while the
 *   Project has Threads (ADR 0102, decision 2).
 * - A workspace is a Strip: columns side by side that scroll sideways, each
 *   holding Panes one above another.
 * - A Pane belongs to a Project; one workspace can mix Panes of any Projects.
 *
 * Every change is a pure function from one state to the next, so plain
 * tests cover the rules; the window only draws the state.
 */
import {
  type AgentId,
  type JsonValue,
  newId,
  type ProjectId,
  type ProjectSummary,
} from "@banda/contract"
import {
  type Columns,
  DEFAULT_COLUMNS,
  type Display,
} from "@banda/contract/look"
import type { PaneState, Place } from "@banda/ui/pane"

/**
 * One Pane on a workspace: what it shows, the Project it belongs to, the
 * Agent that opened it, if one did (ADR 0032), and the share of its
 * column's height the Person gave it (ADR 0025, decision 4).
 */
export type Entry = {
  id: string
  project: ProjectId
  pane: PaneState
  by?: AgentId
  /** Left out, it shares evenly what the Panes given one leave. */
  height?: Width
}

/**
 * A column's share of the screen's width, as a fraction such as `"1/3"`,
 * or `"1"`. Alt+Ctrl+Arrows step it through the look's presets.
 */
export type Width = string

/** What the look says of widths (`[columns]`): the steps, a new column's,
 * and a column's alone on its workspace. Banda's own till the look comes. */
export type Sizes = Pick<Columns, "presets" | "default" | "alone">
/** What the look says of heights: the steps, and how a column shows. */
export type Heights = Pick<Columns, "heights" | "display">
export const SIZES: Sizes = DEFAULT_COLUMNS

/** A width's share of the screen, more than 0 and at most 1; `undefined`
 * when it is no width. */
export function share(width: Width): number | undefined {
  const [top, bottom = "1"] = width.split("/")
  const value = Number(top) / Number(bottom)
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : undefined
}

/** A share as a width the engine keeps: three places are finer than a
 * pixel on any screen. */
export function free(at: number): Width {
  return String(Math.round(at * 1000) / 1000)
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
  /** The Group it is in, with the columns beside it that name it too
   * (ADR 0065). */
  group?: string
}

export type Workspace = {
  id: string
  columns: Column[]
  /** The column that has the focus. */
  focus: number
  /** The Group that takes the whole screen, its columns keeping their
   * shares of it (`Alt+M`, ADR 0065). */
  filled?: string
  /** Solo (ADR 0079, decision 2; ADR 0102, decision 8): every Group here,
   * and every column in none, is drawn the whole screen wide, so the Strip
   * scrolls from one to the next. The
   * window's, as the Flow is; never the engine's (`soloed`). */
  solo?: true
  /** The Project whose Agents' Threads open here (ADR 0065, decision 9). */
  project?: ProjectId
  /** The Project's own Group, first here (ADR 0102, decision 4). */
  own?: string
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

/** The Project the Person is in, as Here says it (ADR 0087, decision 4):
 * the focused Pane's, else the current workspace's, which a Project's
 * workspace keeps once its last Pane goes. None on an empty workspace of
 * no Project, where the window takes its home Project. */
export function projectIn(state: Workspaces): ProjectId | undefined {
  return (focused(state) ?? current(state)).project
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
  const c = workspace.columns.indexOf(column)
  const own = ownWidth(workspace, column, sizes)
  if (column.full || !filledAt(workspace, c)) return own
  return free(shareAt(workspace, c, share(own) ?? 0.5, sizes))
}

/** The share of the screen the column at `c` is drawn at, were its own
 * width `at`: in a Group that fills the screen, the share it has of its
 * Group's, the others keeping theirs. */
function shareAt(
  workspace: Workspace,
  c: number,
  at: number,
  sizes: Sizes
): number {
  if (!filledAt(workspace, c)) return at
  const { start, end } = runOf(workspace.columns, c)
  const others = workspace.columns
    .slice(start, end)
    .filter((_, i) => start + i !== c)
    .reduce(
      (sum, one) => sum + (share(ownWidth(workspace, one, sizes)) ?? 0.5),
      0
    )
  return at / (at + others)
}

/** The columns of the Group the one at `c` is in, from `start` to before
 * `end`: it alone when it is in none. A Group's columns stand side by
 * side, as the engine keeps them (ADR 0065). */
export function runOf(
  columns: readonly Column[],
  c: number
): { start: number; end: number } {
  const group = columns[c]?.group
  let start = c
  let end = c + 1
  if (group === undefined) return { start, end }
  while (start > 0 && columns[start - 1].group === group) start--
  while (end < columns.length && columns[end].group === group) end++
  return { start, end }
}

/** Whether the column at `c` fills the screen: in solo, any Group and
 * any column in none (ADR 0102, decision 8); else the Group `Alt+M`
 * filled. */
export function filledAt(workspace: Workspace, c: number): boolean {
  const column = workspace.columns[c]
  if (column === undefined) return false
  return (
    workspace.solo === true ||
    (column.group !== undefined && workspace.filled === column.group)
  )
}

/** The workspaces as solo draws them: every workspace with each Group,
 * and each column in none, the whole screen wide (ADR 0102, decision 8),
 * but `row`, the one `Alt+M` shows as the row for a while. The same
 * object when none changes. */
export function soloed(state: Workspaces, row?: string): Workspaces {
  const widens = (one: Workspace) =>
    one.id !== row && one.columns.length > 0 && !one.solo
  if (!state.list.some(widens)) return state
  return {
    ...state,
    list: state.list.map((one) =>
      widens(one) ? { ...one, solo: true as const } : one
    ),
  }
}

/** Where a column stands in its Group: its first, its last, and whether
 * those ends stand out half a gap, for its plate (ADR 0065). */
export type Ends = { first: boolean; last: boolean; pad: boolean }

/** Which of a column's sides stand out half a gap, `--group-pad`, for
 * its Group's plate: every measure of the columns counts these. */
export function padded(ends: Ends | undefined): {
  left: boolean
  right: boolean
} {
  return { left: !!ends?.pad && ends.first, right: !!ends?.pad && ends.last }
}

/** The attributes a column draws its Group by: its plate's margins come
 * from them in CSS, with `--group-pad` (globals.css). */
export function groupAttributes(group: string | undefined, ends: Ends) {
  const { left, right } = padded(ends)
  return {
    "data-group": group,
    "data-pad-left": left ? "" : undefined,
    "data-pad-right": right ? "" : undefined,
  }
}

/** Where the column at `c` stands in its Group; a Group that fills the
 * screen stands out into the Strip's own padding instead of the gaps. */
export function groupEnds(workspace: Workspace, c: number): Ends {
  const { columns } = workspace
  const group = columns[c]?.group
  if (group === undefined) return { first: false, last: false, pad: false }
  return {
    first: columns[c - 1]?.group !== group,
    last: columns[c + 1]?.group !== group,
    pad: !filledAt(workspace, c),
  }
}

/** Whether `workspace` is a free one, in the row and solo: one no Project
 * owns that holds a Pane (ADR 0102, decision 1). */
export function isFree(workspace: Workspace): boolean {
  return workspace.project === undefined && workspace.columns.length > 0
}

/** Whether `workspace` takes a Pane of `project` moved to it, in the row
 * and solo: a free one, an empty one, or its Project's (ADR 0102,
 * decision 6). */
export function admits(workspace: Workspace, project: ProjectId): boolean {
  return workspace.project === undefined || workspace.project === project
}

/** Whether a Pane in `column` of `workspace` moves to another workspace
 * by the keys with its whole Group, as one window (ADR 0065): not in the
 * Project's own Group, whose Panes the Person opened one by one (ADR
 * 0102, decision 4). */
export function takesGroup(
  workspace: Workspace,
  column: Column | undefined
): column is Column & { group: string } {
  return column?.group !== undefined && column.group !== workspace.own
}

/** Whether `workspace`, emptied, keeps its place once the window leaves
 * it: in the row and solo, `strict`, a Project's does, but when its
 * Project is known to have no Threads, one of `gone` (ADR 0102, decision
 * 2). In the Flow free every workspace is free, and none does (decision
 * 1). */
export function keepsPlace(
  workspace: Workspace,
  gone: readonly ProjectId[],
  strict: boolean
): boolean {
  return (
    strict &&
    workspace.project !== undefined &&
    !gone.includes(workspace.project)
  )
}

/** The Project Pane `pane` moves as: its own alone; `whole`, with its
 * Group, the Group's lead's, as `lead` says (an Agent's Thread), else its
 * first Pane's. */
export function movingAs(
  state: Workspaces,
  pane: string,
  whole: boolean,
  lead: (entry: Entry) => boolean
): ProjectId | undefined {
  const at = find(state, pane)
  if (!at) return undefined
  const { columns } = state.list[at.workspace]
  const column = columns[at.column]
  if (!whole || column.group === undefined)
    return column.entries[at.entry].project
  const { start, end } = runOf(columns, at.column)
  const all = columns.slice(start, end).flatMap((one) => one.entries)
  return (all.find(lead) ?? all[0]).project
}

/** The workspaces Pane `pane`, or `whole` its Group, may not move to:
 * every other Project's but the one it stands on (ADR 0102, decision 6). */
export function refusedTo(
  state: Workspaces,
  pane: string,
  whole: boolean,
  lead: (entry: Entry) => boolean
): Set<string> {
  const project = movingAs(state, pane, whole, lead)
  const from = find(state, pane)?.workspace
  return new Set(
    project === undefined
      ? []
      : state.list
          .filter((w, at) => at !== from && !admits(w, project))
          .map((w) => w.id)
  )
}

/** A Project's, as the words name it: by its name, else another
 * Project's. */
const whose = (name: string | undefined) =>
  name ? `${name}'s` : "another Project's"

/** Whose workspace `to`, from 0, is, by its Project's `name`. */
function whoseIs(to: number, name: string | undefined): string {
  return `Workspace ${to + 1} is ${whose(name)}`
}

/**
 * What a move refused onto workspace `to`, from 0, is told (ADR 0102,
 * decision 6): whose it is, its Project `owner`'s, and where the Pane can
 * go. `as` is the Project it moves as, and `scratch` whether that is of
 * no Project, as the Placing says: a draft in the machine's own ID is,
 * with no summary. `along`, a Group of that Project takes it along, and
 * dragged alone it would go there. A Project not known is another
 * Project's.
 */
export function refusalOf({
  to,
  owner,
  as,
  scratch,
  along,
}: {
  to: number
  owner: ProjectSummary | undefined
  as: ProjectSummary | undefined
  scratch: boolean
  along: boolean
}): { title: string; description: string } {
  const description = along
    ? `It goes with its Group, which is ${scratch ? "of no Project" : whose(as?.name)}. Drag it to move it alone.`
    : scratch
      ? "A Pane of no Project goes to a free workspace or a new one."
      : as?.name
        ? `${as.name}'s Panes go to its workspace, a free one or a new one.`
        : "A Pane goes to its Project's workspace, a free one or a new one."
  return { title: whoseIs(to, owner?.name), description }
}

/** What the note under Pane `pane`, carried, says over each workspace but
 * the one it stands on, by their IDs, in the row and solo (ADR 0102,
 * decision 6): whose it is, if `refused`, else where the Pane goes, a
 * Project's by `projectOf`. */
export function notesOf(
  state: Workspaces,
  pane: string,
  refused: ReadonlySet<string>,
  projectOf: (project: ProjectId) => ProjectSummary | undefined
): Map<string, string> {
  const from = find(state, pane)?.workspace
  const last = state.list.length - 1
  const noteOf = ({ id, project }: Workspace, to: number) => {
    const name = project === undefined ? undefined : projectOf(project)?.name
    if (refused.has(id)) return whoseIs(to, name)
    if (to === last) return "To a new workspace"
    if (!project) return `To free workspace ${to + 1}`
    return name ? `To ${name}'s workspace` : "To its Project's workspace"
  }
  return new Map(
    state.list.flatMap((workspace, to) =>
      to === from ? [] : [[workspace.id, noteOf(workspace, to)] as const]
    )
  )
}

/** The focused column of the workspace on screen, and its place. */
export function focusedColumn(state: Workspaces) {
  const workspace = current(state)
  const c = workspace.focus
  return { workspace, c, column: workspace.columns[c] as Column | undefined }
}

/** The width a column is drawn at on its own, its Group aside. */
function ownWidth(workspace: Workspace, column: Column, sizes: Sizes): Width {
  if (column.full) return "1"
  if (column.width !== undefined) return column.width
  return workspace.columns.length === 1 ? sizes.alone : sizes.default
}

/** How a column shows its Panes: one above another, or as a Deck. */
export function displayOf(
  column: Column,
  look: Pick<Columns, "display"> = DEFAULT_COLUMNS
): Display {
  return column.display ?? look.display
}

/** The entries of a column on screen: all, or in a Deck the one shown. */
export function shownIn(
  column: Column,
  look: Pick<Columns, "display"> = DEFAULT_COLUMNS
): Entry[] {
  return displayOf(column, look) === "deck"
    ? column.entries.slice(column.active, column.active + 1)
    : column.entries
}

/** A workspace as the bar shows it. */
export type InBar = {
  id: string
  index: number
  /** It holds no Pane: the current one, emptied, or the one at the bottom. */
  empty: boolean
  /** The empty one at the bottom, which the bar shows as its `+`. */
  bottom: boolean
  /** The Project whose Agents open here (ADR 0065, decision 9). */
  project?: ProjectId
}

/** The workspaces the bar shows: those that hold Panes, the current one,
 * and the empty one at the bottom. */
export function inBar(state: Workspaces): InBar[] {
  const last = state.list.length - 1
  return state.list.flatMap((workspace, index) => {
    const empty = workspace.columns.length === 0
    if (
      empty &&
      !workspace.project &&
      index !== state.current &&
      index !== last
    )
      return []
    const bottom = index === last
    const project = bottom ? undefined : workspace.project
    return [
      { id: workspace.id, index, empty, bottom, ...(project && { project }) },
    ]
  })
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

/** What makes a Pane that one Pane, as its kind names it
 * (`PaneKind.identity`): its args whole, by default. */
export type Identity = (pane: PaneState) => PaneState

const WHOLE: Identity = (pane) => pane

/** Two entries show the same Pane when their Project, kind and args are,
 * the args as `identity` takes them. */
export function samePane(
  a: { project: ProjectId; pane: PaneState },
  b: { project: ProjectId; pane: PaneState },
  identity: Identity = WHOLE
): boolean {
  return (
    a.project === b.project &&
    a.pane.kind === b.pane.kind &&
    canonical(identity(a.pane).args) === canonical(identity(b.pane).args)
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
export function left(
  before: Workspaces,
  after: Workspaces,
  identity: Identity = WHOLE
): Entry[] {
  const stays = entries(after)
  return entries(before).filter(
    (entry) => !stays.some((other) => samePane(entry, other, identity))
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
  /** What makes a Pane the one shown, as its kind says: one so shown
   * shows these args and gets the focus, as the Project's one Diff takes
   * another scope. Its args whole, when left out. */
  identity?: Identity
  /** One so shown keeps its own args: it only gets the focus. */
  keep?: true
}

/**
 * Shows a Pane of a Project and focuses it.
 *
 * - An entry already showing the same Pane only gets the focus, on
 *   whichever workspace it is, unless it opens `again` or `instead`; one
 *   the same by its `identity` shows these args first, unless `keep`.
 * - `instead` replaces the opener's Pane; `below` adds it under the
 *   opener, in the same column; `right` adds a column right of the
 *   opener's.
 * - Left out, the Pane takes the place of the one of its kind that the
 *   opener's workspace shows, or adds a column on the right.
 * - With `focus: false` the focus goes back where it was.
 */
export function open(
  state: Workspaces,
  project: ProjectId,
  pane: PaneState,
  opening: Opening = {}
): Workspaces {
  const next = placed(state, project, pane, opening)
  const was = opening.focus === false && focused(state)
  return was ? focusEntry(next, was.id) : next
}

function placed(
  state: Workspaces,
  project: ProjectId,
  pane: PaneState,
  opening: Opening
): Workspaces {
  const place = opening.place
  const wanted = { project, pane }
  const showing =
    !opening.again &&
    place !== "instead" &&
    entries(state).find((entry) => samePane(entry, wanted, opening.identity))
  if (showing) {
    const next =
      opening.keep || samePane(showing, wanted)
        ? state
        : showingNow(state, showing.id, pane)
    return opening.focus === false ? next : focusEntry(next, showing.id)
  }

  // `instead` replaces its opener alone: from one in no workspace, as the
  // drawer's, it opens beside the focused Pane.
  const opener =
    opening.from === undefined ? focusedSpot(state) : find(state, opening.from)
  const from = opener ?? focusedSpot(state)
  const w = from?.workspace ?? state.current
  const workspace = state.list[w]
  const entry: Entry = { id: newId(), project, pane }

  if (opener && place === "instead") {
    return showIn(state, opener, entry)
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

/** The entry `id` showing `pane` now, where it is. */
function showingNow(
  state: Workspaces,
  id: string,
  pane: PaneState
): Workspaces {
  const spot = find(state, id)
  if (!spot) return state
  const workspace = state.list[spot.workspace]
  const column = workspace.columns[spot.column]
  const entry = column.entries[spot.entry]
  return setWorkspace(state, spot.workspace, {
    ...workspace,
    columns: replace(workspace.columns, spot.column, {
      ...column,
      entries: replace(column.entries, spot.entry, { ...entry, pane }),
    }),
  })
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
  project: ProjectId,
  pane: PaneState,
  opening: Opening = {}
): Workspaces {
  const away = entries(state).find(
    (entry) =>
      samePane(entry, { project, pane }, opening.identity) &&
      find(state, entry.id)?.workspace !== state.current
  )
  return away
    ? normalize(open(remove(state, away.id), project, pane, opening))
    : open(state, project, pane, opening)
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

/** Moves the focus as the overview's arrows do: as `move`, and up or
 * down past a column's end, or from an empty workspace, to the next
 * workspace there. */
export function across(state: Workspaces, direction: Direction): Workspaces {
  const next = move(state, direction)
  if (next !== state || direction === "left" || direction === "right") {
    return next
  }
  return step(state, direction === "down" ? 1 : -1)
}

/** Moves the focused Pane as `shift` does, and up or down past its
 * column's end to the workspace there, a column on the right, as niri's
 * `move-window-down-or-to-workspace-down`. */
export function carry(state: Workspaces, direction: Direction): Workspaces {
  const next = shift(state, direction)
  if (next !== state || direction === "left" || direction === "right") {
    return next
  }
  return send(state, state.current + (direction === "down" ? 1 : -1))
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
    // The column, or its whole Group, past the column or the whole Group
    // beside it (ADR 0065).
    const { columns } = workspace
    const { start, end } = runOf(columns, workspace.focus)
    const right = direction === "right"
    if (right ? end >= columns.length : start === 0) return state
    const other = runOf(columns, right ? end : start - 1)
    const [a, b] = right ? [start, other.end] : [other.start, end]
    const mine = columns.slice(start, end)
    const theirs = columns.slice(other.start, other.end)
    const by = right ? theirs.length : -theirs.length
    return setWorkspace(state, state.current, {
      ...workspace,
      columns: [
        ...columns.slice(0, a),
        ...(right ? [...theirs, ...mine] : [...mine, ...theirs]),
        ...columns.slice(b),
      ],
      focus: workspace.focus + by,
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
  const c = workspace.focus
  const column = workspace.columns[c]
  if (!column) return state
  // In a Group that fills the screen, in solo or by Alt+M, a width shows
  // as its share of the Group's: each step goes on to one that shows, and
  // a column that fills the screen alone has none, so the row never comes
  // back at a width the Person did not see (ADR 0102, decision 8).
  const shows = (at: number) => drawn(shareAt(workspace, c, at, sizes), floor)
  const own = share(ownWidth(workspace, column, sizes)) ?? 0.5
  const now = column.full ? 1 : shows(own)
  // Of the presets drawn alike, the widest stands for them all.
  const next = nextStep(sizes.presets, now, by, wrap, shows)
  if (next === undefined) return state
  return withFocused(state, { ...column, width: next, full: undefined })
}

/**
 * The share past `now` in `steps`, by what each `shows` as: from any
 * share, the nearest one past it, up or down; with `wrap`, past the last
 * to the first. Of the steps that show alike, the last stands for them
 * all. None when no step shows another share.
 */
function nextStep(
  steps: readonly Width[],
  now: number,
  by: 1 | -1,
  wrap: boolean,
  shows: (at: number) => number = (at) => at
): Width | undefined {
  const all = steps
    .flatMap((step) => {
      const at = share(step)
      return at === undefined ? [] : [{ step, at, shows: shows(at) }]
    })
    .sort((a, b) => a.at - b.at)
    .filter((step, i, all) => !alike(step.shows, all[i + 1]?.shows))
  let next =
    by > 0
      ? all.find((step) => step.shows > now + EPSILON)
      : all.findLast((step) => step.shows < now - EPSILON)
  if (!next && wrap) next = by > 0 ? all[0] : all.at(-1)
  return next && !alike(next.shows, now) ? next.step : undefined
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

/**
 * The share of its column's height each entry is drawn at: its own, or
 * an even share of what those leave; one alone fills the column.
 */
export function heightsOf(column: Column): number[] {
  if (column.entries.length === 1) return [1]
  const own = column.entries.map((entry) =>
    entry.height === undefined ? undefined : share(entry.height)
  )
  const taken = own.reduce((sum: number, at) => sum + (at ?? 0), 0)
  const rest = own.filter((at) => at === undefined).length
  const each = rest > 0 ? Math.max(0, 1 - taken) / rest : 0
  return own.map((at) => at ?? each)
}

/**
 * Steps the focused Pane's height to the next of the look's `heights`,
 * higher or lower, from the height it is drawn at; with `wrap`, past the
 * last to the first, as niri's Mod+Shift+R. A Pane alone in its column,
 * or one of a Deck, has no height of its own.
 */
export function heighten(
  state: Workspaces,
  by: 1 | -1,
  look: Heights = DEFAULT_COLUMNS,
  { wrap = false }: { wrap?: boolean } = {}
): Workspaces {
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  const entry = column?.entries[column.active]
  if (!entry || column.entries.length < 2) return state
  if (displayOf(column, look) === "deck") return state
  const now = heightsOf(column)[column.active]
  const height = nextStep(look.heights, now, by, wrap)
  if (height === undefined) return state
  const entries = replace(column.entries, column.active, { ...entry, height })
  return withFocused(state, { ...column, entries })
}

/**
 * Gives the focused Pane `height` in its column, as a step of the Pane
 * menu does (ADR 0066, decision 3). A Pane alone in its column, or in a
 * Deck, has no height of its own; neither has a height that is none.
 */
export function heightTo(
  state: Workspaces,
  height: Width,
  look: Heights = DEFAULT_COLUMNS
): Workspaces {
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  const entry = column?.entries[column.active]
  if (!entry || column.entries.length < 2) return state
  if (displayOf(column, look) === "deck") return state
  if (share(height) === undefined || entry.height === height) return state
  const entries = replace(column.entries, column.active, { ...entry, height })
  return withFocused(state, { ...column, entries })
}

/** Makes every Pane of the focused column as high as the others, as
 * niri's Mod+Ctrl+R. */
export function even(state: Workspaces): Workspaces {
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  if (!column?.entries.some((entry) => entry.height !== undefined)) return state
  const entries = column.entries.map((entry) => {
    const even = { ...entry }
    delete even.height
    return even
  })
  return withFocused(state, { ...column, entries })
}

/** Gives the focused column `width`, the room the others leave, as niri's
 * expand-column-to-available-width. */
export function fill(state: Workspaces, width: Width): Workspaces {
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  if (!column || (column.width === width && !column.full)) return state
  return withFocused(state, { ...column, width, full: undefined })
}

/** Focuses the first or the last column, as niri's Mod+Home and Mod+End. */
export function edge(state: Workspaces, side: "first" | "last"): Workspaces {
  const workspace = current(state)
  const focus = side === "first" ? 0 : workspace.columns.length - 1
  if (focus < 0 || focus === workspace.focus) return state
  return setWorkspace(state, state.current, { ...workspace, focus })
}

/** Moves the focused column to the first or the last place, and keeps the
 * focus on it, as niri's Mod+Ctrl+Home and Mod+Ctrl+End. */
export function toEdge(state: Workspaces, side: "first" | "last"): Workspaces {
  const workspace = current(state)
  if (!workspace.columns[workspace.focus]) return state
  // In a Group, the whole Group goes (ADR 0065).
  const { start, end } = runOf(workspace.columns, workspace.focus)
  const mine = workspace.columns.slice(start, end)
  const rest = [
    ...workspace.columns.slice(0, start),
    ...workspace.columns.slice(end),
  ]
  const at = side === "first" ? 0 : rest.length
  if (at === start) return state
  return setWorkspace(state, state.current, {
    ...workspace,
    columns: [...rest.slice(0, at), ...mine, ...rest.slice(at)],
    focus: at + workspace.focus - start,
  })
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
 * Shows the focused column as a Deck, one Pane at a time, or its Panes one
 * above another again, as niri's toggle-column-tabbed-display (ADR 0065).
 */
export function deck(
  state: Workspaces,
  look: Pick<Columns, "display"> = DEFAULT_COLUMNS
): Workspaces {
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  if (!column) return state
  const display = displayOf(column, look) === "deck" ? "stack" : "deck"
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

/** Goes to the workspace above or below. */
export function step(state: Workspaces, by: 1 | -1): Workspaces {
  return go(state, state.current + by)
}

/**
 * Sends the focused Pane to a workspace, as a column on its right, and
 * follows it there; in a Group, the whole Group goes, but from the
 * Project's own Group the Pane goes alone (`takesGroup`). Past the last,
 * it goes to the empty one at the bottom.
 */
export function send(state: Workspaces, index: number): Workspaces {
  const entry = focused(state)
  const to = clamp(index, state.list.length)
  if (!entry || to === state.current) return state
  const target = state.list[to]
  const workspace = current(state)
  const column = workspace.columns[workspace.focus]
  if (takesGroup(workspace, column)) {
    // A Pane in a Group takes its whole Group, as one window (ADR 0065).
    const { start, end } = runOf(workspace.columns, workspace.focus)
    const left = setWorkspace(state, state.current, {
      ...workspace,
      columns: [
        ...workspace.columns.slice(0, start),
        ...workspace.columns.slice(end),
      ],
      focus: Math.max(0, start - 1),
    })
    const columns = workspace.columns.slice(start, end)
    return focusEntry(
      setWorkspace(left, to, {
        ...target,
        columns: [...target.columns, ...columns],
      }),
      entry.id
    )
  }
  const width = column?.width
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
 * Keeps the rules of the list: empty workspaces go, except the current one,
 * a Project's, which the engine lets go when the Project has no Threads
 * (ADR 0102, decision 2), and the one at the bottom, which is always there
 * and always empty.
 */
export function normalize(state: Workspaces): Workspaces {
  const now = state.list[state.current]
  let list = state.list.filter(
    (workspace) =>
      workspace.columns.length > 0 ||
      workspace === now ||
      workspace.project !== undefined
  )
  const last = list[list.length - 1]
  if (!last || last.columns.length > 0 || last.project !== undefined) {
    // The spare at the bottom stays the same one, so it keeps its place.
    const spare = state.list[state.list.length - 1]
    const reused =
      spare && spare.columns.length === 0 && spare.project === undefined
    list = [...list, reused ? spare : blank()]
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
      const display = displayIn(column.display)
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

/** A kept display; `"tabs"` is a Deck's old name (ADR 0065). */
function displayIn(value: unknown): Display | undefined {
  if (value === "tabs") return "deck"
  return value === "stack" || value === "deck" ? value : undefined
}

function isWidth(value: unknown): value is Width {
  return typeof value === "string" && share(value) !== undefined
}

function isEntry(value: unknown): value is Entry {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.project === "string" &&
    isObject(value.pane) &&
    typeof value.pane.kind === "string" &&
    isObject(value.pane.args)
  )
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
