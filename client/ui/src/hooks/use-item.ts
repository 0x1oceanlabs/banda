/**
 * The Item a Pane shows, as what fills its header's Slot reads it (ADR
 * 0082, decisions 8 and 9; ADR 0087, decision 5): the Slot gives the Pane
 * alone, and its App finds its own Item here, by selector, so it is drawn
 * again only as that Item changes. The Window gives what the Apps list
 * (`ItemsContext`); a popped-out Pane's window gives none, so there no
 * Item is found. It stands in the kit until B7a gives the Item a store of
 * its own in `@banda/core/react`.
 */
import { createContext, useCallback, useContext } from "react"
import type { ProjectId } from "@banda/contract"
import { type Readable, useStore } from "@banda/core/react"
import type { Listed, Lists } from "../pane"

const NONE: Lists = {}

/** What the Apps list, as the Window keeps it; nothing where the window
 * gives none. */
export const ItemsContext = createContext<Readable<Lists>>({
  get: () => NONE,
  subscribe: () => () => undefined,
})

/** What `project`'s Apps list as `thing`, drawn again only as it changes;
 * none for no thing, or one no App lists. */
export function useItem(
  project: ProjectId,
  thing: string | null
): Listed | undefined {
  const select = useCallback(
    (lists: Lists) =>
      thing ? lists[project]?.find((listed) => listed.id === thing) : undefined,
    [project, thing]
  )
  return useStore(useContext(ItemsContext), select)
}
