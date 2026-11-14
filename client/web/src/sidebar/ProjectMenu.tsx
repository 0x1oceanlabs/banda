import {
  createContext,
  Fragment,
  type ReactElement,
  type RefObject,
  useContext,
  useRef,
} from "react"
import type { ProjectSummary } from "@banda/contract"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  useAfterMenu,
} from "@banda/ui/components/context-menu"
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@banda/ui/components/dropdown-menu"
import { useRun } from "@banda/core/react"
import {
  BadgeCheckIcon,
  CheckCheckIcon,
  CircleDashedIcon,
  FolderOpenIcon,
  FolderSearchIcon,
  type LucideIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react"
import { LOCATE } from "../menu/menu"
import { MenuRow } from "../titles/ThreadMenu"
import { notNow } from "../trust/not-now"
import { actsOf } from "./acts"
import type { ProjectAsks } from "./inbox"
import type { Row } from "./rows"
import { useOpen } from "./open"
import { useActs } from "./useActs"

/** Every row the sidebar list was made of, from which a Project's menu
 * archives its Threads; none outside the list. */
export const ProjectRows = createContext<readonly Row[]>([])

/** The rows of `project`'s Threads, this machine's, that its cards may
 * archive: Done, Failed, Woke and Open, not one that asks or works. */
export function archivableIn(
  rows: readonly Row[],
  project: ProjectSummary
): Row[] {
  return rows.filter(
    (row) =>
      row.host === undefined &&
      row.project.id === project.id &&
      actsOf(row.stand, row.listed).includes("archive")
  )
}

/**
 * A Project's menu (ADR 0098, decision 16), around what opens it: its
 * group header, whose ⋯ opens it as a right click does, Shift+F10 and the
 * Menu key on that header picked, a card's Project sign, and a Project's
 * own card, whose Trust… and Not now come first, for the keys. Locate
 * folder for a Project whose folder is missing; Open folder; Project
 * settings…; then Archive its Threads,
 * those its cards may archive, told in the one Archived toast whose Undo
 * takes them all back; and Remove from Banda…, which asks first. Each runs
 * by the Window's actions, as their keys would. It is this machine's
 * Projects' alone: another's acts would go to this machine's engine.
 */
export function ProjectMenu({
  project,
  asks,
  className,
  children,
}: {
  project: ProjectSummary
  /** What its card asks, on a Project's own card. */
  asks?: ProjectAsks
  /** Its trigger's place in its line. */
  className?: string
  children: ReactElement
}) {
  const trigger = useRef<HTMLDivElement>(null)
  return (
    <ContextMenu>
      <ContextMenuTrigger ref={trigger} className={className}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label="Project menu" className="min-w-56">
        <Entries project={project} asks={asks} trigger={trigger} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** A row of a Project's menu, by what it does. */
export type ProjectEntry =
  "trust" | "not-now" | "locate" | "folder" | "settings" | "archive" | "remove"

/** Each row's icon and title. */
const LOOK: Record<ProjectEntry, { icon: LucideIcon; title: string }> = {
  trust: { icon: BadgeCheckIcon, title: "Trust…" },
  "not-now": { icon: CircleDashedIcon, title: "Not now" },
  locate: { icon: FolderSearchIcon, title: LOCATE },
  folder: { icon: FolderOpenIcon, title: "Open folder" },
  settings: { icon: SettingsIcon, title: "Project settings…" },
  archive: { icon: CheckCheckIcon, title: "Archive its Threads" },
  remove: { icon: Trash2Icon, title: "Remove from Banda…" },
}

/**
 * A Project's menu in groups a line apart (ADR 0098, decision 16): on its
 * own card that `asks` for trust, Trust… and Not now first; then Locate
 * folder where its folder is `missing`, Open folder and Project
 * settings…; then Archive its Threads and Remove from Banda…. No New
 * Thread here: the sidebar starts no Thread (Roma, 2026-11-12). Pure, so
 * plain tests cover it.
 */
export function entriesOf(
  { missing }: Pick<ProjectSummary, "missing">,
  asks?: ProjectAsks
): ProjectEntry[][] {
  return [
    ...(asks === "trust" ? [["trust", "not-now"] as ProjectEntry[]] : []),
    [...(missing ? ["locate" as const] : []), "folder", "settings"],
    ["archive", "remove"],
  ]
}

/** The menu's rows, worked out only while it is open, as its popup is
 * there only then; `trigger` is what it opened on. Open folder is off
 * where the folder is missing, and Archive its Threads where none would
 * go. */
function Entries({
  project,
  asks,
  trigger,
}: {
  project: ProjectSummary
  asks?: ProjectAsks
  trigger: RefObject<HTMLDivElement | null>
}) {
  // Settings and Locate open a Pane or a menu; the rest act in place.
  const open = useOpen()
  const run = useRun()
  const later = useAfterMenu()
  const actOn = useActs()
  const archivable = archivableIn(useContext(ProjectRows), project)
  const { id, missing } = project
  const runs: Record<ProjectEntry, () => void> = {
    // The trust card and the question take the focus once the menu has
    // gone.
    trust: () =>
      later(() => run("projects.trust", { project: id, trusted: true })),
    "not-now": () => notNow(id),
    locate: () => open("projects.locate", { project: id }),
    folder: () => run("file.outside", { file: project.folder }),
    settings: () => open("projects.settings", { project: id }),
    archive: () => {
      const card = trigger.current ?? document.documentElement
      for (const row of archivable) actOn(row, "archive", { card })
    },
    remove: () => later(() => run("projects.remove", { project: id })),
  }
  const off = (entry: ProjectEntry) =>
    (entry === "folder" && missing) ||
    (entry === "archive" && archivable.length === 0)
  return entriesOf(project, asks).map((group, at) => (
    <Fragment key={group.join()}>
      {at > 0 && <DropdownMenuSeparator />}
      <DropdownMenuGroup>
        {at === 0 && (
          <DropdownMenuLabel className="flex min-w-0 gap-1.5">
            <span className="truncate text-foreground">{project.name}</span>
            <span className="min-w-0 truncate font-normal">
              {project.folder}
            </span>
          </DropdownMenuLabel>
        )}
        {group.map((entry) => (
          <MenuRow
            key={entry}
            icon={LOOK[entry].icon}
            title={LOOK[entry].title}
            off={off(entry)}
            danger={entry === "remove"}
            onClick={runs[entry]}
          />
        ))}
      </DropdownMenuGroup>
    </Fragment>
  ))
}
