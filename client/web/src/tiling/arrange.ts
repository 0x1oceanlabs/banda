/**
 * The workspaces as the engine keeps them, and the window's view of them
 * (ADR 0025, decision 1). The engine's `workspaces` module holds the
 * arrangement: which Panes, in which columns, on which workspaces, with
 * their widths. The window holds the view: the workspace on screen, each
 * one's focused column and each column's shown Pane, by their IDs. The
 * two make the `Workspaces` the window draws (`model.ts`).
 *
 * A key still works out its change with `model.ts`, which says where a
 * Pane goes; what that puts where becomes one command, which the window
 * draws at once with the client's copy of the engine's commands
 * (`pending.ts`), until the engine's event holds it. Pure, so plain tests
 * cover it.
 */
import type { CommandId, Engine, Event } from "@banda/contract"
import type {
  Arranged,
  Changed,
  Pane,
  Place,
  Workspace as Kept,
} from "@banda/contract/workspaces"
import type { PaneState } from "@banda/ui/pane"
import type { Source } from "@banda/ui/hooks/use-live"
import type { Command } from "./arrangement"
import {
  clamp,
  type Column,
  current,
  runOf,
  type Entry,
  entries,
  find,
  samePane,
  type Workspace,
  type Workspaces,
} from "./model"

/** An ID and where it stood, so a neighbour takes its place when it goes. */
type Held = { id: string; at: number }

/** What the Person looks at: the window's, never the engine's. */
export type View = {
  /** The workspace on screen. */
  current?: Held
  /** Each workspace's focused column, by the workspace's ID. */
  focus: Record<string, Held>
  /** Each column's shown Pane, by the column's ID. */
  active: Record<string, Held>
  /** A Pane to focus, one just opened or moved: where the change put it. */
  want?: Want
}

/**
 * A Pane to focus: while the command that put it there waits for its fact
 * (`command`, `pending.ts`), or once the arrangement stands past `after`
 * in the machine's log, as a window kept it before it drew its changes at
 * once, and an arrangement it moved over waits for still.
 */
export type Want = { pane: string; command?: string; after?: number }

export const NO_VIEW: View = { focus: {}, active: {} }

/**
 * The workspaces to draw: the engine's arrangement, as the view looks at
 * it. What `before` drew and is the same stays the same object, so a Pane
 * whose args did not change does not draw again.
 */
export function resolve(
  kept: readonly Kept[],
  view: View,
  before?: Workspaces,
  at = Infinity
): Workspaces {
  const aimed = at >= (view.want?.after ?? 0) ? aim(kept, view) : view
  const was = known(before)
  const list = kept.map((workspace) => {
    const columns = workspace.columns.map((column) => {
      const panes = column.panes.map((pane) => {
        const next: Entry = {
          id: pane.id,
          project: pane.project,
          pane: { kind: pane.kind, args: pane.args as PaneState["args"] },
        }
        if (pane.by !== undefined) next.by = pane.by
        if (pane.height !== undefined) next.height = pane.height
        const old = was.entries.get(pane.id)
        return old && samePane(old, next) && old.height === next.height
          ? old
          : next
      })
      const next: Column = {
        id: column.id,
        entries: panes,
        active: held(aimed.active[column.id], panes, "stay"),
      }
      if (column.width !== undefined) next.width = column.width
      if (column.full) next.full = true
      if (column.display !== undefined) next.display = column.display
      if (column.group !== undefined) next.group = column.group
      return same(was.columns.get(column.id), next)
    })
    const next: Workspace = {
      id: workspace.id,
      columns,
      focus: held(aimed.focus[workspace.id], columns, "before"),
    }
    if (workspace.filled !== undefined) next.filled = workspace.filled
    if (workspace.project !== undefined) next.project = workspace.project
    return same(was.workspaces.get(workspace.id), next)
  })
  const shows = held(aimed.current, list, "stay")
  const unchanged =
    before?.current === shows &&
    before.list.length === list.length &&
    list.every((workspace, i) => workspace === before.list[i])
  return unchanged ? before : { list, current: shows }
}

/** The view `state` shows; `want` stays until the arrangement, at `at`,
 * has shown it. */
export function viewOf(state: Workspaces, want?: Want, at = Infinity): View {
  const view: View = { focus: {}, active: {} }
  for (const workspace of state.list) {
    const column = workspace.columns[workspace.focus]
    if (column)
      view.focus[workspace.id] = { id: column.id, at: workspace.focus }
    for (const column of workspace.columns) {
      const entry = column.entries[column.active]
      if (entry) view.active[column.id] = { id: entry.id, at: column.active }
    }
  }
  const workspace = state.list[state.current]
  if (workspace) view.current = { id: workspace.id, at: state.current }
  const shown = entries(state).some((entry) => entry.id === want?.pane)
  if (want && (at < (want.after ?? 0) || !shown)) view.want = want
  return view
}

/** The view looking at `want`, when the arrangement shows it. */
function aim(kept: readonly Kept[], view: View): View {
  const want = view.want?.pane
  if (!want) return view
  for (const [w, workspace] of kept.entries()) {
    for (const [c, column] of workspace.columns.entries()) {
      const e = column.panes.findIndex((pane) => pane.id === want)
      if (e < 0) continue
      return {
        current: { id: workspace.id, at: w },
        focus: { ...view.focus, [workspace.id]: { id: column.id, at: c } },
        active: { ...view.active, [column.id]: { id: want, at: e } },
      }
    }
  }
  return view
}

/**
 * Where a held ID stands now. One that went leaves its place to the one
 * after it (`stay`), as a Pane closed in a stack does, or the one before
 * it (`before`), as a column closed does.
 */
function held(
  id: Held | undefined,
  items: readonly { id: string }[],
  gone: "stay" | "before"
): number {
  if (!id || items.length === 0) return 0
  const at = items.findIndex((item) => item.id === id.id)
  if (at >= 0) return at
  return clamp(gone === "before" ? id.at - 1 : id.at, items.length)
}

function known(state: Workspaces | undefined) {
  const workspaces = new Map<string, Workspace>()
  const columns = new Map<string, Column>()
  const panes = new Map<string, Entry>()
  for (const workspace of state?.list ?? []) {
    workspaces.set(workspace.id, workspace)
    for (const column of workspace.columns) {
      columns.set(column.id, column)
      for (const entry of column.entries) panes.set(entry.id, entry)
    }
  }
  return { workspaces, columns, entries: panes }
}

/** `old` when it holds what `next` does, so it draws as it was. */
function same<T extends object>(old: T | undefined, next: T): T {
  if (!old) return next
  const a = old as Record<string, unknown>
  const b = next as Record<string, unknown>
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if (!alike(a[key], b[key])) return next
  return old
}

function alike(a: unknown, b: unknown): boolean {
  if (a === b) return true
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((item, i) => item === b[i])
  )
}

/**
 * The args Panes asked for that the arrangement may not show yet, by the
 * Panes' IDs. A Pane works its next args out of the ones it drew, as it
 * did when the window kept them, so they are drawn at once, and until
 * the log stands at `until`: their event's place, once the engine said
 * it, `Infinity` before.
 */
export type Asked = Record<string, { args: unknown; until: number }>

/** `kept` with the args asked for, and of these the ones still ahead of
 * the log's place `at`. */
export function withAsked(
  kept: Kept[],
  asked: Asked,
  at: number
): { kept: Kept[]; asked: Asked } {
  const ahead = Object.fromEntries(
    Object.entries(asked).filter(([, one]) => one.until > at)
  )
  return { kept: withArgs(kept, (pane) => ahead[pane]?.args), asked: ahead }
}

/** `kept` with the args `argsOf` gives its Panes; what it gives none of
 * stays the same object. */
function withArgs(kept: Kept[], argsOf: (pane: string) => unknown): Kept[] {
  const column = (one: Kept["columns"][number]) => {
    const panes = sameOr(
      one.panes,
      one.panes.map((pane) => {
        const args = argsOf(pane.id)
        return args === undefined
          ? pane
          : { ...pane, args: args as Pane["args"] }
      })
    )
    return panes === one.panes ? one : { ...one, panes }
  }
  return sameOr(
    kept,
    kept.map((workspace) => {
      const columns = sameOr(workspace.columns, workspace.columns.map(column))
      return columns === workspace.columns
        ? workspace
        : { ...workspace, columns }
    })
  )
}

/** `old` when `next` holds the same items, so it stays the same object. */
function sameOr<T>(old: T[], next: T[]): T[] {
  return alike(old, next) ? old : next
}

/** The arrangement read once, then kept current by the module's events. */
export function arrangedSource(engine: Engine): Source<Arranged> {
  return {
    read: () => engine.call("workspaces.list", {}),
    filter: { module: "workspaces" },
    apply: applyChange,
  }
}

export function applyChange(state: Arranged, event: Event): Arranged {
  const changed = event.payload as Changed
  // What is set aside changes only as the workspaces are set aside or
  // come back (ADR 0039, decision 2).
  const aside = "aside" in changed ? changed.aside : state.aside
  if ("workspaces" in changed) {
    return { at: event.seq, workspaces: changed.workspaces, aside }
  }
  const workspaces = withArgs(state.workspaces, (pane) =>
    pane === changed.pane ? changed.args : undefined
  )
  return { at: event.seq, workspaces, aside }
}

/** The arrangement a window kept, for the engine to take (decision 2). */
export function keptOf(state: Workspaces): Kept[] {
  return state.list.map((workspace) => ({
    id: workspace.id,
    columns: workspace.columns.map((column) => ({
      id: column.id,
      panes: column.entries.map((entry) => ({
        id: entry.id,
        project: entry.project,
        kind: entry.pane.kind,
        args: entry.pane.args,
        ...(entry.by !== undefined && { by: entry.by }),
        ...(entry.height !== undefined && { height: entry.height }),
      })),
      ...(column.width !== undefined && { width: column.width }),
      full: column.full === true,
      ...(column.display !== undefined && { display: column.display }),
      ...(column.group !== undefined && { group: column.group }),
    })),
    ...(workspace.filled !== undefined && { filled: workspace.filled }),
    ...(workspace.project !== undefined && { project: workspace.project }),
  }))
}

/** A change for the engine to make, and the Pane to focus once it shows
 * it; a Pane opened is focused by the ID the engine gives it, unless
 * `focus` is false. */
export type Plan = { command: Command; want?: string; focus?: false }

/**
 * What a change of the workspaces comes to: the view alone, as the
 * workspaces the window shows next, or a plan for the engine, which
 * arranges them (ADR 0025, decision 1); nothing when nothing changes.
 */
export type Step = Workspaces | Plan | undefined

/** A change of the workspaces, worked out from those the last one drew. */
export type Change = (workspaces: Workspaces) => Step

type Spot = { workspace: Workspace; column: Column; c: number; e: number }

function spotOf(state: Workspaces, id: string): Spot | undefined {
  const at = find(state, id)
  if (!at) return undefined
  const workspace = state.list[at.workspace]
  const column = workspace.columns[at.column]
  return { workspace, column, c: at.column, e: at.entry }
}

/** A column by its ID, on whichever workspace, and its index there. */
function columnOf(state: Workspaces, id: string | undefined) {
  for (const workspace of state.list) {
    const index = workspace.columns.findIndex((column) => column.id === id)
    if (index >= 0)
      return { workspace, column: workspace.columns[index], index }
  }
  return undefined
}

/**
 * Where an entry stands in `next`, as the engine names a place: counted
 * as if it had left its own already, as the engine counts.
 */
function placeIn(spot: Spot): Place {
  return spot.column.entries.length === 1
    ? { to: "column", workspace: spot.workspace.id, index: spot.c }
    : { to: "stack", column: spot.column.id, index: spot.e }
}

/**
 * The Pane `next` shows that `before` did not, as a command to open it
 * where `next` has it, or at `place`, as the engine names one the window
 * only foresees: a Group's, a Project's workspace (ADR 0065); none when it
 * was shown already, and only the view changes. `grouped`, its column is
 * a Group from its opening: the one it goes into, else its own.
 */
export function opened(
  before: Workspaces,
  next: Workspaces,
  { place, grouped }: { place?: Place; grouped?: boolean } = {}
): Plan | undefined {
  const known = new Set(entries(before).map((entry) => entry.id))
  const entry = entries(next).find((other) => !known.has(other.id))
  const spot = entry && spotOf(next, entry.id)
  if (!entry || !spot) return undefined
  const shows = {
    project: entry.project,
    kind: entry.pane.kind,
    args: entry.pane.args,
    ...(grouped && { grouped }),
  }
  // In the place of a Pane that left: the one that stood there before.
  const was = columnOf(before, spot.column.id)?.column.entries[spot.e]
  if (was && !spotOf(next, was.id)) {
    return {
      command: {
        method: "workspaces.open",
        params: { ...shows, instead: was.id },
      },
    }
  }
  const width = spot.column.entries.length === 1 ? spot.column.width : undefined
  return {
    command: {
      method: "workspaces.open",
      // The window shows it anew, though another tile shows the same.
      params: {
        ...shows,
        again: true,
        place: place ?? placeIn(spot),
        ...(width !== undefined && { width }),
      },
    },
  }
}

/** Moves `pane` to where `next` has `as`, its stand-in there when `next`
 * shows it anew, and focuses it. */
export function moved(
  next: Workspaces,
  pane: string,
  as: string = pane
): Plan | undefined {
  const spot = spotOf(next, as)
  if (!spot) return undefined
  return {
    command: {
      method: "workspaces.move_pane",
      params: { pane, place: placeIn(spot) },
    },
    want: pane,
  }
}

/** Moves a column to where `next` has it; in a Group, the whole Group,
 * to where `next` has its first column (ADR 0065). */
export function columnMoved(
  next: Workspaces,
  column: string
): Plan | undefined {
  const at = columnOf(next, column)
  if (!at) return undefined
  if (at.column.group === undefined) {
    return columnTo(column, at.workspace.id, at.index)
  }
  const { start } = runOf(at.workspace.columns, at.index)
  return {
    command: {
      method: "workspaces.move_group",
      params: { column, workspace: at.workspace.id, index: start },
    },
  }
}

/** Moves a column alone to `index` of a workspace, counted as if it had
 * left its place. */
export function columnTo(
  column: string,
  workspace: string,
  index: number
): Plan {
  return {
    command: {
      method: "workspaces.move_column",
      params: { column, workspace, index },
    },
  }
}

/** Moves the workspace on screen one up or down, as niri's
 * `move-workspace-up`, and stays on it; nothing when it would not move,
 * as the engine keeps the empty one at the bottom there. */
export function workspaceMoved(
  state: Workspaces,
  by: 1 | -1
): Plan | undefined {
  const last = state.list.length - 1
  const index = clamp(state.current + by, last)
  if (state.current === last || index === state.current) return undefined
  return workspaceTo(state.list[state.current].id, index)
}

/** Moves a workspace to `index` from the top, counted as if it had left
 * its place: one dragged by its number in the overview. */
export function workspaceTo(workspace: string, index: number): Plan {
  return {
    command: {
      method: "workspaces.move_workspace",
      params: { workspace, index },
    },
  }
}

/** What changed of the focused column, its width, the whole screen, how
 * it shows its Panes or its Panes' heights, as a command. */
export function resized(
  before: Workspaces,
  next: Workspaces
): Plan | undefined {
  const workspace = current(before)
  const was = workspace.columns[workspace.focus]
  const now = columnOf(next, was?.id)?.column
  if (!was || !now) return undefined
  const column = was.id
  if (now.width !== was.width) {
    return {
      command: {
        method: "workspaces.size",
        params: {
          column,
          ...(now.width !== undefined && { width: now.width }),
        },
      },
    }
  }
  if (now.full !== was.full) {
    return {
      command: {
        method: "workspaces.maximize",
        params: { column, full: now.full === true },
      },
    }
  }
  if (now.display !== was.display) {
    return {
      command: {
        method: "workspaces.display",
        params: {
          column,
          ...(now.display !== undefined && { display: now.display }),
        },
      },
    }
  }
  const changed = now.entries.find(
    (entry, e) => entry.height !== was.entries[e]?.height
  )
  if (!changed) return undefined
  if (now.entries.every((entry) => entry.height === undefined)) {
    return { command: { method: "workspaces.even", params: { column } } }
  }
  return {
    command: {
      method: "workspaces.height",
      params: {
        pane: changed.id,
        ...(changed.height !== undefined && { height: changed.height }),
      },
    },
  }
}

/**
 * Lets the empty workspaces go that the Person no longer looks at, as
 * niri does, once the window has left them; none when there are none.
 */
export function tidied(state: Workspaces): Command | undefined {
  const last = state.list.length - 1
  const empty = state.list.some(
    (workspace, i) =>
      workspace.columns.length === 0 && i !== state.current && i !== last
  )
  if (!empty) return undefined
  return {
    method: "workspaces.tidy",
    params: { keep: state.list[state.current]?.id },
  }
}

/**
 * Runs a command on this machine's workspaces, in no Project, under `id`
 * when given: what it makes takes IDs derived from it (`seeded`). Its
 * answer comes with its place in the machine's log (ADR 0082, decision 4).
 */
export function send(
  engine: Engine,
  command: Command,
  id?: CommandId
): Promise<{ answer: { at: number | null; pane?: string }; at?: number }> {
  const { method, params } = command
  return engine.commandAt(method, params as never, undefined, id)
}
