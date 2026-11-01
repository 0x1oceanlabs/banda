import { useMemo } from "react"
import type { JsonValue } from "@bandaso/contract"
import { Spinner } from "@bandaso/ui/components/spinner"
import { useLive } from "@bandaso/ui/hooks/use-live"
import { ago } from "@bandaso/ui/lib/words"
import {
  definePane,
  type PaneProps,
  type Place,
  paneOf,
} from "@bandaso/ui/pane"
import { MessagesSquareIcon } from "lucide-react"
import { applyThreads, readThreads, THREADS_FILTER } from "./list"
import { threadPane } from "./ThreadPane"

type NoArgs = { [key: string]: JsonValue }

/**
 * A Space's Threads, the one changed last first: what the window's sidebar
 * shows for each Space (ADR 0005, decision 8). The Person opens it there,
 * not from the menu, so it has no start.
 */
export const threadsPane = definePane<NoArgs>({
  kind: "agents.threads",
  module: "agents",
  title: () => "Threads",
  icon: MessagesSquareIcon,
  narrow: true,
  Pane: ThreadsPane,
})

/** A click with Ctrl or ⌘ opens beside; a plain one reuses a Thread tile. */
function placeOf(event: React.MouseEvent): Place | undefined {
  return event.ctrlKey || event.metaKey ? "right" : undefined
}

function ThreadsPane({ engine, space, open }: PaneProps<NoArgs>) {
  const source = useMemo(
    () => ({
      read: () => readThreads(engine, space),
      filter: THREADS_FILTER,
      apply: applyThreads,
    }),
    [engine, space]
  )
  const live = useLive(engine, space, source)

  if (live.state === "loading") {
    return (
      <div className="flex justify-center p-2">
        <Spinner className="size-3" />
      </div>
    )
  }
  if (live.state === "refused") {
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground">
        {live.refusal.message}
      </p>
    )
  }
  const { threads } = live.view
  if (threads.length === 0) {
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground">No Threads yet</p>
    )
  }
  return (
    <ul className="flex flex-col">
      {threads.map((thread) => (
        <li key={thread.id}>
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={(event) =>
              open(
                paneOf(threadPane, {
                  thread: thread.id,
                  harness: thread.harness,
                  title: thread.title,
                }),
                placeOf(event)
              )
            }
          >
            <span className="min-w-0 flex-1 truncate">{thread.title}</span>
            <span className="shrink-0 text-xs tabular-nums">
              {ago(thread.updated_at)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
