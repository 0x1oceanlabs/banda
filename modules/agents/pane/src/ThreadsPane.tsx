import { useMemo } from "react"
import type { JsonValue } from "@bandaso/contract"
import type { ListedThread } from "@bandaso/contract/agents"
import {
  BandaMark,
  MARK_WORDS,
  type MarkState,
} from "@bandaso/ui/components/banda-mark"
import { Spinner } from "@bandaso/ui/components/spinner"
import { useLive } from "@bandaso/ui/hooks/use-live"
import { ago } from "@bandaso/ui/lib/words"
import { cn } from "@bandaso/ui/lib/utils"
import {
  definePane,
  type PaneProps,
  type Place,
  paneOf,
} from "@bandaso/ui/pane"
import { MessagesSquareIcon } from "lucide-react"
import { harnessName, useHarnesses } from "./harnesses"
import { threadsSource } from "./list"
import { markOf, needsPerson } from "./marks"
import { useSeen } from "./seen"
import { threadPane } from "./ThreadPane"

type NoArgs = { [key: string]: JsonValue }

/**
 * A Space's Threads, the one changed last first, each with its Harness and
 * its Agent's mark: what the window's sidebar shows for each Space (ADR
 * 0005, decision 8). The Person opens it there, not from the menu, so it
 * has no start.
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
  const source = useMemo(() => threadsSource(engine, space), [engine, space])
  const live = useLive(engine, space, source)
  const harnesses = useHarnesses(engine, space)
  const seen = useSeen()

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
          <Row
            thread={thread}
            mark={markOf(thread, seen)}
            harness={thread.harness && harnessName(harnesses, thread.harness)}
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
          />
        </li>
      ))}
    </ul>
  )
}

/**
 * One Thread: its Agent's mark, its title and Harness, and when it last
 * changed; or, while it needs the Person, what for, in the mark's colour.
 * A Thread at rest keeps its mark quiet.
 */
function Row({
  thread,
  mark,
  harness,
  onClick,
}: {
  thread: ListedThread
  mark: MarkState
  harness: string
  onClick: (event: React.MouseEvent) => void
}) {
  const quiet = mark === "rest"
  return (
    <button
      type="button"
      title={quiet ? undefined : MARK_WORDS[mark]}
      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onClick}
    >
      <BandaMark
        variant="agent"
        state={mark}
        playful={0}
        label={quiet ? undefined : MARK_WORDS[mark]}
        className={cn("size-4", quiet ? "opacity-40" : "text-foreground")}
      />
      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
      {harness && <span className="shrink-0 truncate text-xs">{harness}</span>}
      {needsPerson(mark) ? (
        <span
          className={cn(
            "shrink-0 text-xs font-medium",
            mark === "asking" ? "text-attention" : "text-destructive"
          )}
        >
          {MARK_WORDS[mark]}
        </span>
      ) : (
        <span className="shrink-0 text-xs tabular-nums">
          {ago(thread.updated_at)}
        </span>
      )}
    </button>
  )
}
