/**
 * What `files.search` found, as the tree lists it (ADR 0073, decision
 * 11): the lines grouped by their file, the files by their paths, and the
 * rows the keys move through, a file's own and its lines. Pure, so plain
 * tests cover it.
 */
import type { Matched, Searched } from "@banda/contract/files"

/** One file's lines that match. */
export type FoundFile = {
  /** From the folder searched, with `/` between names. */
  path: string
  lines: readonly Matched[]
  /** It holds more than these. */
  more: boolean
}

/** What a search found so far. */
export type Found = {
  files: readonly FoundFile[]
  /** It ended; with how many lines, and whether it stopped at the most. */
  done?: { lines: number; cut: boolean }
}

export const NOTHING: Found = { files: [] }

/** `found` with one more piece of the search: a file goes in by its path. */
export function withPiece(found: Found, piece: Searched): Found {
  if (piece.kind === "done")
    return { ...found, done: { lines: piece.lines, cut: piece.cut } }
  const file: FoundFile = {
    path: piece.path,
    lines: piece.lines,
    more: piece.more === true,
  }
  const files = [...found.files]
  const at = files.findIndex((one) => one.path.localeCompare(file.path) > 0)
  files.splice(at === -1 ? files.length : at, 0, file)
  return { ...found, files }
}

/** A row of the list: a file, or one of its lines. */
export type Row =
  | {
      kind: "file"
      path: string
      count: number
      more: boolean
      folded: boolean
    }
  | { kind: "line"; path: string; matched: Matched }

/** The rows shown: each file, and its lines unless it is folded. */
export function rowsOf(
  files: readonly FoundFile[],
  folded: ReadonlySet<string>
): Row[] {
  return files.flatMap((file): Row[] => {
    const shut = folded.has(file.path)
    const head: Row = {
      kind: "file",
      path: file.path,
      count: file.lines.length,
      more: file.more,
      folded: shut,
    }
    if (shut) return [head]
    return [
      head,
      ...file.lines.map((matched): Row => ({
        kind: "line",
        path: file.path,
        matched,
      })),
    ]
  })
}

/** How many lines the files hold. */
export function linesIn(files: readonly FoundFile[]): number {
  return files.reduce((sum, file) => sum + file.lines.length, 0)
}

/** A line's text as pieces, each lit where it matches. */
export function lit(matched: Matched): { text: string; lit: boolean }[] {
  const pieces: { text: string; lit: boolean }[] = []
  let at = 0
  for (const [from, to] of matched.ranges) {
    if (from > at)
      pieces.push({ text: matched.text.slice(at, from), lit: false })
    pieces.push({ text: matched.text.slice(from, to), lit: true })
    at = to
  }
  if (at < matched.text.length)
    pieces.push({ text: matched.text.slice(at), lit: false })
  return pieces
}
