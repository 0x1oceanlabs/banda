/** A Thread as a Pane follows it: loaded once, then each of its events. */
import { useMemo } from "react"
import type { Engine, Event, ProjectId } from "@banda/contract"
import {
  decodeFact,
  knownItem,
  type ThreadId,
  type WhySupervised,
} from "@banda/contract/agents"
import { useLive } from "@banda/ui/hooks/use-live"
import { apply, fromView, type ThreadState } from "./state"

/** Why Banda kept a Thread Supervised, and when, in ms since the epoch. */
export type Supervised = WhySupervised & { at: number }

/**
 * A Thread as its Pane follows it: the engine's view of it, which the
 * Pane's projection keeps equal (ADR 0014, decision 3), and what the Pane
 * heard as it followed that no view holds.
 */
export type Followed = ThreadState & {
  /** Why Banda last kept it Supervised while this Pane followed it, and
   * when (ADR 0083): the fence no longer keeps its Full access. A view
   * read again forgets it; the Pane keeps what it said of it. */
  supervised?: Supervised
}

/** `apply`, and what Banda said as it kept the Thread Supervised. Pure, so
 * plain tests cover it. */
export function follow(state: Followed, event: Event): Followed {
  const next: Followed = apply(state, event)
  if (next === state) return next
  const fact = decodeFact(event)
  return fact?.kind === "thread.configured" && fact.payload.supervised
    ? { ...next, supervised: { ...fact.payload.supervised, at: event.at } }
    : next
}

/**
 * The Thread `thread` of `project` as its engine has it now. Its entries of
 * a kind this window does not know are left out, and named once in
 * `window.log` (ADR 0103, decision 10): a newer engine wrote them.
 */
export async function readThread(
  engine: Engine,
  project: ProjectId,
  thread: ThreadId
): Promise<Followed> {
  const view = await engine.call("agents.thread", { thread }, { project })
  const unknown = new Set(
    view.items.filter((item) => !knownItem(item)).map((item) => item.body.kind)
  )
  if (unknown.size > 0)
    console.warn(
      `agents: left out entries of kinds this window does not know: ${[...unknown].join(", ")}`
    )
  return fromView(view)
}

/** The Thread `thread` of `project`, live; none to follow without one. */
export function useThread(
  engine: Engine,
  project: ProjectId,
  thread: ThreadId | null
) {
  const source = useMemo(
    () =>
      thread === null
        ? null
        : {
            read: () => readThread(engine, project, thread),
            filter: { module: "agents", subject: thread },
            apply: follow,
          },
    [engine, project, thread]
  )
  return useLive(engine, project, source)
}
