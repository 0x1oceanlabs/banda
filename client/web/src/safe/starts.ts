/**
 * Whether the window's starts break (ADR 0039, decision 2). A start that
 * does not draw its workspaces and stay up a few seconds broke; after two
 * in a row, the window offers to open without the workspaces. Kept in the
 * window's own storage, as its view is: the starts that did not go well.
 */

const STARTS = "banda.starts"

/** How long a start stays up, its workspaces drawn, to have gone well. */
export const WELL = 5000

/** Starts in a row that broke, before the window offers to open without
 * the workspaces. */
export const OFFER_AFTER = 2

/** A start begins: how many starts in a row broke before it, as each
 * that began and did not go well. Storage that cannot be read or written
 * says none: the window opens as usual. */
export function starting(): number {
  try {
    const broken = Number(localStorage.getItem(STARTS)) || 0
    localStorage.setItem(STARTS, String(broken + 1))
    return broken
  } catch {
    return 0
  }
}

/** This start went well. */
export function wentWell(): void {
  try {
    localStorage.removeItem(STARTS)
  } catch {
    // Storage that cannot be written counts no starts either.
  }
}
