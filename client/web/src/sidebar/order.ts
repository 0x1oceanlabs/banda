/**
 * The one order of what calls (ADR 0079, decision 4; ADR 0087, decision
 * 8): the Person's sidebar, as the Inbox lays it out (ADR 0098). The
 * sidebar list draws it, the bar's counts list and `Alt+U` go by its
 * rows' `project:thing` keys, and only `order` works it out. Its keys are
 * Your turn oldest first, then Open, then Working, whatever the list
 * shows and however it is grouped, so the counts and Alt+U take them
 * whole, while the Sidebar is hidden too, and only when asked, on the key
 * or as the counts' list opens. All three place the other machines'
 * Threads alike, by the one `elsewhereOf`.
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
import { type Inbox, inboxOf, type InboxView } from "./inbox"
import {
  type Elsewhere,
  type ProjectLine,
  projectLines,
  type Row,
  rowsOf,
} from "./rows"
import { groupOf, listsProjects, type Settings } from "./settings"

/** What of the order the sidebar list shows: one Project's rows alone,
 * as a click in the list of Projects asks; the tab in view, a cut list
 * whole, the groups the Person folded and when inbox zero last told of
 * Someday, which the counts and Alt+U leave as they come, their keys the
 * same whatever these say; and the other machines' Projects, whose rows
 * it places among this one's, which they hand too. `settings` are the
 * look's, as the Person arranged the sidebar, unless a test hands its
 * own: how the list is grouped, and what the Inbox shows in what order. */
export type View = Partial<
  Pick<InboxView, "tab" | "more" | "folded" | "someday">
> & {
  settings?: Settings
  only?: ProjectId
  elsewhere?: readonly Elsewhere[]
  /** A search in place while one runs (decision 17): its words, and the
   * rows it finds, which the tabs and their counts take alone. */
  search?: { words: string; found: (row: Row) => boolean }
}

/** The sidebar as it is drawn: the Inbox, every row it was made of, and
 * the list of Projects when the settings ask for it. */
export type Ordered = Inbox & { rows: Row[]; projects?: ProjectLine[] }

/**
 * The sidebar's Inbox of every Project's list, as the Person's settings
 * say, each Thread where it stands at `now`, the Later clock.
 */
export function order(
  lists: Lists,
  projects: readonly ProjectSummary[],
  now: number,
  {
    settings = currentLook()?.sidebar ?? DEFAULT_SIDEBAR,
    only,
    elsewhere = [],
    search,
    ...shown
  }: View = {}
): Ordered {
  const mine = rowsOf(lists, projects, now)
  const others = elsewhere.map((host) => ({
    ...host,
    rows: rowsOf(lists, host.projects, now, host.name),
  }))
  const rows = [...mine, ...others.flatMap((host) => host.rows)].filter(
    (row) => only === undefined || row.project.id === only
  )
  const view: InboxView = {
    tab: "inbox",
    group: groupOf(settings),
    ...settings.inbox,
    ...shown,
    ...(search && { search: search.words }),
  }
  return {
    ...inboxOf(search ? rows.filter(search.found) : rows, view, now),
    rows,
    ...(listsProjects(settings)
      ? {
          projects: [
            ...projectLines(mine, projects, settings),
            ...others.flatMap((host) =>
              projectLines(host.rows, host.projects, settings, host.name)
            ),
          ],
        }
      : {}),
  }
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
  now: number
) => Ordered {
  const kept = useContext(HostsContext)
  return useCallback(
    (lists, projects, now) =>
      order(lists, projects, now, { elsewhere: elsewhereOf(kept.get()) }),
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
