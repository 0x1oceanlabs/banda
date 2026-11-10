/**
 * Each Thread as the sidebar lists it (ADR 0008): its title and the one
 * before it, its mark, what calls its Person (a Question, why it failed,
 * or what its Agent told it of its turn, ADR 0057), whether they saw how
 * it ended and whether they archived it, what it was last asked, its
 * Agent, and the Pane a click opens.
 * The window arranges the rows; this says only what each one is. Pure, so
 * plain tests cover it.
 */
import type { ProjectId } from "@banda/contract"
import type { Choice, ListedThread, Later } from "@banda/contract/agents"
import { mayArchive } from "@banda/ui/status"
import {
  type Answering,
  type Listed,
  type ListedLater,
  paneOf,
  type PaneState,
} from "@banda/ui/pane"
import { archiveHolds } from "./list"
import { markOf } from "./marks"
import { threadPane } from "../ThreadPane"

/** What a failed turn says when its Harness gave no reason. */
export const FAILED = "The turn failed"

/** The agents module's actions a toast's buttons run (index.ts). */
export const ANSWER = "agents.answer"
export const RETRY = "agents.retry"
export const SHOW = "agents.show"

/**
 * What answers a Thread's call there and then (ADR 0056, decision 3): the
 * first Question's Allow and Deny, when a click answers it; Sign in, or
 * Try again, for a turn that failed. None otherwise: Open, its toast's
 * own, opens the Thread.
 */
export function answersOf(
  thread: ListedThread,
  mark: Listed["mark"],
  project: ProjectId
): Answering[] {
  if (mark === "asking") {
    const asking = thread.asking[0]
    if (!asking?.choices?.length) return []
    return choicesOf(asking.choices).map((choice) => ({
      label: choice.name,
      action: ANSWER,
      args: { project, item: asking.item, choice: choice.id },
    }))
  }
  const { latest } = thread
  if (mark !== "failed" || !latest) return []
  if (latest.failure?.class === "sign_in")
    return [
      {
        label: "Sign in",
        action: SHOW,
        args: { project, thread: thread.id, harness: thread.harness },
      },
    ]
  return [
    {
      label: "Try again",
      action: RETRY,
      args: { project, turn: latest.turn },
    },
  ]
}

/** The choices a toast shows: the first that allows once and the first
 * that does not, else the first two. */
function choicesOf(choices: readonly Choice[]): Choice[] {
  const allow = choices.find((choice) => choice.allows && !choice.always)
  const deny = choices.find((choice) => !choice.allows)
  return allow && deny ? [allow, deny] : choices.slice(0, 2)
}

export function listedOf(
  thread: ListedThread,
  harness: string,
  project?: ProjectId
): Listed {
  const mark = markOf(thread)
  const { latest } = thread
  const calls =
    mark === "asking"
      ? thread.asking[0]?.title
      : mark === "failed"
        ? latest?.reason || FAILED
        : mark === "done"
          ? latest?.note
          : undefined
  const answers = project ? answersOf(thread, mark, project) : []
  // A Thread is titled by its first message: that says nothing new.
  const line = thread.message?.split("\n", 1)[0].trim()
  const said = line && line !== thread.title ? line : undefined
  // A finished turn that calls when unseen: "Mark as unread" makes it call
  // again (ADR 0077, decision 6).
  const unseen = markOf({ ...thread, asking: [], seen: undefined })
  const seenNow =
    latest && (unseen === "done" || unseen === "failed")
      ? thread.seen === latest.turn
      : undefined
  // Archived while it may be and nothing happened in it since, both by
  // its host's times (ADR 0096, decision 4); the Archive counts from it.
  const archivedAt =
    archiveHolds(thread) && mayArchive({ mark })
      ? thread.archived?.at
      : undefined
  return {
    id: thread.id,
    title: thread.title || "New Thread",
    mark,
    changed: thread.updated_at,
    ...(latest?.state === "running" ? { began: latest.began } : {}),
    ...(calls ? { calls } : {}),
    ...(answers.length ? { answers } : {}),
    ...(said ? { said } : {}),
    ...(harness ? { by: harness } : {}),
    ...(thread.harness ? { harness: thread.harness } : {}),
    agent: thread.agent,
    ...(thread.was !== undefined ? { was: thread.was } : {}),
    ...(seenNow !== undefined ? { seen: seenNow } : {}),
    ...(archivedAt === undefined
      ? {}
      : { archived: true as const, archivedAt }),
    pane: threadPaneOf(thread),
    ...(thread.later ? { later: laterOf(thread.later) } : {}),
  }
}

/** A Thread's Later as the sidebar reads it (ADR 0074). */
function laterOf({ at, until, by, woke, woke_seen }: Later): ListedLater {
  return {
    at,
    ...(until === undefined ? {} : { until }),
    ...(by.kind === "agent" ? { byAgent: true } : {}),
    ...(woke ? { woke } : {}),
    ...(woke_seen ? { wokeSeen: true } : {}),
  }
}

/** The Thread Pane that shows `thread`. */
export function threadPaneOf(thread: ListedThread): PaneState {
  const { id, harness, title } = thread
  return paneOf(threadPane, { thread: id, harness, title })
}
