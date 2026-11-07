/**
 * A file's lines as `files.file` shows them: how many there are, the line
 * it opens at, how much of a long file it draws, and how picked lines are
 * named. Pure, so plain tests cover it.
 */
import { atLines } from "@banda/ui/lib/paths"

/** The most lines drawn: past them the editor's cost is measured in
 * hundreds of MB (ADR 0073, decision 8), and a ranged view comes later. */
export const MOST_LINES = 20_000

/** How many lines `text` has: a last line break ends a line, it does not
 * start one. */
export function lineCount(text: string): number {
  if (text === "") return 1
  let count = 1
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1))
    count++
  return text.endsWith("\n") ? count - 1 : count
}

/** The line to open at, within the file's `count` lines: past the last,
 * the last; none, or one not a number, for none. */
export function lineIn(
  line: number | null | undefined,
  count: number
): number | null {
  if (typeof line !== "number" || !Number.isFinite(line)) return null
  return Math.min(Math.max(1, Math.floor(line)), Math.max(1, count))
}

/** At most `most` lines of `text`, and whether it had more. */
export function startOf(
  text: string,
  most = MOST_LINES
): { text: string; cut: boolean } {
  let at = -1
  for (let line = 0; line < most; line++) {
    at = text.indexOf("\n", at + 1)
    if (at === -1) return { text, cut: false }
  }
  // The break that ends the last line drawn ends the file; more after it
  // is cut.
  return at === text.length - 1
    ? { text, cut: false }
    : { text: text.slice(0, at + 1), cut: true }
}

/** Picked lines as an Agent and a compiler read them: `src/a.ts:12`, or
 * `src/a.ts:12-20`, whichever way they were dragged. */
export function rangeText(
  path: string,
  range: { start: number; end: number }
): string {
  return atLines(path, range.start, range.end)
}

/** Lines `from` to `to` of `text`, from 1, as they read. */
export function linesOf(text: string, from: number, to: number): string {
  return text
    .split("\n")
    .slice(from - 1, to)
    .join("\n")
}
