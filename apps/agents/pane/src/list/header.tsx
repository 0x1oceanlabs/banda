/**
 * What Threads shows of a Thread in the Tiling's Slot `pane.header` (ADR
 * 0062, decision 17): its Mark in its look (ADR 0099, decision 12), and
 * at work what its Agent does, in its Pane's header in the icon's place,
 * faint while it rests; and on its tile in the Overview, at a size to
 * read, with what it asks while it calls, unless it rests and does not
 * call. The Slot gives the Pane alone: Threads finds the Thread its Pane
 * shows in what it lists itself (#943).
 */
import { ThreadMark, works } from "@banda/ui/components/banda-mark"
import { useItem } from "@banda/ui/hooks/use-item"
import { useNow } from "@banda/ui/hooks/use-now"
import type { Listed, PaneState } from "@banda/ui/pane"
import type { Filler, HeaderProps } from "@banda/ui/slots"
import { headerLookOf } from "@banda/ui/status"
import type { ThreadArgs } from "../thread/session"
import { threadPane } from "../ThreadPane"

/** The Thread `pane` shows, if it is a Thread's Pane and its Thread has
 * started. */
const threadOf = (pane: PaneState): string | null =>
  pane.kind === threadPane.kind
    ? (threadPane.shows?.(pane.args as ThreadArgs) ?? null)
    : null

/** Whether `listed` is a Thread: Threads shows only its own Items. */
const isThread = (listed: Listed | undefined): listed is Listed =>
  listed?.pane.kind === threadPane.kind

function ThreadHeader(props: HeaderProps) {
  // As Threads lists it; none where the window gives no Items, as a
  // popped-out Pane's window does not.
  const listed = useItem(props.project, threadOf(props.pane))
  const thread = isThread(listed) ? listed : undefined
  const later = thread?.later
  // It looks again as a Later's time may come, and at work, as its Agent
  // may say nothing for long enough to show it stuck.
  const now = useNow(
    30_000,
    (later?.until !== undefined && !later.woke) ||
      (thread !== undefined && works(thread.mark))
  )
  if (!thread) return null
  const look = headerLookOf(thread, now)
  const rests = look.look === "rest"
  switch (props.at) {
    case "start":
      return (
        <ThreadMark
          listed={thread}
          {...look}
          className={rests ? "opacity-40" : undefined}
        />
      )
    case "overview":
      if (!props.calling && rests) return null
      return (
        <>
          <ThreadMark listed={thread} {...look} className="size-3.5" />
          {props.calling && thread.calls && (
            <span className="min-w-0 truncate">{thread.calls}</span>
          )}
        </>
      )
    default:
      return null
  }
}

/** A Thread's Mark, on its Pane's header and its tile in the Overview. */
export const threadHeader: Filler<"pane.header"> = {
  id: "agents.mark",
  slot: "pane.header",
  Fill: ThreadHeader,
}
