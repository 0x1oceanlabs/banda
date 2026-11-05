/** Where a new Thread starts: its Project (ADR 0006). Its Harness is chosen
 * with its model, in the model picker (ADR 0031, decision 6). */
import { useMemo } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { useMachine } from "@banda/ui/hooks/use-status"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { openProjects, shownProjects } from "@banda/ui/lib/projects"
import { FolderIcon, FolderPlusIcon } from "lucide-react"
import { Pick } from "./ThreadSettings"

/**
 * The Project of a Thread not yet started. A Person changes it until the
 * first message; after it, it is the Thread's for good.
 */
export function NewThreadBar({
  engine,
  project,
  disabled,
  onProject,
  onAddProject,
}: {
  engine: Engine
  project: ProjectId
  disabled: boolean
  onProject: (project: ProjectId) => void
  /** Opens "Add Project" in the Banda menu (ADR 0026), from the Project list. */
  onAddProject?: () => void
}) {
  const projects = useShownProjects(engine)
  const machine = useMachine(engine)
  return (
    // In meta words, its icon in line with the composer's text above it.
    <div className="flex min-w-0 items-center gap-0.5 px-2.5 text-muted-foreground">
      {machine && (
        <Pick
          what="Project"
          icon={<FolderIcon data-icon="inline-start" />}
          value={projects.some((s) => s.id === project) ? project : machine}
          choices={[
            {
              id: machine,
              name: "No Project",
              about: "A new Thread with its own folder",
            },
            ...projects.map((project) => ({
              id: project.id,
              name: project.name,
              about: project.folder,
            })),
          ]}
          disabled={disabled}
          onChange={(id) => onProject(id as ProjectId)}
          more={
            onAddProject && {
              title: "Add Project",
              icon: <FolderPlusIcon />,
              run: onAddProject,
            }
          }
        />
      )}
    </div>
  )
}

function useShownProjects(engine: Engine): ProjectSummary[] {
  const { listed } = useProjects(engine)
  // As the window lists them: pinned first, archived ones not at all;
  // nor one whose folder is missing, where no Thread starts.
  return useMemo(
    () =>
      listed.state === "ready"
        ? openProjects(shownProjects(listed.value))
        : NONE,
    [listed]
  )
}

const NONE: ProjectSummary[] = []
