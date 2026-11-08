/**
 * Where the Person looks, for a thing that calls (ADR 0011, decision 1;
 * ADR 0087, decision 9), from the workspaces, what of the one on screen
 * shows, and whether the window is in front. Pure, so plain tests cover
 * it: what shows, the Tiling measures.
 */
import type { ProjectId } from "@banda/contract"
import type { Columns } from "@banda/contract/look"
import type { Sight } from "@banda/ui/module"
import { type Call, type Lists, listedOf, type PaneState } from "@banda/ui/pane"
import { placeIn } from "../sidebar/order"
import {
  type Column,
  current,
  entries,
  find,
  focused,
  shownIn,
  type Workspaces,
} from "../tiling/model"

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

/** How much of a Tile shows inside the Strip's clip for it to be on
 * screen (ADR 0087, decision 9). */
const ON_SCREEN_SHARE = 0.5

/** What of the workspace on screen shows: the share of each column inside
 * its Strip's clip, by its id, as the Tiling measures it (`shownOf`, in
 * `tiling/layout.ts`); none when nothing is measured. */
export type Shown = () => ReadonlyMap<string, number> | undefined

/** What the screen shows of the workspace on screen, past its model. */
export type Screen = {
  /** How columns show their Panes: a Tile behind another tab does not
   * show (`look.display`). */
  look?: Pick<Columns, "display">
  /** What of the Strip shows; left out, every column shows whole. */
  shown?: Shown
  /** The Panes in windows of their own (ADR 0025, decision 9): those
   * windows show them, wherever the Strip has their stand-ins. */
  away?: ReadonlySet<string>
  /** A Pane is zoomed over the whole window (`Alt+Shift+F`): the focused
   * one, and no other shows. */
  zoomed?: boolean
}

/**
 * Where the Person looks for `thing`: at it, in the focused Pane of the
 * window in front; on screen, in a Tile at least half of which shows
 * inside the Strip's clip, as the Tiling measures it, so in Solo only the
 * filled Group's, which takes the whole clip; else in the window, or away.
 * `shown` is asked only for a thing a Tile of the workspace on screen
 * shows, outside a window of its own and with no Pane zoomed; with nothing
 * measured, as while the overview shows the Strip whole, every column
 * shows whole.
 */
export function sightOf(
  workspaces: Workspaces,
  thing: { project: ProjectId; about: string },
  front: boolean,
  shows: Shows,
  { look, shown, away, zoomed }: Screen = {}
): Sight {
  if (!front) return "away"
  const isIt = (entry: { project: ProjectId; pane: PaneState }) =>
    isShowing(entry, thing, shows)
  const entry = focused(workspaces)
  if (entry && isIt(entry)) return "looking"
  const tiles = current(workspaces).columns.flatMap((column) =>
    shownIn(column, look)
      .filter(isIt)
      .map((entry) => ({ column, entry }))
  )
  if (tiles.length === 0) return "in-window"
  if (tiles.some(({ entry }) => away?.has(entry.id))) return "on-screen"
  if (zoomed) return "in-window"
  const shares = shown?.()
  const enough = ({ column }: { column: Column }) =>
    (shares?.get(column.id) ?? 1) >= ON_SCREEN_SHARE
  return tiles.some(enough) ? "on-screen" : "in-window"
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
  const at = placeIn(order)
  const sorted = calling
    .filter((call) => call.key !== here)
    .sort((a, b) => at(a.key) - at(b.key) || a.since - b.since)
  const from = here === undefined ? -1 : at(here)
  return sorted.find((call) => at(call.key) > from) ?? sorted[0]
}
