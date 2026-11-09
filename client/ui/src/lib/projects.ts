import type {
  Engine,
  ProjectId,
  ProjectSummary,
  Sign,
  UpdateProject,
} from "@banda/contract"

/** Which Projects a list shows: the core's (ADR 0089), named here too
 * for the Panes that take them from here, until L3 splits this package. */
export { openProjects, shownProjects } from "@banda/core"

/** What the Threads without a Project are in (ADR 0069). */
export const NO_PROJECT = "No Project"

/** Whether `project` stands for No Project: none, or one Thread's own. */
export function isNoProject(project: ProjectSummary | undefined): boolean {
  return !project || project.scratch
}

/** What a Project is called where it shows. */
export function projectLabel(project: ProjectSummary | undefined): string {
  return isNoProject(project) || !project?.name ? NO_PROJECT : project.name
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
        one.scratch === b[n].scratch &&
        one.trusted === b[n].trusted &&
        one.trust_said === b[n].trust_said &&
        sameSign(one.sign, b[n].sign)
    )
  )
}

/** Whether two signs draw the same (ADR 0070). */
function sameSign(a: Sign, b: Sign): boolean {
  return (
    a.kind === b.kind &&
    a.text === b.text &&
    a.color === b.color &&
    a.picked === b.picked &&
    a.found === b.found
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

/** Trusts a Project, or takes its trust back (ADR 0083, decision 5): only
 * the Person's gesture does, and the window's lists follow. */
export async function trustProject(
  engine: Engine,
  project: ProjectId,
  trusted: boolean
): Promise<ProjectSummary> {
  const changed = await engine.command("projects.trust", { project, trusted })
  projectsChanged()
  return changed
}

/** Looks in a Project's folder for its sign's picture again (ADR 0070),
 * and the window's lists follow. */
export async function findSign(
  engine: Engine,
  project: ProjectId
): Promise<ProjectSummary> {
  const found = await engine.command("projects.find_sign", { project })
  projectsChanged()
  return found
}

/** Removes a Project from the engine, and from the window's lists. */
export async function removeProject(
  engine: Engine,
  project: ProjectId
): Promise<void> {
  await engine.command("projects.remove", { project })
  projectsChanged()
}
