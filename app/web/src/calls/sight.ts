/**
 * Where the Person looks, for a thing that calls (ADR 0011, decision 1),
 * from the workspaces and whether the window is in front. Pure, so plain
 * tests cover it.
 */
import type { SpaceId } from "@banda/contract"
import type { Columns } from "@banda/contract/look"
import type { PaneState } from "@banda/ui/pane"
import {
  current,
  entries,
  focused,
  shownIn,
  type Workspaces,
} from "../workspaces/model"
import type { Sight } from "./tell"

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
