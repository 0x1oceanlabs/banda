import { useEffect, useMemo, useState } from "react"
import { useLive } from "@banda/ui/hooks/use-live"
import type { Watch, WatchProps } from "@banda/ui/pane"
import { harnessName, useHarnesses } from "../harnesses"
import { type Doings, hearDoing, threadsSource, withDoing } from "./list"
import { move } from "./marks-moved"
import { listedOf } from "./rows"
import { settle, shown, useSending } from "./sent"

/**
 * Each of a Project's Threads as the sidebar lists it, from which the
 * window reads what calls its Person, for the bar's mark, and tells them
 * of it (ADR 0011): one list for all, followed whether the sidebar
 * shows or not, so they never disagree. Its marks are its host's, with
 * what the Person sent there shown until the list hears it (ADR 0096).
 * What each Thread at work does comes from its host as it changes (ADR
 * 0099, decision 11).
 */
export const threadsWatch: Watch = {
  Watch: ThreadsWatch,
}

/**
 * What the Watch reads a Project's Threads from: once this window's old
 * marks moved to their host (ADR 0096, decision 9), so it never shows what
 * the host had before them; another host's at once, as `move.over` is told
 * which host it is (#1061).
 */
export function watchedSource(
  engine: WatchProps["engine"],
  project: WatchProps["project"],
  host: WatchProps["host"]
) {
  const threads = threadsSource(engine, project)
  const read = () => move.over(engine, project, host).then(threads.read)
  return { ...threads, read }
}

function ThreadsWatch({ engine, project, host, report }: WatchProps) {
  const source = useMemo(
    () => watchedSource(engine, project, host),
    [engine, project, host]
  )
  const live = useLive(engine, project, source)
  const doings = useDoings(engine, project)
  const harnesses = useHarnesses(engine)
  const sending = useSending(engine)
  const list = live.state === "ready" ? live.view : undefined
  useEffect(() => {
    if (list) settle(engine, list)
  }, [engine, list, sending])
  // What each Thread does is merged on its own, as the list read never
  // holds what the stream said since, so each merge makes its Threads at
  // work anew: only the list or the stream merges again, never a mark sent
  // in another Project.
  const merged = useMemo(
    () => list && withDoing(list.threads, doings),
    [list, doings]
  )
  // The same Threads while nothing sent shows on them, so no row is
  // listed again as a mark of another Project's comes and goes.
  const threads = useMemo(
    () => merged && shown(merged, sending),
    [merged, sending]
  )
  const listed = useMemo(
    () =>
      threads?.map((thread) =>
        listedOf(
          thread,
          thread.harness && harnessName(harnesses, thread.harness),
          project
        )
      ),
    [threads, harnesses, project]
  )
  // It reports once it read its list: what calls then already was.
  useEffect(() => {
    if (listed) report({ listed })
  }, [report, listed])
  return null
}

/**
 * What `project`'s Threads at work do, as `agents.doing` says it on
 * `engine`: this machine's, or another host's own session, so its stream
 * comes from the machine it runs on (ADR 0081, decision 4). None before it
 * says anything, and again for another engine or Project.
 */
function useDoings(
  engine: WatchProps["engine"],
  project: WatchProps["project"]
): Doings | undefined {
  const [heard, setHeard] = useState<{
    engine: WatchProps["engine"]
    project: WatchProps["project"]
    doings: Doings
  }>()
  useEffect(
    () =>
      hearDoing(engine, project, (doings) =>
        setHeard({ engine, project, doings })
      ),
    [engine, project]
  )
  return heard?.engine === engine && heard.project === project
    ? heard.doings
    : undefined
}
