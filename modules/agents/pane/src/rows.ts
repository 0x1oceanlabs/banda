/**
 * Each Thread as the sidebar lists it (ADR 0008): its title and the one
 * before it, its mark, what calls its Person (a Question, why it failed,
 * or what its Agent told it of its turn, ADR 0057), whether they saw how
 * it ended, what it was last asked, its Agent, and the Pane a click opens.
 * The window arranges the rows; this says only what each one is. Pure, so
 * plain tests cover it.
 */
import type { ListedThread, Snooze } from "@banda/contract/agents"
import {
  type Listed,
  type ListedSnooze,
  paneOf,
  type PaneState,
} from "@banda/ui/pane"
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
        : mark === "done"
          ? latest?.note
          : undefined
  // A Thread is titled by its first message: that says nothing new.
  const line = thread.message?.split("\n", 1)[0].trim()
  const said = line && line !== thread.title ? line : undefined
  // A finished turn that calls when unseen: "Mark as unread" makes it call
  // again (ADR 0077, decision 6).
  const unseen = markOf({ ...thread, asking: [] }, {})
  const seenNow =
    latest && (unseen === "done" || unseen === "failed")
      ? seen[thread.id] === latest.turn
      : undefined
  return {
    id: thread.id,
    title: thread.title || "New Thread",
    mark,
    changed: thread.updated_at,
    ...(latest?.state === "running" ? { began: latest.began } : {}),
    ...(calls ? { calls } : {}),
    ...(said ? { said } : {}),
    ...(harness ? { by: harness } : {}),
    ...(thread.harness ? { harness: thread.harness } : {}),
    agent: thread.agent,
    ...(thread.was !== undefined ? { was: thread.was } : {}),
    ...(seenNow !== undefined ? { seen: seenNow } : {}),
    pane: threadPaneOf(thread),
    ...(thread.snooze ? { snooze: snoozeOf(thread.snooze) } : {}),
  }
}

/** A Thread's snooze as the sidebar reads it (ADR 0074). */
function snoozeOf({ at, until, by, woke }: Snooze): ListedSnooze {
  return {
    at,
    ...(until === undefined ? {} : { until }),
    ...(by.kind === "agent" ? { byAgent: true } : {}),
    ...(woke ? { woke } : {}),
  }
}

/** The Thread Pane that shows `thread`. */
export function threadPaneOf(thread: ListedThread): PaneState {
  const { id, harness, title } = thread
  return paneOf(threadPane, { thread: id, harness, title })
}
