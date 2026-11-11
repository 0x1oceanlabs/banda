import { Spinner } from "@banda/ui/components/spinner"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { useNow } from "@banda/ui/hooks/use-now"
import { duration } from "@banda/ui/lib/words"
import type { LineProps } from "./types"

/**
 * The turn that runs, at its live edge (ADR 0058, decision 5): how long it
 * has worked, "Working for 45s", and what it does now: "· Running pnpm
 * test · 11s", "· 3 sub-agents at work" (ADR 0103, decision 19), or
 * "· Waiting for you".
 */
export function WorkingLine({ line, facts }: LineProps<"working">) {
  const { turn, doing } = line
  const { name } = facts
  const since = doing?.kind === "calling" ? doing.since : undefined
  const now = useNow(1000, turn.started !== undefined || since !== undefined)
  const title =
    turn.started === undefined
      ? `${name} is working…`
      : `Working for ${duration(now - turn.started)}`
  return (
    <Trace>
      <TraceLine status="running">
        <TraceIcon>
          <Spinner className="motion-reduce:animate-none" />
        </TraceIcon>
        <TraceTitle className="shrink-0 tabular-nums">{title}</TraceTitle>
        {doing && (
          <span className="min-w-0 truncate text-muted-foreground/70 tabular-nums">
            {"· "}
            {doing.kind === "asking" ? (
              "Waiting for you"
            ) : doing.kind === "thinking" ? (
              "Thinking"
            ) : doing.kind === "subagents" ? (
              doing.words
            ) : (
              <>
                {[doing.said.verb, doing.said.subject]
                  .filter(Boolean)
                  .join(" ")}
                {` · ${duration(now - doing.since)}`}
              </>
            )}
          </span>
        )}
      </TraceLine>
    </Trace>
  )
}
