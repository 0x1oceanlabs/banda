/**
 * Where the Person looks, for a thing that calls (ADR 0011, decision 1),
 * from the workspaces and whether the window is in front. Pure, so plain
 * tests cover it.
 */
import type { ProjectId } from "@banda/contract"
import type { Columns } from "@banda/contract/look"
import type { Sight } from "@banda/ui/module"
import { type Call, type Lists, listedOf, type PaneState } from "@banda/ui/pane"
import {
  current,
  entries,
  find,
  focused,
  shownIn,
  type Workspaces,
} from "../workspaces/model"

/** The thing a Pane shows, as the registry knows it. */
export type Shows = (pane: PaneState) => string | null

/** Whether an entry shows the thing. */
export function isShowing(
  entry: { project: ProjectId; pane: PaneState },
  thing: { project: ProjectId; about: string },
  shows: Shows
): boolean {
  return entry.project === thing.project && shows(entry.pane) === thing.about
}

/** A tile behind another tab is not on screen (`look.display`). */
export function sightOf(
  workspaces: Workspaces,
  thing: { project: ProjectId; about: string },
  front: boolean,
  shows: Shows,
  look?: Pick<Columns, "display">
): Sight {
  if (!front) return "away"
  const isIt = (entry: { project: ProjectId; pane: PaneState }) =>
    isShowing(entry, thing, shows)
  const entry = focused(workspaces)
  if (entry && isIt(entry)) return "looking"
  const onScreen = current(workspaces).columns.some((column) =>
    shownIn(column, look).some(isIt)
  )
  return onScreen ? "on-screen" : "in-window"
}

/** The entry that shows the thing, on any workspace, if one does. */
export function showing(
  workspaces: Workspaces,
  thing: { project: ProjectId; about: string },
  shows: Shows
) {
  return entries(workspaces).find((entry) => isShowing(entry, thing, shows))
}

/**
 * Where the thing `agent` works in is, for `WindowApi.beside`: its Project,
 * from what the modules list; the entry that shows it, on any workspace;
 * and the Panes of the column right of that entry's. None when nothing
 * listed is that Agent's.
 */
export function besideOf(
  workspaces: Workspaces,
  lists: Lists,
  agent: string,
  shows: Shows
): { project: ProjectId; from?: string; right: PaneState[] } | null {
  const thing = listedOf(lists, agent)
  if (!thing) return null
  const { project } = thing
  const entry = showing(workspaces, { project, about: thing.listed.id }, shows)
  const at = entry && find(workspaces, entry.id)
  if (!entry || !at) return { project, right: [] }
  const next = workspaces.list[at.workspace].columns[at.column + 1]
  const right = next?.entries.map((each) => each.pane) ?? []
  return { project, from: entry.id, right }
}

/**
 * The call `Alt+U` goes to (ADR 0079, decision 4): the first below the
 * Thread at `here`, in the sidebar's `order` of `project:thing` keys, and
 * from the end back to the top. It has no order of its own, the loudest
 * first or the like: a call the sidebar lists nowhere comes last, the one
 * that called first first.
 */
export function nextCall(
  calling: readonly Call[],
  order: readonly string[],
  here?: string
): Call | undefined {
  const place = new Map(order.map((key, i) => [key, i]))
  const at = (call: Call) => place.get(call.key) ?? order.length
  const sorted = calling
    .filter((call) => call.key !== here)
    .sort((a, b) => at(a) - at(b) || a.since - b.since)
  const from = (here === undefined ? undefined : place.get(here)) ?? -1
  return sorted.find((call) => at(call) > from) ?? sorted[0]
}
