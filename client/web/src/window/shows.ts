/**
 * What the Tiling reads of what the Apps list and of what calls the
 * Person (`tiling/shows.ts`), from the Window's stores: the one place an
 * Item becomes what the Tiling sees of it. A Group's owner is the Agent a
 * Thread's Item names, and that owner's Mark gives the Group its state,
 * its title the Group's name. After B7a `item@1`'s owner takes the
 * Agent's place here, and the Tiling stays as it is (ADR 0087).
 */
import { groupState } from "@banda/ui/components/banda-mark"
import type { Listed, Lists, PaneState } from "@banda/ui/pane"
import { isShowing } from "../calls/sight"
import { listedIn, type Stores } from "../calls/stores"
import type { Entry } from "../tiling/model"
import type { Owner, Shows } from "../tiling/shows"

/** The Tiling's port to `stores`, the same for the Window's life, with
 * `showsOf` saying what a Pane shows (the registry's). */
export function tilingShows(
  stores: Stores,
  showsOf: (pane: PaneState) => string | null
): Shows {
  const listed = (entry: Entry) => listedIn(stores.items.get(), entry, showsOf)
  // Each owner's Item, worked out again only as the lists change.
  let indexed: { lists: Lists; owners: ReadonlyMap<Owner, Listed> } | undefined
  const ownersNow = () => {
    const lists = stores.items.get()
    if (indexed?.lists !== lists) indexed = { lists, owners: ownersIn(lists) }
    return indexed.owners
  }
  return {
    listed,
    owner: (entry) => listed(entry)?.agent,
    mark: (owner) => {
      const item = ownersNow().get(owner)
      return item && { state: groupState(item.mark), name: item.title }
    },
    called: (entry) =>
      stores.calls.get().list.find((call) => isShowing(entry, call, showsOf))
        ?.chime,
    // The calls follow every change of the items, so it hears them alone.
    subscribe: stores.calls.subscribe,
  }
}

/** Each owner's Item in `lists`, by the owner it names: one for each
 * Agent, this machine's first, as the items hold them. */
function ownersIn(lists: Lists): ReadonlyMap<Owner, Listed> {
  const owners = new Map<Owner, Listed>()
  for (const listed of Object.values(lists).flat())
    if (listed.agent !== undefined && !owners.has(listed.agent))
      owners.set(listed.agent, listed)
  return owners
}
