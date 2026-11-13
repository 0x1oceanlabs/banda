/**
 * The arrangement's commands as the engine runs them, copied: what
 * `platform/workspaces/engine/src/model.rs`, `commands.rs` and
 * `placing.rs` do, function for function, so a client works out what a
 * command does before the engine answers (ADR 0088, decision 11). Where a
 * Pane with no place opens is the engine's to say (ADR 0110): this copy
 * of its rule only draws ahead, by the facts the client believes the
 * engine has, and the engine's answer wins. The engine's golden traces hold
 * the two together: `parity.test.ts` replays every one through `apply`.
 * The model itself, compiled to WebAssembly, takes this one's place (T1);
 * so it imports nothing but the contract, as that crate will be a leaf.
 *
 * Pure: `apply` changes a copy of the list it is given, and returns it.
 *
 * Where it falls short of the engine, in what no client sends:
 * - It reads no `space`, the word the engine still reads from before ADR
 *   0069.
 * - A number is a number: serde_json tells 1 from 1.0 in a Pane's args,
 *   and refuses 1.0 for an index; JavaScript cannot tell them apart.
 * - An ID is text, as the engine lists it: lowercase, with hyphens. The
 *   engine reads one in braces, without hyphens or as a URN too.
 * - serde reads params whose struct has no flattened field, such as
 *   `OnePane`'s or a column in `take`, from an array of its fields in
 *   order too; this one refuses them.
 *
 * Its readers of params follow serde's, but the traces hold only a few of
 * the ways params can be wrong, so most of how they refuse is unchecked
 * until T1.
 */
import type { Code, JsonValue, MethodOf, Params } from "@banda/contract"
import {
  type Column,
  type Pane,
  type Place,
  seeded,
  type Side,
  type Workspace,
} from "@banda/contract/workspaces"

type Named = Extract<MethodOf<"command">, `workspaces.${string}`>

/** One of the workspaces module's commands, with its params. */
export type Command = {
  [M in Named]: { method: M; params: Params<M> }
}[Named]

/**
 * The commands `apply` runs, as `commands::METHODS`: the module's own, but
 * for those that need its store (`set_aside`, `bring_back`, `unarrange`)
 * and the Agents' tools.
 */
export const METHODS: readonly Command["method"][] = [
  "workspaces.open",
  "workspaces.close",
  "workspaces.update",
  "workspaces.move_pane",
  "workspaces.move_column",
  "workspaces.move_workspace",
  "workspaces.size",
  "workspaces.height",
  "workspaces.even",
  "workspaces.maximize",
  "workspaces.display",
  "workspaces.group",
  "workspaces.regroup",
  "workspaces.move_group",
  "workspaces.fill",
  "workspaces.tidy",
  "workspaces.arrange",
  "workspaces.take",
]

/** What a command answers, as the engine does: the Pane for `open`, and
 * whether it is new. */
export type Answer = { pane?: string; new?: boolean }

/** What a command comes to: the workspaces after it and its answer, or
 * why it is refused, in the engine's words. */
export type Applied =
  { list: Workspace[]; answer: Answer } | { refused: Code; message: string }

/**
 * What the engine places a Pane by, beside its arrangement, as
 * `placing::Facts` (ADR 0110, decision 5): its machine's Flow, solo being
 * each client's view of the row, and the Pane kinds that stand on their
 * Project's workspace (`PaneKind.home`).
 */
export type Facts = { flow: "free" | "row"; home: readonly string[] }

/** The engine's facts when it knows no Flow and no kind. */
export const NO_FACTS: Facts = { flow: "free", home: [] }

/**
 * Runs `command` on `list` as the engine runs it under the command ID
 * `seed`, from which what it makes takes its IDs (`seeded`), by `facts`.
 * `list` stays as it was, refused or not.
 */
export function apply(
  list: readonly Workspace[],
  command: Command,
  seed: string,
  facts: Facts = NO_FACTS
): Applied {
  // What it keeps of the params, as its args, is its own too.
  const [copy, params] = structuredClone([list, command.params]) as [
    Arrangement,
    unknown,
  ]
  try {
    const answer = dispatch(copy, command.method, params, facts, seedOf(seed))
    return { list: copy, answer }
  } catch (error) {
    if (!(error instanceof Refused)) throw error
    return { refused: error.code, message: error.message }
  }
}

/** The workspaces from the top down. */
type Arrangement = Workspace[]

type Display = NonNullable<Column["display"]>
type Toward = Params<"workspaces.regroup">["toward"]
type Open = Params<"workspaces.open">
type Shown = Pick<Pane, "project" | "kind" | "args">

/** A refusal, with the engine's code and words. */
class Refused extends Error {
  readonly code: Code
  constructor(code: Code, message: string) {
    super(message)
    this.code = code
  }
}

const invalid = (message: string) => new Refused("invalid", message)
const notFound = (message: string) => new Refused("not_found", message)

/** As `usize::MAX`: past the last, the last. */
const LAST = Number.MAX_SAFE_INTEGER

/** The IDs of what one command makes, as `Seed` names them. */
type Seed = Record<
  "pane" | "column" | "group" | "workspace" | "bottom",
  string
> & {
  /** The `n`th of the new empty workspaces it makes under the last. */
  nth: (n: number) => string
  /** The own Group it starts on `project`'s workspace, at most one on
   * each. */
  own: (project: string) => string
}

function seedOf(command: string): Seed {
  return {
    nth: (n) => seeded(command, `bottom ${n}`),
    own: (project) => seeded(command, `own ${project}`),
    pane: seeded(command, "pane"),
    column: seeded(command, "column"),
    group: seeded(command, "group"),
    workspace: seeded(command, "workspace"),
    bottom: seeded(command, "bottom"),
  }
}

/** Refuses a seed whose IDs the workspaces hold: its command ran before. */
function unused(seed: Seed, list: Arrangement): void {
  // Every ID it makes but those made afresh by `nth` and `own`.
  const made = new Set(
    Object.values(seed).filter((id) => typeof id === "string")
  )
  const ran = list.some(
    (workspace) =>
      made.has(workspace.id) ||
      workspace.columns.some(
        (column) =>
          made.has(column.id) ||
          (column.group !== undefined && made.has(column.group)) ||
          column.panes.some((pane) => made.has(pane.id))
      )
  )
  if (ran) {
    throw new Refused(
      "conflict",
      "This command ran before: the workspaces hold what it made."
    )
  }
}

// The commands, as `commands.rs` runs them.

function dispatch(
  list: Arrangement,
  method: string,
  params: unknown,
  facts: Facts,
  seed: Seed
): Answer {
  // Its params are read first, then whether it ran before, as the kernel
  // reads them before the module's handler runs.
  const read = <T>(reading: (fields: Fields) => T): T => {
    const got = reading(fields(params, "the params"))
    unused(seed, list)
    return got
  }
  switch (method) {
    case "workspaces.open": {
      const opening = read(readOpen)
      const [pane, isNew] = openCommand(list, opening, facts, seed)
      return { pane, new: isNew }
    }
    case "workspaces.close": {
      const { pane } = read((f) => ({ pane: id(f.pane) }))
      close(list, pane, seed)
      break
    }
    case "workspaces.update": {
      const { pane, args } = read((f) => ({
        pane: id(f.pane),
        args: json(f.args),
      }))
      update(list, pane, args)
      break
    }
    case "workspaces.move_pane": {
      const { pane, place, grouped } = read((f) => ({
        pane: id(f.pane),
        place: placeOf(f.place),
        grouped: optional(f.grouped, bool),
      }))
      movePane(list, pane, place, grouped, seed)
      break
    }
    case "workspaces.move_column": {
      const { column, workspace, index } = read(readMoveColumn)
      moveColumn(list, column, workspace, index, seed)
      break
    }
    case "workspaces.move_workspace": {
      const { workspace, index } = read((f) => ({
        workspace: id(f.workspace),
        index: indexOf(f.index),
      }))
      moveWorkspace(list, workspace, index)
      break
    }
    case "workspaces.size": {
      const { column, width } = read((f) => ({
        column: id(f.column),
        width: optional(f.width, text),
      }))
      size(list, column, width)
      break
    }
    case "workspaces.height": {
      const { pane, height: share } = read((f) => ({
        pane: id(f.pane),
        height: optional(f.height, text),
      }))
      height(list, pane, share)
      break
    }
    case "workspaces.even": {
      const { column } = read((f) => ({ column: id(f.column) }))
      even(list, column)
      break
    }
    case "workspaces.maximize": {
      const { column, full } = read((f) => ({
        column: id(f.column),
        full: bool(f.full),
      }))
      maximize(list, column, full)
      break
    }
    case "workspaces.display": {
      const { column, shows } = read((f) => ({
        column: id(f.column),
        shows: optional(f.display, displayOf),
      }))
      display(list, column, shows)
      break
    }
    case "workspaces.group": {
      const { column } = read((f) => ({ column: id(f.column) }))
      group(list, column, seed)
      break
    }
    case "workspaces.regroup": {
      const { column, toward } = read((f) => ({
        column: id(f.column),
        toward: oneOf(f.toward, ["left", "right"] as const),
      }))
      regroup(list, column, toward)
      break
    }
    case "workspaces.move_group": {
      const { column, workspace, index } = read(readMoveColumn)
      moveGroup(list, column, workspace, index, seed)
      break
    }
    case "workspaces.fill": {
      const { column, filling } = read((f) => ({
        column: id(f.column),
        filling: bool(f.fill),
      }))
      fill(list, column, filling)
      break
    }
    case "workspaces.tidy": {
      const { keep, projects } = read((f) => ({
        keep: optional(f.keep, id),
        projects: optional(f.projects, (v) => listOf(v, id)) ?? [],
      }))
      tidy(list, keep, projects)
      break
    }
    case "workspaces.arrange": {
      const { projects, only, leads } = read((f) => ({
        projects: optional(f.projects, (v) => listOf(v, id)) ?? [],
        only: optional(f.only, id),
        leads: optional(f.leads, (v) => listOf(v, text)) ?? [],
      }))
      arrange(list, projects, only, leads, seed)
      break
    }
    case "workspaces.take": {
      const { workspaces } = read((f) => ({
        workspaces: listOf(f.workspaces, workspaceOf),
      }))
      take(list, workspaces, seed)
      break
    }
    default: {
      const named = method.replace(/^workspaces\./, "")
      throw invalid(`The arrangement takes no command "${named}".`)
    }
  }
  return {}
}

/** Opens a Pane as `workspaces.open` says; answers it, and whether it is
 * new. One the workspaces show already is only named. One with no place
 * goes where `place` says, by `facts`. */
function openCommand(
  list: Arrangement,
  open: Open,
  facts: Facts,
  seed: Seed
): [string, boolean] {
  const again = open.again === true || open.instead !== undefined
  const shown = { project: open.project, kind: open.kind, args: open.args }
  const isNew = again || showing(list, shown) === undefined
  const grouped = open.grouped === true
  let { place, instead } = open
  // The Pane it was moved from to another Project, when it opens
  // elsewhere: from there, and that Pane leaves once the new one stands.
  const away =
    instead !== undefined &&
    place === undefined &&
    open.moved === true &&
    movesAway(list, facts.flow, open.project, instead)
      ? instead
      : undefined
  if (away !== undefined) instead = undefined
  if (place === undefined && instead === undefined)
    place = placeAsked(list, {
      flow: facts.flow,
      project: open.project,
      home: facts.home.includes(open.kind),
      scratch: open.scratch === true,
      from: away ?? open.from,
      on: open.on,
      agents: open.agents === true,
    })
  const opening: Opening = { shown, place, instead, width: open.width, again }
  const pane = openPane(list, opening, seed)
  if (isNew && grouped) groupPane(list, pane, seed)
  if (away !== undefined) close(list, away, seed)
  return [pane, isNew]
}

// Where a Pane with no place goes, as `placing.rs` says it.

/** A Pane to place, and the facts it is placed by, as `placing::Asked`:
 * all but an Agent's own tool, which no client's command runs. */
type Asked = {
  flow: Facts["flow"]
  project: string
  home: boolean
  scratch: boolean
  from: string | undefined
  on: string | undefined
  /** Opened for an Agent whose Thread no workspace shows. */
  agents: boolean
}

/** As `placing::place`: where the Pane goes by the Flow; none, where a
 * Pane with no place goes. */
function placeAsked(list: Arrangement, asked: Asked): Place | undefined {
  const { flow, project, home, scratch, from, on, agents } = asked
  const right = (pane: string): Place => ({ to: "beside", pane, side: "right" })
  const itsWorkspace: Place = scratch
    ? { to: "free" }
    : { to: "project", project }
  if (agents && flow === "row") return itsWorkspace
  // A Pane in front that has gone since counts as none, and so does a
  // workspace.
  const at = spotOr(list, from)
  const here = (): Place | undefined =>
    on !== undefined && list.some((w) => w.id === on)
      ? { to: "column", workspace: on, index: LAST }
      : undefined
  if (flow === "free") return at && from !== undefined ? right(from) : here()
  if (home) return itsWorkspace
  if (!at || from === undefined)
    return scratch ? here() : { to: "own", project }
  const workspace = list[at.workspace]
  const column = workspace.columns[at.column]
  const inItsGroup =
    column.group !== undefined && column.panes[at.pane].project === project
  const group: Place = { to: "group", pane: from }
  if (scratch) return inItsGroup ? group : right(from)
  if (column.group !== undefined && column.group === workspace.own)
    return { to: "own", project }
  if (inItsGroup) return group
  // A free one: no Project owns it, and the Pane in front is on it.
  return workspace.project === undefined ? right(from) : { to: "own", project }
}

/** As `placing::moves_away`: whether a Pane opened in place of `instead`,
 * in another Project than it, opens elsewhere. */
function movesAway(
  list: Arrangement,
  flow: Facts["flow"],
  project: string,
  instead: string
): boolean {
  const at = spotOr(list, instead)
  if (!at) return false
  const workspace = list[at.workspace]
  const was = workspace.columns[at.column].panes[at.pane].project
  return (
    flow === "row" &&
    was !== project &&
    workspace.project !== undefined &&
    workspace.project !== project
  )
}

// The params, read as serde reads them: a field left out or null is none
// where the engine's is an Option.

type Fields = Record<string, unknown>

const unfit = (why: string) =>
  invalid(`The call's parameters do not fit: ${why}.`)

function fields(value: unknown, what: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw unfit(`${what} are no object`)
  return value as Fields
}

function optional<T>(
  value: unknown,
  reading: (value: unknown) => T
): T | undefined {
  return value === undefined || value === null ? undefined : reading(value)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function id(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw unfit(`${JSON.stringify(value)} is no ID`)
  return value
}

function indexOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw unfit(`${JSON.stringify(value)} is no index`)
  return value
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw unfit(`${JSON.stringify(value)} is no boolean`)
  return value
}

function text(value: unknown): string {
  if (typeof value !== "string")
    throw unfit(`${JSON.stringify(value)} is no string`)
  return value
}

/** Any JSON, but present: null is a value. */
function json(value: unknown): JsonValue {
  if (value === undefined) throw unfit("a field is missing")
  return value as JsonValue
}

function oneOf<T extends string>(value: unknown, names: readonly T[]): T {
  if (!names.includes(value as T))
    throw unfit(`${JSON.stringify(value)} is none of ${names.join(", ")}`)
  return value as T
}

function listOf<T>(value: unknown, reading: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) throw unfit(`${JSON.stringify(value)} is no list`)
  return value.map(reading)
}

/** A Deck is read by its old name too, `tabs`, as the look's `Display`. */
function displayOf(value: unknown): Display {
  return value === "tabs" ? "deck" : oneOf(value, ["stack", "deck"] as const)
}

const SIDES: readonly Side[] = ["above", "below", "left", "right"]

function placeOf(value: unknown): Place {
  const f = fields(value, "a place's fields")
  switch (f.to) {
    case "column":
      return {
        to: "column",
        workspace: id(f.workspace),
        index: indexOf(f.index),
      }
    case "stack":
      return { to: "stack", column: id(f.column), index: indexOf(f.index) }
    case "beside":
      return { to: "beside", pane: id(f.pane), side: oneOf(f.side, SIDES) }
    case "workspace":
      return { to: "workspace", index: indexOf(f.index) }
    case "project":
      return { to: "project", project: id(f.project) }
    case "own":
      return { to: "own", project: id(f.project) }
    case "free":
      return { to: "free" }
    case "group":
      return { to: "group", pane: id(f.pane) }
  }
  throw unfit(`${JSON.stringify(f.to)} is no place`)
}

function readOpen(f: Fields): Open {
  return written({
    project: id(f.project),
    kind: text(f.kind),
    args: json(f.args),
    place: optional(f.place, placeOf),
    from: optional(f.from, id),
    on: optional(f.on, id),
    agents: optional(f.agents, bool),
    scratch: optional(f.scratch, bool),
    instead: optional(f.instead, id),
    moved: optional(f.moved, bool),
    width: optional(f.width, text),
    again: optional(f.again, bool),
    grouped: optional(f.grouped, bool),
  })
}

function readMoveColumn(f: Fields) {
  return {
    column: id(f.column),
    workspace: id(f.workspace),
    index: indexOf(f.index),
  }
}

function workspaceOf(value: unknown): Workspace {
  const f = fields(value, "a workspace's fields")
  return written({
    id: id(f.id),
    columns: listOf(f.columns, columnOf),
    filled: optional(f.filled, id),
    project: optional(f.project, id),
    own: optional(f.own, id),
  })
}

function columnOf(value: unknown): Column {
  const f = fields(value, "a column's fields")
  return written({
    id: id(f.id),
    panes: listOf(f.panes, paneOf),
    width: optional(f.width, text),
    // Left out, false; null is no boolean.
    full: f.full === undefined ? false : bool(f.full),
    display: optional(f.display, displayOf),
    group: optional(f.group, id),
  })
}

function paneOf(value: unknown): Pane {
  const f = fields(value, "a Pane's fields")
  return written({
    id: id(f.id),
    project: id(f.project),
    kind: text(f.kind),
    args: json(f.args),
    by: optional(f.by, id),
    height: optional(f.height, text),
  })
}

/** `value` without the fields it has none of, as serde writes it. */
function written<T extends object>(value: T): T {
  const all = value as Record<string, unknown>
  for (const key of Object.keys(all))
    if (all[key] === undefined) delete all[key]
  return value
}

/** Gives `object` its `key`, or leaves the field out for none. */
function assign<T extends object, K extends keyof T>(
  object: T,
  key: K,
  value: T[K] | undefined
): void {
  if (value === undefined) delete object[key]
  else object[key] = value
}

// The model, as `model.rs` keeps its rules.

function blank(id: string): Workspace {
  return { id, columns: [] }
}

/** Where a Pane is: its workspace, its column and its place in it. */
type Spot = { workspace: number; column: number; pane: number }

function spot(list: Arrangement, pane: string): Spot {
  const at = spotOr(list, pane)
  if (!at) throw notFound("The workspaces show no such Pane.")
  return at
}

/** Where a Pane is; none when the workspaces show no such Pane. */
function spotOr(list: Arrangement, pane: string | undefined): Spot | undefined {
  for (const [w, workspace] of list.entries()) {
    for (const [c, column] of workspace.columns.entries()) {
      const p = column.panes.findIndex((other) => other.id === pane)
      if (p >= 0) return { workspace: w, column: c, pane: p }
    }
  }
  return undefined
}

function columnAt(list: Arrangement, column: string): [number, number] {
  for (const [w, workspace] of list.entries()) {
    const c = workspace.columns.findIndex((other) => other.id === column)
    if (c >= 0) return [w, c]
  }
  throw notFound("The workspaces have no such column.")
}

function columnMut(list: Arrangement, column: string): Column {
  const [w, c] = columnAt(list, column)
  return list[w].columns[c]
}

function workspaceAt(list: Arrangement, workspace: string): number {
  const w = list.findIndex((other) => other.id === workspace)
  if (w < 0) throw notFound("There is no such workspace.")
  return w
}

function panesOf(workspace: Workspace): Pane[] {
  return workspace.columns.flatMap((column) => column.panes)
}

/** Two Panes are the same when they show the same: their args as JSON,
 * whatever the order of their keys, as serde_json's `Value`. */
function same(a: Shown, b: Shown): boolean {
  return a.project === b.project && a.kind === b.kind && alike(a.args, b.args)
}

function alike(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => alike(item, b[i]))
    )
  }
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && alike(a[key], b[key]))
  )
}

function showing(list: Arrangement, shown: Shown): Pane | undefined {
  return list.flatMap(panesOf).find((pane) => same(pane, shown))
}

/** A Pane to open: what it shows, and how. */
type Opening = {
  shown: Shown
  place?: Place
  instead?: string
  width?: string
  again: boolean
}

function openPane(list: Arrangement, opening: Opening, seed: Seed): string {
  const { shown, place, instead, width, again } = opening
  checkShown(shown)
  checkWidth(width)
  if (place !== undefined && instead !== undefined) {
    throw invalid("A Pane opens at a place or instead of another, not both.")
  }
  const named = showing(list, shown)
  if (named && !again && instead === undefined) return named.id
  const pane: Pane = { id: seed.pane, ...shown }
  if (instead !== undefined) {
    const at = spot(list, instead)
    list[at.workspace].columns[at.column].panes[at.pane] = pane
  } else {
    const where: Place = place ?? {
      to: "column",
      workspace: list[showingProject(list, pane.project)].id,
      index: LAST,
    }
    put(list, newColumn(pane, width, seed.column), where, undefined, seed)
  }
  normalize(list, seed)
  return pane.id
}

function newColumn(pane: Pane, width: string | undefined, id: string): Column {
  return written({ id, panes: [pane], width, full: false })
}

/**
 * Puts a column at `place`. `grouped`, as the mouse let it go beside a
 * Pane at a Group's end, says whether a column of its own goes inside
 * that Pane's Group or out of it.
 */
function put(
  list: Arrangement,
  column: Column,
  place: Place,
  grouped: boolean | undefined,
  seed: Seed
): void {
  switch (place.to) {
    case "column": {
      const w = workspaceAt(list, place.workspace)
      const at = Math.min(place.index, list[w].columns.length)
      list[w].columns.splice(at, 0, column)
      settle(list, w, at, undefined)
      return
    }
    case "stack": {
      const panes = columnMut(list, place.column).panes
      const at = Math.min(place.index, panes.length)
      panes.splice(at, 0, ...column.panes)
      return
    }
    case "beside": {
      const at = spot(list, place.pane)
      const columns = list[at.workspace].columns
      if (place.side === "above" || place.side === "below") {
        const index = at.pane + (place.side === "below" ? 1 : 0)
        columns[at.column].panes.splice(index, 0, ...column.panes)
        return
      }
      const index = at.column + (place.side === "right" ? 1 : 0)
      const by = columns[at.column].group
      columns.splice(index, 0, column)
      const into =
        grouped === undefined ? undefined : grouped ? (by ?? null) : null
      settle(list, at.workspace, index, into)
      return
    }
    case "workspace": {
      const workspace = blank(seed.workspace)
      workspace.columns.push(column)
      list.splice(aboveEmpty(list, place.index), 0, workspace)
      return
    }
    case "project": {
      putLast(list, projectWorkspace(list, place.project), column, seed)
      return
    }
    case "own": {
      const w = projectWorkspace(list, place.project)
      const at = afterOwn(list[w])
      const group = (list[w].own ??= seed.group)
      list[w].columns.splice(at, 0, { ...column, group })
      return
    }
    case "free": {
      putLast(list, freeWorkspace(list), column, seed)
      return
    }
    case "group": {
      const at = spot(list, place.pane)
      const columns = list[at.workspace].columns
      const group = (columns[at.column].group ??= seed.group)
      const next = at.column + 1
      const deck = columns[next]
      if (deck !== undefined && deck.group === group) {
        deck.panes.push(...column.panes)
      } else {
        columns.splice(next, 0, { ...column, group, display: "deck" })
      }
      return
    }
  }
}

/** The workspace `project` owns, even emptied; else the empty one at the
 * bottom, which it owns then (ADR 0102, decision 1). */
function projectWorkspace(list: Arrangement, project: string): number {
  const owned = list.findIndex((w) => w.project === project)
  const w = owned >= 0 ? owned : list.length - 1
  list[w].project = project
  return w
}

/** Just past the last column of a workspace's own Group, where `own` puts
 * a Pane; its start when it has none. */
function afterOwn(workspace: Workspace): number {
  const own = workspace.own
  if (own === undefined) return 0
  return workspace.columns.findLastIndex((c) => c.group === own) + 1
}

/** The top free workspace, one no Project owns that holds a Pane; else
 * the empty one at the bottom (ADR 0102, decision 1). */
function freeWorkspace(list: Arrangement): number {
  const free = list.findIndex(
    (w) => w.project === undefined && w.columns.length > 0
  )
  return free >= 0 ? free : list.length - 1
}

/** Puts a column last on workspace `w`. */
function putLast(list: Arrangement, w: number, column: Column, seed: Seed) {
  const workspace = list[w].id
  put(list, column, { to: "column", workspace, index: LAST }, undefined, seed)
}

/** The top workspace that shows a Pane of `project`, else the empty one
 * at the bottom. */
function showingProject(list: Arrangement, project: string): number {
  const w = list.findIndex((workspace) =>
    panesOf(workspace).some((pane) => pane.project === project)
  )
  return w >= 0 ? w : list.length - 1
}

function close(list: Arrangement, pane: string, seed: Seed): void {
  const at = spot(list, pane)
  list[at.workspace].columns[at.column].panes.splice(at.pane, 1)
  normalize(list, seed)
}

function update(list: Arrangement, pane: string, args: JsonValue): void {
  const at = spot(list, pane)
  const shows = list[at.workspace].columns[at.column].panes[at.pane]
  checkShown({ ...shows, args })
  shows.args = args
}

function movePane(
  list: Arrangement,
  pane: string,
  place: Place,
  grouped: boolean | undefined,
  seed: Seed
): void {
  if (place.to === "beside" && place.pane === pane) {
    throw invalid("A Pane moves beside another, not itself.")
  }
  const at = spot(list, pane)
  const here = list[at.workspace].id
  const from = list[at.workspace].columns
  const [moving] = from[at.column].panes.splice(at.pane, 1)
  // Its height was of the column it leaves.
  delete moving.height
  let column: Column
  if (from[at.column].panes.length === 0) {
    if (place.to === "stack" && place.column === from[at.column].id) {
      from[at.column].panes.push(moving)
      return
    }
    ;[column] = from.splice(at.column, 1)
    column.panes = [moving]
  } else {
    // Taken out of its column to one of its own beside it, a Pane stays
    // in the column's Group.
    const own = from[at.column]
    const beside =
      place.to === "column"
        ? place.workspace === here &&
          (place.index === at.column || place.index === at.column + 1)
        : place.to === "beside"
          ? (place.side === "left" || place.side === "right") &&
            own.panes.some((other) => other.id === place.pane)
          : false
    column = newColumn(moving, undefined, seed.column)
    if (beside && own.group !== undefined) column.group = own.group
  }
  put(list, column, place, grouped, seed)
  normalize(list, seed)
}

/** Whether the column at `c` stands with one Group's columns on both
 * sides of it. */
function flanked(columns: Column[], c: number): boolean {
  const left = c >= 1 ? columns[c - 1].group : undefined
  return left !== undefined && columns[c + 1]?.group === left
}

function moveColumn(
  list: Arrangement,
  column: string,
  workspace: string,
  index: number,
  seed: Seed
): void {
  const [w, c] = columnAt(list, column)
  const [moving] = list[w].columns.splice(c, 1)
  put(list, moving, { to: "column", workspace, index }, undefined, seed)
  normalize(list, seed)
}

function moveWorkspace(
  list: Arrangement,
  workspace: string,
  index: number
): void {
  const w = workspaceAt(list, workspace)
  if (w + 1 === list.length) {
    throw invalid("The empty workspace at the bottom stays there.")
  }
  const [moving] = list.splice(w, 1)
  list.splice(aboveEmpty(list, index), 0, moving)
}

function size(
  list: Arrangement,
  column: string,
  width: string | undefined
): void {
  checkWidth(width)
  const [w, c] = columnAt(list, column)
  // A Group that filled the screen no longer does.
  if (
    list[w].filled !== undefined &&
    list[w].filled === list[w].columns[c].group
  ) {
    delete list[w].filled
  }
  const sized = list[w].columns[c]
  assign(sized, "width", width)
  sized.full = false
}

function height(
  list: Arrangement,
  pane: string,
  share: string | undefined
): void {
  checkHeight(share)
  const at = spot(list, pane)
  assign(list[at.workspace].columns[at.column].panes[at.pane], "height", share)
}

function even(list: Arrangement, column: string): void {
  for (const pane of columnMut(list, column).panes) delete pane.height
}

function maximize(list: Arrangement, column: string, full: boolean): void {
  columnMut(list, column).full = full
}

function display(
  list: Arrangement,
  column: string,
  shows: Display | undefined
): void {
  assign(columnMut(list, column), "display", shows)
}

/** The columns of the Group the one at `c` is in, from `start` to before
 * `end`: it alone when it is in none. */
function run(columns: Column[], c: number): { start: number; end: number } {
  const group = columns[c].group
  if (group === undefined) return { start: c, end: c + 1 }
  let start = c
  while (start > 0 && columns[start - 1].group === group) start--
  let end = c
  while (end < columns.length && columns[end].group === group) end++
  return { start, end }
}

/**
 * A column just put at `at` of workspace `w` joins the Group whose columns
 * stand on both sides of it; else it goes `into` the Group the mouse said
 * (`null` for none; `undefined` when the mouse said nothing); else it
 * leaves its own when that Group's other columns stand elsewhere.
 */
function settle(
  list: Arrangement,
  w: number,
  at: number,
  into: string | null | undefined
): void {
  const columns = list[w].columns
  const left = at >= 1 ? columns[at - 1].group : undefined
  const right = columns[at + 1]?.group
  if (flanked(columns, at)) {
    columns[at].group = left
    return
  }
  if (into !== undefined) {
    assign(columns[at], "group", into ?? undefined)
    return
  }
  const own = columns[at].group
  if (own === undefined) return
  const beside = left === own || right === own
  const elsewhere = list.some((workspace, v) =>
    workspace.columns.some(
      (other, i) => other.group === own && !(v === w && i === at)
    )
  )
  if (!beside && elsewhere) delete columns[at].group
}

/** A Group, or a column in none, that `arrange` moves. */
type Moving = {
  /** The Project whose workspace it goes to; none, a free one. */
  home: string | undefined
  columns: Column[]
  /** It goes into the Project's own Group, or just after it. */
  own: boolean
  /** It filled the screen. */
  filled: boolean
}

/** Puts every Group, and every column in none, where the row would have
 * opened it (ADR 0102, decisions 4, 7 and 9): on its Project's workspace,
 * when it is one of `projects`, which have one; else last on the top free
 * one. What it is of is its lead's Project, a Pane of one of the kinds
 * that `leads` (an Agent's Thread), else its first Pane's, as when it
 * moves (decision 6). On its Project's workspace, the Person's own goes
 * into the own Group, first: one with no lead and no Pane an Agent
 * opened, or the Project's own Group. A column in none joins it, and a
 * Group becomes it or stands just after it, in the order they stood. Any
 * other goes last. A Group that filled the screen fills it there, when
 * none does. One already there stays, but for the Person's own column in
 * none, which joins the own Group; with `only`, only that Project's move, and
 * none already there. */
function arrange(
  list: Arrangement,
  projects: readonly string[],
  only: string | undefined,
  leads: readonly string[],
  seed: Seed
): void {
  const moving: Moving[] = []
  for (const workspace of list) {
    let c = 0
    while (c < workspace.columns.length) {
      const { start, end } = run(workspace.columns, c)
      const panes = workspace.columns
        .slice(start, end)
        .flatMap((column) => column.panes)
      const lead = panes.find((pane) => leads.includes(pane.kind))
      // An Agent's: led by its Thread, or with a Pane it opened.
      const ofAnAgent =
        lead !== undefined || panes.some((pane) => pane.by !== undefined)
      const project = (lead ?? workspace.columns[c].panes[0]).project
      const home = projects.includes(project) ? project : undefined
      const group = workspace.columns[c].group
      const wasOwn = group !== undefined && group === workspace.own
      const own = home !== undefined && (wasOwn || !ofAnAgent)
      // On its workspace, but for the Person's own column in none
      // when the Person arranges.
      const settled = group !== undefined || !own || only !== undefined
      const there = workspace.project === home && settled
      if (there || (only !== undefined && only !== project)) {
        c = end
        continue
      }
      const filled = group !== undefined && group === workspace.filled
      if (wasOwn) delete workspace.own
      if (filled) delete workspace.filled
      moving.push({
        home,
        columns: workspace.columns.splice(start, end - start),
        own,
        filled,
      })
    }
  }
  let made = 0
  // On each workspace, the columns of the Groups put just after its own
  // Group: the next Group goes past them, so they stand as they stood.
  const after = new Map<number, number>()
  for (const { home, columns, own, filled } of moving) {
    const w =
      home === undefined ? freeWorkspace(list) : projectWorkspace(list, home)
    const group = columns[0].group
    const to = list[w]
    if (own && home !== undefined) {
      // Last into the own Group, as the place `own` puts a Pane; made
      // first when there is none.
      let at = afterOwn(to)
      if (to.own === undefined) {
        to.own = group ?? seed.own(home)
      } else if (group !== undefined) {
        // A Group goes past those put there before.
        const past = after.get(w) ?? 0
        at += past
        after.set(w, past + columns.length)
      }
      // A column in none joins it; a Group stays itself.
      columns[0].group = group ?? to.own
      to.columns.splice(at, 0, ...columns)
    } else {
      to.columns.push(...columns)
    }
    if (filled && to.filled === undefined) to.filled = group
    // The empty one at the bottom taken: a new one under it.
    if (w === list.length - 1) list.push(blank(seed.nth(made++)))
  }
  normalize(list, seed)
}

/** Whether `at`, a place between two columns, stands inside a Group. */
function inside(columns: Column[], at: number): boolean {
  const left = at >= 1 ? columns[at - 1]?.group : undefined
  return left !== undefined && columns[at]?.group === left
}

function group(list: Arrangement, column: string, seed: Seed): void {
  columnMut(list, column).group ??= seed.group
}

function groupPane(list: Arrangement, pane: string, seed: Seed): void {
  const at = spot(list, pane)
  group(list, list[at.workspace].columns[at.column].id, seed)
}

function regroup(list: Arrangement, column: string, toward: Toward): void {
  const [w, c] = columnAt(list, column)
  const columns = list[w].columns
  if (columns[c].group !== undefined) {
    const { start, end } = run(columns, c)
    const [leaving] = columns.splice(c, 1)
    delete leaving.group
    columns.splice(toward === "left" ? start : end - 1, 0, leaving)
    return
  }
  const beside = toward === "left" ? c - 1 : c + 1
  const joining = beside >= 0 ? columns[beside]?.group : undefined
  if (joining === undefined) {
    throw invalid("No Group stands beside the column that way.")
  }
  columns[c].group = joining
}

function moveGroup(
  list: Arrangement,
  column: string,
  workspace: string,
  index: number,
  seed: Seed
): void {
  const [w, c] = columnAt(list, column)
  const moved = list[w].columns[c].group
  if (moved === undefined) {
    moveColumn(list, column, workspace, index, seed)
    return
  }
  const to = workspaceAt(list, workspace)
  const { start, end } = run(list[w].columns, c)
  const moving = list[w].columns.splice(start, end - start)
  if (list[w].filled === moved) {
    delete list[w].filled
    list[to].filled = moved
  }
  const columns = list[to].columns
  let at = Math.min(index, columns.length)
  if (inside(columns, at)) at = run(columns, at).end
  columns.splice(at, 0, ...moving)
  normalize(list, seed)
}

function fill(list: Arrangement, column: string, filling: boolean): void {
  const [w, c] = columnAt(list, column)
  const filled = list[w].columns[c].group
  if (filled === undefined) throw invalid("The column is in no Group.")
  assign(list[w], "filled", filling ? filled : undefined)
}

/** Lets every empty workspace go but `keep` and the last. */
function tidy(
  list: Arrangement,
  keep: string | undefined,
  projects: readonly string[]
): void {
  const last = list.at(-1)?.id
  const kept = list.filter(
    (w) =>
      w.columns.length > 0 ||
      w.id === keep ||
      w.id === last ||
      (w.project !== undefined && projects.includes(w.project))
  )
  list.splice(0, list.length, ...kept)
}

function take(list: Arrangement, taken: Arrangement, seed: Seed): void {
  const all: Arrangement = [...taken, ...list]
  const seen: Shown[] = []
  for (const workspace of all) {
    for (const column of workspace.columns) {
      column.panes = column.panes.filter((pane) => {
        const twice = seen.some((other) => same(other, pane))
        if (!twice) seen.push(pane)
        return !twice
      })
    }
  }
  const ids = new Set<string>()
  const fresh = (id: string) => !ids.has(id) && Boolean(ids.add(id))
  for (const workspace of all) {
    let unique = fresh(workspace.id)
    for (const column of workspace.columns) {
      checkWidth(column.width)
      unique = fresh(column.id) && unique
      for (const pane of column.panes) {
        checkShown(pane)
        checkHeight(pane.height)
        unique = fresh(pane.id) && unique
      }
    }
    if (!unique) {
      throw invalid("Each workspace, column and Pane needs an ID of its own.")
    }
  }
  normalize(all, seed)
  // Of the empty workspaces, only the last stays.
  // A Project's workspace, emptied, keeps its place (ADR 0102, decision 2).
  const projects = all.flatMap((w) => (w.project ? [w.project] : []))
  tidy(all, undefined, projects)
  list.splice(0, list.length, ...all)
}

/** `index` from the top, or past the last, the last above the empty
 * workspace at the bottom. */
function aboveEmpty(list: Arrangement, index: number): number {
  return Math.min(index, Math.max(list.length - 1, 0))
}

/** Keeps the rules: a column with no Pane goes, the last workspace is an
 * empty one, and a column of a Group that stands apart from the rest of
 * it leaves it. */
function normalize(list: Arrangement, seed: Seed): void {
  const groups = new Set<string>()
  for (const workspace of list) {
    workspace.columns = workspace.columns.filter((c) => c.panes.length > 0)
    let before: string | undefined
    for (const column of workspace.columns) {
      const group = column.group
      if (group !== undefined && before !== group) {
        if (groups.has(group)) delete column.group
        else groups.add(group)
      }
      before = column.group
    }
    // A Group the workspace names, gone from it, is named no more.
    const holds = (g: string) => workspace.columns.some((c) => c.group === g)
    if (workspace.filled !== undefined && !holds(workspace.filled)) {
      delete workspace.filled
    }
    if (workspace.own !== undefined && !holds(workspace.own)) {
      delete workspace.own
    }
  }
  // A Project's, emptied, is never the empty one at the bottom (ADR 0102,
  // decision 2).
  const last = list.at(-1)
  if (
    last === undefined ||
    last.columns.length > 0 ||
    last.project !== undefined
  ) {
    list.push(blank(seed.bottom))
  }
}

function checkShown(shown: Shown): void {
  const kind = shown.kind
  const dot = kind.indexOf(".")
  if (dot <= 0 || dot === kind.length - 1) {
    throw invalid(`"${kind}" is no Pane's kind: it is <module>.<pane>.`)
  }
  const args = shown.args
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw invalid("A Pane's args are an object.")
  }
}

function checkWidth(width: string | undefined): void {
  checkShare(width, "width", "screen")
}

function checkHeight(share: string | undefined): void {
  checkShare(share, "height", "column")
}

function checkShare(value: string | undefined, what: string, of: string) {
  if (value !== undefined && shareOf(value) === undefined) {
    throw invalid(
      `"${value}" is no ${what}: a share of the ${of}, such as "1/2" or "1".`
    )
  }
}

// A share, as `share` in `platform/look/src/columns.rs` reads it.

/** What Rust's `str::trim` trims: Unicode's white space. */
const SPACE =
  "[\\t-\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]"
const TRIMMED = new RegExp(`^${SPACE}+|${SPACE}+$`, "g")

/** A number as Rust's `f64` reads one, `inf` and `nan` too. */
const FLOAT = /^[+-]?(?:inf|infinity|nan|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i

function float(text: string): number | undefined {
  if (!FLOAT.test(text)) return undefined
  const sign = text.startsWith("-") ? -1 : 1
  if (/inf/i.test(text)) return sign * Infinity
  if (/nan/i.test(text)) return NaN
  return Number(text)
}

/** A width's share of the screen: more than 0, at most 1. */
function shareOf(width: string): number | undefined {
  const trimmed = width.replace(TRIMMED, "")
  const slash = trimmed.indexOf("/")
  let value: number | undefined
  if (slash >= 0) {
    const top = float(trimmed.slice(0, slash).replace(TRIMMED, ""))
    const bottom = float(trimmed.slice(slash + 1).replace(TRIMMED, ""))
    if (top === undefined || bottom === undefined || bottom === 0) return
    value = top / bottom
  } else {
    value = float(trimmed)
  }
  return value !== undefined &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1
    ? value
    : undefined
}
