/**
 * The Thread's quiet line about its snooze (ADR 0074, decisions 4 and 7),
 * above the composer: while it sleeps, until when, with Wake now; once it
 * woke by itself, when, with Dismiss, until its next turn ends.
 */
import type { Snooze, TurnView } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { useNow } from "@banda/ui/hooks/use-now"
import { kept } from "@banda/ui/lib/kept"
import { clock, left } from "@banda/ui/lib/words"
import { sleeps, wokeOf } from "@banda/ui/pane"
import { AlarmClockIcon } from "lucide-react"
import { Docked } from "./Card"

/** Which Thread's waking its Person dismissed: the moment it was snoozed. */
const dismissed = kept(
  "banda.agents.woke-dismissed",
  (at): at is number => typeof at === "number"
)

/** What woke it early, in a few words; nothing for its time coming. */
const WHY: Partial<Record<NonNullable<Snooze["woke"]>["by"], string>> = {
  question: "it asked, so it woke early",
  failure: "a turn failed, so it woke early",
  done: "its turn ended",
}

export function SnoozeLine({
  thread,
  snooze,
  turns,
  onWake,
}: {
  thread: string
  snooze: Snooze | undefined
  turns: readonly TurnView[]
  /** Wakes it now, as the window does (`thread.wake`). */
  onWake: () => void
}) {
  // A clock only while it sleeps till a time: what it says then moves.
  const now = useNow(30_000, snooze?.until !== undefined && !snooze.woke)
  const gone = dismissed.use()
  if (!snooze) return null
  const byAgent = snooze.by.kind === "agent" ? " by its Agent" : ""
  if (sleeps(snooze, now)) {
    const until =
      snooze.until === undefined
        ? "it's done"
        : `${clock(snooze.until, now)} · ${left(snooze.until, now)} left${snooze.resume ? " · goes on by itself" : ""}`
    return (
      <Line
        words={`Snoozed${byAgent} until ${until}`}
        action="Wake now"
        onAction={onWake}
      />
    )
  }
  const at = wokeOf(snooze, now)
  if (at === undefined || gone[thread] === snooze.at) return null
  // Its next turn that ends puts the line away, as Dismiss does.
  if (turns.some((turn) => turn.ended !== undefined && turn.ended > at))
    return null
  const why = snooze.woke && WHY[snooze.woke.by]
  return (
    <Line
      words={`Woke at ${clock(at, now)}${why ? ` · ${why}` : ""}`}
      action="Dismiss"
      onAction={() => dismissed.put(thread, snooze.at)}
    />
  )
}

function Line({
  words,
  action,
  onAction,
}: {
  words: string
  action: string
  onAction: () => void
}) {
  return (
    <Docked
      label="Snooze"
      className="flex items-center gap-2 py-1.5 pr-1.5 pl-4"
    >
      <AlarmClockIcon className="size-3.75 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {words}
      </span>
      <Button variant="outline" size="xs" onClick={onAction}>
        {action}
      </Button>
    </Docked>
  )
}
