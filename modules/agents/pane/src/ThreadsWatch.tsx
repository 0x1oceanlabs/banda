import { useEffect, useMemo, useRef } from "react"
import { useLive } from "@bandaso/ui/hooks/use-live"
import { QUIET, type Watch, type WatchProps } from "@bandaso/ui/pane"
import { harnessName, useHarnesses } from "./harnesses"
import { threadsSource } from "./list"
import { looksAt } from "./looking"
import { attentionOf, callsOf, type Marks } from "./marks"
import { listedOf } from "./rows"
import { useSeen } from "./seen"

/**
 * What a Space's Threads call their Person for, for the bar's mark, and
 * each Thread that calls them now, for its sound, and each Thread as the
 * sidebar lists it: one list for all, followed whether the sidebar shows
 * or not, so they never disagree.
 */
export const threadsWatch: Watch = {
  module: "agents",
  Watch: ThreadsWatch,
}

function ThreadsWatch({ engine, space, report, call }: WatchProps) {
  const source = useMemo(() => threadsSource(engine, space), [engine, space])
  const live = useLive(engine, space, source)
  const harnesses = useHarnesses(engine, space)
  const seen = useSeen()
  const threads = live.state === "ready" ? live.view.threads : undefined

  const { mark, waiting } = threads ? attentionOf(threads, seen) : QUIET
  const listed = useMemo(
    () =>
      (threads ?? []).map((thread) =>
        listedOf(
          thread,
          seen,
          thread.harness && harnessName(harnesses, thread.harness)
        )
      ),
    [threads, seen, harnesses]
  )
  useEffect(
    () => report({ mark, waiting, listed }),
    [report, mark, waiting, listed]
  )

  // The marks this Watch saw last; another list starts again from nothing.
  const marks = useRef<Marks | undefined>(undefined)
  useEffect(() => {
    marks.current = undefined
  }, [source])
  useEffect(() => {
    if (!threads) return
    const now = callsOf(marks.current, threads, seen)
    marks.current = now.marks
    for (const { thread, chime } of now.calls)
      if (!looksAt(thread.id)) call({ chime, about: thread.title })
  }, [threads, seen, call])
  return null
}
