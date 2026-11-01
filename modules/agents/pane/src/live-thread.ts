/** A Thread as a Pane follows it: loaded once, then each of its events. */
import { useMemo } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type { ThreadId, ThreadView } from "@banda/contract/agents"
import { useLive } from "@banda/ui/hooks/use-live"
import { apply, fromView } from "./thread"

/** The Thread `thread` of `space`, live; none to follow without one. */
export function useThread(
  engine: Engine,
  space: SpaceId,
  thread: ThreadId | null
) {
  const source = useMemo(
    () =>
      thread === null
        ? null
        : {
            read: async () =>
              fromView(
                await engine.call<ThreadView>(
                  "agents.thread",
                  { thread },
                  { space }
                )
              ),
            filter: { module: "agents", subject: thread },
            apply,
          },
    [engine, space, thread]
  )
  return useLive(engine, space, source)
}
