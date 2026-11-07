/**
 * The Thread menu (ADR 0077, decision 5): one menu of a thing a module
 * lists, the same at its title in a Pane's header and at its row in the
 * sidebar. The rows are the window's; what each does to the thing, its
 * module says (`Module.listed`).
 */
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { useAfterMenu } from "@banda/ui/components/context-menu"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@banda/ui/components/dropdown-menu"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { useNow } from "@banda/ui/hooks/use-now"
import { asleep, type Listed } from "@banda/ui/pane"
import {
  AlarmClockIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  CircleDotIcon,
  CircleIcon,
  FolderPlusIcon,
  PencilIcon,
  SparklesIcon,
  Undo2Icon,
} from "lucide-react"
import { archivable, useIsArchived } from "../sidebar/archived"
import { snoozable } from "../sidebar/snoozed"
import { MakeProject } from "../sidebar/MakeProject"
import {
  listingFor,
  previousTitle,
  startNaming,
  suggestTitle,
  toggleUnread,
} from "./titles"

/** What the Thread menu asks of the window, wherever it opens. */
type Threads = {
  projects: readonly ProjectSummary[]
  /** Opens "Make a Project from this Thread" for a Thread in No Project
   * (ADR 0046). */
  makeProject?: (project: ProjectSummary) => void
  /** Archives a thing, which closes the Panes that show it, or brings it
   * back (ADR 0069). */
  archive?: (project: ProjectId, id: string, archived: boolean) => void
  /** Opens the snooze's picker for a Thread (ADR 0074). */
  snooze?: (project: ProjectId, listed: Listed) => void
  /** Wakes a snoozed Thread now. */
  wake?: (project: ProjectId, id: string) => void
}

const ThreadsContext = createContext<Threads>({ projects: [] })

/** Gives the Thread menus inside it the window's Projects and acts, and
 * holds the dialog that makes a Project. */
export function ThreadMenus({
  engine,
  projects,
  archive,
  snooze,
  wake,
  children,
}: {
  engine: Engine
  projects: readonly ProjectSummary[]
  archive: (project: ProjectId, id: string, archived: boolean) => void
  snooze: (project: ProjectId, listed: Listed) => void
  wake: (project: ProjectId, id: string) => void
  children: ReactNode
}) {
  const [making, setMaking] = useState<ProjectSummary>()
  const threads = useMemo(
    () => ({ projects, makeProject: setMaking, archive, snooze, wake }),
    [projects, archive, snooze, wake]
  )
  return (
    <ThreadsContext value={threads}>
      {children}
      {making && (
        <MakeProject
          engine={engine}
          project={making}
          onClose={() => setMaking(undefined)}
        />
      )}
    </ThreadsContext>
  )
}

/**
 * The Thread menu's rows for `listed`, in its order: Rename…, Suggest a
 * title, Previous title, Mark as unread or read, Make a Project from it…,
 * Snooze… or Wake now, Archive thread. A row that does not apply is not
 * there; Snooze while the Thread asks, and Archive while it works or
 * asks, are there but off. A thing whose module names
 * nothing (`Module.listed`) has the rows from Make a Project on.
 */
export function ThreadRows({
  engine,
  project,
  listed,
  where,
  later: given,
}: {
  engine: Engine
  project: ProjectId
  listed: Listed
  /** Where Rename… opens the field: the header, or the row. */
  where: "head" | "row"
  /** Runs an act once the menu has gone, as the field that takes the
   * focus must; a context menu's own, by default. */
  later?: (act: () => void) => void
}) {
  const keyFor = useKeyLabel()
  const { projects, makeProject, archive, snooze, wake } =
    useContext(ThreadsContext)
  const isArchived = useIsArchived()
  // Whether it sleeps, by a clock that moves as the menu stays open.
  const now = useNow(30_000)
  const ours = useAfterMenu()
  const later = given ?? ours
  const listing = listingFor(listed)
  const summary = projects.find((one) => one.id === project)
  const archived = isArchived(listed)
  const named = listing && (
    <>
      <DropdownMenuItem
        onClick={() => later(() => startNaming(project, listed.id, where))}
      >
        <PencilIcon />
        Rename…
        <DropdownMenuShortcut>{keyFor("thread.rename")}</DropdownMenuShortcut>
      </DropdownMenuItem>
      {listing.suggest && (
        <DropdownMenuItem
          onClick={() => void suggestTitle(engine, project, listed)}
        >
          <SparklesIcon />
          Suggest a title
          <DropdownMenuShortcut>
            {keyFor("thread.suggest-title")}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      )}
      {listed.was !== undefined && (
        <DropdownMenuItem
          onClick={() => previousTitle(engine, project, listed)}
        >
          <Undo2Icon />
          Previous title
        </DropdownMenuItem>
      )}
      {listing.unread && listed.seen !== undefined && (
        <DropdownMenuItem onClick={() => toggleUnread(listed)}>
          {listed.seen ? <CircleDotIcon /> : <CircleIcon />}
          {listed.seen ? "Mark as unread" : "Mark as read"}
          <DropdownMenuShortcut>{keyFor("thread.unread")}</DropdownMenuShortcut>
        </DropdownMenuItem>
      )}
    </>
  )
  return (
    <>
      {named}
      {named && ((summary?.scratch && makeProject) || snooze || archive) && (
        <DropdownMenuSeparator />
      )}
      {summary?.scratch && makeProject && (
        <DropdownMenuItem onClick={() => later(() => makeProject(summary))}>
          <FolderPlusIcon />
          Make a Project from it…
        </DropdownMenuItem>
      )}
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
