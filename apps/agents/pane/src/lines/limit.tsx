/**
 * A usage limit is a pause, not a failure (ADR 0078, decision 6; ADR 0093,
 * decision 8): the turn's red line becomes a card that names the account,
 * its window and its reset, and offers the ways on, as the accounts
 * mockup has it. Each goes on with the stopped turn on the new account.
 * Banda never takes one by itself (decision 7).
 */
import { useState } from "react"
import { AGENTS_FILE, type TurnView } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { Emblem } from "@banda/ui/components/emblem"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { useFile } from "@banda/ui/lib/look"
import { clock } from "@banda/core/react"
import { left } from "@banda/ui/lib/words"
import { cn } from "@banda/ui/lib/utils"
import {
  MoreHorizontalIcon,
  RotateCcwIcon,
  SettingsIcon,
  WorkflowIcon,
} from "lucide-react"
import { useHarnesses } from "@banda/ui/hooks/use-harnesses"
import { MoveConfirm } from "../composer/Moves"
import { harnessName } from "../harnesses"
import { useThreadAround } from "../thread/context"
import { moveAll, useWaitingOn } from "../thread/move-all"
import { type Move, type Moves, waysOn } from "../thread/moves"

export function LimitCard({
  turn,
  moves,
  until,
  waits,
  busy,
  now,
}: {
  turn: TurnView
  moves?: Moves
  /** When the limit resets, still to come; none when it is not said. */
  until?: number
  /** The Thread is put off till the reset, to go on by itself: its Later
   * line above the composer wakes it. */
  waits: boolean
  busy: boolean
  now: number
}) {
  const { acts } = useThreadAround()
  const { fallback } = useFile(AGENTS_FILE)
  const here = moves?.same.find((move) => move.on)
  const account = here?.harness.name ?? "This account"
  const all = moves ? waysOn(moves.same, moves.others, fallback) : []
  // While it waits, only the first: going on now.
  const ways = waits ? all.slice(0, 1) : all
  // "5-hour window · resets at 14:20, in 1h", of what is known.
  const when =
    until === undefined
      ? undefined
      : `resets at ${clock(until, now)}, in ${left(until, now)}`
  const said = [here?.out?.window, when].filter(Boolean).join(" · ")
  const about = waits
    ? "The Thread is put off till the reset and goes on by itself."
    : `${said ? `${said[0].toUpperCase()}${said.slice(1)}. ` : ""}The turn goes on where it stopped.`
  const title = waits
    ? `Waiting for ${account}'s reset${until === undefined ? "" : ` · goes on at ${clock(until, now)}`}`
    : `${account}'s limit ran out`
  return (
    <div
      role="group"
      aria-label={title}
      className="my-1 max-w-160 rounded-card border border-border bg-warning/5 px-3 pt-2.5 pb-3 text-sm"
    >
      <div className="flex items-center gap-2 font-medium">
        <PauseMark />
        {title}
      </div>
      <p className="pl-6 text-meta text-muted-foreground">{about}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-6">
        {ways.map((move, i) => (
          <WayOn
            key={move.harness.id}
            move={move}
            from={account}
            main={i === 0}
            waits={waits}
            confirm={!move.same && (moves?.confirm ?? true)}
            busy={busy}
            onGo={() => acts.retryOn(turn, move.harness.id)}
          />
        ))}
        {!waits && until !== undefined && acts.putOff && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => acts.putOff?.(until, true)}
          >
            Wait until {clock(until, now)}
          </Button>
        )}
        <More
          here={here}
          to={all[0]?.same ? all[0] : undefined}
          onRetry={() => acts.retry(turn)}
          onAccounts={acts.accounts}
          busy={busy}
        />
      </div>
      {!waits && ways.length > 0 && (
        <p className="mt-2 pl-6 text-xs text-muted-foreground/80">
          {ways.map(noteOf).join(" ")}
        </p>
      )}
    </div>
  )
}

/** What one way on keeps, under the buttons. */
function noteOf(move: Move): string {
  const name = move.harness.name
  if (move.same) return `${name}: the same session, nothing lost.`
  if (move.back) return `${name} goes back to its own session.`
  return `${name} gets the Thread's history.`
}

/** A limit the Thread went on from: what stopped there, in one quiet
 * line, named by the account the turn ran on, not the one it is on now. */
export function LimitPassed({ turn }: { turn: TurnView }) {
  const { engine } = useThreadAround()
  const harnesses = useHarnesses(engine)
  const account = turn.harness
    ? harnessName(harnesses, turn.harness)
    : "The account"
  return (
    <div className="my-1 flex items-center gap-2 text-sm text-muted-foreground">
      <PauseMark quiet />
      {account}'s limit ran out
    </div>
  )
}

/** The pause sign in the warning's colour: a limit waits, it did not
 * fail. Quiet, once the Thread went on. */
function PauseMark({ quiet }: { quiet?: boolean }) {
  const bar = cn(
    "h-1.5 w-[1.5px]",
    quiet ? "bg-muted-foreground/60" : "bg-warning"
  )
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center gap-0.5 rounded-full border-[1.5px]",
        quiet ? "border-muted-foreground/60" : "border-warning"
      )}
    >
      <span className={bar} />
      <span className={bar} />
    </span>
  )
}

/** A way on: at once to an account of the Thread's Harness, after a word
 * on what goes to another Harness, until the Thread's first handoff. */
function WayOn({
  move,
  from,
  main,
  waits,
  confirm,
  busy,
  onGo,
}: {
  move: Move
  from: string
  main: boolean
  /** Said as "now": the Thread waits for the reset otherwise. */
  waits: boolean
  confirm: boolean
  busy: boolean
  onGo: () => void
}) {
  const [asking, setAsking] = useState(false)
  const { harness, fullest } = move
  const button = (
    <Button
      variant={main ? "default" : "outline"}
      size="sm"
      className={cn(main && "font-medium")}
      disabled={busy}
      onClick={confirm ? undefined : onGo}
    >
      <Emblem of={harness} />
      {main ? `Go on ${waits ? "now " : ""}with ${harness.name}` : harness.name}
      {fullest !== undefined && (
        <span className="text-xs tabular-nums opacity-60">{fullest}%</span>
      )}
    </Button>
  )
  if (!confirm) return button
  return (
    <Popover open={asking} onOpenChange={setAsking}>
      <PopoverTrigger render={button} />
      <PopoverContent
        side="top"
        align="start"
        className="w-80 gap-0 rounded-card p-1"
      >
        <MoveConfirm
          move={move}
          from={from}
          onCancel={() => setAsking(false)}
          onMove={() => {
            setAsking(false)
            onGo()
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** The card's ⋯: try again here, move every Thread the limit stopped,
 * and the accounts in Settings. */
function More({
  here,
  to,
  onRetry,
  onAccounts,
  busy,
}: {
  /** The account the Thread is on. */
  here?: Move
  /** The account of the same Harness all of them may move to. */
  to?: Move
  onRetry: () => void
  onAccounts?: () => void
  busy: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="More ways on"
          >
            <MoreHorizontalIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuItem disabled={busy} onClick={onRetry}>
          <RotateCcwIcon />
          Try again here
        </DropdownMenuItem>
        {here && to && <MoveAll from={here} to={to} />}
        {onAccounts && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onAccounts}>
              <SettingsIcon />
              Accounts…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** "Move all N Threads of Work to Personal", read as the menu opens;
 * nothing while this Thread alone waits. */
function MoveAll({ from, to }: { from: Move; to: Move }) {
  const { engine } = useThreadAround()
  const waiting = useWaitingOn(engine, from.harness.id)
  if (waiting.length < 2) return null
  return (
    <DropdownMenuItem
      onClick={() => void moveAll(engine, waiting, to.harness.id)}
    >
      <WorkflowIcon />
      Move all {waiting.length} Threads of {from.harness.name} to{" "}
      {to.harness.name}
    </DropdownMenuItem>
  )
}
