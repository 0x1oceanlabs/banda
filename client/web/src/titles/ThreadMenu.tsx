/**
 * The Thread menu (ADR 0077, decision 5): one menu of an Item, the same
 * at its title in a Pane's header and at its row in the sidebar. Its rows
 * are the Item's item actions (ADR 0087, decision 12), those that name it
 * first: the Window draws them and runs each by its id, and the Item's App
 * does it.
 */
import { createContext, type ReactNode, useContext } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { useAfterMenu } from "@banda/ui/components/context-menu"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@banda/ui/components/dropdown-menu"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { useNow } from "@banda/ui/hooks/use-now"
import { useRun } from "@banda/core/react"
import type { Listed } from "@banda/ui/pane"
import { rowsOf, type Shown } from "../sidebar/items"
import { Making } from "./MakeProject"

/** The window's Projects, for the Thread menu wherever it opens; it runs
 * its rows by the Window's `run` (`useRun`). */
const ProjectsContext = createContext<readonly ProjectSummary[]>([])

/** Gives the Thread menus inside it the window's Projects, and holds the
 * dialog that makes a Project. */
export function ThreadMenus({
  engine,
  projects,
  children,
}: {
  engine: Engine
  projects: readonly ProjectSummary[]
  children: ReactNode
}) {
  return (
    <ProjectsContext value={projects}>
      {children}
      <Making engine={engine} projects={projects} />
    </ProjectsContext>
  )
}

/**
 * The Thread menu's rows for `listed`, in its order: its App's item
 * actions that name it (Rename…, Suggest a title, Previous title, Mark as
 * unread or read), then the rest (Make a Project from it…, Later… or
 * Wake now) and the sidebar list's Archive thread. A row that does not
 * apply is not there; Later while the Thread asks, and Archive while it
 * works or asks, are there but off.
 */
export function ThreadRows({
  project,
  listed,
  where,
  later: given,
  onAct,
}: {
  project: ProjectId
  listed: Listed
  /** Where Rename… opens the field: the header, or the row. */
  where: "head" | "row"
  /** Runs an act once the menu has gone, as the field that takes the
   * focus must; a context menu's own, by default. */
  later?: (act: () => void) => void
  /** Told of each act its Person takes from it, as the sidebar list draws
   * an act on a card at once, even while it holds. */
  onAct?: () => void
}) {
  const keyFor = useKeyLabel()
  const projects = useContext(ProjectsContext)
  const run = useRun()
  // Whether it sleeps, by a clock that moves as the menu stays open.
  const now = useNow(30_000)
  const ours = useAfterMenu()
  const later = given ?? ours
  const shown = rowsOf(listed, {
    project: projects.find((one) => one.id === project),
    now,
  })
  const naming = shown.filter(({ action }) => action.group === "name")
  const others = shown.filter(({ action }) => action.group === "other")
  const drawn = ({ action, row }: Shown) => {
    // Where it opens a field, to one that takes it, as Rename….
    const from = "from" in action.args.properties && { from: where }
    const act = () => {
      onAct?.()
      run(action.id, { project, item: listed.id, ...from })
    }
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
