import { Satellite } from "@banda/ui/components/satellite"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import type { LineProps } from "./types"

/**
 * Sub-agents at work when no turn runs (ADR 0103, decision 19): the live
 * line stays at the Thread's end, a working satellite in its spinner's
 * place and no clock, as the one clock is a running turn's (decision 20):
 * "Reviewer is at work · Claude goes on when it ends".
 */
export function AtWorkLine({ line }: LineProps<"at-work">) {
  return (
    <Trace>
      <TraceLine status="running">
        <TraceIcon>
          <Satellite state="working" size={10} />
        </TraceIcon>
        <TraceTitle>{line.words}</TraceTitle>
        {/* Sized from nothing, so a narrow Thread cuts it before the title. */}
        <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
          {"· "}
          {line.then}
        </span>
      </TraceLine>
    </Trace>
  )
}
