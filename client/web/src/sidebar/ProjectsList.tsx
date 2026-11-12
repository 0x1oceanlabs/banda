import { Fragment, type ReactNode } from "react"
import type { ProjectId } from "@banda/contract"
import { useThisNamed } from "@banda/core/react"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { cn } from "@banda/ui/lib/utils"
import type { ProjectLine } from "./rows"
import { HerePart } from "./HostPart"
import { NewThreadIn } from "./NewThreadIn"
import { useOpen } from "./open"
import type { WithMenu } from "./ProjectMenu"
import { Rollup } from "./Rollup"
import type { Settings } from "./settings"

/** The list of Projects, as Herdr's: a click shows only that Project's
 * rows. This machine's stand under its own label, as another's do, where
 * the Person asked it named too (ADR 0095, decision 4). */
export function ProjectsList({
  lines,
  settings,
  only,
  onPick,
  withMenu,
  children,
}: {
  lines: ProjectLine[]
  settings: Settings
  only?: ProjectId
  /** Shows only that Project's rows, or all again. */
  onPick: (project: ProjectId) => void
  withMenu: WithMenu
  /** The other hosts' Projects, below this machine's. */
  children?: ReactNode
}) {
  const open = useOpen()
  const here = useThisNamed(settings.machines.thisToo)
  const mine = lines.map(({ project, mark, waiting }) => (
    <Fragment key={project.id}>
      {withMenu(
        project,
        <div className="group/head flex items-center">
          <button
            type="button"
            aria-pressed={only === project.id}
            title={
              project.missing
                ? `The folder ${project.folder} is missing`
                : project.folder
            }
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-control border border-transparent px-2 py-1 text-left text-ui outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
              only === project.id && "border-border bg-tile shadow-xs"
            )}
            onClick={() =>
              project.missing
                ? open("projects.locate", { project: project.id })
                : onPick(project.id)
            }
          >
            <ProjectSign project={project} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            {project.missing && (
              <span className="shrink-0 text-meta text-attention">Missing</span>
            )}
            {settings.projects.rollup && (
              <Rollup mark={mark} waiting={waiting} />
            )}
          </button>
          {settings.projects.newThread && !project.missing && (
            <NewThreadIn project={project} />
          )}
        </div>
      )}
    </Fragment>
  ))
  return (
    <div
      role="group"
      aria-label="Projects"
      className="flex flex-col gap-px pb-1"
    >
      <div className="px-2 pt-2 pb-1 text-meta text-muted-foreground">
        Projects
      </div>
      {here ? <HerePart named={here}>{mine}</HerePart> : mine}
      {children}
    </div>
  )
}
