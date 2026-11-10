/**
 * Sub-agents one message started (ADR 0103, decisions 14 and 15): one line
 * that counts them, "3 sub-agents · 2 working · 1 asks", only the asking
 * and the failed in colour, and their rows under it, open while they work.
 * Once all have ended it folds into "Ran 3 sub-agents · 2m 40s", dimmed,
 * and opens on a click.
 */
import { useState } from "react"
import {
  Collapsible,
  CollapsibleContent,
} from "@banda/ui/components/collapsible"
import { Satellite } from "@banda/ui/components/satellite"
import { cn } from "@banda/ui/lib/utils"
import { Entry } from "../entries"
import { FADES, RowTrigger } from "../entries/parts/RowTrigger"
import { holds } from "../thread/findIn"
import { type Count, groupOf, lanesOf } from "../thread/subagents"
import type { LineProps } from "./types"

/** The colour a count takes: only what asks, and what failed. */
const TONES: Record<NonNullable<Count["tone"]>, string> = {
  asks: "text-attention",
  failed: "text-destructive",
}

export function SubagentsLine({ line, facts }: LineProps<"subagents">) {
  const group = groupOf(lanesOf(line.items, facts.lanes.byId))
  // Open while they work; folded as they settle, until opened again.
  const [open, setOpen] = useState(!group.settled)
  const [settled, setSettled] = useState(group.settled)
  if (settled !== group.settled) {
    setSettled(group.settled)
    setOpen(!group.settled)
  }
  const found = holds(line, facts.finding, facts.lanes)
  return (
    <Collapsible
      open={open || found}
      onOpenChange={setOpen}
      data-slot="subagents"
      className={cn(
        "flex min-w-0 flex-col transition-opacity motion-reduce:transition-none",
        group.settled && "opacity-55 hover:opacity-85"
      )}
    >
      <RowTrigger>
        <span aria-hidden className="flex w-7.5 shrink-0 items-center gap-0.75">
          {group.looks.map((look, at) => (
            <Satellite key={at} state={look} size={8} />
          ))}
        </span>
        <span className={cn("min-w-0 text-muted-foreground", FADES)}>
          <span className="text-foreground">{group.head}</span>
          {group.counts.map((count, at) => (
            <span key={at}>
              {" · "}
              <span className={count.tone && TONES[count.tone]}>
                {count.words}
              </span>
            </span>
          ))}
        </span>
      </RowTrigger>
      {/* Its rows, indented under its satellites, open at once as the
          kit's do; each reaches past their edges as the line does. */}
      <CollapsibleContent className="ml-9 flex min-w-0 flex-col">
        {line.items.map((item) => (
          <Entry key={item.id} item={item} {...facts.of(item)} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
