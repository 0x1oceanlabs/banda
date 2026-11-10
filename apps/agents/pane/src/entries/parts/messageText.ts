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

/** The first line of `text` with words in it, without the markup that
 * starts a heading, a list or a quote, or marks words bold or as code: a
 * plan's title, a sub-agent's report as its row says it. */
export function firstLine(text: string | undefined): string | undefined {
  const line = text
    ?.split("\n")
    .map((one) => one.trim())
    .find(Boolean)
  const plain = line
    ?.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, "")
    // Bold, emphasis and code marks, but an underscore inside a name.
    .replace(/\*\*|__|`|(?<!\w)[*_]|[*_](?!\w)/g, "")
    .trim()
  return plain || undefined
}

/** A plan's title: its first line, without markdown's marks. */
export function planTitle(text: string): string {
  return firstLine(text) ?? ""
}
