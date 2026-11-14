/**
 * The one order of what calls (ADR 0079, decision 4; ADR 0087, decision
 * 8): the Person's sidebar, as `sidebarOf` lays it out (ADR 0098). The
 * sidebar list draws it, the small inbox too, and `Alt+U` goes by its
 * `keys`: Your turn oldest first, then Open, then Working, whatever the
 * list shows and however it is grouped, so Alt+U takes them whole, while
 * the Sidebar is hidden too, and only when asked, on the key. The sidebar
 * list, the small inbox's among them, the counts and Alt+U place the
 * other machines' Threads alike, by the one `elsewhereOf`.
 */
import { useCallback, useContext } from "react"
import type { ProjectSummary } from "@banda/contract"
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
import { type Drawn, sidebarOf } from "./drawn"
import type { Elsewhere } from "./rows"

/** Alt+U walks no Project's card, so none is put off for it. */
const NONE: ReadonlySet<never> = new Set()

/** The other machines whose Projects the order places among this one's:
 * those of `hosts.toml` the Window shows rows of, live or away (ADR 0081,
 * decision 4). It is said here alone, so the sidebar list, the counts and
 * Alt+U never place another machine's Thread apart. */
const elsewhereOf = (hosts: readonly Shown[]): Elsewhere[] =>
  hosts.filter(holds)

/** The other machines the order places (`elsewhereOf`), drawn again only
 * as they change, for the sidebar list. */
export const useElsewhere = (): readonly Elsewhere[] =>
  useHostsBy(elsewhereOf, sameEach)

/**
 * `sidebarOf` with the other machines as they stand when it is asked, for
 * Alt+U, which works the order out on the key and draws nothing; the same
 * function while the Window's hosts stay.
 */
export function useOrderNow(): (
  lists: Lists,
  projects: readonly ProjectSummary[],
  now: number
) => Drawn {
  const kept = useContext(HostsContext)
  return useCallback(
    (lists, projects, now) =>
      sidebarOf({
        lists,
        now,
        projects,
        elsewhere: elsewhereOf(kept.get()),
        settings: currentLook()?.sidebar ?? DEFAULT_SIDEBAR,
        putOff: NONE,
        view: { tab: "inbox" },
      }),
    [kept]
  )
}

/** Where a `project:thing` key stands in `keys`: one the sidebar lists
 * nowhere stands after them all. */
export function placeIn(keys: readonly string[]): (key: string) => number {
  const place = new Map(keys.map((key, i) => [key, i]))
  return (key) => place.get(key) ?? keys.length
}

/**
 * `things` in the order of `keys`, each by its `project:thing` key, as
 * `Alt+U` sorts what it shows. Those of one
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
