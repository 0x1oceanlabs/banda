import { useEffect, useMemo } from "react"
import { useLive } from "@bandaso/ui/hooks/use-live"
import { QUIET, type Watch, type WatchProps } from "@bandaso/ui/pane"
import { threadsSource } from "./list"
import { attentionOf } from "./marks"
import { useSeen } from "./seen"

/**
 * What a Space's Threads call their Person for, for the bar's mark: it
 * follows the same list the sidebar shows, whether the sidebar shows or
 * not.
 */
export const threadsWatch: Watch = {
  module: "agents",
  Watch: ThreadsWatch,
}

function ThreadsWatch({ engine, space, report }: WatchProps) {
  const source = useMemo(() => threadsSource(engine, space), [engine, space])
  const live = useLive(engine, space, source)
  const seen = useSeen()
  const { mark, waiting } =
    live.state === "ready" ? attentionOf(live.view.threads, seen) : QUIET
  useEffect(() => report({ mark, waiting }), [report, mark, waiting])
  return null
}
