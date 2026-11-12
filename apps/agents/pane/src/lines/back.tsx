import { CornerDownRightIcon } from "lucide-react"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import type { LineProps } from "./types"

/**
 * A Crew or a sub-agent that ended after its turn had (ADR 0103, decision
 * 19): "↩ Crew audit-routes finished · 14m", then, muted, "Claude went on
 * by itself", before what Claude then wrote; or "↩ Reviewer finished".
 */
export function BackLine({ line }: LineProps<"back">) {
  return (
    <Trace data-slot="back">
      <TraceLine>
        <TraceIcon>
          <CornerDownRightIcon />
        </TraceIcon>
        <TraceTitle>{line.words}</TraceTitle>
        {line.then && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
            {"· "}
            {line.then}
          </span>
        )}
      </TraceLine>
    </Trace>
  )
}
