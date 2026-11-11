/**
 * Beside a spent account in the limits widget, the Threads its limit
 * stopped and "Move to" the account of its Harness with the most room
 * (ADR 0078, decision 7), as the accounts mockup has it. One click of the
 * Person's moves them all; Banda never does by itself.
 */
import { useState } from "react"
import { Button } from "@banda/ui/components/button"
import { Emblem } from "@banda/ui/components/emblem"
import { useAccounts, useHarnesses } from "@banda/ui/hooks/use-harnesses"
import type { Filler, SpentProps } from "@banda/ui/slots"
import { moveAll, useWaitingOn } from "../thread/move-all"
import { movesOf, waysOn } from "../thread/moves"

function WaitingThreads({ engine, account, limits, now }: SpentProps) {
  // The account's machine's list, and its fallback.
  const harnesses = useHarnesses(engine)
  const fallback = useAccounts(engine)?.fallback
  const waiting = useWaitingOn(engine, account)
  const [moved, setMoved] = useState<"moving" | "moved">()
  // Only an account of its Harness: it goes on with each one's session.
  const { same } = movesOf(harnesses, account, [], limits, now)
  const [to] = waysOn(same, [], fallback)
  const count = waiting.length
  if (!to || count === 0 || moved === "moved") return null
  return (
    <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">
        {count} {count === 1 ? "Thread waits" : "Threads wait"}
      </span>
      <Button
        size="xs"
        disabled={moved !== undefined}
        onClick={async () => {
          setMoved("moving")
          await moveAll(engine, waiting, to.harness.id)
          setMoved("moved")
        }}
      >
        <Emblem of={to.harness} className="size-3" />
        Move to {to.harness.name}
      </Button>
    </div>
  )
}

export const waitingThreads: Filler<"limits.account"> = {
  id: "agents.waiting",
  slot: "limits.account",
  Fill: WaitingThreads,
}
