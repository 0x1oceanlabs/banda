/**
 * The places on a Files Pane's left (ADR 0073, decision 1): the Projects
 * with their signs, Home, Desktop and Downloads, what the Person pinned,
 * then Recent and the Trash. It folds to icons, as it starts on a narrow
 * Pane.
 */
import type { ReactNode } from "react"
import type { ProjectSummary } from "@banda/contract"
import type { Places } from "@banda/contract/files"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import { DropdownMenuItem } from "@banda/ui/components/dropdown-menu"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { cn } from "@banda/ui/lib/utils"
import {
  ClockIcon,
  DownloadIcon,
  FolderIcon,
  HouseIcon,
  MonitorIcon,
  PinOffIcon,
  TrashIcon,
} from "lucide-react"
import { nameOf, tilded } from "./where"

export type RailProps = {
  /** Folded to icons. */
  folded: boolean
  projects: readonly ProjectSummary[]
  places: Places | null
  pinned: readonly string[]
  /** The folder shown, whole; none while Recent shows. */
  at: string | null
  recent: boolean
  /** The Trash shows. */
  trash: boolean
  onGo: (dir: string) => void
  onRecent: () => void
  onTrash: () => void
  onUnpin: (dir: string) => void
}

export function Rail({
  folded,
  projects,
  places,
  pinned,
  at,
  recent,
  trash,
  onGo,
  onRecent,
  onTrash,
  onUnpin,
}: RailProps) {
  const home = places?.home ?? null
  const place = (dir: string, icon: ReactNode, name: string) => (
    <Place
      key={dir}
      icon={icon}
      name={name}
      title={tilded(dir, home)}
      on={at === dir}
      folded={folded}
      onClick={() => onGo(dir)}
    />
  )
  return (
    <nav
      aria-label="Places"
      className={cn(
        "flex shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r py-1.5 [scrollbar-width:none]",
        folded ? "w-10 items-center px-1" : "w-42 px-1"
      )}
    >
      {projects.length > 0 && (
        <Section name="Projects" folded={folded} first>
          {projects.map((project) =>
            place(
              project.folder,
              <ProjectSign project={project} />,
              project.name
            )
          )}
        </Section>
      )}
      {places && (
        <Section name="Places" folded={folded} first={projects.length === 0}>
          {place(places.home, <HouseIcon />, "Home")}
          {places.desktop && place(places.desktop, <MonitorIcon />, "Desktop")}
          {places.downloads &&
            place(places.downloads, <DownloadIcon />, "Downloads")}
        </Section>
      )}
      {pinned.length > 0 && (
        <Section name="Pinned" folded={folded}>
          {pinned.map((dir) => (
            <ContextMenu key={dir}>
              <ContextMenuTrigger render={<div className="contents" />}>
                {place(dir, <FolderIcon />, nameOf(dir))}
              </ContextMenuTrigger>
              <ContextMenuContent
                aria-label="Pinned place"
                className="min-w-40"
              >
                <DropdownMenuItem onClick={() => onUnpin(dir)}>
                  <PinOffIcon />
                  Unpin
                </DropdownMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </Section>
      )}
      <Section name="" folded={folded}>
        <Place
          icon={<ClockIcon />}
          name="Recent"
          title="Recent"
          on={recent}
          folded={folded}
          onClick={onRecent}
        />
        <Place
          icon={<TrashIcon />}
          name="Trash"
          title="The system's Trash"
          on={trash}
          folded={folded}
          onClick={onTrash}
        />
      </Section>
    </nav>
  )
}

/** A heading over some places; folded, a line between them. */
function Section({
  name,
  folded,
  first = false,
  children,
}: {
  name: string
  folded: boolean
  first?: boolean
  children: ReactNode
}) {
  return (
    <div role="group" aria-label={name || undefined} className="contents">
      {folded ? (
        !first && <div className="my-1.5 h-px w-5 shrink-0 bg-border" />
      ) : (
        <div className="truncate px-2 pt-2 pb-0.5 text-[10.5px] font-medium text-muted-foreground/80">
          {name || " "}
        </div>
      )}
      {children}
    </div>
  )
}

/** One place: a quiet row, lit while the Pane shows it. */
function Place({
  icon,
  name,
  title,
  on,
  folded,
  onClick,
}: {
  icon: ReactNode
  name: string
  title: string
  on: boolean
  folded: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-current={on ? "location" : undefined}
      aria-label={name}
      onClick={onClick}
      className={cn(
        "flex h-6 shrink-0 items-center gap-2 rounded-control text-xs text-muted-foreground outline-none hover:bg-foreground/7 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0",
        folded ? "w-7 justify-center" : "w-full px-2",
        on && "bg-foreground/10 text-foreground"
      )}
    >
      {icon}
      {!folded && <span className="min-w-0 truncate">{name}</span>}
    </button>
  )
}
