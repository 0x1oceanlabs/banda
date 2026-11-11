import { type ReactElement, useRef, useState } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  useAfterMenu,
} from "@banda/ui/components/context-menu"
import { DropdownMenuItem } from "@banda/ui/components/dropdown-menu"
import { useRun } from "@banda/core/react"
import { copyText } from "@banda/ui/lib/clipboard"
import {
  BadgeCheckIcon,
  CircleDashedIcon,
  CopyIcon,
  FolderSearchIcon,
  PinIcon,
  PinOffIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react"
import { LOCATE } from "../menu/menu"
import { newThread, useOpen } from "./open"
import { useHoldWhile } from "./useHold"

/** A Project's row with its right-click menu around it, which takes
 * `className` as the row's place in its line. */
export type WithMenu = (
  project: ProjectSummary,
  row: ReactElement,
  className?: string
) => ReactElement

/** A Project's right-click menu, in T3 Code's words (ADR 0026, decision
 * 5), with its trust (ADR 0083, decision 5). */
export function ProjectMenu({
  project,
  onTrust,
  onStopTrusting,
  className,
  children,
}: {
  project: ProjectSummary
  /** Its row's place in its line. */
  className?: string
  /** Asks on a card by `row` whether to trust the Project. */
  onTrust: (project: ProjectId, row: Element) => void
  onStopTrusting: (project: ProjectId) => void
  children: ReactElement
}) {
  const row = useRef<HTMLDivElement>(null)
  // A pin changes the list in place; the rest open a Pane or a menu.
  const run = useRun()
  const open = useOpen()
  // Open, it holds the list still (ADR 0098, decision 6).
  const [shown, setShown] = useState(false)
  useHoldWhile(shown)
  return (
    <ContextMenu onOpenChange={setShown}>
      <ContextMenuTrigger ref={row} className={className}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {project.missing ? (
          <DropdownMenuItem
            onClick={() => open("projects.locate", { project: project.id })}
          >
            <FolderSearchIcon />
            {LOCATE}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => newThread(open, { project: project.id })}
          >
            <SquarePenIcon />
            New Thread
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => copyText(project.folder)}>
          <CopyIcon />
          Copy path
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            run("projects.pin", {
              project: project.id,
              pinned: !project.pinned,
            })
          }
        >
          {project.pinned ? <PinOffIcon /> : <PinIcon />}
          {project.pinned ? "Unpin Project" : "Pin Project"}
        </DropdownMenuItem>
        {!project.scratch && (
          <TrustItem
            trusted={project.trusted}
            onTrust={() => row.current && onTrust(project.id, row.current)}
            onStopTrusting={() => onStopTrusting(project.id)}
          />
        )}
        <DropdownMenuItem
          onClick={() => open("projects.settings", { project: project.id })}
        >
          <SettingsIcon />
          Project settings
        </DropdownMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Trust Project…, which asks on a card by the row once the menu has
 * gone, or Stop trusting, at once. */
function TrustItem({
  trusted,
  onTrust,
  onStopTrusting,
}: {
  trusted: boolean
  onTrust: () => void
  onStopTrusting: () => void
}) {
  const later = useAfterMenu()
  return trusted ? (
    <DropdownMenuItem onClick={onStopTrusting}>
      <CircleDashedIcon />
      Stop trusting
    </DropdownMenuItem>
  ) : (
    <DropdownMenuItem onClick={() => later(onTrust)}>
      <BadgeCheckIcon />
      Trust Project…
    </DropdownMenuItem>
  )
}
