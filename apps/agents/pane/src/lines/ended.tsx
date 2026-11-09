import type { Failure } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { useNow } from "@banda/ui/hooks/use-now"
import { sleeps } from "@banda/ui/lib/later"
import { useThreadAround } from "../thread/context"
import { LimitCard } from "./limit"
import type { LineProps } from "./types"
import { CircleAlertIcon, CircleSlashIcon, RotateCcwIcon } from "lucide-react"

/** A turn that did not finish: why, what to do about it, and Try again
 * when its message can be sent again. One that failed says so in plain
 * words beside a red icon (ADR 0058, decision 1). One that failed because
 * its Person must sign in offers the ways to, while it can go again. One
 * a usage limit stopped is a pause: its card (ADR 0078, decision 6). */
export function EndedLine({ line, facts }: LineProps<"ended">) {
  const { turn } = line
  const { answering: busy, later } = facts
  const { acts } = useThreadAround()
  const again = turn.can.retry
  const onRetry = again ? () => acts.retry(turn) : undefined
  const failed = turn.state === "failed"
  const failure = turn.failure
  const limit = again && failure?.class === "usage_limit" ? failure : undefined
  const now = useNow(60_000, limit !== undefined)
  if (limit) {
    // The reset the limit said, else the one its limits read say.
    const here = facts.moves?.same.find((move) => move.on)
    const resets = limit.until ?? here?.out?.until
    return (
      <LimitCard
        turn={turn}
        moves={facts.moves}
        until={resets !== undefined && resets > now ? resets : undefined}
        waits={sleeps(later, now)}
        busy={busy}
        now={now}
      />
    )
  }
  const signsIn = failure?.class === "sign_in" && onRetry !== undefined
  const advice = !signsIn && failure && adviceFor(failure)
  return (
    <Trace>
      <TraceLine
        status={failed ? "error" : undefined}
        className={failed ? "text-foreground" : undefined}
      >
        <TraceIcon>
          {turn.state === "stopped" ? <CircleSlashIcon /> : <CircleAlertIcon />}
        </TraceIcon>
        <TraceTitle className="whitespace-normal">
          {turn.reason ?? (failed ? "This turn failed." : "Stopped.")}
        </TraceTitle>
      </TraceLine>
      {(advice || onRetry) && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          {advice && (
            <span className="text-meta text-muted-foreground">{advice}</span>
          )}
          {onRetry && (
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={onRetry}
            >
              <RotateCcwIcon data-icon="inline-start" />
              Try again
            </Button>
          )}
        </div>
      )}
      {signsIn && <div className="pl-6">{acts.signIn(turn)}</div>}
    </Trace>
  )
}

/** What a Person can do about a failure, beyond trying again. */
function adviceFor(failure: Failure): string | undefined {
  switch (failure.class) {
    case "sign_in":
      return "Sign in from a terminal, then try again."
    // One that can go again is a card; one that cannot went already.
    case "usage_limit":
    case "harness_stopped":
    case "provider":
      return undefined
  }
}
