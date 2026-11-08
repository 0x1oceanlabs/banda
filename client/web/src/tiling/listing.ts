/**
 * What the Tiling reads of what its Panes show, as their Apps list it:
 * each one's Listed, and how its Thread calls the Person. The Window gives
 * it from its items and calls stores, the same object for its life; the
 * Tiling reads it by selector, so a list that changes draws again only
 * the Strips whose Panes it changes (ADR 0088, decision 7). It goes with
 * T-a, once the Tiling reads no Listed.
 */
import { useMemo } from "react"
import { sameEach, useSelected } from "@banda/ui/lib/store"
import type { Listed } from "@banda/ui/pane"
import type { Chime } from "@banda/ui/sound"
import type { Entry, Workspace } from "./model"

export type Listing = {
  /** The listed thing an entry's Pane shows, if it shows one. */
  listed: (entry: Entry) => Listed | undefined
  /** How the Thread an entry's Pane shows calls the Person, if it does. */
  called: (entry: Entry) => Chime | undefined
  /** Calls `listener` when either may have changed; returns how to stop. */
  subscribe: (listener: () => void) => () => void
}

/** What `listing` says of the Panes `entries`: each one's Listed and
 * call, side by side. */
function shownOf(
  listing: Listing,
  entries: readonly Entry[]
): (Listed | Chime | undefined)[] {
  return entries.flatMap((entry) => [
    listing.listed(entry),
    listing.called(entry),
  ])
}

/**
 * What `listing` says of the Panes of `workspace`, drawn again only when
 * that changes: what one Strip, or one row of the overview, reads.
 */
export function useShown(
  listing: Listing,
  workspace: Workspace
): Pick<Listing, "listed" | "called"> {
  const entries = useMemo(
    () => workspace.columns.flatMap((column) => column.entries),
    [workspace]
  )
  const shown = useSelected(
    listing.subscribe,
    () => shownOf(listing, entries),
    sameEach
  )
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
  listing: Listing,
  entry: Entry | undefined
): Listed | undefined {
  return useSelected(listing.subscribe, () =>
    entry ? listing.listed(entry) : undefined
  )
}
