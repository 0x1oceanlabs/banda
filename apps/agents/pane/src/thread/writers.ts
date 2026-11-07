import { useMemo } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { ListedThread } from "@banda/contract/agents"
import { useLive } from "@banda/ui/hooks/use-live"
import { type Listing } from "../thread"
import { applyThreads, threadsSource } from "../list"

/** The Project's other Threads by their Agents' IDs, as the sidebar follows
 * them, so a message from one names it as it is now; and this Thread's own
 * Agent, so a message from one the list no longer has still says so. */
export function useWriters(
  engine: Engine,
  project: ProjectId,
  thread: string | null
): Listing {
  // Who writes stays as a rewind leaves it: no need to read the list again.
  const source = useMemo(
    () =>
      thread === null
        ? null
        : { ...threadsSource(engine, project), apply: applyThreads },
    [engine, project, thread]
  )
  const live = useLive(engine, project, source)
  const threads = live.state === "ready" ? live.view.threads : undefined
  return useMemo(() => {
    const listing: {
      threads: Map<string, ListedThread>
      self?: string
      own?: ListedThread
    } = {
      threads: new Map(),
    }
    for (const one of threads ?? []) {
      if (one.id === thread) {
        listing.self = one.agent
        listing.own = one
      } else listing.threads.set(one.agent, one)
    }
    return listing
  }, [threads, thread])
}
