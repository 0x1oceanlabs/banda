import { useEffect, useMemo } from "react"
import { useLive } from "@banda/ui/hooks/use-live"
import type { Watch, WatchProps } from "@banda/ui/pane"
import { harnessName, useHarnesses } from "../harnesses"
import { threadsSource } from "./list"
import { move } from "./marks-moved"
import { attentionOf } from "./marks"
import { listedOf } from "./rows"
import { settle, shown, useSending } from "./sent"

/**
 * What a Project's Threads call their Person for, for the bar's mark, and
 * each Thread as the sidebar lists it, which the window also tells its
 * Person of (ADR 0011): one list for all, followed whether the sidebar
 * shows or not, so they never disagree. Its marks are its host's, with
 * what the Person sent there shown until the list hears it (ADR 0096).
 */
export const threadsWatch: Watch = {
  Watch: ThreadsWatch,
}

function ThreadsWatch({ engine, project, host, report }: WatchProps) {
  // It reads once this window's old marks moved to their host (ADR 0096,
  // decision 9), so it never shows what the host had before them; another
  // host's, at once.
  const source = useMemo(() => {
    const threads = threadsSource(engine, project)
    const read = () => move.over(engine, project, host).then(threads.read)
    return { ...threads, read }
  }, [engine, project, host])
  const live = useLive(engine, project, source)
  const harnesses = useHarnesses(engine)
  const sending = useSending(engine)
  const list = live.state === "ready" ? live.view : undefined
  useEffect(() => {
    if (list) settle(engine, list)
  }, [engine, list, sending])
  // The same Threads while nothing sent shows on them, so no row is
  // listed again as a mark of another Project's comes and goes.
  const threads = useMemo(
    () => list && shown(list.threads, sending),
    [list, sending]
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
    if (!threads || !listed) return
    report({ ...attentionOf(threads), listed })
  }, [report, threads, listed])
  return null
}
