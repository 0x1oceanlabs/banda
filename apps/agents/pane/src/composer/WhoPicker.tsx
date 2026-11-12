/**
 * "Who" in a started Thread's row (ADR 0114, decision 4): the account it
 * runs on, by its emblem alone, and its use once past the warning. Its
 * menu: its Harness's accounts, which go on in the same session at one
 * click, then the other Harnesses, handed off to after a question above
 * the Message box. It draws {@link Who} and says what was picked.
 */
import { useState } from "react"
import { Button } from "@banda/ui/components/button"
import { Emblem } from "@banda/ui/components/emblem"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { RingMeter } from "@banda/ui/components/ring-meter"
import { clock } from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import { CheckIcon } from "lucide-react"
import { Docked } from "../entries/parts/Card"
import type { Move } from "../thread/moves"
import { FOOTER_CONTROL } from "./footer"
import type { Who, WhoRow } from "./who"

export function WhoPicker({
  who,
  disabled,
  onPick,
}: {
  who: Who
  disabled: boolean
  /** An account of the Thread's Harness, or another Harness's. */
  onPick: (move: Move) => void
}) {
  const [open, setOpen] = useState(false)
  const { now } = who
  const name = now.move.harness.name
  const pick = (row: WhoRow) => {
    setOpen(false)
    onPick(row.move)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn("min-w-0 px-1.5", FOOTER_CONTROL)}
            aria-label={`Account: ${name}${now.warns ? `, ${now.used}% used` : ""}`}
            title={[name, now.about].filter(Boolean).join(" · ")}
          />
        }
      >
        <Emblem of={now.move.harness} />
        {now.warns && (
          <span className="text-warning tabular-nums">{now.used}%</span>
        )}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-80 gap-0 rounded-card p-1"
      >
        <Heading>{who.title}</Heading>
        {who.same.map((row) => (
          <Row key={row.move.harness.id} row={row} onPick={pick} />
        ))}
        {who.same.length > 1 && <Note>Goes on in the same session.</Note>}
        {who.others.length > 0 && (
          <>
            <div className="mx-1.5 my-1 h-px bg-border" />
            <Heading>Hand off to another agent</Heading>
            {who.others.map((row) => (
              <Row key={row.move.harness.id} row={row} onPick={pick} />
            ))}
            <Note>Reads this Thread's history and goes on from here.</Note>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pt-2 pb-1 text-meta font-medium text-muted-foreground">
      {children}
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2.5 pt-0.5 pb-1.5 pl-9 text-meta text-muted-foreground">
      {children}
    </p>
  )
}

export function Row({
  row,
  onPick,
}: {
  row: WhoRow
  onPick: (row: WhoRow) => void
}) {
  const { move, about, used, warns, out, idle } = row
  return (
    <button
      type="button"
      disabled={idle}
      aria-current={move.on || undefined}
      className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left text-ui outline-none focus-visible:bg-accent enabled:hover:bg-accent"
      onClick={() => onPick(row)}
    >
      {/* Beside its name, the emblem only decorates the row. */}
      <span aria-hidden className="contents">
        <Emblem of={move.harness} className={cn(out && "opacity-50")} />
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span
          className={cn("shrink-0 font-medium", out && "text-muted-foreground")}
        >
          {move.harness.name}
        </span>
        {about && (
          <span className="truncate text-meta text-muted-foreground">
            {about}
          </span>
        )}
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 text-meta text-muted-foreground tabular-nums",
          warns && "text-warning"
        )}
      >
        {out ? (
          out.until === undefined ? (
            "out"
          ) : (
            `back at ${clock(out.until)}`
          )
        ) : used === undefined ? null : (
          <>
            <RingMeter value={used} className="size-3" />
            {used}%
          </>
        )}
      </span>
      <CheckIcon
        className={cn("size-4 shrink-0", !move.on && "invisible")}
        aria-hidden
      />
    </button>
  )
}

/** The question a handoff to another Harness asks first, docked above the
 * Message box (ADR 0114, decision 4; ADR 0078, decision 5). */
export function Handoff({
  move,
  onStay,
  onHandOff,
}: {
  move: Move
  onStay: () => void
  onHandOff: () => void
}) {
  const to = move.harness.short
  return (
    <Docked
      label={`Hand this Thread to ${to}?`}
      className="flex flex-col gap-2 p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") onStay()
      }}
    >
      <div className="flex items-center gap-1.5 text-meta font-semibold">
        <Emblem of={move.harness} />
        Hand this Thread to {to}?
      </div>
      <p className="text-muted-foreground">
        {move.back
          ? `${to} goes on with its own session of this Thread, and reads only what came after it.`
          : `${to} reads this Thread's history and goes on from here, in a session of its own.`}
      </p>
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onStay}>
          Stay
        </Button>
        <Button size="sm" autoFocus onClick={onHandOff}>
          Hand off
        </Button>
      </div>
    </Docked>
  )
}
