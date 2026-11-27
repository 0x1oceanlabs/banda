/**
 * The Panes in windows of their own (ADR 0025, decision 9): main keeps
 * which, and their places in the workspaces keep stand-ins.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { device } from "../boot"
import { focused, type Workspaces } from "../tiling/model"

export function usePoppedOut(drawnNow: () => Workspaces) {
  const [away, setAway] = useState<ReadonlySet<string>>(() => new Set())
  const awayNow = useRef(away)
  useEffect(() => {
    awayNow.current = away
  }, [away])
  useEffect(() => device.popped.follow(setAway), [])
  // Its window opens as big as its tile.
  const popOut = useCallback((entry: string) => {
    const tile = document.querySelector(`[data-tile="${CSS.escape(entry)}"]`)
    const size = tile?.getBoundingClientRect()
    device.popped.open(entry, size?.width ?? 0, size?.height ?? 0)
  }, [])
  // The Pane in focus goes to a window of its own, or comes back.
  const togglePopOut = useCallback(() => {
    const entry = focused(drawnNow())?.id
    if (!entry) return
    if (awayNow.current.has(entry)) device.popped.close(entry)
    else popOut(entry)
  }, [popOut, drawnNow])
  return { away, awayNow, popOut, togglePopOut }
}
