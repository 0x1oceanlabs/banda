import type {
  Engine,
  ProjectId,
  ProjectSummary,
  UpdateProject,
} from "@banda/contract"

/** The Projects a picker shows: pinned ones first, archived ones not at
 * all (ADR 0026, decision 5). The window and the modules' Panes list
 * them alike. */
export function shownProjects(
  projects: readonly ProjectSummary[]
): ProjectSummary[] {
  return projects
    .filter((project) => !project.archived && !project.scratch)
    .toSorted((a, b) => Number(b.pinned) - Number(a.pinned))
}

/** The Projects whose folder is there: a missing one opens nothing until
 * the Person locates it (ADR 0026, decision 6). */
export function openProjects(
  projects: readonly ProjectSummary[]
): ProjectSummary[] {
  return projects.filter((project) => !project.missing)
}

/** Whether two lists say the same Projects, as a picker shows them. */
export function sameProjects(
  a: readonly ProjectSummary[],
  b: readonly ProjectSummary[]
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (one, n) =>
        one.id === b[n].id &&
        one.name === b[n].name &&
        one.folder === b[n].folder &&
        one.pinned === b[n].pinned &&
        one.archived === b[n].archived &&
        one.missing === b[n].missing &&
        one.scratch === b[n].scratch
    )
  )
}

const hearing = new Set<() => void>()

/** Tells every list of the Projects in the window to read them again: a
 * Project was added, changed or removed here. The engine has no event for
 * it yet, so a change made elsewhere shows as the window comes to the
 * front (`useProjects`). */
export function projectsChanged(): void {
  for (const hear of hearing) hear()
}

/** Calls `hear` each time `projectsChanged` is told; returns how to stop. */
export function onProjectsChanged(hear: () => void): () => void {
  hearing.add(hear)
  return () => {
    hearing.delete(hear)
  }
}

/** Changes a Project in the engine, and the window's lists follow. */
export async function updateProject(
  engine: Engine,
  how: UpdateProject
): Promise<ProjectSummary> {
  const project = await engine.command("projects.update", how)
  projectsChanged()
  return project
}

/** Removes a Project from the engine, and from the window's lists. */
export async function removeProject(
  engine: Engine,
  project: ProjectId
): Promise<void> {
  await engine.command("projects.remove", { project })
  projectsChanged()
}
