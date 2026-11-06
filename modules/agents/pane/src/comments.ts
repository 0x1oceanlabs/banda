/**
 * Comments on a file's lines that wait in a Thread's message (ADR 0034,
 * decision 9; ADR 0073, decision 6). An App attaches them as chips
 * (`WindowApi.attach`); the composer shows each with its path, its lines
 * and the start of what was said; and the message that is sent carries
 * them as text the Agent reads, framed as T3 Code's
 * `buildFileReviewComment` frames a comment: where, the lines as they
 * read, and the words. Nothing is kept on a server. Pure, so plain tests
 * cover it.
 */
import type { Chip } from "@banda/ui/module"
import { atLines } from "@banda/ui/lib/paths"

/** A comment waiting in a message: its file, from the Project's folder
 * when inside it, its lines, the words, and the lines as they read. */
export type Comment = {
  id: string
  path: string
  lines?: readonly [from: number, to: number]
  comment?: string
  text?: string
}

/** Whether a chip is a comment on lines, not a file to name with `@`. */
export function isComment(chip: Chip): boolean {
  return chip.lines !== undefined || chip.comment !== undefined
}

/** Where a comment is, as an Agent and a compiler read it: `src/a.ts:12`
 * or `src/a.ts:12-14`. */
export function commentAt({ path, lines }: Pick<Comment, "path" | "lines">) {
  return lines ? atLines(path, ...lines) : path
}

/** What a comment's chip names: the file's name and its lines. */
export function commentLabel(comment: Pick<Comment, "path" | "lines">) {
  const at = commentAt(comment)
  return at.slice(comment.path.lastIndexOf("/") + 1)
}

/** The start of what was said, for a chip: its first line, at most
 * `most` characters. */
export function commentStart(comment: string | undefined, most = 40) {
  const line = (comment ?? "").trim().split("\n")[0] ?? ""
  return line.length > most ? `${line.slice(0, most - 1).trimEnd()}…` : line
}

/** The language a fence names for `path`: its extension, as T3 Code
 * infers it; `text` for none. */
function languageOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
  const dot = name.lastIndexOf(".")
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1)
  return name.startsWith(".") && name.length > 1 ? name.slice(1) : "text"
}

/** `contents` in a fence longer than any run of backticks in it. */
function fenced(language: string, contents: string): string {
  const longest = Math.max(
    0,
    ...Array.from(contents.matchAll(/`+/g), (run) => run[0].length)
  )
  const fence = "`".repeat(Math.max(3, longest + 1))
  return [`${fence}${language}`, contents.trimEnd(), fence].join("\n")
}

/**
 * A comment as the Agent reads it:
 *
 *     Comment on src/a.ts:12-14:
 *     ```ts
 *     …the lines…
 *     ```
 *     Why twice?
 */
export function commentText(comment: Comment): string {
  const words = comment.comment?.trim()
  return [
    `Comment on ${commentAt(comment)}:`,
    ...(comment.text !== undefined
      ? [fenced(languageOf(comment.path), comment.text)]
      : []),
    ...(words ? [words] : []),
  ].join("\n")
}

/** The message `text` with `comments` after it, each apart by a blank
 * line. */
export function withComments(
  text: string,
  comments: readonly Comment[]
): string {
  if (comments.length === 0) return text
  return [text.trimEnd(), ...comments.map(commentText)]
    .filter((part) => part !== "")
    .join("\n\n")
}
