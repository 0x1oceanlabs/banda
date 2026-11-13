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

/** Changes a Project in the engine. The window's lists follow what its
 * machine says of it, as they follow every change (`useProjects`). */
export function updateProject(
  engine: Engine,
  how: UpdateProject
): Promise<ProjectSummary> {
  return engine.command("projects.update", how)
}

/** Trusts a Project, or takes its trust back (ADR 0083, decision 5): only
 * the Person's gesture does. */
export function trustProject(
  engine: Engine,
  project: ProjectId,
  trusted: boolean
): Promise<ProjectSummary> {
  return engine.command("projects.trust", { project, trusted })
}

/** Looks in a Project's folder for its sign's picture again (ADR 0070). */
export function findSign(
  engine: Engine,
  project: ProjectId
): Promise<ProjectSummary> {
  return engine.command("projects.find_sign", { project })
}

/** Removes a Project from the engine. */
export async function removeProject(
  engine: Engine,
  project: ProjectId
): Promise<void> {
  await engine.command("projects.remove", { project })
}
