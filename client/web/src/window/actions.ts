/**
 * What the window does, as one list of actions (ADR 0005, decisions 2 and
 * 10): the modules' own and the window's (ADR 0022, decision 3). The keys,
 * the Banda menu, its key sheet and `keys.toml` read the same list.
 */
import type {
  Engine,
  JsonValue,
  ProjectId,
  ProjectSummary,
} from "@banda/contract"
import { toast } from "@banda/ui/components/sonner"
import { seenNamed } from "@banda/ui/hooks/use-status"
import { updateProject } from "@banda/ui/lib/projects"
import {
  type Action,
  type Args,
  itemArgs,
  itemOf,
  takes,
  type WindowApi,
} from "@banda/ui/module"
import { IN_PROGRAM, type PaneState, paneOf, type Place } from "@banda/ui/pane"
import { RESET_KEY } from "../actions/actions"
import { chipOf } from "./attach"
import { device } from "../boot"
import { showing } from "../calls/sight"
import { columnsOf } from "../look"
import { type At, locateRoute } from "../menu/menu"
import { modules } from "../modules"
import {
  groupedOf,
  homeOf,
  leads,
  identityOf,
  launcher,
  minOf,
  showsOf,
  widthOf,
  windowModule,
} from "../registry"
import { AGENTS_FILE, type Flow } from "@banda/contract/agents"
import { tomlOf } from "@banda/contract/settings"
import { fileNow } from "@banda/ui/lib/look"
import { isFlow, nextFlow } from "../sidebar/FlowMenu"
import { archiving } from "../sidebar/items"
import { makeProject } from "../titles/MakeProject"
import { pickLater } from "../sidebar/LaterPicker"
import { logged } from "../sidebar/write-setting"
import {
  type Change,
  columnMoved,
  moved,
  opened,
  type Plan,
  resized,
  type Step,
  workspaceMoved,
} from "../tiling/arrange"
import { filling, grouping, regrouping, shiftingInside } from "../tiling/groups"
import { floorOf, roomLeft } from "../tiling/layout"
import {
  across,
  bring,
  carry,
  consume,
  current,
  deck,
  type Direction,
  edge,
  entries,
  even,
  fill,
  find,
  focusEntry,
  focused,
  focusedColumn,
  isFree,
  movingAs,
  REFUSED,
  admits,
  fresh,
  go,
  heighten,
  heightTo,
  maximize,
  move,
  open,
  type Opening,
  samePane,
  send,
  share,
  shift,
  step,
  toEdge,
  widen,
  type Workspaces,
} from "../tiling/model"

/** What the window's own actions can change: its parts, more than a
 * module's get (`WindowApi`). */
export type Shell = WindowApi & {
  /** Changes the workspaces. */
  change: (how: Change) => void
  toggleSidebar: () => void
  /** Shows the sidebar, as a notice of many calls asks (ADR 0011). */
  showSidebar: () => void
  toggleOverview: () => void
  /** Drops the drawer, or lifts it (ADR 0025, decision 8). */
  drawer: () => void
  /** Shows the focused Pane over the whole window, or brings it back. */
  zoom: () => void
  /** Opens the focused Pane in a window of its own, or brings it back to
   * its place (ADR 0025, decision 9). */
  popOut: () => void
  /** Brings the focused column to the middle of the screen, once. */
  center: () => void
  /** Goes to the Pane `pane.pick` asks for, the one way to go to an
   * Agent (ADR 0087, decision 7): where a workspace shows it, else where
   * it opens (`picking`), and brings it to the left once drawn (ADR 0065,
   * decision 8). Only that action calls it. */
  pick: (project: ProjectId, pane: PaneState) => void
  /** Goes to what calls the Person first (ADR 0011, decision 5). */
  answer: () => void
  /** Closes every Pane that shows `item` of `project`, on any workspace:
   * it is put away, archived or put off (ADR 0069; ADR 0074). */
  putAway: (project: ProjectId, item: string) => void
  /** Opens the Banda menu, or closes it when it is open (ADR 0017). */
  menu: (at: At) => void
  /** Has what peeks over the desk fill it, or float again (ADR 0073,
   * decision 7); false when nothing peeks. */
  fillPeek: () => boolean
  /** Takes the Sheet away while it shows (ADR 0102, decision 5); false
   * when none does. */
  closeSheet: () => boolean
  /** In solo, the workspace in view as the row for a while, or back to
   * solo (ADR 0079); false when the Flow is not solo. */
  glance: () => boolean
  /** Opens the Banda menu at a route, or the settings at theirs, as
   * `banda menu ROUTE` does (ADR 0017, decision 7). */
  route: (route: string) => void
  /** The window's own keys again, until keys.toml changes; the settings
   * open at Keys to mend it (ADR 0005, decision 11). */
  ownKeys: () => void
  /** Opens the settings at `link`, a section and a row (ADR 0016). */
  settings: (link?: string) => void
  /** Asks an Agent to look into a Problem, in a new Thread (ADR 0039). */
  lookInto: (fingerprint: string) => void
  /** Quits Banda: stops the engine and its Agents, asking first while
   * they work (ADR 0086, decision 3). */
  quit: () => void
  /** The engine, for what the window asks of it itself, as a title for a
   * Thread (ADR 0077). */
  engine: Engine
}

/** What a module is given of `shell`, a steady face of it (`useSteady`):
 * its `WindowApi` alone, so an App's `start` and its widgets reach no more
 * of the Window than the API says. */
export function windowApiOf(shell: Shell): WindowApi {
  return {
    get home() {
      return shell.home
    },
    open: shell.open,
    here: shell.here,
    beside: shell.beside,
    items: shell.items,
    run: shell.run,
    sessionOf: shell.sessionOf,
    sight: shell.sight,
    projects: shell.projects,
    look: shell.look,
    writeSetting: shell.writeSetting,
    attach: shell.attach,
    peek: shell.peek,
  }
}

const ARROWS: Record<Direction, string> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
}
const DIRECTIONS = Object.keys(ARROWS) as Direction[]
/**
 * Up and down, past a column's end the arrows go on to the workspace
 * there, as niri's `focus-window-or-workspace-down`; held, they stop at
 * the end. The ones that stay in the column are kept with no key, for
 * that and for `keys.toml`.
 */
const PAST: Partial<Record<Direction, string>> = { up: "above", down: "below" }
const UPRIGHT = ["up", "down"] as const
const PAGES = { up: "PageUp", down: "PageDown" } as const
const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const EDGES = [
  { side: "first", code: "Home" },
  { side: "last", code: "End" },
] as const

/**
 * Steps the focused column's width through the look's presets, by what
 * the window shows: a preset its `min` hides is passed over.
 */
function resize(shell: Shell, by: 1 | -1, wrap = false) {
  shell.change((w) => {
    const workspace = current(w)
    const column = workspace.columns[workspace.focus]
    if (!column) return undefined
    const look = columnsOf()
    const floor = floorOf(workspace.id, minOf(column, look.min))
    return resized(w, widen(w, by, look, { floor, wrap }))
  })
}

/** Steps the focused Pane's height through the look's `heights`. */
function heightening(shell: Shell, by: 1 | -1, wrap = false) {
  shell.change((w) => resized(w, heighten(w, by, columnsOf(), { wrap })))
}

/** Moves the focused Pane as `how` would: sideways its whole column, or
 * its whole Group (ADR 0065). */
function shifting(w: Workspaces, direction: Direction): Step {
  const workspace = current(w)
  const column = workspace.columns[workspace.focus]
  const entry = focused(w)
  const next = shift(w, direction)
  if (!column || !entry || next === w) return undefined
  return direction === "left" || direction === "right"
    ? columnMoved(next, column.id)
    : moved(next, entry.id)
}

/** Moves the focused column, or its whole Group, to the first or the last
 * place. */
function movedTo(w: Workspaces, side: "first" | "last"): Step {
  const workspace = current(w)
  const column = workspace.columns[workspace.focus]
  const next = toEdge(w, side)
  return column && next !== w ? columnMoved(next, column.id) : undefined
}

/** Puts every Pane where the row would have opened it, or with `only`
 * that Project's alone: last on its Project's workspace, one of no
 * Project, or of none open, on a free one (ADR 0102, decisions 7 and 9). */
export function arranging(
  workspaces: Workspaces,
  projects: readonly ProjectSummary[],
  only?: ProjectId
): Plan {
  const homed = projects.filter((one) => !one.scratch).map((one) => one.id)
  return {
    command: {
      method: "workspaces.arrange",
      params: { projects: homed, ...(only !== undefined && { only }) },
    },
    // The Pane in front goes along to where it is put.
    want: focused(workspaces)?.id,
  }
}

/** Whether a Pane is the focused one of `workspaces`, by all its args. */
export function focusedIn(workspaces: Workspaces) {
  const entry = focused(workspaces)
  return (project: ProjectId, pane: PaneState) =>
    entry !== undefined && samePane(entry, { project, pane }, identityOf)
}

/** What the Threads away from their Project's workspace show, on a free
 * one or another Project's, in the row and solo: their sidebar rows say so
 * (ADR 0102, decision 6). */
export function strayedIn(
  workspaces: Workspaces,
  { flow, scratch }: Placing
): ReadonlySet<string> {
  if (flow === "free") return new Set()
  return new Set(
    workspaces.list
      .flatMap((workspace) =>
        workspace.columns
          .flatMap((c) => c.entries)
          .filter((entry) => entry.project !== workspace.project)
      )
      .filter(
        (entry) => !scratch(entry.project) && homeOf(entry.pane) === "project"
      )
      .flatMap((entry) => showsOf(entry.pane) ?? [])
  )
}

/** Moves the focused Pane where `how` puts it, and follows it; one in a
 * Group that `how` sends to another workspace takes its Group, as one
 * window (ADR 0065). */
function moving(w: Workspaces, how: (w: Workspaces) => Workspaces): Step {
  const { workspace, column } = focusedColumn(w)
  const entry = focused(w)
  const next = how(w)
  if (!entry || next === w) return undefined
  const to = current(next).id
  // Never onto another Project's workspace, in the row and solo (ADR
  // 0102, decision 6): it says why, once however long the key is held.
  const as = movingAs(w, entry.id, column?.group !== undefined, leads)
  if (
    to !== workspace.id &&
    as !== undefined &&
    !admits(current(next), as) &&
    fileNow(AGENTS_FILE).flow !== "free"
  ) {
    toast(REFUSED, {
      id: REFUSED,
      description: "A Pane goes to its Project's workspace, or to a free one.",
    })
    return undefined
  }
  if (column?.group !== undefined && to !== workspace.id) {
    const plan = columnMoved(next, column.id)
    return plan && { ...plan, want: entry.id }
  }
  return moved(next, entry.id)
}

/** Shows a Pane of a Project and focuses it, as `how` says; a new column
 * takes its width. A Pane is the one shown as its kind names it, so a
 * Project has one Diff. */
export function opening(
  workspaces: Workspaces,
  project: ProjectId,
  pane: PaneState,
  how: Omit<Opening, "width"> = {}
): Step {
  const next = open(workspaces, project, pane, {
    identity: identityOf,
    ...how,
    width: widthOf(pane),
  })
  // As `placeFor` says (ADR 0102, decision 3): in the Group of the Pane it
  // opens from, last on its Project's workspace, into its own Group there,
  // or on the top free workspace.
  const from = how.from ?? focused(workspaces)?.id
  const plan = opened(workspaces, next, {
    place:
      how.place === "group" && from
        ? { to: "group", pane: from }
        : how.place === "project" || how.place === "own"
          ? { to: how.place, project }
          : how.place === "free"
            ? { to: "free" }
            : undefined,
    grouped: groupedOf(pane),
  })
  if (!plan) return next
  return how.focus === false ? { ...plan, focus: false } : plan
}

/** Shows a Pane as `opening` does; one already shown, as its kind names
 * it, takes these args and the focus, as a file's Pane the line a link
 * names. */
export function updating(
  workspaces: Workspaces,
  project: ProjectId,
  pane: PaneState,
  how: Omit<Opening, "width"> = {}
): Step {
  const wanted = { project, pane }
  const shown = entries(workspaces).find((entry) =>
    samePane(entry, wanted, identityOf)
  )
  // None shown, or one with these args: as `opening` does.
  if (!shown || samePane(shown, wanted))
    return opening(workspaces, project, pane, how)
  return {
    command: {
      method: "workspaces.update",
      params: { pane: shown.id, args: pane.args },
    },
    want: shown.id,
  }
}

/** Shows a Pane here, right of the focused one, with its width; one
 * another workspace shows moves here. */
export function bringing(
  workspaces: Workspaces,
  project: ProjectId,
  pane: PaneState
): Step {
  const next = bring(workspaces, project, pane, {
    place: "right",
    width: widthOf(pane),
    identity: identityOf,
  })
  const away = entries(workspaces).find(
    (entry) =>
      samePane(entry, { project, pane }, identityOf) &&
      !current(workspaces).columns.some((c) => c.entries.includes(entry))
  )
  // The one that moved here shows anew in `next`, under another ID.
  const was = new Set(entries(workspaces).map((entry) => entry.id))
  const here = entries(next).find((entry) => !was.has(entry.id))
  if (away && here) return moved(next, away.id, here.id)
  return opened(workspaces, next, { grouped: groupedOf(pane) }) ?? next
}

/** How the Person works the Panes: the Flow, and whether a Project is a
 * scratch one, of no Project (ADR 0046). */
export type Placing = { flow: Flow; scratch: (project: ProjectId) => boolean }

/** Those of no Project, the Projects as they are now: the scratch ones,
 * and a draft in the `machine`'s own ID, as a new one in No Project
 * starts. None of them owns a workspace (ADR 0102, decision 1). */
export function noProjectOf(
  projects: readonly ProjectSummary[],
  machine?: ProjectId
): ProjectId[] {
  const scratch = projects.filter((one) => one.scratch).map((one) => one.id)
  return machine ? [machine, ...scratch] : scratch
}

/** How the Person works the Panes in `flow`, with `none` of no Project
 * (`noProjectOf`). */
export function placingOf(flow: Flow, none: readonly ProjectId[]): Placing {
  return { flow, scratch: (project) => none.includes(project) }
}

/**
 * Where a Pane the Person opens goes, by the Flow and the Projects as they
 * are now (`placingOf`; ADR 0102, decision 3).
 * In the Flow `free`, right of the Pane in front. In the row and solo:
 * - one an Agent opens with its Thread not shown (`agent`), or a Thread, as
 *   its kind's `home` says, last on its Project's workspace, or, of no
 *   Project, on the top free workspace;
 * - a Pane opened from a Group of its Project, into that Group, of no
 *   Project too;
 * - another Pane of no Project, right of the Pane in front;
 * - one opened on a free workspace, right of the Pane in front;
 * - any other, last into its Project's own Group, first on its workspace.
 */
export function placeFor(
  workspaces: Workspaces,
  project: ProjectId,
  pane: PaneState,
  { flow, scratch }: Placing,
  agent = false
): Place {
  if (flow === "free") return "right"
  const none = scratch(project)
  if (agent || homeOf(pane) === "project") return none ? "free" : "project"
  const { workspace, column } = focusedColumn(workspaces)
  const from = column?.entries[column.active]
  const grouped = column?.group !== undefined && from?.project === project
  if (none) return grouped ? "group" : "right"
  // From the Project's own Group, last into it, not stacked in a Deck.
  if (column?.group !== undefined && column.group === workspace.own)
    return "own"
  if (grouped) return "group"
  return isFree(workspace) ? "right" : "own"
}

/**
 * Goes to the Pane picked (`pane.pick`, ADR 0087, decision 7): to the one
 * a workspace shows, on any workspace, by the thing it shows (`shows`),
 * else by what makes it that Pane; else opens it where the Flow says
 * (`placeFor`, ADR 0102, decision 3).
 */
export function picking(
  workspaces: Workspaces,
  project: ProjectId,
  pane: PaneState,
  placing: Placing
): Step {
  const about = showsOf(pane)
  const entry =
    about === null
      ? undefined
      : showing(workspaces, { project, about }, showsOf)
  return entry
    ? focusEntry(workspaces, entry.id)
    : placed(workspaces, project, pane, placing)
}

/**
 * Whether a Pane opened in place of `from` goes elsewhere, where the Flow
 * says (`placeFor`): in the row and solo, one that shows what `from`
 * showed, in another Project that the workspace holding `from` does not
 * take, as a draft the Person moves to another Project, or to none (ADR
 * 0102, decision 1). A draft that became its Thread with its first
 * message stays where it stood.
 */
export function movesAway(
  workspaces: Workspaces,
  from: string,
  project: ProjectId,
  pane: PaneState,
  { flow }: Placing
): boolean {
  if (flow === "free") return false
  const at = find(workspaces, from)
  if (!at) return false
  const workspace = workspaces.list[at.workspace]
  const was = workspace.columns[at.column].entries[at.entry]
  return (
    was.project !== project &&
    showsOf(was.pane) === showsOf(pane) &&
    !admits(workspace, project)
  )
}

/**
 * Opens a Pane as a tile asks (`Frame.open`), by `changing`, from the
 * workspaces as drawn now. One in place of `from` that its workspace does
 * not take (`movesAway`) opens anew where the Flow says, and the window
 * follows it; `from` closes once it is drawn there, so no workspace
 * empties in between.
 */
export function openFrom(
  changing: (how: Change) => Promise<string | undefined>,
  workspaces: Workspaces,
  placing: Placing,
  project: ProjectId,
  pane: PaneState,
  from: string,
  place?: Place
): Promise<unknown> {
  if (
    place !== "instead" ||
    !movesAway(workspaces, from, project, pane, placing)
  )
    return changing((w) => opening(w, project, pane, { from, place }))
  return changing((w) =>
    placed(w, project, pane, placing, { again: true })
  ).then((entry) => entry && changing(() => closing(from)))
}

/** Opens the Pane where the Flow says (`placeFor`), as `how` says. */
export function placed(
  workspaces: Workspaces,
  project: ProjectId,
  pane: PaneState,
  placing: Placing,
  how: Omit<Opening, "width" | "place"> = {}
): Step {
  const place = placeFor(workspaces, project, pane, placing)
  return opening(workspaces, project, pane, { ...how, place })
}

/** What `pane.pick` is asked: a Project, and the Pane to open in it, its
 * kind and args, as an Item carries it; none when its args are not that. */
export function pickOf(
  args: Args | undefined
): { project: ProjectId; pane: PaneState } | undefined {
  const { project, pane } = args ?? {}
  if (typeof project !== "string" || !isArgs(pane)) return undefined
  const { kind, args: shown } = pane
  if (typeof kind !== "string" || !isArgs(shown)) return undefined
  return { project: project as ProjectId, pane: { kind, args: shown } }
}

/** Whether `value` is an object of JSON values, as a Pane's args are. */
function isArgs(value: JsonValue | undefined): value is Args {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Closes a Pane; its neighbour takes the focus. */
export function closing(pane: string): Plan {
  return { command: { method: "workspaces.close", params: { pane } } }
}

/**
 * Closes a Pane that shows the thing, on any workspace, as a Thread the
 * Person archives leaves them (ADR 0008, decision 4); nothing when none
 * shows it.
 */
export function closingShown(
  workspaces: Workspaces,
  thing: { project: ProjectId; about: string }
): Plan | undefined {
  const entry = showing(workspaces, thing, showsOf)
  return entry && closing(entry.id)
}

/** What a file action takes. */
const FILE = "the file's absolute path"

/**
 * Does `then` with the file `args` name, if it is there still; a toast
 * says when it has gone since its link was drawn (ADR 0063, decision 2).
 */
function present(args: Args | undefined, then: (file: string) => void) {
  const file = args?.file
  if (typeof file !== "string") return
  void device.files.exists(file)?.then((there) => {
    if (there) then(file)
    else toast.warning(`No such file: ${file}`)
  })
}

/**
 * Writes the Flow into agents.toml (ADR 0079), for its key and for the
 * sidebar's menu; the look brings it back. What went wrong goes to the
 * console, as it did from the menu.
 */
function writeFlow(shell: Shell, flow: Flow) {
  const file = AGENTS_FILE.name
  logged(file, shell.writeSetting(file, "flow", tomlOf(flow)))
}

/** The other machines a stop is on its way to, by their keys: a second
 * click meanwhile sends no second `banda stop`. */
const stopping = new Set<string>()

/**
 * Stops Banda on another machine, by its key in `hosts.toml` (ADR 0095,
 * decision 6): its own `banda stop` there. While its Agents work, nothing
 * stops; a toast asks once whether to stop them too. One stop at a time
 * goes to each, and one toast says of it.
 */
function stopHost(host: string, force = false) {
  if (stopping.has(host)) return
  stopping.add(host)
  const { name } = seenNamed(host)
  const id = `hosts.stop:${host}`
  device.hosts
    .stop(host, force)
    .then(
      (said) => {
        if (said === "working")
          toast(`Agents work on ${name}`, {
            id,
            description: "Stopping Banda there stops them too.",
            action: {
              label: "Stop anyway",
              onClick: () => stopHost(host, true),
            },
          })
      },
      (error: unknown) => {
        console.error(`banda: Banda on ${host} was not stopped`, error)
        toast.error(`Banda on ${name} was not stopped. Try again.`, { id })
      }
    )
    .finally(() => stopping.delete(host))
}

/** The window's own actions, the tiling's first (ADR 0071, decision 2):
 * `client/web/window.json` copies them for the engine. */
export const WINDOW_ACTIONS: readonly Action<Shell>[] = [
  ...DIRECTIONS.map((direction) => ({
    id: `pane.focus-${direction}`,
    section: "Panes",
    family: "Focus a Pane",
    title: `Focus the Pane ${direction}`,
    keys: PAST[direction] ? [] : [{ code: ARROWS[direction], mod: true }],
    run: (shell: Shell) => shell.change((w) => move(w, direction)),
  })),
  ...DIRECTIONS.map((direction) => ({
    id: `pane.move-${direction}`,
    section: "Panes",
    family: "Move the Pane",
    title: `Move the Pane ${direction}`,
    keys: PAST[direction]
      ? []
      : [{ code: ARROWS[direction], mod: true, shift: true }],
    run: (shell: Shell) => shell.change((w) => shifting(w, direction)),
  })),
  ...UPRIGHT.map((direction) => ({
    id: `pane.focus-${direction}-or-workspace`,
    section: "Panes",
    family: "Focus a Pane, or the workspace past it",
    title: `Focus the Pane ${direction}, or the workspace ${PAST[direction]}`,
    keys: [{ code: ARROWS[direction], mod: true }],
    whenHeld: `pane.focus-${direction}`,
    run: (shell: Shell) => shell.change((w) => across(w, direction)),
  })),
  ...UPRIGHT.map((direction) => ({
    id: `pane.move-${direction}-or-to-workspace`,
    section: "Panes",
    family: "Move the Pane, or to the workspace past it",
    title: `Move the Pane ${direction}, or to the workspace ${PAST[direction]}`,
    keys: [{ code: ARROWS[direction], mod: true, shift: true }],
    whenHeld: `pane.move-${direction}`,
    run: (shell: Shell) =>
      shell.change((w) => moving(w, (w) => carry(w, direction))),
  })),
  {
    id: "column.wider",
    section: "Columns",
    title: "Make the column wider",
    keys: [{ code: "ArrowRight", mod: true, more: true }],
    run: (shell) => resize(shell, 1),
  },
  {
    id: "column.narrower",
    section: "Columns",
    title: "Make the column narrower",
    keys: [{ code: "ArrowLeft", mod: true, more: true }],
    run: (shell) => resize(shell, -1),
  },
  {
    id: "column.next-width",
    section: "Columns",
    title: "The column's next width, round",
    // As niri's Mod+R and Mod+Shift+R.
    keys: [{ code: "KeyR", mod: true }],
    run: (shell) => resize(shell, 1, true),
  },
  {
    id: "column.previous-width",
    section: "Columns",
    title: "The column's previous width, round",
    // Alt+Shift+R is the height now, as niri's; Alt+Ctrl+Left steps back.
    run: (shell) => resize(shell, -1, true),
  },
  {
    id: "column.fill",
    section: "Columns",
    title: "The column as wide as the room the others leave",
    // As niri's Mod+Ctrl+F.
    keys: [{ code: "KeyF", mod: true, more: true }],
    run: (shell) =>
      shell.change((w) => {
        const width = roomLeft(current(w))
        return width === undefined ? undefined : resized(w, fill(w, width))
      }),
  },
  {
    id: "column.width",
    args: takes({ width: "a step of the look's, as 1/2" }, ["width"]),
    section: "Columns",
    title: "The column as wide as a step of the look's",
    // A picture in the Pane menu (ADR 0066, decision 3): `{ width: "1/2" }`.
    unlisted: true,
    run: (shell, args) => {
      const width = args?.width
      if (typeof width !== "string" || share(width) === undefined) return
      shell.change((w) => resized(w, fill(w, width)))
    },
  },
  {
    id: "column.center",
    section: "Columns",
    title: "The column in the middle of the screen",
    // As niri's Mod+C.
    keys: [{ code: "KeyC", mod: true }],
    run: (shell) => shell.center(),
  },
  // As niri's Mod+Home and End, and Mod+Ctrl+Home and End.
  ...EDGES.flatMap(({ side, code }) => [
    {
      id: `column.${side}`,
      section: "Columns",
      title: `Focus the ${side} column`,
      keys: [{ code, mod: true }],
      run: (shell: Shell) => shell.change((w) => edge(w, side)),
    },
    {
      id: `column.move-${side}`,
      section: "Columns",
      title: `Move the column to the ${side} place`,
      keys: [{ code, mod: true, shift: true }],
      run: (shell: Shell) => shell.change((w) => movedTo(w, side)),
    },
  ]),
  {
    id: "pane.next-height",
    section: "Panes",
    title: "The Pane's next height in its column, round",
    // As niri's Mod+Shift+R.
    keys: [{ code: "KeyR", mod: true, shift: true }],
    run: (shell) => heightening(shell, 1, true),
  },
  {
    id: "pane.taller",
    section: "Panes",
    title: "Make the Pane taller",
    keys: [{ code: "ArrowDown", mod: true, more: true }],
    run: (shell) => heightening(shell, 1),
  },
  {
    id: "pane.shorter",
    section: "Panes",
    title: "Make the Pane shorter",
    keys: [{ code: "ArrowUp", mod: true, more: true }],
    run: (shell) => heightening(shell, -1),
  },
  {
    id: "pane.height",
    args: takes({ height: "a step of the look's, as 1/3" }, ["height"]),
    section: "Panes",
    title: "The Pane as high in its column as a step of the look's",
    // A picture in the Pane menu (ADR 0066, decision 3): `{ height: "1/3" }`.
    unlisted: true,
    run: (shell, args) => {
      const height = args?.height
      if (typeof height !== "string") return
      shell.change((w) => resized(w, heightTo(w, height, columnsOf())))
    },
  },
  {
    id: "column.even",
    section: "Columns",
    title: "Every Pane of the column as high as the others",
    // As niri's Mod+Ctrl+R.
    keys: [{ code: "KeyR", mod: true, more: true }],
    run: (shell) => shell.change((w) => resized(w, even(w))),
  },
  {
    id: "pane.zoom",
    section: "Panes",
    title: "The Pane over the whole window, or back",
    // As niri's Mod+Shift+F, fullscreen in the window.
    keys: [{ code: "KeyF", mod: true, shift: true }],
    run: (shell) => shell.zoom(),
  },
  {
    id: "column.tabs",
    section: "Columns",
    title: "The column as a Deck, one Pane at a time, or one above another",
    // niri's Mod+W; Alt+G starts a Group (ADR 0065).
    keys: [{ code: "KeyT", mod: true }],
    run: (shell) => shell.change((w) => resized(w, deck(w, columnsOf()))),
  },
  // Groups: columns held together, which move and look as one (ADR 0065).
  {
    id: "group.new",
    section: "Groups",
    title: "A Group of the column, for others to join",
    keys: [{ code: "KeyG", mod: true }],
    run: (shell) => shell.change(grouping),
  },
  ...(["left", "right"] as const).flatMap((side) => [
    {
      id: `group.join-${side}`,
      section: "Groups",
      title: `The column into the Group on the ${side}, or out of its own that way`,
      keys: [
        {
          code: side === "left" ? "BracketLeft" : "BracketRight",
          mod: true,
          shift: true,
        },
      ],
      run: (shell: Shell) => shell.change((w) => regrouping(w, side)),
    },
    {
      id: `group.column-${side}`,
      section: "Groups",
      title: `Move the column ${side} inside its Group`,
      keys: [{ code: ARROWS[side], mod: true, more: true, shift: true }],
      run: (shell: Shell) => shell.change((w) => shiftingInside(w, side)),
    },
  ]),
  {
    id: "group.maximize",
    section: "Groups",
    title:
      "The Group the whole screen wide, or back; in solo, the row for a while",
    keys: [{ code: "KeyM", mod: true }],
    run: (shell) => {
      if (!shell.glance()) shell.change(filling)
    },
  },
  {
    id: "flow.solo",
    section: "Workspaces",
    title: "Solo, every Agent the whole screen wide, or back to the row",
    keys: [{ code: "KeyM", mod: true, shift: true }],
    run: (shell) => writeFlow(shell, nextFlow(fileNow(AGENTS_FILE).flow)),
  },
  {
    id: "workspaces.arrange",
    section: "Workspaces",
    title: "Arrange by Project",
    run: (shell) => shell.change((w) => arranging(w, shell.projects())),
  },
  {
    // The sidebar's Flow menu: a pick of the three, where the key only
    // goes to solo and back.
    id: "flow.pick",
    args: takes({ flow: "free, row or solo" }, ["flow"]),
    section: "Workspaces",
    title: "Pick how the Agents' windows stand: free, row or solo",
    unlisted: true,
    run: (shell, args) => {
      if (isFlow(args?.flow)) writeFlow(shell, args.flow)
    },
  },
  {
    id: "pane.consume-left",
    section: "Panes",
    title: "Take the Pane into the column on the left, or out of its own",
    // As niri's Mod+[.
    keys: [{ code: "BracketLeft", mod: true }],
    run: (shell) => shell.change((w) => moving(w, (w) => consume(w, "left"))),
  },
  {
    id: "pane.consume-right",
    section: "Panes",
    title: "Take the Pane into the column on the right, or out of its own",
    keys: [{ code: "BracketRight", mod: true }],
    run: (shell) => shell.change((w) => moving(w, (w) => consume(w, "right"))),
  },
  {
    id: "column.maximize",
    section: "Columns",
    title: "The column the whole screen wide, or back",
    // As niri's Mod+F.
    keys: [{ code: "KeyF", mod: true }],
    run: (shell) => shell.change((w) => resized(w, maximize(w))),
  },
  {
    id: "pane.new",
    section: "Panes",
    title: "New Pane",
    keys: [{ code: "KeyN", mod: true }],
    run: (shell) => shell.open(paneOf(launcher, {})),
  },
  {
    id: "pane.close",
    section: "Panes",
    title: "Close the Pane",
    keys: [{ code: "KeyW", mod: true }],
    // The Sheet, while it shows; else the focused Pane.
    run: (shell) =>
      shell.closeSheet() ||
      shell.change((w) => {
        const entry = focused(w)
        return entry && closing(entry.id)
      }),
  },
  {
    // What an App asks once an Item is put away, as a Thread put off.
    id: "pane.put-away",
    args: takes(
      {
        project: "the Project of the Item",
        item: "the Item's id in its Project",
      },
      ["project", "item"]
    ),
    section: "Panes",
    title: "Close every Pane that shows an Item, on any workspace",
    unlisted: true,
    run: (shell, args) => {
      const { project, item } = args ?? {}
      if (typeof project === "string" && typeof item === "string")
        shell.putAway(project as ProjectId, item)
    },
  },
  {
    id: "pane.pop-out",
    section: "Panes",
    title: "The Pane in a window of its own, and back",
    run: (shell) => shell.popOut(),
  },
  {
    id: "drawer.toggle",
    section: "Threads",
    title: "The drawer: a quick Thread over the workspace",
    // As a terminal that drops down is: the key under Esc.
    keys: [{ code: "Backquote", mod: true }],
    overDialogs: true,
    run: (shell) => shell.drawer(),
  },
  {
    id: "overview.toggle",
    section: "Workspaces",
    title: "Overview of every window",
    keys: [{ code: "KeyO", mod: true }],
    run: (shell) => shell.toggleOverview(),
  },
  ...UPRIGHT.flatMap((direction): Action<Shell>[] => {
    const code = PAGES[direction]
    const by = direction === "up" ? -1 : 1
    return [
      {
        id: `workspace.${direction}`,
        section: "Workspaces",
        title: `The workspace ${PAST[direction]}`,
        keys: [{ code, mod: true }],
        run: (shell) => shell.change((w) => step(w, by)),
      },
      {
        id: `workspace.move-${direction}`,
        section: "Workspaces",
        title: `Move the workspace ${direction}`,
        keys: [{ code, mod: true, shift: true }],
        run: (shell) => shell.change((w) => workspaceMoved(w, by)),
      },
    ]
  }),
  {
    id: "workspace.new",
    section: "Workspaces",
    title: "A new workspace: the empty one at the bottom",
    run: (shell) => shell.change(fresh),
  },
  {
    // The one way to go to an Agent (ADR 0087, decision 7): a sidebar
    // row, a row of the counts list, a toast's button and Alt+U run it,
    // with the Pane as an Item carries it.
    id: "pane.pick",
    section: "Panes",
    title: "Go to a Pane where a workspace shows it, or open it",
    unlisted: true,
    run: (shell, args) => {
      const picked = pickOf(args)
      if (!picked) return
      // To a Pane, even the one in focus, which no focus goes to: the
      // Sheet goes (ADR 0102, decision 5).
      shell.closeSheet()
      shell.pick(picked.project, picked.pane)
    },
  },
  {
    id: "calls.answer",
    section: "Threads",
    title: "Go to what calls you",
    keys: [{ code: "KeyU", mod: true }],
    run: (shell) => shell.answer(),
  },
  archiving,
  {
    // Threads' "Make a Project from it…" (ADR 0046): its dialog is the
    // Window's, for a Project of No Project alone, missing or not, as the
    // Thread menu shows its row.
    id: "project.make",
    args: takes({ project: "the No Project's Project its Thread is in" }, [
      "project",
    ]),
    section: "Threads",
    title: "Make a Project from a Thread in No Project",
    unlisted: true,
    run: (_, args) => {
      if (typeof args?.project === "string")
        makeProject(args.project as ProjectId)
    },
  },
  {
    // The Later's picker (ADR 0074, decision 5): the sidebar list's, as
    // a Thread's App asks it when.
    id: "sidebar.later-picker",
    args: itemArgs(),
    section: "Threads",
    title: "Pick when the Thread you look at wakes",
    unlisted: true,
    run: (shell, args) => pickLater(itemOf(shell, args)),
  },
  {
    id: "menu.open",
    section: "Banda",
    title: "Banda menu",
    keys: [{ code: "Space", mod: true }],
    overDialogs: true,
    // Over Quick Look its key has the tile fill the desk, or float again,
    // as ⌥Space does in a Finder (ADR 0073, decision 7, as amended): the
    // menu opens once Quick Look is closed. A module opens it on one of
    // its sources alone, as Files' quick open does.
    args: takes({
      source: "a source's id, to show its rows alone, as files.find",
    }),
    run: (shell, args) => {
      if (typeof args?.source === "string")
        return shell.route(`find.${args.source}`)
      if (!shell.fillPeek()) shell.menu("root")
    },
  },
  {
    id: "menu.keys",
    section: "Banda",
    title: "Every action and its key",
    keys: [{ code: "KeyK", mod: true }],
    overDialogs: true,
    run: (shell) => shell.menu("actions"),
  },
  {
    // The sidebar's Search and its key sheet's button: the menu opens
    // there whatever shows, as `banda menu` opens it. Alt+Space is
    // menu.open's, which fills Quick Look where it shows, and Alt+K
    // closes the menu at its Actions. A route is a row's id in the menu
    // (ADR 0017), not a client's Route to a host.
    id: "menu.at",
    args: takes({
      route:
        "a route of banda menu, as actions or project.add; none for its root",
    }),
    section: "Banda",
    title: "Open the Banda menu at a route",
    unlisted: true,
    run: (shell, args) =>
      shell.route(typeof args?.route === "string" ? args.route : ""),
  },
  {
    // A file a Pane's link names, as a terminal's path or a reply's
    // (ADR 0063), at its line: in Files' `files.file` (ADR 0073).
    id: "file.open",
    args: takes({ file: FILE, project: "the Project it is in" }, ["file"]),
    section: "Banda",
    title: "Open a file in Banda",
    unlisted: true,
    run: (shell, args) =>
      present(args, (file) =>
        shell.run("files.open", {
          file,
          project: args?.project ?? null,
          line: args?.line ?? null,
        })
      ),
  },
  {
    // A reply's path in Quick Look, over the desk (ADR 0073, decision 12):
    // in Files' `files.file`, as it peeks.
    id: "file.peek",
    args: takes({ file: FILE, project: "the Project it is in" }, ["file"]),
    section: "Banda",
    title: "Quick Look at a file",
    unlisted: true,
    run: (shell, args) =>
      present(args, (file) =>
        shell.run("files.peek", { file, project: args?.project ?? null })
      ),
  },
  {
    // A file a Pane's link names, as a terminal's path with Ctrl.
    id: "file.outside",
    args: takes({ file: FILE }, ["file"]),
    runsAsPerson: true,
    section: "Banda",
    title: "Open a file in its app",
    unlisted: true,
    run: (_, args) => present(args, device.files.outside),
  },
  {
    // Files' "Add to chat" and a reply's "Add to message": the file named
    // in a Thread's message, as `@` names it; and a comment on some of
    // its lines, which the message quotes (ADR 0073, decisions 6 and 14).
    id: "file.attach",
    args: takes(
      {
        file: "the file's absolute path; a folder's ends with /",
        from: { number: "the first line commented on, from 1" },
        to: { number: "the last line commented on" },
        comment: "what the Person says of those lines",
        text: "those lines as they read",
      },
      ["file"]
    ),
    // The words go in the message, as the Person's.
    runsAsPerson: ["comment", "text"],
    section: "Banda",
    title: "Add a file to a Thread's message",
    unlisted: true,
    run: (shell, args) =>
      present(args, (path) => shell.attach(chipOf(path, args ?? {}))),
  },
  {
    // A Thread menu's "Show in folder", for a path in a reply.
    id: "file.folder",
    args: takes({ file: FILE }, ["file"]),
    runsAsPerson: true,
    section: "Banda",
    title: "Show a file in its folder",
    unlisted: true,
    run: (_, args) => present(args, device.files.show),
  },
  {
    // The menu's Paste, as a terminal's: the focused field takes it.
    id: "edit.paste",
    section: "Banda",
    title: "Paste",
    unlisted: true,
    run: () => device.edit.paste(),
  },
  {
    // The composer menu's "Paste as plain text".
    id: "edit.paste-plain",
    section: "Banda",
    title: "Paste as plain text",
    unlisted: true,
    run: () => device.edit.pastePlain(),
  },
  {
    // A Thread menu's "Copy image": the image at a point of the page.
    id: "edit.copy-image",
    args: takes(
      {
        x: { number: "where the image is, across the page" },
        y: { number: "where the image is, down the page" },
      },
      ["x", "y"]
    ),
    section: "Banda",
    title: "Copy image",
    unlisted: true,
    run: (_, args) => {
      if (typeof args?.x === "number" && typeof args.y === "number")
        device.edit.copyImageAt(args.x, args.y)
    },
  },
  {
    id: "project.add",
    section: "Banda",
    title: "Add Project",
    // The menu lists "Add Project" as its own branch; this opens it there.
    unlisted: true,
    run: (shell) => shell.route("project.add"),
  },
  // A Project's verbs, as its line in the sidebar list and its menu run
  // them (ADR 0026, decisions 5 and 6).
  {
    id: "projects.pin",
    args: takes(
      {
        project: "the Project",
        pinned: { flag: "true pins it, false unpins it" },
      },
      ["project", "pinned"]
    ),
    section: "Banda",
    title: "Pin a Project, so it comes first, or unpin it",
    unlisted: true,
    run: (shell, args) => {
      const { project, pinned } = args ?? {}
      if (typeof project !== "string" || typeof pinned !== "boolean") return
      updateProject(shell.engine, {
        project: project as ProjectId,
        pinned,
      }).catch((error: unknown) =>
        console.error("banda: the Project was not pinned", error)
      )
    },
  },
  {
    // The Person's Locate: it asks for the folder in the menu, which then
    // sends the engine's own `projects.locate` with the folder picked.
    id: "projects.locate",
    args: takes({ project: "the Project whose folder is missing" }, [
      "project",
    ]),
    section: "Banda",
    title: "Open the Banda menu to find a missing Project's folder",
    unlisted: true,
    run: (shell, args) => {
      if (typeof args?.project === "string")
        shell.route(locateRoute(args.project as ProjectId))
    },
  },
  {
    id: "projects.settings",
    args: takes({ project: "the Project" }, ["project"]),
    section: "Banda",
    title: "Open the settings at a Project's own",
    unlisted: true,
    run: (shell, args) => {
      if (typeof args?.project === "string")
        shell.settings(`projects/${args.project}`)
    },
  },
  {
    id: "settings.open",
    args: takes({ link: "a section, or a row in it, as keys" }),
    section: "Banda",
    title: "Open the settings",
    keys: [{ code: "Comma", mod: true }],
    // A Problem's toast opens it there: its `link` (ADR 0039).
    run: (shell, args) =>
      shell.settings(typeof args?.link === "string" ? args.link : undefined),
  },
  {
    // Another machine's label, its ⋯ (ADR 0095, decision 6).
    id: "hosts.stop",
    args: takes({ name: "the machine's key in hosts.toml" }, ["name"]),
    // It stops Banda there, and with it its Agents: the Person's alone,
    // as `banda stop` is.
    runsAsPerson: true,
    section: "Banda",
    title: "Stop Banda on another machine",
    unlisted: true,
    run: (_, args) => {
      if (typeof args?.name === "string") stopHost(args.name)
    },
  },
  {
    id: "problems.look-into",
    args: takes({ fingerprint: "the Problem's fingerprint" }, ["fingerprint"]),
    // It starts a Thread with what to ask its Agent.
    runsAsPerson: true,
    section: "Banda",
    title: "Look into a Problem",
    unlisted: true,
    run: (shell, args) => {
      if (typeof args?.fingerprint === "string")
        shell.lookInto(args.fingerprint)
    },
  },
  {
    id: "update.check",
    section: "Banda",
    title: "Check for updates",
    run: () => device.update.check(),
  },
  {
    id: "update.restart",
    section: "Banda",
    title: "Restart Banda to install its update",
    // The bar's update runs it; with no version ready it does nothing
    // (ADR 0041, decision 2).
    unlisted: true,
    run: () => device.update.restart(),
  },
  {
    id: "banda.quit",
    section: "Banda",
    title: "Quit Banda",
    // It stops the engine and its Agents; closing the window does not
    // (ADR 0086, decision 3). Where a program reads the keys, as in a
    // terminal, the key is the program's: Emacs' quoted insert.
    keys: [{ code: "KeyQ", primary: true }],
    when: () => !document.activeElement?.closest(IN_PROGRAM),
    run: (shell) => shell.quit(),
  },
  {
    id: "keys.reset",
    section: "Banda",
    title: "Banda's own keys, until keys.toml changes",
    // No file binds it, so keys bound away can always be mended.
    keys: [RESET_KEY],
    overDialogs: true,
    run: (shell) => shell.ownKeys(),
  },
  {
    id: "sidebar.toggle",
    section: "Threads",
    title: "Show or hide the sidebar",
    keys: [{ code: "KeyA", mod: true }],
    run: (shell) => shell.toggleSidebar(),
  },
  {
    id: "sidebar.show",
    section: "Threads",
    title: "Show the sidebar",
    // The notice of many calls shows it, which lists them all.
    unlisted: true,
    run: (shell) => shell.showSidebar(),
  },
  {
    // A number on the Bar, past the ninth too, where the keys stop.
    id: "workspace.go",
    args: takes({ index: { number: "its place from the top, from 0" } }, [
      "index",
    ]),
    section: "Workspaces",
    title: "Go to a workspace",
    unlisted: true,
    run: (shell, args) => {
      const index = args?.index
      if (typeof index === "number" && Number.isInteger(index))
        shell.change((w) => go(w, index))
    },
  },
  ...NUMBERS.map((n) => ({
    id: `workspace.go-${n}`,
    section: "Workspaces",
    family: "Go to a workspace",
    title: `Go to workspace ${n}`,
    keys: [{ code: `Digit${n}`, mod: true }],
    run: (shell: Shell) => shell.change((w) => go(w, n - 1)),
  })),
  ...NUMBERS.map((n) => ({
    id: `pane.send-${n}`,
    section: "Panes",
    family: "Move the Pane to a workspace",
    title: `Move the Pane to workspace ${n}`,
    keys: [{ code: `Digit${n}`, mod: true, shift: true }],
    run: (shell: Shell) =>
      shell.change((w) => moving(w, (w) => send(w, n - 1))),
  })),
  // The launcher's letters (ADR 0025, decision 4).
  ...windowModule.actions,
]

/** Where the modules' item actions stand among the Window's own: after
 * its own Thread actions, as the key sheet listed them while they were
 * the Window's. It goes with B4h, actions by owner. */
const ITEMS_AT =
  WINDOW_ACTIONS.findIndex((action) => action.id === "sidebar.archive") + 1

/** Every action: the modules' (`modules.ts`), then the window's own, with
 * the modules' item actions among them (ADR 0087, decision 12). */
export const ACTIONS: readonly Action<Shell>[] = [
  ...modules.flatMap((module) => module.actions),
  ...WINDOW_ACTIONS.slice(0, ITEMS_AT),
  ...modules.flatMap((module) => module.items),
  ...WINDOW_ACTIONS.slice(ITEMS_AT),
]

/** Runs the action `id` as its key would, with `args`. */
export function runAction(shell: Shell, id: string, args?: Args): void {
  const action = ACTIONS.find((action) => action.id === id)
  if (!action) throw new Error(`Banda has no action ${id}`)
  action.run(shell, args)
}
