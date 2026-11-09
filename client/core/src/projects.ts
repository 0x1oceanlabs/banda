/**
 * Which Projects a list shows, as every client shows them (ADR 0026,
 * decisions 5 and 6): the window's pickers, the modules' Panes and the
 * machines a new Thread starts on list them alike.
 */
import type { ProjectSummary } from "@banda/contract"

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
