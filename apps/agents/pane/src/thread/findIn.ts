/**
 * Find in the Thread, as T3 Code's Mod+F (ADR 0010, decision 9): which
 * lines hold the words, so a folded one opens to show them. Pure, so
 * plain tests cover it; the Pane marks the words themselves where they
 * show.
 */
import type { Item } from "@banda/contract/agents"
import type { Line } from "./timeline"

/** The words an item shows. */
function wordsOf({ body }: Item): string {
  switch (body.kind) {
    case "message":
    case "thought":
    case "notice":
      return body.text
    case "tool":
    case "question":
    case "visual":
      return body.title
    case "issue":
      return `${body.title}\n${body.body}`
    case "plan":
      return body.steps.map((step) => step.text).join("\n")
    case "moved":
      return ""
  }
}

/** Each item's words in lower case: an item that does not change keeps
 * the same object, so only the one that grows is read again. */
const lowered = new WeakMap<Item, string>()

function has(item: Item, wanted: string): boolean {
  let words = lowered.get(item)
  if (words === undefined) {
    words = wordsOf(item).toLocaleLowerCase()
    lowered.set(item, words)
  }
  return words.includes(wanted)
}

/** Whether `line` holds `query`, in any case; nothing holds no words. */
export function holds(line: Line, query: string): boolean {
  if (!query) return false
  const wanted = query.toLocaleLowerCase()
  switch (line.kind) {
    case "item":
    case "plan":
      return has(line.item, wanted)
    case "work":
      return line.items.some((item) => has(item, wanted))
    case "fold":
      return line.lines.some((inner) => holds(inner, query))
    default:
      return false
  }
}
