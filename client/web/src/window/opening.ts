/**
 * What the Window's `open` does with a Pane, and what it sees of a thing
 * (`sight`): asked by an action, a module, a tile or the Person.
 */
import { inFront } from "@banda/ui/hooks/use-in-front"
import type { WindowApi } from "@banda/ui/module"
import type { ProjectId } from "@banda/contract"
import { besideOf, sightOf } from "../calls/sight"
import type { Stores } from "../calls/stores"
import { columnsOf } from "../look"
import { identityOf, sheetsOf, showsOf } from "../registry"
import { shownOf } from "../tiling/layout"
import {
  current,
  focused,
  projectIn,
  samePane,
  type Workspaces,
} from "../tiling/model"
import { closing, placed, type Placing } from "../tiling/opening"
import type { useTiling } from "../tiling/useTiling"
import type { Shell } from "./actions"
import type { useDrawer } from "./Drawer"
import type { usePeek } from "./Peek"
import type { useSheet } from "./Sheet"

/**
 * The Window's `open`: into the drawer when asked so, as the Sheet for a
 * Pane that comes so, and else in the workspaces, where the engine places
 * it.
 */
export function openerOf({
  drawer,
  sheet,
  peek: { peekNow, setPeek },
  change,
  stores,
  home,
  placing,
}: {
  drawer: Pick<ReturnType<typeof useDrawer>, "into">
  sheet: Pick<ReturnType<typeof useSheet>, "show">
  peek: Pick<ReturnType<typeof usePeek>, "peekNow" | "setPeek">
  change: ReturnType<typeof useTiling>["change"]
  stores: Stores
  home: ProjectId
  placing: Placing
}): Shell["open"] {
  return (
    pane,
    project,
    { beside, again = true, update, toggle, drawer: inDrawer, ...how } = {}
  ) => {
    if (inDrawer) return drawer.into(pane, project ?? home)
    if (sheetsOf(pane)) return sheet.show(pane, project, { toggle, again })
    // The Pane that peeks, opened in the workspace, peeks no more.
    const peeked = peekNow.current
    if (
      peeked &&
      samePane({ project: project ?? peeked.project, pane }, peeked, identityOf)
    )
      setPeek(null)
    change((w) => {
      const at = beside
        ? besideOf(w, stores.items.get(), beside, showsOf)
        : null
      const into = project ?? at?.project ?? projectIn(w) ?? home
      // Toggled, the one in focus closes when it is this one.
      const entry = toggle && focused(w)
      if (entry && samePane(entry, { project: into, pane }, identityOf))
        return closing(entry.id)
      // Not again: the one shown, as its kind names it, keeps what it
      // shows, or takes these args when asked to update it. Beside its
      // Agent's Thread, where a workspace shows it, in its Group; else
      // where the engine places what is opened for an Agent.
      return placed(w, into, pane, placing, {
        ...how,
        ...(at &&
          (at.from ? { from: at.from, place: "group" } : { agents: true })),
        ...(again ? { again } : update && { update }),
      })
    })
  }
}

/**
 * Where a thing is to the Person now (`WindowApi.sight`): what shows is
 * measured as it is asked, only for a Tile on the workspace on screen
 * (ADR 0087, decision 9). `zoomed`: under a zoom no other Tile shows.
 */
export function sightNow(
  thing: Parameters<WindowApi["sight"]>[0],
  state: Workspaces,
  away: ReadonlySet<string>,
  zoomed: boolean
): ReturnType<WindowApi["sight"]> {
  if (!thing) return inFront() ? "in-window" : "away"
  const look = columnsOf()
  return sightOf(state, thing, inFront(), showsOf, {
    look,
    shown: () => shownOf(current(state), look),
    away,
    zoomed,
  })
}
