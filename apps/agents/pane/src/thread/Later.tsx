/**
 * The Thread's quiet line about its Later (ADR 0074, decisions 4 and 7),
 * above the composer: while it sleeps, until when, with Wake now; once it
 * woke by itself, when, with Dismiss, until its next turn ends. What its
 * Person saw of it waking is its host's mark (`woke_seen`, ADR 0096), so
 * every window and machine shows the same.
 */
import { useEffect } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { Later, ThreadId, TurnView } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { useNow } from "@banda/ui/hooks/use-now"
import { left } from "@banda/ui/lib/words"
import { clock } from "@banda/core/react"
import { sleeps, wokeOf } from "@banda/ui/lib/later"
import { AlarmClockIcon } from "lucide-react"
import { Docked } from "../entries/parts/Card"
import { mark, useSending } from "../list/sent"
import { markWhenPresent } from "./session"

/**
 * Marks that its Person saw `thread` wake by itself, as they look at its
 * Pane, focused in the window in front, once they are at the window: its
 * row in every sidebar stops saying it woke (ADR 0074, decision 3).
 */
export function useSeeWoke(
  engine: Engine,
  project: ProjectId,
  thread: ThreadId | null,
  later: Later | undefined,
  looking: boolean
): void {
  const front = useInFront()
  // A clock only while it sleeps till a time: it wakes as that comes.
  const now = useNow(30_000, later?.until !== undefined && !later.woke)
  const seen = useWokeSeen(engine, thread, later)
  // Its waking that is still to be seen: when it was put off, the Later's
  // own, so a new Later is seen again.
  const unseen =
    later && !seen && wokeOf(later, now) !== undefined ? later.at : undefined
  useEffect(() => {
    if (!looking || !front || thread === null || unseen === undefined) return
    return markWhenPresent(engine, project, thread, { woke: "seen" })
  }, [looking, front, thread, unseen, engine, project])
}

/** What woke it early, in a few words; nothing for its time coming. */
const WHY: Partial<Record<NonNullable<Later["woke"]>["by"], string>> = {
  question: "it asked, so it woke early",
  failure: "a turn failed, so it woke early",
  done: "its turn ended",
}

/** What its Person saw of `thread` waking: its host's mark, or the one on
 * its way there, which shows at once (`mark`). */
function useWokeSeen(
  engine: Engine,
  thread: ThreadId | null,
  later: Later | undefined
): Later["woke_seen"] {
  const sending = useSending(engine)[thread ?? ""]?.woke?.to
  return later?.woke_seen === "dismissed"
    ? "dismissed"
    : (sending ?? later?.woke_seen)
}

export function LaterLine({
  engine,
  project,
  thread,
  later,
  turns,
  onWake,
}: {
  engine: Engine
  project: ProjectId
  thread: ThreadId
  later: Later | undefined
  turns: readonly TurnView[]
  /** Wakes it now, as the window does (`thread.wake`). */
  onWake: () => void
}) {
  // A clock only while it sleeps till a time: what it says then moves.
  const now = useNow(30_000, later?.until !== undefined && !later.woke)
  const seen = useWokeSeen(engine, thread, later)
  if (!later) return null
  const byAgent = later.by.kind === "agent" ? " by its Agent" : ""
  if (sleeps(later, now)) {
    const until =
      later.until === undefined
        ? "it's done"
        : `${clock(later.until, now)} · ${left(later.until, now)} left${later.resume ? " · goes on by itself" : ""}`
    return (
      <Line
        words={`Later${byAgent}, until ${until}`}
        action="Wake now"
        onAction={onWake}
      />
    )
  }
  const at = wokeOf(later, now)
  if (at === undefined || seen === "dismissed") return null
  // Its next turn that ends puts the line away, as Dismiss does.
  if (turns.some((turn) => turn.ended !== undefined && turn.ended > at))
    return null
  const why = later.woke && WHY[later.woke.by]
  return (
    <Line
      words={`Woke at ${clock(at, now)}${why ? ` · ${why}` : ""}`}
      action="Dismiss"
      onAction={() => void mark(engine, project, thread, { woke: "dismissed" })}
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
      label="Later"
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
