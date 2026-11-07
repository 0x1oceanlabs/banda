import { useState } from "react"
import type { Failure } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { Switch } from "@banda/ui/components/switch"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { useNow } from "@banda/ui/hooks/use-now"
import { clock } from "@banda/ui/lib/words"
import { sleeps } from "@banda/ui/pane"
import { useThreadAround } from "../thread/context"
import type { LineProps } from "./types"
import {
  AlarmClockIcon,
  CircleAlertIcon,
  CircleSlashIcon,
  RotateCcwIcon,
} from "lucide-react"

/** A turn that did not finish: why, what to do about it, and Try again
 * when its message can be sent again. One that failed says so in plain
 * words beside a red icon (ADR 0058, decision 1). One that failed because
 * its Person must sign in offers the ways to, while it can go again. */
export function EndedLine({ line, facts }: LineProps<"ended">) {
  const { turn } = line
  const { answering: busy, snooze } = facts
  const { acts } = useThreadAround()
  const again = turn.can.retry
  const onRetry = again ? () => acts.retry(turn) : undefined
  // Snoozes the Thread until a usage limit's reset, and with `resume`
  // tries the turn again then (ADR 0074, decision 8).
  const onSnooze = again ? acts.snooze : undefined
  const failed = turn.state === "failed"
  const signsIn = turn.failure?.class === "sign_in" && onRetry !== undefined
  const advice = !signsIn && turn.failure && adviceFor(turn.failure)
  // A usage limit that says when it resets, still to come, offers a
  // snooze till then, unless the Thread sleeps already.
  const failure = turn.failure
  const resets =
    onSnooze && failure?.class === "usage_limit" ? failure.until : undefined
  const now = useNow(60_000, resets !== undefined)
  const [goOn, setGoOn] = useState(true)
  const until =
    resets !== undefined && resets > now && !sleeps(snooze, now)
      ? resets
      : undefined
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
          {until !== undefined && (
            <>
              <Button
                variant="outline"
                size="xs"
                onClick={() => onSnooze?.(until, goOn)}
              >
                <AlarmClockIcon data-icon="inline-start" />
                Snooze until {clock(until)}
              </Button>
              <label className="flex items-center gap-1.5 text-meta text-muted-foreground">
                <Switch
                  label="Go on by itself when it resets"
                  on={goOn}
                  onChange={setGoOn}
                />
                Go on by itself when it resets
              </label>
            </>
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
    case "usage_limit":
      return failure.until === undefined
        ? undefined
        : `You can try again after ${clock(failure.until)}.`
    case "harness_stopped":
    case "provider":
      return undefined
  }
}
