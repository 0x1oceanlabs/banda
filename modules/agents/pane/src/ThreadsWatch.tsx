import { useEffect, useMemo, useRef } from "react"
import { useLive } from "@bandaso/ui/hooks/use-live"
import { QUIET, type Watch, type WatchProps } from "@bandaso/ui/pane"
import { threadsSource } from "./list"
import { looksAt } from "./looking"
import { attentionOf, callsOf, type Marks } from "./marks"
import { useSeen } from "./seen"

/**
 * What a Space's Threads call their Person for, for the bar's mark, and
 * each Thread that calls them now, for its sound: it follows the same list
 * the sidebar shows, whether the sidebar shows or not.
 */
export const threadsWatch: Watch = {
  module: "agents",
  Watch: ThreadsWatch,
}

function ThreadsWatch({ engine, space, report, call }: WatchProps) {
  const source = useMemo(() => threadsSource(engine, space), [engine, space])
  const live = useLive(engine, space, source)
  const seen = useSeen()
  const threads = live.state === "ready" ? live.view.threads : undefined

  const { mark, waiting } = threads ? attentionOf(threads, seen) : QUIET
  useEffect(() => report({ mark, waiting }), [report, mark, waiting])

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
