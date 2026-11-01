/**
 * Where the Person looks, for a thing that calls (ADR 0011, decision 1),
 * from the workspaces and whether the window is in front. Pure, so plain
 * tests cover it.
 */
import type { SpaceId } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { current, entries, focused, type Workspaces } from "../workspaces/model"
import type { Sight } from "./tell"

/** The thing a Pane shows, as the registry knows it. */
export type Shows = (pane: PaneState) => string | null

export function sightOf(
  workspaces: Workspaces,
  thing: { space: SpaceId; about: string },
  front: boolean,
  shows: Shows
): Sight {
  if (!front) return "away"
  const isIt = (entry: { space: SpaceId; pane: PaneState }) =>
    entry.space === thing.space && shows(entry.pane) === thing.about
  const entry = focused(workspaces)
  if (entry && isIt(entry)) return "looking"
  const onScreen = current(workspaces).columns.some((column) =>
    column.entries.some(isIt)
  )
  return onScreen ? "on-screen" : "in-window"
}

/** The entry that shows the thing, on any workspace, if one does. */
export function showing(
  workspaces: Workspaces,
  thing: { space: SpaceId; about: string },
  shows: Shows
) {
  return entries(workspaces).find(
    (entry) => entry.space === thing.space && shows(entry.pane) === thing.about
  )
}
