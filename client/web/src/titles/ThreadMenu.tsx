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
import type { Args, ItemAction, ItemRow } from "@banda/ui/module"
import { asleep, type Listed } from "@banda/ui/pane"
import { AlarmClockIcon, ArchiveIcon, ArchiveRestoreIcon } from "lucide-react"
import { archivable, useIsArchived } from "../sidebar/archived"
import { itemActionsOf } from "../sidebar/items"
import { Making } from "../sidebar/MakeProject"
import { snoozable } from "../sidebar/snoozed"
import type { Shell } from "../window/actions"

/** Runs an action by its id, as its key would. */
type Run = (action: string, args?: Args) => void

/** What the Thread menu asks of the window, wherever it opens. */
type Threads = {
  projects: readonly ProjectSummary[]
  run: Run
  /** Archives a thing, which closes the Panes that show it, or brings it
   * back (ADR 0069). */
  archive?: (project: ProjectId, id: string, archived: boolean) => void
  /** Opens the snooze's picker for a Thread (ADR 0074). */
  snooze?: (project: ProjectId, listed: Listed) => void
  /** Wakes a snoozed Thread now. */
  wake?: (project: ProjectId, id: string) => void
}

const ThreadsContext = createContext<Threads>({
  projects: [],
  run: () => undefined,
})

/** How a part inside the Thread menus runs an item action, as the
 * title's field renames by its App's. */
export function useItemRun(): Run {
  return useContext(ThreadsContext).run
}

/** Gives the Thread menus inside it the window's Projects and acts, and
 * holds the dialog that makes a Project. */
export function ThreadMenus({
  engine,
  projects,
  run,
  archive,
  snooze,
  wake,
  children,
}: {
  engine: Engine
  projects: readonly ProjectSummary[]
  run: Run
  archive: (project: ProjectId, id: string, archived: boolean) => void
  snooze: (project: ProjectId, listed: Listed) => void
  wake: (project: ProjectId, id: string) => void
  children: ReactNode
}) {
  const threads = useMemo(
    () => ({ projects, run, archive, snooze, wake }),
    [projects, run, archive, snooze, wake]
  )
  return (
    <ThreadsContext value={threads}>
      {children}
      <Making engine={engine} projects={projects} />
    </ThreadsContext>
  )
}

/** An item action with its row for one Item. */
type Shown = { action: ItemAction<Shell>; row: ItemRow }

/**
 * The Thread menu's rows for `listed`, in its order: its App's item
 * actions that name it (Rename…, Suggest a title, Previous title, Mark as
 * unread or read), then the rest (Make a Project from it…), Snooze… or
 * Wake now, Archive thread. A row that does not apply is not there;
 * Snooze while the Thread asks, and Archive while it works or asks, are
 * there but off.
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
  const { projects, run, archive, snooze, wake } = useContext(ThreadsContext)
  const isArchived = useIsArchived()
  // Whether it sleeps, by a clock that moves as the menu stays open.
  const now = useNow(30_000)
  const ours = useAfterMenu()
  const later = given ?? ours
  const archived = isArchived(listed)
  const at = {
    project: projects.find((one) => one.id === project),
    now,
    archived,
  }
  const shown = itemActionsOf(listed).flatMap((action): Shown[] => {
    const row = action.row(listed, at)
    return row ? [{ action, row }] : []
  })
  const naming = shown.filter(({ action }) => action.group === "name")
  const others = shown.filter(({ action }) => action.group === "other")
  const drawn = ({ action, row }: Shown) => {
    const act = () => run(action.id, { project, item: listed.id, from: where })
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
      {naming.length > 0 && (others.length > 0 || snooze || archive) && (
        <DropdownMenuSeparator />
      )}
      {others.map(drawn)}
      {wake && asleep(listed, now) ? (
        <DropdownMenuItem onClick={() => wake(project, listed.id)}>
          <AlarmClockIcon />
          Wake now
        </DropdownMenuItem>
      ) : (
        snooze && (
          <DropdownMenuItem
            disabled={!snoozable(listed)}
            onClick={() => later(() => snooze(project, listed))}
          >
            <AlarmClockIcon />
            Snooze…
            <DropdownMenuShortcut>
              {keyFor("thread.snooze")}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        )
      )}
      {archive && (
        <DropdownMenuItem
          disabled={!archived && !archivable(listed)}
          onClick={() => archive(project, listed.id, !archived)}
        >
          {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
          {archived ? "Unarchive thread" : "Archive thread"}
          <DropdownMenuShortcut>
            {keyFor("sidebar.archive")}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      )}
    </>
  )
}
