import { RingMeter } from "@banda/ui/components/ring-meter"
import type { Usage } from "@banda/contract/agents"

/** From this share of its context used, how full it is shows. */
const HALF_FULL = 50

/** From this share of its context used, an Agent is near the point where
 * its Harness compacts or stops: the share shows as a warning. */
const NEARLY_FULL = 80

/** How full the Agent's context is, from half full: a ring, and the
 * share; what it cost so far on hover, when the Harness says. */
export function ContextUsed({ usage: { used, size, cost } }: { usage: Usage }) {
  const share = size > 0 ? Math.round((used / size) * 100) : 0
  if (share < HALF_FULL) return null
  const tokens = new Intl.NumberFormat("en", { notation: "compact" })
  const spent =
    cost &&
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: cost.currency,
    }).format(cost.amount)
  const words =
    `${share}% of the context used: ${tokens.format(used)} of ${tokens.format(size)} tokens` +
    (spent ? `. ${spent} so far.` : ".")
  return (
    <span
      title={words}
      data-full={share >= NEARLY_FULL || undefined}
      className="flex h-7 shrink-0 items-center gap-1.5 px-1.5 text-xs text-muted-foreground tabular-nums data-full:text-destructive"
    >
      <RingMeter
        className="size-3.5"
        value={share}
        aria-label="Context used"
        getAriaValueText={() => words}
      />
      {share}%
    </span>
  )
}
