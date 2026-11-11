/**
 * A Thread as Markdown, as the sidebar card's "Copy as Markdown" puts it
 * on the clipboard (ADR 0098, decision 14): its title, then what was said
 * in it, each message under who said it: the Person, its own Agent by its
 * Harness's name, or another Thread's Agent. What its Agent thought and
 * the tools it ran stay out. Pure, so plain tests cover it.
 */
import type { Item, ThreadView } from "@banda/contract/agents"

/** Who said a message, as its heading names it. */
function whoOf(item: Item, own: { agent?: string; by?: string }): string {
  const { author } = item
  if (author.kind === "person") return "You"
  return author.id === own.agent ? own.by || "Agent" : "Another Agent"
}

/** The Thread `view` as Markdown, titled `title`; `own` names its Agent,
 * by its id, and its Harness. The messages one says in a row go under
 * one heading. */
export function markdownOf(
  view: Pick<ThreadView, "items">,
  title: string,
  own: { agent?: string; by?: string }
): string {
  const parts = [`# ${title}`]
  let last: string | undefined
  for (const item of view.items) {
    if (item.body.kind !== "message") continue
    const text = item.body.text.trim()
    if (!text) continue
    const who = whoOf(item, own)
    if (who !== last) parts.push(`## ${who}`)
    last = who
    parts.push(text)
  }
  return `${parts.join("\n\n")}\n`
}
