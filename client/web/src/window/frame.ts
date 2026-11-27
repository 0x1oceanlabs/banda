/**
 * What a framed Pane asks of the workspaces (`Frame`), as the Window
 * answers it: the Tiling's changes, the Window's actions, the Pane's own
 * window, and where a Pane stands for its menu (ADR 0066).
 */
import { type RefObject, useMemo } from "react"
import { listedIn, type Stores } from "../calls/stores"
import { columnsOf } from "../look"
import { sheetsOf, showsOf } from "../registry"
import { targetsOf } from "../tiling/actions"
import { floorsOf } from "../tiling/layout"
import {
  current,
  displayOf,
  find,
  focusEntry,
  heightsOf,
  share,
  widthIn,
} from "../tiling/model"
import { closing, openingFrom } from "../tiling/opening"
import type { Frame } from "../tiling/PaneFrame"
import type { useTiling } from "../tiling/useTiling"
import type { Shell } from "./actions"
import { paneRowsOf } from "./items"

/** The Window's `Frame`, the same while what it is made of is. */
export function useFrame({
  tiling: { change, update, drawnNow },
  parts,
  stores,
  popOut,
  away,
}: {
  tiling: Pick<ReturnType<typeof useTiling>, "change" | "update" | "drawnNow">
  parts: Shell
  stores: Stores
  popOut: (entry: string) => void
  /** The Panes in windows of their own, as they are now. */
  away: RefObject<ReadonlySet<string>>
}): Frame {
  return useMemo(
    () => ({
      // A tile takes the focus as the DOM gives it, on the workspace on
      // screen; by its turn, the Person may have gone to another.
      focus: (entry) =>
        change((w) =>
          current(w).columns.some((c) => c.entries.some((e) => e.id === entry))
            ? focusEntry(w, entry)
            : undefined
        ),
      // A Pane that comes as the Sheet comes so, asked for from a tile too.
      open: (project, pane, ...asked) =>
        sheetsOf(pane)
          ? parts.open(pane, project)
          : change((w) =>
              openingFrom(w, project, pane, parts.placing(), ...asked)
            ),
      update,
      close: (entry) => change(() => closing(entry)),
      run: parts.run,
      arrange: (plan) => change(() => plan),
      popOut,
      // As the window draws it now, when the menu opens.
      stand: (entry) => {
        const state = drawnNow()
        const spot = find(state, entry)
        if (!spot) return undefined
        const workspace = state.list[spot.workspace]
        const column = workspace?.columns[spot.column]
        if (!workspace || !column) return undefined
        const look = columnsOf()
        const floor = floorsOf(workspace.id, look)
        const shown = column.entries[spot.entry]
        const listed = shown && listedIn(stores.items.get(), shown, showsOf)
        return {
          width: share(widthIn(workspace, column, look, floor)) ?? 0.5,
          full: column.full === true,
          deck: displayOf(column, look) === "deck",
          panes: column.entries.length,
          height: heightsOf(column)[spot.entry] ?? 1,
          left: spot.column > 0,
          right: spot.column < workspace.columns.length - 1,
          workspace: spot.workspace + 1,
          targets: targetsOf(state, spot, parts.projectOf),
          away: away.current.has(entry),
          presets: look.presets,
          heights: look.heights,
          floor: floor?.(column) ?? 0,
          // What its Item's item actions offer here (ADR 0087, decision 12).
          items: listed
            ? paneRowsOf(listed, shown.project, parts.projects())
            : [],
        }
      },
    }),
    [change, update, parts, popOut, stores, drawnNow, away]
  )
}
