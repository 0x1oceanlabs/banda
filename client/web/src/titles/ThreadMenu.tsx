/**
 * The Thread menu (ADR 0077, decision 5): one menu of an Item, the same
 * at its title in a Pane's header and at its row in the sidebar. Its rows
 * are the Item's item actions (ADR 0087, decision 12), those that name it
 * first: the Window draws them and runs each by its id, and the Item's App
 * does it.
 */
import { createContext, type ReactNode, useContext, useMemo } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { useAfterMenu } from "@banda/ui/components/context-menu"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@banda/ui/components/dropdown-menu"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { useNow } from "@banda/ui/hooks/use-now"
import type { Args } from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
import { useIsArchived } from "../sidebar/archived"
import { rowsOf, type Shown } from "../sidebar/items"
import { Making } from "../sidebar/MakeProject"

/** Runs an action by its id, as its key would. */
type Run = (action: string, args?: Args) => void

/** What the Thread menu asks of the window, wherever it opens. */
type Threads = { projects: readonly ProjectSummary[]; run: Run }

const ThreadsContext = createContext<Threads>({
  projects: [],
  run: () => undefined,
})

/** How a part inside the Thread menus runs an item action, as the
 * title's field renames by its App's. */
export function useItemRun(): Run {
  return useContext(ThreadsContext).run
}

/** Gives the Thread menus inside it the window's Projects and its `run`,
 * and holds the dialog that makes a Project. */
export function ThreadMenus({
  engine,
  projects,
  run,
  children,
}: {
  engine: Engine
  projects: readonly ProjectSummary[]
  run: Run
  children: ReactNode
}) {
  const threads = useMemo(() => ({ projects, run }), [projects, run])
  return (
    <ThreadsContext value={threads}>
      {children}
      <Making engine={engine} projects={projects} />
    </ThreadsContext>
  )
}

/**
 * The Thread menu's rows for `listed`, in its order: its App's item
 * actions that name it (Rename…, Suggest a title, Previous title, Mark as
 * unread or read), then the rest (Make a Project from it…, Snooze… or
 * Wake now) and the sidebar list's Archive thread. A row that does not
 * apply is not there; Snooze while the Thread asks, and Archive while it
 * works or asks, are there but off.
 */
export function ThreadRows({
  project,
  listed,
  where,
  later: given,
}: {
  project: ProjectId
  listed: Listed
  /** Where Rename… opens the field: the header, or the row. */
  where: "head" | "row"
  /** Runs an act once the menu has gone, as the field that takes the
   * focus must; a context menu's own, by default. */
  later?: (act: () => void) => void
}) {
  const keyFor = useKeyLabel()
  const { projects, run } = useContext(ThreadsContext)
  const isArchived = useIsArchived()
  // Whether it sleeps, by a clock that moves as the menu stays open.
  const now = useNow(30_000)
  const ours = useAfterMenu()
  const later = given ?? ours
  const shown = rowsOf(listed, {
    project: projects.find((one) => one.id === project),
    now,
    archived: isArchived(listed),
  })
  const naming = shown.filter(({ action }) => action.group === "name")
  const others = shown.filter(({ action }) => action.group === "other")
  const drawn = ({ action, row }: Shown) => {
    // Where it opens a field, to one that takes it, as Rename….
    const from = "from" in action.args.properties && { from: where }
    const act = () => run(action.id, { project, item: listed.id, ...from })
    // A key of its own, or one the Person gave it.
    const key = keyFor(action.id)
    return (
      <DropdownMenuItem
        key={action.id}
        disabled={row.off}
        onClick={() => (action.later ? later(act) : act())}
      >
        <row.icon />
        {row.title}
        {key || action.keys?.length ? (
          <DropdownMenuShortcut>{key}</DropdownMenuShortcut>
        ) : null}
      </DropdownMenuItem>
    )
  }
  return (
    <>
      {naming.map(drawn)}
      {naming.length > 0 && others.length > 0 && <DropdownMenuSeparator />}
      {others.map(drawn)}
    </>
  )
}
