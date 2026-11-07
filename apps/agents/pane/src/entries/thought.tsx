/** The Agent's thought, folded under how long it took. */
import { Markdown } from "@banda/ui/components/markdown"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { duration } from "@banda/ui/lib/words"
import { BrainIcon } from "lucide-react"
import type { EntryProps } from "./types"

export function ThoughtEntry({ item, live, took }: EntryProps<"thought">) {
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={live ? "running" : undefined}>
            <TraceIcon>
              <BrainIcon />
            </TraceIcon>
            <TraceTitle>
              {live
                ? "Thinking"
                : took !== undefined && took >= 1000
                  ? `Thought for ${duration(took)}`
                  : "Thought"}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent inset>
          <Markdown streaming={live} className="text-muted-foreground">
            {item.body.text}
          </Markdown>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
