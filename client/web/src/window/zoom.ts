/**
 * The Pane zoomed over the whole window, while it keeps the focus: the
 * focus elsewhere, or the overview, brings it back (ADR 0025, decision 4).
 */
import { useCallback, useState } from "react"
import { focused, type Workspaces } from "../tiling/model"

export function useZoom(
  workspaces: Workspaces,
  overview: boolean,
  drawnNow: () => Workspaces
) {
  const [zoom, setZoom] = useState<string>()
  const zoomed =
    zoom !== undefined && !overview && focused(workspaces)?.id === zoom
      ? zoom
      : undefined
  if (zoom !== undefined && zoomed === undefined) setZoom(undefined)
  const toggleZoom = useCallback(
    () =>
      setZoom((was) =>
        was === undefined ? focused(drawnNow())?.id : undefined
      ),
    [drawnNow]
  )
  return { zoomed, toggleZoom }
}
