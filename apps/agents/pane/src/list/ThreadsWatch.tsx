import { useEffect, useMemo } from "react"
import { useLive } from "@banda/ui/hooks/use-live"
import type { Watch, WatchProps } from "@banda/ui/pane"
import { harnessName, useHarnesses } from "../harnesses"
import { threadsSource } from "./list"
import { attentionOf } from "./marks"
import { listedOf } from "./rows"
import { heardEnded, useSeen } from "./seen"

/**
 * What a Project's Threads call their Person for, for the bar's mark, and
 * each Thread as the sidebar lists it, which the window also tells its
 * Person of (ADR 0011): one list for all, followed whether the sidebar
 * shows or not, so they never disagree.
 */
export const threadsWatch: Watch = {
  Watch: ThreadsWatch,
}

function ThreadsWatch({ engine, project, report }: WatchProps) {
  const source = useMemo(
    () => threadsSource(engine, project),
    [engine, project]
  )
  const live = useLive(engine, project, source)
  const harnesses = useHarnesses(engine)
  const seen = useSeen()
  const threads = live.state === "ready" ? live.view.threads : undefined

  useEffect(() => {
    if (threads) heardEnded(threads)
  }, [threads])
  const listed = useMemo(
    () =>
      threads?.map((thread) =>
        listedOf(
          thread,
          seen,
          thread.harness && harnessName(harnesses, thread.harness),
          project
        )
      ),
    [threads, seen, harnesses, project]
  )
  // It reports once it read its list: what calls then already was.
  useEffect(() => {
    if (!threads || !listed) return
    report({ ...attentionOf(threads, seen), listed })
  }, [report, threads, seen, listed])
  return null
}
