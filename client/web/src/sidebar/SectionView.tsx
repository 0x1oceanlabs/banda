import { useContext } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { Button } from "@banda/ui/components/button"
import { clock, useRun } from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import type { Listed, PaneState } from "@banda/ui/pane"
import { mayPutOff } from "@banda/ui/status"
import {
  AlarmClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SquarePenIcon,
} from "lucide-react"
import { type Row as Arranged, type Section } from "./arrange"
import type { Settings } from "./settings"
import { rowKey } from "./hold"
import { Dismiss, newThread } from "./open"
import { itemActionOf } from "./items"
import { pickLater } from "./LaterPicker"
import { NewThreadIn } from "./NewThreadIn"
import { Rollup } from "./Rollup"
import type { WithMenu } from "./ProjectMenu"
import { ThreadRow } from "./ThreadRow"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"

/** A section: its header, which folds it, and its rows. */
export function SectionView({
  section,
  settings,
  more,
  isCurrent,
  strayed,
  onToggle,
  onMore,
  engine,
  machine,
  withMenu,
}: {
  section: Section
  settings: Settings
  more: boolean
  isCurrent: (project: ProjectId, pane: PaneState) => boolean
  /** The Threads that stand away from their Project's workspace (ADR
   * 0102, decision 6). */
  strayed: ReadonlySet<string>
  onToggle: () => void
  onMore: () => void
  engine: Engine
  /** This machine's No Project, once the engine named it. */
  machine?: ProjectId
  withMenu: WithMenu
}) {
  const keyFor = useKeyLabel()
  const run = useRun()
  const dismiss = useContext(Dismiss)
  // A row's Later and Wake are its Thread's App's (ADR 0087, decision 12).
  const wake = ({ project, listed }: Arranged) => {
    const action = itemActionOf(listed, "wake")
    if (action) run(action.id, { project: project.id, item: listed.id })
  }
  const laterKey = (listed: Listed) =>
    keyFor(itemActionOf(listed, "later")?.id ?? "")
  const { limit } = settings.group
  const rows = limit > 0 && !more ? section.rows.slice(0, limit) : section.rows
  const hidden = section.rows.length - rows.length
  const Chevron = section.folded ? ChevronRightIcon : ChevronDownIcon
  const { project } = section
  // Another host's Project has no menu yet: each act would go to this
  // machine's engine.
  const mine = section.host === undefined
  const header = section.label && (
    <div className="group/head flex items-center">
      <button
        type="button"
        aria-expanded={!section.folded}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 rounded-control px-2 pt-2 pb-1 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          project ? "font-medium text-foreground" : "text-muted-foreground"
        )}
        onClick={onToggle}
      >
        <Chevron className="size-3 shrink-0 text-muted-foreground" />
        {/* Grouped by Project, No Project's section has its dashed tile. */}
        {settings.group.by === "project" && <ProjectSign project={project} />}
        <span className="min-w-0 truncate" title={project?.folder}>
          {section.label}
        </span>
        <span className="ml-auto flex items-center gap-1 text-muted-foreground tabular-nums">
          {section.next !== undefined && (
            <span className="mr-1">next {clock(section.next)}</span>
          )}
          {section.folded && settings.projects.rollup && (
            <Rollup mark={section.mark} waiting={section.waiting} />
          )}
          {section.rows.length}
        </span>
      </button>
      {section.key === "no-project" && mine && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New Thread in No Project"
          title="New Thread"
          onClick={() => {
            // It goes, as from any New Thread, though none starts before
            // the engine names this machine.
            dismiss?.()
            if (machine) newThread(run, machine)
          }}
        >
          <SquarePenIcon />
        </Button>
      )}
      {project && mine && settings.projects.newThread && (
        <NewThreadIn project={project} />
      )}
    </div>
  )
  return (
    <div role="group" aria-label={section.label || "Threads"}>
      {header && (project && mine ? withMenu(project, header) : header)}
      {!section.folded && (
        <div className="flex flex-col gap-px">
          {rows.map((row) => (
            <ThreadRow
              key={rowKey(row)}
              engine={engine}
              row={row}
              settings={settings}
              inProject={project !== undefined || row.project.scratch}
              current={isCurrent(row.project.id, row.listed.pane)}
              away={strayed.has(row.listed.id)}
              named={!mine}
              action={
                row.stand === "later" ? (
                  <Button variant="ghost" size="xs" onClick={() => wake(row)}>
                    <AlarmClockIcon />
                    Wake
                  </Button>
                ) : mayPutOff(row.listed) ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Later"
                    title={`Later ${laterKey(row.listed)}`}
                    onClick={(event) => {
                      const anchor = event.currentTarget.closest("[data-row]")
                      pickLater({
                        project: row.project.id,
                        listed: row.listed,
                        ...(anchor ? { anchor } : {}),
                      })
                    }}
                  >
                    <AlarmClockIcon />
                  </Button>
                ) : undefined
              }
            />
          ))}
          {(hidden > 0 || more) && (
            <button
              type="button"
              className="rounded-control px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={onMore}
            >
              {more ? "Show fewer" : `Show ${hidden} more`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
