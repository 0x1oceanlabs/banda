/**
 * What a move to another Harness takes along, as a limit's card asks
 * before it goes (ADR 0078, decision 5). The "who" picker asks it above
 * the Message box instead (ADR 0114, decision 4).
 */
import { Button } from "@banda/ui/components/button"
import { Emblem } from "@banda/ui/components/emblem"
import { ChevronLeftIcon } from "lucide-react"
import type { Move } from "../thread/moves"

/** What a move to another Harness takes along, before it goes. */
export function MoveConfirm({
  move,
  from,
  onCancel,
  onMove,
}: {
  move: Move
  /** The name of the Harness the Thread runs on now. */
  from: string
  onCancel: () => void
  onMove: () => void
}) {
  const to = move.harness.name
  return (
    <div className="flex flex-col gap-2 p-1.5 text-sm">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Back"
          onClick={onCancel}
        >
          <ChevronLeftIcon />
        </Button>
        Move to {to}
      </div>
      {move.back ? (
        <p className="px-1 text-muted-foreground">
          {to} goes on with its own session of this Thread, and reads only what
          came after it.
        </p>
      ) : (
        <>
          <p className="px-1 text-muted-foreground">
            {to} starts a session of its own and reads this Thread's history:
          </p>
          <ul className="list-disc space-y-0.5 pr-1 pl-6 text-muted-foreground">
            <li>
              the first request and the newest messages, tool calls as text,
              about 16k tokens at most
            </li>
            <li>the rest it reads with Banda's read tool when it needs it</li>
            <li>
              not moved: {from}'s hidden reasoning, its cache, its tools' state
            </li>
          </ul>
          <p className="px-1 text-muted-foreground">
            Back on {from} at any time, its session goes on with only what is
            new.
          </p>
        </>
      )}
      <div className="flex justify-end gap-1.5 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onMove}>
          <Emblem of={move.harness} />
          Move to {to}
        </Button>
      </div>
    </div>
  )
}
