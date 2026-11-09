/**
 * What the Tiling reads of what its Panes show, as their Apps list it:
 * each one's Listed, how its Thread calls the Person, and each Group's
 * owner, as the Item one of its Panes shows names it, with what that
 * owner's Mark says of the Group. The Window gives it from its items and
 * calls stores (`window/shows.ts`), the same object for its life; the
 * Tiling reads it by selector, so a list that changes draws again only
 * the Strips whose Panes it changes (ADR 0088, decision 7). The Listed
 * goes with T-a; the port, once the Tiling reads the items store by
 * selector itself (B7a or E8b).
 */
import { useCallback, useMemo } from "react"
import { sameEach, useSelected } from "@banda/core/react"
import type { GroupState } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import type { Chime } from "@banda/ui/sound"
import { ownersOf } from "./groups"
import type { Column, Entry, Workspace } from "./model"

/** Who a Group is for, opaque to the Tiling: today the Agent a Thread's
 * Item names, `item@1`'s owner after B7a (ADR 0082, decision 9). */
export type Owner = string

/** What a Group shows of its owner: its plate's state, as the owner's
 * Mark says it, and the name on its handle. */
export type Owned = { state: GroupState | undefined; name: string }

export type Shows = {
  /** The listed thing an entry's Pane shows, if it shows one. */
  listed: (entry: Entry) => Listed | undefined
  /** The owner the Item an entry's Pane shows names, if it names one. */
  owner: (entry: Entry) => Owner | undefined
  /** What a Group of `owner`'s shows of it, while an App lists it. */
  mark: (owner: Owner) => Owned | undefined
  /** How the Thread an entry's Pane shows calls the Person, if it does. */
  called: (entry: Entry) => Chime | undefined
  /** Calls `listener` when any may have changed; returns how to stop. */
  subscribe: (listener: () => void) => () => void
}

/**
 * Each owned Group of `columns`, by the first Pane in it whose Item names
 * an owner, flat: its id, then its owner's state and name. They are
 * plain values, so a selection of them stays the same while they do,
 * however else the owner's Item changes.
 */
export function ownedIn(
  shows: Shows,
  columns: readonly Column[]
): (string | undefined)[] {
  return [...ownersOf(columns, shows.owner)].flatMap(([group, owner]) => {
    const owned = shows.mark(owner)
    return owned ? [group, owned.state, owned.name] : []
  })
}

/** The Groups `ownedIn` says, each by its id. */
export function groupsIn(
  owned: readonly unknown[]
): ReadonlyMap<string, Owned> {
  const groups = new Map<string, Owned>()
  for (let i = 0; i + 2 < owned.length; i += 3) {
    groups.set(owned[i] as string, {
      state: owned[i + 1] as GroupState | undefined,
      name: owned[i + 2] as string,
    })
  }
  return groups
}

/**
 * What `shows` says of the Panes of `workspace`, drawn again only when
 * that changes: what one Strip, one row of the overview or the map
 * reads. Each Pane's Listed and call, side by side, then its owned
 * Groups, in one selection.
 */
export function useShows(
  shows: Shows,
  workspace: Workspace
): Pick<Shows, "listed" | "called"> & {
  /** Each owned Group's state and name, by its id. */
  groups: ReadonlyMap<string, Owned>
} {
  const entries = useMemo(
    () => workspace.columns.flatMap((column) => column.entries),
    [workspace]
  )
  const read = useCallback(
    () => [
      ...entries.flatMap((entry) => [shows.listed(entry), shows.called(entry)]),
      ...ownedIn(shows, workspace.columns),
    ],
    [shows, entries, workspace]
  )
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
      groups: groupsIn(shown.slice(2 * entries.length)),
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
