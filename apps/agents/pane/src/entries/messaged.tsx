/**
 * What the Agent, or a sub-agent, wrote to a sub-agent after its brief
 * (ADR 0103, decision 25): where it was sent, a row of its work,
 * "Messaged Reviewer", and the first line of the words, muted; in that
 * sub-agent's own Pane, a bubble on the right under "Claude wrote", as
 * its brief is. One queued for a sub-agent at work has no words, as the
 * Harness says none: a row with none, and no bubble. The Harness's own ID
 * for the sub-agent never shows.
 */
import { MessageSquareIcon } from "lucide-react"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { cn } from "@banda/ui/lib/utils"
import { messagedWords } from "../thread/subagents"
import { Brief } from "./parts/Brief"
import { FADES } from "./parts/RowTrigger"
import type { EntryProps } from "./types"

export function MessagedEntry({ item, to, wrote }: EntryProps<"messaged">) {
  const { text } = item.body
  if (wrote)
    return text ? <Brief asker={wrote} text={text} slot="wrote" /> : null
  const { verb, subject, first } = messagedWords(to, text)
  return (
    <Trace data-slot="messaged">
      <TraceLine>
        <TraceIcon>
          <MessageSquareIcon />
        </TraceIcon>
        <TraceTitle className="shrink-0">
          {verb} <span className="text-foreground">{subject}</span>
        </TraceTitle>
        {first && (
          <span className={cn("min-w-0 text-muted-foreground/70", FADES)}>
            · {first}
          </span>
        )}
      </TraceLine>
    </Trace>
  )
}
