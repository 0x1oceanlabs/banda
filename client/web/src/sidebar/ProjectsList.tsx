import { Fragment, type ReactNode } from "react"
import type { ProjectId } from "@banda/contract"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { cn } from "@banda/ui/lib/utils"
import type { ProjectLine } from "./arrange"
import { NewThreadIn } from "./NewThreadIn"
import { useOpen } from "./open"
import type { WithMenu } from "./ProjectMenu"
import { Rollup } from "./Rollup"
import type { Settings } from "./settings"

/** The list of Projects, as Herdr's: a click shows only that Project's rows. */
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
  return (
    <div
      role="group"
      aria-label="Projects"
      className="flex flex-col gap-px pb-1"
    >
      <div className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
        Projects
      </div>
      {lines.map(({ project, mark, waiting }) => (
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
                  "flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-left text-sm outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
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
                  <span className="shrink-0 text-xs text-attention">
                    Missing
                  </span>
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
      ))}
      {children}
    </div>
  )
}
