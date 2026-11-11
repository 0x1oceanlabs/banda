/** How the Thread Pane shows a message's text (ADR 0010, decision 1). */
import { KINDS } from "@banda/ui/lib/prompt"

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

/** A piece of a Person's message as its bubble shows it: words, or a
 * chip for the sub-agent it is about, by its label. */
export type Piece = { text: string } | { about: string }

/** Whether `text` holds words about a sub-agent, which may be a chip. */
export function namesSubagent(text: string): boolean {
  return text.search(KINDS.subagent.read) >= 0
}

/** A Person's message's text in pieces, each sub-agent it is about a chip,
 * as the composer wrote it (ADR 0103, decision 25): only a label `known`
 * has, one of its Thread's sub-agents; the rest stays words. */
export function piecesOf(
  text: string,
  known: { has(label: string): boolean }
): Piece[] {
  const pieces: Piece[] = []
  let from = 0
  for (const found of text.matchAll(KINDS.subagent.read)) {
    const [whole, space, label] = found
    if (!known.has(label)) continue
    const at = found.index + space.length
    if (at > from) pieces.push({ text: text.slice(from, at) })
    pieces.push({ about: label })
    from = found.index + whole.length
  }
  if (from < text.length) pieces.push({ text: text.slice(from) })
  return pieces
}
