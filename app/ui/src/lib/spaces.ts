import type { SpaceSummary } from "@banda/contract"

/** The Spaces a picker shows: pinned ones first, archived ones not at
 * all (ADR 0026, decision 5). The window and the modules' Panes list
 * them alike. */
export function shownSpaces(spaces: readonly SpaceSummary[]): SpaceSummary[] {
  return spaces
    .filter((space) => !space.archived)
    .toSorted((a, b) => Number(b.pinned) - Number(a.pinned))
}

/** Whether two lists say the same Spaces, as a picker shows them. */
export function sameSpaces(
  a: readonly SpaceSummary[],
  b: readonly SpaceSummary[]
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (one, n) =>
        one.id === b[n].id &&
        one.name === b[n].name &&
        one.folder === b[n].folder &&
        one.pinned === b[n].pinned &&
        one.archived === b[n].archived
    )
  )
}
