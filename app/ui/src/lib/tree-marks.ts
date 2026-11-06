/**
 * The marks a Files tree draws on its rows (ADR 0073, decisions 3 and 9):
 * a folder being listed spins; a folder shows a dot when it holds git's
 * changes, a quiet one when it holds what the Agent's turn changed, and
 * both when both; a file the turn changed has the quiet dot. The row of
 * the file an Agent works on now pulses in its colour. Pure, so plain
 * tests cover it.
 */
import { foldersOf } from "./tree-paths"

/** What a row's decoration shows. */
export type RowMark =
  "loading" | "holds" | "turned" | "holds-turned" | "holds-both"

/** The folders that hold one of `paths`: each folder they are in. */
export function holding(paths: Iterable<string>): Set<string> {
  return new Set([...paths].flatMap(foldersOf))
}

/** What a row's mark is drawn from. */
export type Marking = {
  /** The row is a folder being listed. */
  loading: boolean
  /** The folders that hold git's changes. */
  holds: ReadonlySet<string>
  /** The files the turn changed, and the folders that hold them. */
  turned: ReadonlySet<string>
  turnHolds: ReadonlySet<string>
}

/** The mark of the row of `path`, a folder's or a file's. */
export function rowMarkOf(
  path: string,
  folder: boolean,
  { loading, holds, turned, turnHolds }: Marking
): RowMark | null {
  if (!folder) return turned.has(path) ? "turned" : null
  if (loading) return "loading"
  const git = holds.has(path)
  const turn = turnHolds.has(path)
  if (git && turn) return "holds-both"
  return git ? "holds" : turn ? "holds-turned" : null
}

/** What a pulsing row wears, in its `--banda-pulse`: a tint, and a ring
 * that fades again and again, as the mock draws it. */
const PULSE =
  "--banda-pulse-tint: color-mix(in oklab, var(--banda-pulse) 13%, transparent); background-image: linear-gradient(var(--banda-pulse-tint), var(--banda-pulse-tint)); animation: banda-pulse 1.3s ease-out infinite;"

/** The rows of `pulses` pulsing, each in its colour. A row is found by
 * its path, so it pulses however the tree draws it again. */
export function pulseCSS(pulses: ReadonlyMap<string, string>): string {
  return [...pulses]
    .map(
      ([path, colour]) =>
        `button[data-type='item'][data-item-path="${path.replace(/["\\]/g, "\\$&")}"] { --banda-pulse: ${colour.replace(/[;{}]/g, "")}; ${PULSE} }`
    )
    .join("\n")
}
