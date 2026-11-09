/**
 * What the Tiling reads of what its Panes show, as their Apps list it:
 * each one's Listed, and how its Thread calls the Person. The Window gives
 * it from its items and calls stores, the same object for its life; the
 * Tiling reads it by selector, so a list that changes draws again only
 * the Strips whose Panes it changes (ADR 0088, decision 7). It goes with
 * T-a, once the Tiling reads no Listed.
 */
import { useCallback, useMemo } from "react"
import { sameEach, useSelected } from "@banda/core/react"
import type { Listed } from "@banda/ui/pane"
import type { Chime } from "@banda/ui/sound"
import type { Entry, Workspace } from "./model"

export type Shows = {
  /** The listed thing an entry's Pane shows, if it shows one. */
  listed: (entry: Entry) => Listed | undefined
  /** How the Thread an entry's Pane shows calls the Person, if it does. */
  called: (entry: Entry) => Chime | undefined
  /** Calls `listener` when either may have changed; returns how to stop. */
  subscribe: (listener: () => void) => () => void
}

/** What `shows` says of the Panes `entries`: each one's Listed and call,
 * side by side. */
function showsIn(
  shows: Shows,
  entries: readonly Entry[]
): (Listed | Chime | undefined)[] {
  return entries.flatMap((entry) => [shows.listed(entry), shows.called(entry)])
}

/**
 * What `shows` says of the Panes of `workspace`, drawn again only when
 * that changes: what one Strip, or one row of the overview, reads.
 */
export function useShows(
  shows: Shows,
  workspace: Workspace
): Pick<Shows, "listed" | "called"> {
  const entries = useMemo(
    () => workspace.columns.flatMap((column) => column.entries),
    [workspace]
  )
  const read = useCallback(() => showsIn(shows, entries), [shows, entries])
  const shown = useSelected(shows.subscribe, read, sameEach)
  return useMemo(() => {
    const at = new Map(entries.map((entry, i) => [entry.id, 2 * i]))
    const of = (entry: Entry, side: 0 | 1) => {
      const i = at.get(entry.id)
      return i === undefined ? undefined : shown[i + side]
    }
    return {
      listed: (entry) => of(entry, 0) as Listed | undefined,
      called: (entry) => of(entry, 1) as Chime | undefined,
    }
  }, [entries, shown])
}

/** The listed thing `entry`'s Pane shows, drawn again only as it changes:
 * what a Pane alone, as the drawer's, reads. */
export function useListed(
  shows: Shows,
  entry: Entry | undefined
): Listed | undefined {
  const read = useCallback(
    () => (entry ? shows.listed(entry) : undefined),
    [shows, entry]
  )
  return useSelected(shows.subscribe, read)
}
