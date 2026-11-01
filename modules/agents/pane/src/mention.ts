/**
 * `@` and a word in the composer names a file in the Space's folder, as in
 * T3 Code (ADR 0010, decision 9). Pure, so plain tests cover it.
 */

/** A file's name being typed: `@` at the start or after a space, then
 * what follows it up to the caret. */
export type Mentioning = { start: number; word: string }

/** What is typed after `@` before the caret at `caret`, if a file is. */
export function mentioning(
  text: string,
  caret: number
): Mentioning | undefined {
  const found = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  if (!found) return undefined
  return { start: caret - found[1].length - 1, word: found[1] }
}

/** `text` with the file at `path` in place of what `at` typed, and the
 * caret after it. */
export function mention(
  text: string,
  at: Mentioning,
  path: string
): { text: string; caret: number } {
  const rest = text.slice(at.start + 1 + at.word.length)
  // One space after it, whether it was there already or not.
  const named = `@${path}${/^\s/.test(rest) ? "" : " "}`
  return {
    text: text.slice(0, at.start) + named + rest,
    caret: at.start + `@${path} `.length,
  }
}
