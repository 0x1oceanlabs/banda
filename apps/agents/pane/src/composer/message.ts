/**
 * The message as it goes, and whether it may: the text, then the comments
 * on files' lines (ADR 0034, decision 9), within what a Harness takes.
 * Pure, so plain tests cover it.
 */
import { type Comment, withComments } from "./comments"

/** The longest message a Harness takes, as in T3 Code. */
export const LONGEST = 120_000

/** The message `text` and `comments` make, with `images` images: what
 * goes, whether anything is written, and how far past {@link LONGEST}
 * it is, if it is. */
export function measure(
  text: string,
  comments: readonly Comment[],
  images: number
): { message: string; written: boolean; over: number } {
  const message = withComments(text, comments)
  const trimmed = message.trim().length
  return {
    message,
    written: trimmed > 0 || images > 0,
    over: trimmed - LONGEST,
  }
}

/**
 * Whether Enter and Send send the message now: something is `written`, no
 * longer than a Harness takes (`over` it by none), with nothing on its way
 * (`busy`); never while Send is `held`, when the machine it goes to cannot
 * be reached, and the message waits as the draft.
 */
export function sendable({
  written,
  over,
  busy,
  held,
}: {
  written: boolean
  over: number
  busy: boolean
  held?: string
}): boolean {
  return written && over <= 0 && !busy && held === undefined
}
