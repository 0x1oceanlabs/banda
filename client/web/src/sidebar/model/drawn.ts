/**
 * What the sidebar draws, from what it is given (the window's rule 2; ADR
 * 0098): one pure function, `sidebarOf`, with one input and one output,
 * both plain data. Where each Thread stands, in what order, what each tab
 * and the bar count, and the one order `Alt+U` walks are decided here
 * alone: the sidebar list, the small inbox, the bar's counts and Alt+U
 * read its answer and work none of it out again. The engine will give
 * the same answer for every client (SE7, "told anywhere"); then it
 * replaces this function, and the two types below are what it fills.
 *
 * Inside, the steps go in a row: the rows (`rows.ts`, each where
 * `status.ts` says it stands), the Inbox's blocks (`inbox.ts`), and the
 * list as flat items (`flat.ts`). What the window keeps of its own is the
 * one rule under the pointer (`still.ts`). Pure, so plain tests cover it.
 */
import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Count } from "@banda/contract/sidebar"
import { loudest, type MarkState, works } from "@banda/ui/lib/mark-state"
import type { Lists } from "@banda/ui/pane"
import { isAway, lookOf, takes } from "@banda/ui/status"
import { type Item, itemsOf } from "./flat"
import {
  inboxOf,
  projectCallsOf,
  type Tab,
  type TabCount,
  type Zero,
} from "./inbox"
import { type Elsewhere, type Row, rowsOf } from "./rows"
import type { Settings } from "./settings"

/** What the sidebar is given. */
export type SidebarInput = {
  /** What every App lists, by Project, this machine's and the others'. */
  lists: Lists
  /** The Later clock, by which each Thread stands where it does (ADR
   * 0074). */
  now: number
  /** This machine's Projects. */
  projects: readonly ProjectSummary[]
  /** The other machines of `hosts.toml` whose rows the Window shows, in
   * its order, with their Projects (ADR 0081, decision 4). */
  elsewhere: readonly Elsewhere[]
  /** `sidebar.toml` as `banda look` resolves it: how the list is grouped,
   * and what the Inbox shows in what order. */
  settings: Pick<Settings, "group" | "inbox">
  /** This machine's Projects whose trust the Person put off on this
   * device (ADR 0083, decision 5). */
  putOff: ReadonlySet<ProjectId>
  /** How the Person has the list in view. */
  view: {
    tab: Tab
    /** The rest of a cut list shows: the shelf's "+ N more", the
     * Archive's "Show older". */
    more?: boolean
    /** What the Person turned from how it first shows, by its key: the
     * groups folded, and the parents whose children at work they
     * unfolded past three. */
    folded?: ReadonlySet<string>
    /** When inbox zero last told how many sleep until Someday, as this
     * device keeps it; it tells once a week (decision 12). */
    someday?: number
  }
}

/** One of the bar's counts (ADR 0035): how many it takes, and the loudest
 * look of them, as the bar's Mark takes it. */
export type BarCount = { count: number; mark: MarkState }

/** What the sidebar draws. */
export type Drawn = {
  /** Each tab's count, and whether it is the Person's turn there. */
  tabs: Record<Tab, TabCount>
  /** The tab in view as the list draws it, top down: inbox zero or a
   * tab's empty words, the parts' heads, the groups' headers, the cards,
   * the dividers and what a cut list leaves out. */
  items: Item[]
  /** Set while nothing in the Inbox is the Person's, on every tab. */
  zero?: Zero
  /** The `project:thing` key of each Thread Alt+U walks, in the one order
   * of what calls: Your turn oldest first, whatever `[inbox] order` says,
   * then Open, then Working by when it began, each child under its
   * parent; across groups, folds, tabs and machines. */
  keys: string[]
  /** Each of the bar's counts, over every Thread not put away; `[bar]
   * counts` says which the bar shows. */
  counts: Record<Count, BarCount>
  /** Nothing waits for the Person and nothing works: the calm square. */
  calm: boolean
  /** Every row the list was made of, each where it stands. */
  rows: Row[]
}

/**
 * What the sidebar draws of `input`: this machine's rows, then each other
 * machine's, each where it stands at `now`; this machine's Projects that
 * wait for the Person first in Your turn, but those whose trust they put
 * off; with no Project of its own and no Thread at all, inbox zero is the
 * first run.
 */
export function sidebarOf({
  lists,
  now,
  projects,
  elsewhere,
  settings,
  putOff,
  view,
}: SidebarInput): Drawn {
  const rows = [
    ...rowsOf(lists, projects, now),
    ...elsewhere.flatMap((host) =>
      rowsOf(lists, host.projects, now, host.name)
    ),
  ]
  const { blocks, ...inbox } = inboxOf(
    rows,
    { ...view, group: settings.group, ...settings.inbox },
    now,
    {
      calls: projectCallsOf(projects, putOff),
      none: projects.every((project) => project.scratch),
    }
  )
  // What is put away, Later or archived, the bar counts not, nor looks at.
  const present = rows.flatMap((row) =>
    isAway(row.stand) ? [] : [{ row, look: lookOf(row.listed, now).look }]
  )
  const countOf = (count: Count): BarCount => {
    const taken = present.filter(({ row }) =>
      takes(count, row.stand, row.listed.mark)
    )
    return {
      count: taken.length,
      mark: loudest(taken.map(({ look }) => look)),
    }
  }
  return {
    ...inbox,
    items: itemsOf(blocks),
    counts: {
      asking: countOf("asking"),
      done: countOf("done"),
      waiting: countOf("waiting"),
      working: countOf("working"),
    },
    calm:
      !rows.some((row) => row.stand === "turn") &&
      !works(loudest(present.map(({ look }) => look))),
    rows,
  }
}
