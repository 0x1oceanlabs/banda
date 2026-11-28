/**
 * A Harness's row (ADR 0140, decision 6): its emblem and name, where its
 * setup is, and one button, which opens its sheet. And the card of rows a
 * new Thread shows while no Harness is ready.
 */
import { useState } from "react"
import type { Engine } from "@banda/contract"
import type { HarnessView, Setup } from "@banda/contract/harnesses"
import { Button } from "@banda/ui/components/button"
import { Emblem } from "@banda/ui/components/emblem"
import { cn } from "@banda/ui/lib/utils"
import { SetupSheet } from "./SetupSheet"
import { rowOf, type Tone } from "./setup"

export const TONE: Readonly<Record<Tone, string>> = {
  asks: "text-attention",
  failed: "text-destructive",
  ready: "text-added",
}

type Shown = {
  engine: Engine
  account: HarnessView
  setup: Setup
  /** What its sheet's button says once it is ready. */
  done?: string
  /** Hears its sheet open and close. */
  onSheet?: (open: boolean) => void
}

/** The row's one button, and the sheet it opens; nothing where there is
 * nothing to do and no sheet open. */
export function SetupAction({
  engine,
  account,
  setup,
  done,
  onSheet,
  className,
}: Shown & { className?: string }) {
  const [open, setOpen] = useState(false)
  const words = rowOf(setup)
  const show = (next: boolean) => {
    setOpen(next)
    onSheet?.(next)
  }
  return (
    <>
      {words.button && (
        <Button
          size="xs"
          variant={setup.running ? "outline" : "default"}
          className={className}
          aria-label={`${words.button}: ${account.name}`}
          onClick={() => show(true)}
        >
          {words.button}
        </Button>
      )}
      {open && (
        <SetupSheet
          engine={engine}
          account={account}
          setup={setup}
          open
          onOpenChange={show}
          done={done}
        />
      )}
    </>
  )
}

function SetupRow(props: Shown) {
  const { account, setup } = props
  const words = rowOf(setup)
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Emblem of={account} className="size-6 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui font-medium">{setup.name}</p>
        <p
          className={cn(
            "truncate text-meta text-muted-foreground",
            words.tone && TONE[words.tone]
          )}
        >
          {words.line}
        </p>
      </div>
      <SetupAction {...props} />
    </li>
  )
}

/** "Claude Code or Codex", "Claude Code, Codex or Gemini". */
function either(names: readonly string[]): string {
  if (names.length < 2) return names.join("")
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`
}

/** What a new Thread shows while no Harness is ready: a row for each one
 * Banda can set up. */
export function ConnectAgent({
  engine,
  rows,
  onSheet,
}: {
  engine: Engine
  rows: readonly { account: HarnessView; setup: Setup }[]
  onSheet: (open: boolean) => void
}) {
  return (
    <section
      aria-label="Connect an Agent"
      className="flex w-full max-w-md flex-col gap-3"
    >
      <div className="flex flex-col gap-1 text-center">
        <h2 className="text-heading font-medium">Connect an Agent</h2>
        <p className="text-ui text-muted-foreground">
          Banda works with {either(rows.map((row) => row.setup.name))} on this
          computer.{rows.length > 1 && " One is enough."} It uses your own plan.
        </p>
      </div>
      <ul className="flex flex-col divide-y rounded-card border bg-card">
        {rows.map((row) => (
          <SetupRow
            key={row.account.id}
            engine={engine}
            {...row}
            done="Write the first message"
            onSheet={onSheet}
          />
        ))}
      </ul>
    </section>
  )
}
