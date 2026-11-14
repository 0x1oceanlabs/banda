/**
 * What opens a Pane, and where it is (ADR 0110): the window says what is
 * wanted, a Pane of a Project and where the Person is, and the engine
 * says where it goes (decision 3). Each function here works out one step
 * for the workspaces' one queue (`Change`), from the workspaces as they
 * are drawn; none decides a place the engine would.
 *
 *   in    the workspaces, a Project and its Pane, and `Placing`, how the
 *         Person works the Panes, as the Window lists the Projects
 *   gives `placed`, the one way a Pane the engine places opens; `opening`,
 *         at a place its caller named; `openingFrom`, as a tile asks;
 *         `bringing`, beside the Pane in focus; `picking`, to the Pane a
 *         pick names; `startingHere`, a first Pane on an empty workspace
 *         `closing` and `closingShown`, which take a Pane away
 *         `focusedIn` and `strayedIn`, what the sidebar list reads of
 *         where the Panes are
 *         `sayRefused`, the words of a move the engine refused
 */
import type { JsonValue, ProjectId, ProjectSummary } from "@banda/contract"
import type { Flow, Via } from "@banda/contract/workspaces"
import { toast } from "@banda/ui/components/sonner"
import type { Args } from "@banda/ui/module"
import type { PaneState, Place } from "@banda/ui/pane"
import { groupedOf, homeOf, identityOf, showsOf } from "../registry"
import {
  asking,
  moved,
  opened,
  type Plan,
  refusable,
  type Step,
} from "./arrange"
import type { RowRefusal } from "./arrangement"
import {
  bring,
  current,
  entries,
  focusEntry,
  focused,
  open,
  type Opening,
  refusalOf,
  samePane,
  showing,
  type Workspaces,
} from "./model"
import { factsOf } from "./useTiling"

/** How the Person works the Panes: the Flow, and whether a Project is a
 * scratch one, of no Project (ADR 0046). */
export type Placing = { flow: Flow; scratch: (project: ProjectId) => boolean }

/** How the Person works the Panes in `flow`, with `none` of no Project,
 * as the Window lists them. */
export function placingOf(flow: Flow, none: readonly ProjectId[]): Placing {
  return { flow, scratch: (project) => none.includes(project) }
}

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

/** The toast a refused move shows: one, however long the key is held. */
const REFUSED = "workspace-refused"

/** Words a move the engine refused onto another Project's workspace:
 * whose it is, and where a Pane that moves as its Project can go, by
 * `projectOf`, or as one of no Project when `scratch` says so
 * (`refusalOf`). The workspace is numbered as before the move, as the bar
 * shows it. `along`, its Group took the Pane along. */
export function sayRefused(
  { at, owner, moving }: RowRefusal,
  along: boolean,
  projectOf: (project: ProjectId) => ProjectSummary | undefined,
  scratch: Placing["scratch"]
) {
  const { title, description } = refusalOf({
    to: at,
    owner: projectOf(owner),
    as: projectOf(moving),
    scratch: scratch(moving),
    along,
  })
  toast(title, { id: REFUSED, description })
}

/** Shows a Pane of a Project and focuses it at the place its caller
 * named, as `how` says; a new column's width is the engine's to give, by
 * its kind (`placing::Facts::width`). A Pane is the one
 * shown as its kind names it, so a Project has one Diff. With no place, as
 * a Pane's own `open` leaves it out, it takes the place of the one of its
 * kind on the opener's workspace, or goes right of the opener. */
export function opening(
  workspaces: Workspaces,
  project: ProjectId,
  pane: PaneState,
  how: Omit<Opening, "width"> = {}
): Step {
  const next = open(workspaces, project, pane, {
    identity: identityOf,
    ...how,
  })
  // Into the Group of the Pane it opens from, as the engine names it.
  const from = how.from ?? focused(workspaces)?.id
  const plan = opened(workspaces, next, {
    place:
      how.place === "group" && from ? { to: "group", pane: from } : undefined,
    grouped: groupedOf(pane),
  })
  if (!plan) return next
  return how.focus === false ? { ...plan, focus: false } : plan
}

/** How a Pane the engine places opens (`placed`): as `Opening`, and with
 * `update`, one already shown takes these args; `agents`, it is opened
 * for an Agent, as the tab a browser opens for one. */
type Placed = Omit<Opening, "width" | "identity" | "keep"> & {
  update?: true
  agents?: boolean
  via?: Via
}

/**
 * Shows a Pane of a Project and focuses it, as `how` says. Where it goes
 * is the engine's to say (ADR 0110, decision 3): the window sends the Pane
 * and where the Person is (`asking`), and names a place only where its
 * caller named one (`how.place`, `opening`). One already shown, as its
 * kind names it, gets the focus instead, unless it opens `again`; with
 * `update` it takes these args first, as a file's Pane the line a link
 * names.
 */
export function placed(
  workspaces: Workspaces,
  project: ProjectId,
  pane: PaneState,
  placing: Placing,
  { update, agents, via = "key", ...how }: Placed = {}
): Step {
  const wanted = { project, pane }
  const shown = how.again
    ? undefined
    : entries(workspaces).find((entry) => samePane(entry, wanted, identityOf))
  if (shown && update && !samePane(shown, wanted))
    return {
      command: {
        method: "workspaces.update",
        params: { pane: shown.id, args: pane.args },
      },
      want: shown.id,
    }
  if (shown)
    return how.focus === false ? undefined : focusEntry(workspaces, shown.id)
  if (how.place !== undefined) return opening(workspaces, project, pane, how)
  const plan = asking(workspaces, wanted, {
    ...saidOf(project, pane, placing),
    from: how.from,
    agents,
    via,
  })
  return how.focus === false ? { ...plan, focus: false } : plan
}

/** What the window says of a Pane the engine places, beside where the
 * Person is: its kind's Group, and whether its Project is of no Project,
 * which the engine takes of another machine's alone. */
function saidOf(project: ProjectId, pane: PaneState, placing: Placing) {
  return {
    grouped: groupedOf(pane),
    scratch: placing.scratch(project),
  }
}

/** Shows a Pane here, right of the focused one; one
 * another workspace shows moves here. Onto another Project's workspace,
 * in the row and solo, the engine refuses it as it does a move, and as
 * `Alt+Shift+N` the window says why, by `projectOf` (ADR 0102, decision
 * 6). */
export function bringing(
  workspaces: Workspaces,
  project: ProjectId,
  pane: PaneState,
  placing: Placing,
  projectOf: (project: ProjectId) => ProjectSummary | undefined
): Step {
  const next = bring(workspaces, project, pane, {
    place: "right",
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
  const moves = away !== undefined && here !== undefined
  const plan = moves
    ? moved(next, away.id, here.id)
    : opened(workspaces, next, { grouped: groupedOf(pane), brought: true })
  if (!plan) return moves ? undefined : next
  return refusable(workspaces, plan, factsOf(placing.flow), (refused) =>
    sayRefused(refused, false, projectOf, placing.scratch)
  )
}

/**
 * Goes to the Pane picked (`pane.pick`, ADR 0087, decision 7): to the one
 * a workspace shows, on any workspace, by the thing it shows (`shows`),
 * else by what makes it that Pane; else opens it where the engine places
 * it (`placed`).
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
 * Opens a Pane as a tile asks (`Frame.open`), by a click in the tile
 * `from`: at the place it names, right of `from`, under it or instead of
 * it; else where the engine places it, into the Group of the Thread
 * `from` is or stands with (ADR 0134, decision 1). One already shown
 * gets the focus, and these args as its kind names it. One in place of
 * `from` that shows what `from` showed, in
 * another Project, as a draft the Person moves to another Project or to
 * none, says so and names no place: the engine has it take that place, or,
 * in the row on a workspace that is not its Project's, open where the Flow
 * says while `from` leaves (ADR 0102, decision 3). A draft that became its
 * Thread with its first message shows another thing, and stays.
 */
export function openingFrom(
  workspaces: Workspaces,
  project: ProjectId,
  pane: PaneState,
  placing: Placing,
  from: string,
  place?: Place
): Step {
  if (place === undefined || place === "group")
    return placed(workspaces, project, pane, placing, {
      from,
      via: "click",
      update: true,
    })
  const was = entries(workspaces).find((entry) => entry.id === from)
  const moved =
    place === "instead" &&
    was !== undefined &&
    was.project !== project &&
    showsOf(was.pane) === showsOf(pane)
  if (!moved) return opening(workspaces, project, pane, { from, place })
  const said = saidOf(project, pane, placing)
  return asking(workspaces, { project, pane }, { ...said, instead: from })
}

/**
 * Opens a first Pane on the empty workspace on screen, as its buttons do,
 * in its Project, else in `home`. On a Project's, where the keys would:
 * a terminal makes the Project's own Group there, and the next goes right
 * of it (ADR 0102, decision 4). On one of no Project the buttons name the
 * place: there, which makes it a free one (decision 1).
 */
export function startingHere(
  workspaces: Workspaces,
  home: ProjectId,
  pane: PaneState,
  placing: Placing
): Step {
  const { project } = current(workspaces)
  return project === undefined
    ? opening(workspaces, home, pane, { place: "right", again: true })
    : placed(workspaces, project, pane, placing, { again: true })
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

/** Whether a Pane is the focused one of `workspaces`, by all its args. */
export function focusedIn(workspaces: Workspaces) {
  const entry = focused(workspaces)
  return (project: ProjectId, pane: PaneState) =>
    entry !== undefined && samePane(entry, { project, pane }, identityOf)
}

/** What the Threads away from their Project's workspace show, on a free
 * one or another Project's, in the row and solo: their sidebar rows say so
 * (ADR 0102, decision 6). A Project with no workspace yet, as every one
 * after the Flow free, has none of its Threads away. */
export function strayedIn(
  workspaces: Workspaces,
  { flow, scratch }: Placing
): ReadonlySet<string> {
  if (flow === "free") return new Set()
  const owned = new Set(workspaces.list.map((workspace) => workspace.project))
  return new Set(
    workspaces.list
      .flatMap((workspace) =>
        workspace.columns
          .flatMap((c) => c.entries)
          .filter((entry) => entry.project !== workspace.project)
      )
      .filter(
        (entry) =>
          owned.has(entry.project) &&
          !scratch(entry.project) &&
          homeOf(entry.pane) === "project"
      )
      .flatMap((entry) => showsOf(entry.pane) ?? [])
  )
}
