/**
 * Which Thread the Person looks at in this window: the one whose Pane has
 * the focus. A Thread they look at never calls them (ADR 0009, decision 3):
 * they see it already. It lives only as long as the window does.
 */
import type { ThreadId } from "@bandaso/contract/agents"

let looking: ThreadId | null = null

/** Says the Person looks at `thread`; the function it gives stops that. */
export function lookAt(thread: ThreadId): () => void {
  looking = thread
  return () => {
    if (looking === thread) looking = null
  }
}

/** Whether the Person looks at `thread` now, with the window in front. */
export function looksAt(thread: ThreadId): boolean {
  return looking === thread && document.hasFocus()
}
