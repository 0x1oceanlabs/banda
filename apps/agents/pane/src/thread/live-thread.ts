/** A Thread as a Pane follows it: loaded once, then each of its events. */
import { useMemo } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { ThreadId } from "@banda/contract/agents"
import { useLive } from "@banda/ui/hooks/use-live"
import { apply, fromView } from "./state"

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
            read: async () =>
              fromView(
                await engine.call("agents.thread", { thread }, { project })
              ),
            filter: { module: "agents", subject: thread },
            apply,
          },
    [engine, project, thread]
  )
  return useLive(engine, project, source)
}
