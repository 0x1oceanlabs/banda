import { useCallback, useEffect, useMemo, useState } from "react"
import type { Listed as Pulls } from "@banda/contract/pulls"
import { sameData, useStore } from "@banda/core/react"
import type { Lists, Watch, WatchProps } from "@banda/ui/pane"
import { itemsOf, threadsIn } from "./items"
import { items } from "./threads"

/**
 * A Project's pull requests, each Thread's as an item on it (ADR 0076),
 * which the sidebar draws on that Thread's card. It follows `pulls.watch`,
 * so the engine reads GitHub for the Project while the window is up, one
 * reader however many follow it (decision 2); nothing here polls.
 */
export const pullsWatch: Watch = { Watch: PullsWatch }

const NONE: Pulls = { pulls: [] }

function PullsWatch({ engine, project, report }: WatchProps) {
  const pulls = usePulls(engine, project)
  const select = useCallback(
    (lists: Lists) => threadsIn(lists[project] ?? []),
    [project]
  )
  const threads = useStore(items, select, sameData)
  const listed = useMemo(
    () => pulls && itemsOf(pulls, threads),
    [pulls, threads]
  )
  // It reports once the engine said its list.
  useEffect(() => {
    if (listed) report({ listed })
  }, [report, listed])
  return null
}

/** `project`'s pull requests, as `pulls.watch` says them on `engine`;
 * none before it said them, and none once it ended. */
function usePulls(
  engine: WatchProps["engine"],
  project: WatchProps["project"]
): Pulls | undefined {
  const [heard, setHeard] = useState<{
    engine: WatchProps["engine"]
    project: WatchProps["project"]
    pulls: Pulls
  }>()
  useEffect(() => {
    const hear = (pulls: Pulls) => setHeard({ engine, project, pulls })
    return engine.stream(project, "pulls.watch", {}, hear, () => hear(NONE))
  }, [engine, project])
  return heard?.engine === engine && heard.project === project
    ? heard.pulls
    : undefined
}
