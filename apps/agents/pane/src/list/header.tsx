/**
 * What Threads shows of a Thread in the Tiling's Slot `pane.header` (ADR
 * 0062, decision 17): its Mark, in its Pane's header in the icon's place,
 * faint while it rests; and on its tile in the Overview, at a size to
 * read, with what it asks while it calls, unless it rests and does not
 * call.
 */
import { ThreadMark } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import type { Filler, HeaderProps } from "@banda/ui/slots"
import { threadPane } from "../ThreadPane"

/** Whether `listed` is a Thread: Threads shows only its own Items. */
const isThread = (listed: Listed | undefined): listed is Listed =>
  listed?.pane.kind === threadPane.kind

function ThreadHeader(props: HeaderProps) {
  const { listed } = props
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
    case "project":
      return null
  }
}

/** A Thread's Mark, on its Pane's header and its tile in the Overview. */
export const threadHeader: Filler<"pane.header"> = {
  id: "agents.mark",
  slot: "pane.header",
  Fill: ThreadHeader,
}
