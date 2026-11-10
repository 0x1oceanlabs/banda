/**
 * The accounts and Harnesses a started Thread may move to, under the model
 * picker's effort slider, as the accounts mockup has them (ADR 0078,
 * decisions 4 and 5): another account of its Harness at one click, in the
 * same session; another Harness after a word on what goes, once per
 * Thread.
 */
import { Button } from "@banda/ui/components/button"
import { Emblem } from "@banda/ui/components/emblem"
import { clock } from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import { CheckIcon, ChevronLeftIcon, CornerDownRightIcon } from "lucide-react"
import type { Move } from "../thread/moves"

/** The two lists: the Harness's accounts, then the other Harnesses. */
export function MoveList({
  same,
  others,
  harnessName,
  onPick,
}: {
  same: readonly Move[]
  others: readonly Move[]
  /** What its Harness is called, for the accounts' heading. */
  harnessName: string
  onPick: (move: Move) => void
}) {
  if (same.length < 2 && others.length === 0) return null
  return (
    <div className="mt-1 border-t border-border/60 pt-1">
      {same.length > 1 && (
        <>
          <Heading>{harnessName}'s accounts</Heading>
          {same.map((move) => (
            <MoveRow key={move.harness.id} move={move} onPick={onPick} />
          ))}
        </>
      )}
      {others.length > 0 && (
        <>
          <Heading>Another agent</Heading>
          {others.map((move) => (
            <MoveRow key={move.harness.id} move={move} onPick={onPick} />
          ))}
        </>
      )}
      <p className="px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground/80">
        An account of the same agent goes on in the same session. Another agent
        reads the Thread's history.
      </p>
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pt-1.5 pb-0.5 text-xs text-muted-foreground">
      {children}
    </div>
  )
}

function MoveRow({
  move,
  onPick,
}: {
  move: Move
  onPick: (move: Move) => void
}) {
  const { harness, fullest, out, on, same } = move
  const room = out
    ? out.until === undefined
      ? "out"
      : clock(out.until)
    : fullest === undefined
      ? undefined
      : `${fullest}%`
  return (
    <button
      type="button"
      disabled={(same && !!out) || on}
      title={
        out
          ? `${harness.name} is out of its limits${out.until === undefined ? "" : ` until ${clock(out.until)}`}`
          : undefined
      }
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:hover:bg-transparent"
      onClick={() => onPick(move)}
    >
      <Emblem of={harness} />
      <span className="min-w-0 flex-1 truncate">{harness.name}</span>
      {fullest !== undefined && (
        <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
          <span
            className={cn(
              "block h-full rounded-full",
              out
                ? "bg-destructive"
                : fullest >= 85
                  ? "bg-warning"
                  : "bg-muted-foreground/60"
            )}
            style={{ width: `${out ? 100 : fullest}%` }}
          />
        </span>
      )}
      {room && (
        <span
          className={cn(
            "min-w-10 shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums",
            out && "text-destructive"
          )}
        >
          {room}
        </span>
      )}
      <span className="flex w-4 shrink-0 justify-end">
        {on ? (
          <CheckIcon className="size-4" />
        ) : (
          !same && (
            <CornerDownRightIcon className="size-3.5 text-muted-foreground" />
          )
        )}
      </span>
    </button>
  )
}

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
