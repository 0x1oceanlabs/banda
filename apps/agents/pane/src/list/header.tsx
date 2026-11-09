/**
 * What Threads shows of a Thread in the Tiling's Slot `pane.header` (ADR
 * 0062, decision 17): its Mark, in its Pane's header in the icon's place,
 * faint while it rests; and on its tile in the Overview, at a size to
 * read, with what it asks while it calls, unless it rests and does not
 * call. The Slot gives the Pane alone: Threads finds the Thread its Pane
 * shows in what it lists itself (#943).
 */
import { ThreadMark } from "@banda/ui/components/banda-mark"
import { useItem } from "@banda/ui/hooks/use-item"
import type { Listed, PaneState } from "@banda/ui/pane"
import type { Filler, HeaderProps } from "@banda/ui/slots"
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
  // As Threads lists it; none where the Window lists nothing, as in a
  // popped-out Pane's window.
  const listed = useItem(props.project, threadOf(props.pane))
  if (!isThread(listed)) return null
  switch (props.at) {
    case "start":
      return (
        <ThreadMark
          listed={listed}
          className={listed.mark === "rest" ? "opacity-40" : undefined}
        />
      )
    case "overview":
      if (!props.calling && listed.mark === "rest") return null
      return (
        <>
          <ThreadMark listed={listed} className="size-3.5" />
          {props.calling && listed.calls && (
            <span className="min-w-0 truncate">{listed.calls}</span>
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
