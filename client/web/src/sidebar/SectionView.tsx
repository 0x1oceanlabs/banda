import { Fragment, useContext } from "react"
import { flushSync } from "react-dom"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { Button } from "@banda/ui/components/button"
import { Separator } from "@banda/ui/components/separator"
import { useRun } from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import type { Listed, PaneState } from "@banda/ui/pane"
import {
  AlarmClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SquarePenIcon,
} from "lucide-react"
import type { Row as Arranged } from "./arrange"
import { EmptyTab, InboxZero } from "./Empty"
import type { Block } from "./inbox"
import type { Settings } from "./settings"
import { rowKey } from "./hold"
import { Dismiss, newThread } from "./open"
import { itemActionOf } from "./items"
import { pickLater } from "./LaterPicker"
import { NewThreadIn } from "./NewThreadIn"
import type { GroupBlock, Region } from "./regions"
import { Rollup } from "./Rollup"
import type { WithMenu } from "./ProjectMenu"
import { ThreadRow } from "./ThreadRow"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"

/**
 * The regions of the tab in view (ADR 0098, decisions 3–5): Your turn
 * under its head, Open under a hairline, the Working shelf in grey with
 * "+ N more", which opens in place; Later and the Archive by day; inbox
 * zero and an empty tab in words; and, grouped, each group under its
 * header, which folds it.
 */
export function SectionView({
  regions,
  settings,
  named,
  isCurrent,
  strayed,
  onToggle,
  onMore,
  engine,
  machine,
  withMenu,
  only,
  projects,
}: {
  regions: readonly Region[]
  settings: Settings
  /** A label above names their machine, as another machine's part. */
  named: boolean
  isCurrent: (project: ProjectId, pane: PaneState) => boolean
  /** The Threads that stand away from their Project's workspace (ADR
   * 0102, decision 6). */
  strayed: ReadonlySet<string>
  /** Folds or opens the group of that key. */
  onToggle: (key: string) => void
  /** Shows a cut list whole. */
  onMore: () => void
  engine: Engine
  /** This machine's No Project, once the engine named it. */
  machine?: ProjectId
  withMenu: WithMenu
  /** The Project whose rows alone the list shows, if one. */
  only: ProjectId | undefined
  projects: readonly ProjectSummary[]
}) {
  const keyFor = useKeyLabel()
  const run = useRun()
  const dismiss = useContext(Dismiss)
  // Grouped by Project, a header names each card's Project.
  const grouped = regions.some((region) => region.group?.by === "project")
  // A row's Later and Wake are its Thread's App's (ADR 0087, decision 12).
  const wake = ({ project, listed }: Arranged) => {
    const action = itemActionOf(listed, "wake")
    if (action) run(action.id, { project: project.id, item: listed.id })
  }
  const laterKey = (listed: Listed) =>
    keyFor(itemActionOf(listed, "later")?.id ?? "")

  const header = (group: GroupBlock, label: string) => {
    const { project } = group
    const Chevron = group.folded ? ChevronRightIcon : ChevronDownIcon
    // Another host's Project has no menu yet: each act would go to this
    // machine's engine.
    const mine = group.host === undefined
    const head = (
      <div className="group/head flex items-center">
        <button
          type="button"
          aria-expanded={!group.folded}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-control px-2 pt-2 pb-1 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            project ? "font-medium text-foreground" : "text-muted-foreground"
          )}
          onClick={() => onToggle(group.key)}
        >
          <Chevron className="size-3 shrink-0 text-muted-foreground" />
          {/* No Project's group has its dashed tile. */}
          {group.by === "project" && <ProjectSign project={project} />}
          <span className="min-w-0 truncate" title={project?.folder}>
            {label}
          </span>
          {/* What waits for the Person, the loudest's mark while folded,
            then how many work, in grey (decision 7). */}
          <span className="ml-auto flex items-center gap-1.5 text-muted-foreground tabular-nums">
            {settings.projects.rollup && (
              <Rollup
                mark={group.folded ? group.mark : "rest"}
                waiting={group.waiting}
              />
            )}
            {group.working > 0 && group.working}
          </span>
        </button>
        {group.by === "project" && !project && mine && (
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
    return project && mine ? withMenu(project, head) : head
  }

  const drawBlock = (block: Block) => {
    switch (block.kind) {
      case "head":
        return (
          <div
            key={block.key}
            data-block={block.key}
            className="flex items-baseline gap-1 px-2 pt-2.5 pb-1 text-xs font-medium text-muted-foreground"
          >
            {block.label}
            {block.count !== undefined && (
              <span className="font-normal tabular-nums">· {block.count}</span>
            )}
          </div>
        )
      case "divider":
        return <Separator key={block.key} className="mx-2 my-1.5 w-auto!" />
      case "more":
        return (
          <button
            key={block.key}
            type="button"
            className="rounded-control px-2 py-1 text-left text-xs text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={(event) => {
              // It goes as the rest shows: the focus goes on to the first
              // card it showed, never to the page.
              const cards = event.currentTarget.previousElementSibling
              const shown = cards?.childElementCount ?? 0
              flushSync(onMore)
              const first = cards?.children[shown]
              const card = first?.matches("button")
                ? first
                : first?.querySelector("button")
              if (card instanceof HTMLElement) card.focus()
            }}
          >
            {block.of === "working"
              ? `+ ${block.count} more`
              : `Show ${block.count} older`}
          </button>
        )
      case "zero":
        return <InboxZero key={block.key} zero={block} />
      case "empty":
        return (
          <EmptyTab
            key={block.key}
            tab={block.tab}
            only={only}
            projects={projects}
          />
        )
      case "group":
        return null
      case "rows":
        return (
          <div key={block.key} className="flex flex-col gap-px">
            {block.rows.map(({ row }) => (
              <ThreadRow
                key={rowKey(row)}
                engine={engine}
                row={row}
                settings={settings}
                inProject={grouped || row.project.scratch}
                current={isCurrent(row.project.id, row.listed.pane)}
                away={strayed.has(row.listed.id)}
                named={named}
                action={
                  row.stand === "later" ? (
                    <Button variant="ghost" size="xs" onClick={() => wake(row)}>
                      <AlarmClockIcon />
                      Wake
                    </Button>
                  ) : (
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
                  )
                }
              />
            ))}
          </div>
        )
    }
  }

  return regions.map((region) =>
    region.label === undefined ? (
      <Fragment key={region.key}>{region.blocks.map(drawBlock)}</Fragment>
    ) : (
      <div key={region.key} role="group" aria-label={region.label}>
        {region.group && header(region.group, region.label)}
        {!region.group?.folded && region.blocks.map(drawBlock)}
      </div>
    )
  )
}
