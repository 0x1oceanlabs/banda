import type {
  Engine,
  SpaceId,
  SpaceSummary,
  UpdateSpace,
} from "@banda/contract"

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

const hearing = new Set<() => void>()

/** Tells every list of the Spaces in the window to read them again: a
 * Space was added, changed or removed here. The engine has no event for
 * it yet, so a change made elsewhere shows as the window comes to the
 * front (`useSpaces`). */
export function spacesChanged(): void {
  for (const hear of hearing) hear()
}

/** Calls `hear` each time `spacesChanged` is told; returns how to stop. */
export function onSpacesChanged(hear: () => void): () => void {
  hearing.add(hear)
  return () => {
    hearing.delete(hear)
  }
}

/** Changes a Space in the engine, and the window's lists follow. */
export async function updateSpace(
  engine: Engine,
  how: UpdateSpace
): Promise<SpaceSummary> {
  const space = await engine.command("spaces.update", how)
  spacesChanged()
  return space
}

/** Removes a Space from the engine, and from the window's lists. */
export async function removeSpace(
  engine: Engine,
  space: SpaceId
): Promise<void> {
  await engine.command("spaces.remove", { space })
  spacesChanged()
}
