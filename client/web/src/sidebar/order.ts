/**
 * The one order of what calls (ADR 0079, decision 4; ADR 0087, decision
 * 8): the Person's arrangement of the sidebar. The sidebar list draws it,
 * the bar's counts list and `Alt+U` go by its rows' `project:thing` keys,
 * and only `order` works it out. The counts and Alt+U take it with no
 * filter nor fold, so it holds while the Sidebar is hidden, and only when
 * asked, on the key or as the counts' list opens. All three place the
 * other machines' Threads alike, by the one `elsewhereOf`.
 */
import { useCallback, useContext } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { DEFAULT_SIDEBAR } from "@banda/contract/sidebar"
import {
  holds,
  HostsContext,
  sameEach,
  type Shown,
  useHostsBy,
} from "@banda/core/react"
import { currentLook } from "@banda/ui/lib/look"
import type { Lists } from "@banda/ui/pane"
import { type Arranged, arrange, type Elsewhere, type Marks } from "./arrange"
import { rowKey } from "./hold"
import type { Settings } from "./settings"

/** What of the order the sidebar list shows: one Project's rows alone,
 * as a click in the list of Projects asks, and the sections the Person
 * folded or opened, which the counts and Alt+U leave out to take it
 * whole; and the other machines' Projects, whose rows it places among
 * this one's, which they hand too. `settings` are the look's, as the
 * Person arranged the sidebar, unless a test hands its own. */
export type View = {
  settings?: Settings
  only?: ProjectId
  toggled?: ReadonlySet<string>
  elsewhere?: readonly Elsewhere[]
}

/**
 * The sidebar's arrangement of every Project's list, as the Person's
 * settings and marks say.
 *
 * @param marks what the Person's marks say of each row now
 */
export function order(
  lists: Lists,
  projects: readonly ProjectSummary[],
  marks: Marks,
  {
    settings = currentLook()?.sidebar ?? DEFAULT_SIDEBAR,
    only,
    toggled,
    elsewhere = [],
  }: View = {}
): Arranged {
  return arrange(lists, projects, settings, only, toggled, marks, elsewhere)
}

/** The other machines whose Projects the order places among this one's:
 * those of `hosts.toml` the Window shows rows of, live or away (ADR 0081,
 * decision 4). It is said here alone, so the sidebar list, the counts and
 * Alt+U never place another machine's Thread apart. */
const elsewhereOf = (hosts: readonly Shown[]): Elsewhere[] =>
  hosts.filter(holds)

/** The other machines the order places (`elsewhereOf`), drawn again only
 * as they change, for the sidebar list and the counts' list. */
export const useElsewhere = (): readonly Elsewhere[] =>
  useHostsBy(elsewhereOf, sameEach)

/**
 * `order` with the other machines as they stand when it is asked, for
 * Alt+U, which works the order out on the key and draws nothing; the same
 * function while the Window's hosts stay.
 */
export function useOrderNow(): (
  lists: Lists,
  projects: readonly ProjectSummary[],
  marks: Marks
) => Arranged {
  const kept = useContext(HostsContext)
  return useCallback(
    (lists, projects, marks) =>
      order(lists, projects, marks, { elsewhere: elsewhereOf(kept.get()) }),
    [kept]
  )
}

/** The `project:thing` key of each row of `arranged`, top down, the
 * shelves' last. */
export function keysOf({ sections, shelves }: Arranged): string[] {
  return [...sections, ...shelves].flatMap((section) =>
    section.rows.map(rowKey)
  )
}

/** Where a `project:thing` key stands in `keys`: one the sidebar lists
 * nowhere stands after them all. */
export function placeIn(keys: readonly string[]): (key: string) => number {
  const place = new Map(keys.map((key, i) => [key, i]))
  return (key) => place.get(key) ?? keys.length
}

/**
 * `things` in the order of `keys`, each by its `project:thing` key: the
 * counts' list and `Alt+U` sort what they show by it alike. Those of one
 * place, as those the sidebar lists nowhere, go by `tie`.
 */
export function byOrder<T>(
  things: readonly T[],
  keys: readonly string[],
  keyOf: (thing: T) => string,
  tie: (a: T, b: T) => number
): T[] {
  const at = placeIn(keys)
  return [...things].sort((a, b) => at(keyOf(a)) - at(keyOf(b)) || tie(a, b))
}
