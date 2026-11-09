/**
 * What the Tiling reads of what its Panes show, as their Apps list it:
 * whether each one shows an Item, how its Thread calls the Person, and
 * each Group's owner, as the Item one of its Panes shows names it, with
 * what that owner's Mark says of the Group. It never hands the Tiling an
 * Item: the Window gives the port from its items and calls stores
 * (`window/shows.ts`), the same object for its life, and the Tiling reads
 * it by selector, so a list that changes draws again only the Strips
 * whose Panes it changes (ADR 0088, decision 7). The Panes' part and the
 * Groups' are selected apart: a Strip takes both, a row of the overview
 * its Panes', the map its Groups'. The port goes once the Tiling reads
 * the items store by selector itself (B7a or E8b).
 */
import { useCallback, useMemo } from "react"
import { sameEach, useSelected } from "@banda/core/react"
import type { GroupState } from "@banda/ui/components/banda-mark"
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
  /** Whether an App lists what an entry's Pane shows: its header then
   * has an Item's places for its Project and its title. */
  item: (entry: Entry) => boolean
  /** The owner the Item an entry's Pane shows names, if it names one. */
  owner: (entry: Entry) => Owner | undefined
  /** What a Group `owner` owns shows of it: its state and name, while an
   * App lists the owner's Item. */
  mark: (owner: Owner) => Owned | undefined
  /** How the Thread an entry's Pane shows calls the Person, if it does. */
  called: (entry: Entry) => Chime | undefined
  /** Calls `listener` when any may have changed; returns how to stop. */
  subscribe: (listener: () => void) => () => void
}

/**
 * What `shows` says of each Pane of `entries`, flat: whether it shows an
 * Item, then how it calls. They are plain values, so a selection of them
 * stays the same while they do, however else an Item or its owner's Mark
 * changes.
 */
export function shownIn(
  shows: Shows,
  entries: readonly Entry[]
): (boolean | Chime | undefined)[] {
  return entries.flatMap((entry) => [shows.item(entry), shows.called(entry)])
}

/**
 * Each owned Group of `columns`, by the first Pane in it whose Item names
 * an owner, flat: its id, then its owner's state and name. They are
 * plain values, so a selection of them stays the same while they do,
 * however else the owner's Item changes, or what calls.
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
 * that changes: what one Strip or one row of the overview reads. Whether
 * each Pane shows an Item, and its call, side by side (`shownIn`); not
 * its Groups, which a row of the overview does not draw.
 */
export function useShows(
  shows: Shows,
  workspace: Workspace
): Pick<Shows, "item" | "called"> {
  const entries = useMemo(
    () => workspace.columns.flatMap((column) => column.entries),
    [workspace]
  )
  const read = useCallback(() => shownIn(shows, entries), [shows, entries])
  const shown = useSelected(shows.subscribe, read, sameEach)
  return useMemo(() => {
    const at = new Map(entries.map((entry, i) => [entry.id, 2 * i]))
    const of = (entry: Entry, side: 0 | 1) => {
      const i = at.get(entry.id)
      return i === undefined ? undefined : shown[i + side]
    }
    return {
      item: (entry) => of(entry, 0) === true,
      called: (entry) => of(entry, 1) as Chime | undefined,
    }
  }, [entries, shown])
}

/** Each owned Group of `workspace`, its state and name by its id, drawn
 * again only as one of those changes (`ownedIn`): what a Strip's plates
 * and handles, and the map, read; not its Panes' calls, which the map
 * does not draw. */
export function useGroups(
  shows: Shows,
  workspace: Workspace
): ReadonlyMap<string, Owned> {
  const read = useCallback(
    () => ownedIn(shows, workspace.columns),
    [shows, workspace]
  )
  const owned = useSelected(shows.subscribe, read, sameEach)
  return useMemo(() => groupsIn(owned), [owned])
}

/** Whether an App lists what `entry`'s Pane shows, drawn again only as
 * that changes: what a Pane alone, as the drawer's, reads. */
export function useItemShown(shows: Shows, entry: Entry | undefined): boolean {
  const read = useCallback(
    () => (entry ? shows.item(entry) : false),
    [shows, entry]
  )
  return useSelected(shows.subscribe, read)
}
