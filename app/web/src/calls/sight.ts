/**
 * Where the Person looks, for a thing that calls (ADR 0011, decision 1),
 * from the workspaces and whether the window is in front. Pure, so plain
 * tests cover it.
 */
import type { SpaceId } from "@banda/contract"
import type { Columns } from "@banda/contract/look"
import { callOrder } from "@banda/ui/components/banda-mark"
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
  entry: { space: SpaceId; pane: PaneState },
  thing: { space: SpaceId; about: string },
  shows: Shows
): boolean {
  return entry.space === thing.space && shows(entry.pane) === thing.about
}

/** A tile behind another tab is not on screen (`look.display`). */
export function sightOf(
  workspaces: Workspaces,
  thing: { space: SpaceId; about: string },
  front: boolean,
  shows: Shows,
  look?: Pick<Columns, "display">
): Sight {
  if (!front) return "away"
  const isIt = (entry: { space: SpaceId; pane: PaneState }) =>
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
  thing: { space: SpaceId; about: string },
  shows: Shows
) {
  return entries(workspaces).find((entry) => isShowing(entry, thing, shows))
}

/**
 * Where the thing `agent` works in is, for `WindowApi.beside`: its Space,
 * from what the modules list; the entry that shows it, on any workspace;
 * and the Panes of the column right of that entry's. None when nothing
 * listed is that Agent's.
 */
export function besideOf(
  workspaces: Workspaces,
  lists: Lists,
  agent: string,
  shows: Shows
): { space: SpaceId; from?: string; right: PaneState[] } | null {
  const thing = listedOf(lists, agent)
  if (!thing) return null
  const { space } = thing
  const entry = showing(workspaces, { space, about: thing.listed.id }, shows)
  const at = entry && find(workspaces, entry.id)
  if (!entry || !at) return { space, right: [] }
  const next = workspaces.list[at.workspace].columns[at.column + 1]
  const right = next?.entries.map((each) => each.pane) ?? []
  return { space, from: entry.id, right }
}

/** The call to answer first, in the order calls are answered. */
export function first(calling: readonly Call[]): Call | undefined {
  return [...calling].sort(
    callOrder(
      (call) => call.chime,
      (call) => call.since
    )
  )[0]
}
