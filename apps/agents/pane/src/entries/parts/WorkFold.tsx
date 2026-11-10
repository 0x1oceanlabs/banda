/** A run of work as one line that says what it did and how much it
 * changed, opening to its list (ADR 0058, decision 4): a Thread's line of
 * work and fold, and a sub-agent's work opened in its row. */
import { Fragment } from "react"
import { DiffCounts } from "@banda/ui/components/diff"
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import type { Did } from "../../thread/timeline"

/** One line, `title` after `icon`, with the lines `did` changed, that
 * opens to `children`: the work's list. It sits in a `Trace`, and opens
 * by itself unless `open` says when. */
export function WorkFold({
  icon,
  title,
  did,
  children,
  ...open
}: {
  icon: React.ReactNode
  title: React.ReactNode
  did: Did
  children: React.ReactNode
} & (
  | { open?: undefined }
  | { open: boolean; onOpenChange: (open: boolean) => void }
)) {
  return (
    <TraceCollapsible {...open}>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceIcon>{icon}</TraceIcon>
          <TraceTitle>{title}</TraceTitle>
          <Counts did={did} />
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>{children}</TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/** "ran 3 commands (1 failed), edited 2 files": what failed in the
 * destructive colour. */
export function Kinds({
  did: { kinds },
  capital,
}: {
  did: Did
  capital?: boolean
}) {
  return kinds.map(({ words, failed }, at) => (
    <Fragment key={at}>
      {at > 0 && ", "}
      {capital && at === 0 ? words[0].toUpperCase() + words.slice(1) : words}
      {failed > 0 && (
        <>
          {" "}
          <span className="text-destructive">({failed} failed)</span>
        </>
      )}
    </Fragment>
  ))
}

/** The lines a run of work added and removed, if it changed any. */
function Counts({ did: { added, removed } }: { did: Did }) {
  return added + removed > 0 ? (
    <DiffCounts added={added} removed={removed} />
  ) : null
}
