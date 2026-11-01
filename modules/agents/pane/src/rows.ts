/**
 * Each Thread as the sidebar lists it (ADR 0008): its title, its mark, what
 * calls its Person, what it was last asked, and the Pane a click opens.
 * The window arranges the rows; this says only what each one is. Pure, so
 * plain tests cover it.
 */
import type { ListedThread } from "@bandaso/contract/agents"
import { type Listed, paneOf } from "@bandaso/ui/pane"
import { markOf, type Seen } from "./marks"
import { threadPane } from "./ThreadPane"

/** What a failed turn says when its Harness gave no reason. */
export const FAILED = "The turn failed"

export function listedOf(
  thread: ListedThread,
  seen: Seen,
  harness: string
): Listed {
  const mark = markOf(thread, seen)
  const { latest } = thread
  const calls =
    mark === "asking"
      ? thread.asking[0]?.title
      : mark === "failed"
        ? latest?.reason || FAILED
        : undefined
  // A Thread is titled by its first message: that says nothing new.
  const line = thread.message?.split("\n", 1)[0].trim()
  const said = line && line !== thread.title ? line : undefined
  return {
    id: thread.id,
    title: thread.title || "New Thread",
    mark,
    changed: thread.updated_at,
    ...(latest?.state === "running" ? { began: latest.began } : {}),
    ...(calls ? { calls } : {}),
    ...(said ? { said } : {}),
    ...(harness ? { by: harness } : {}),
    pane: paneOf(threadPane, {
      thread: thread.id,
      harness: thread.harness,
      title: thread.title,
    }),
  }
}
