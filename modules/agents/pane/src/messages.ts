/** How the Thread Pane shows a message's text (ADR 0010, decision 1). */

/** A message this long opens only when its Person asks, as in T3 Code. */
const LINES = 8
const CHARACTERS = 600

/** Whether `text` is long enough to show clamped. */
export function clamped(text: string): boolean {
  if (text.length > CHARACTERS) return true
  let lines = 1
  for (const char of text) if (char === "\n" && ++lines > LINES) return true
  return false
}
