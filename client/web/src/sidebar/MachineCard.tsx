/**
 * Another machine's hover (ADR 0095, decision 1; ADR 0097, decision 7):
 * a card on its label in the sidebar, and on its mark on a row, with its
 * longer facts: what it is, its battery and why it is awake, its build
 * and its address. What it is its engine says, asked as the card opens
 * while the machine is live; away, the card says only what still holds.
 */
import { type ReactNode, useCallback, useContext, useMemo, useRef } from "react"
import { BatteryIcon } from "@banda/ui/components/battery-icon"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@banda/ui/components/hover-card"
import { MachineMark } from "@banda/ui/components/machine-icon"
import { useNow } from "@banda/ui/hooks/use-now"
import { useRead } from "@banda/ui/hooks/use-read"
import {
  awakeWords,
  awayFor,
  batteryWords,
  HostsContext,
  type Shown,
  useShownOf,
} from "@banda/core/react"
import { useTurnsOn } from "../calls/battery"
import { buildWords, factsWords, stateWords } from "../settings/machines"

/** `children`, the machine `host`'s label or mark, with its card as the
 * pointer rests on it. */
export function MachineCard({
  host,
  className = "flex min-w-0",
  children,
}: {
  /** Its key in `hosts.toml`. */
  host: string
  className?: string
  children: ReactNode
}) {
  const trigger = useRef<HTMLSpanElement>(null)
  // Beside the sidebar, level with what it is of, so it covers no row.
  const beside = useCallback(() => {
    const at = trigger.current
    if (!at) return null
    const edge = at.closest('aside[aria-label="Sidebar"]') ?? at
    return {
      getBoundingClientRect: () => {
        const { top, height } = at.getBoundingClientRect()
        const { right } = edge.getBoundingClientRect()
        return DOMRect.fromRect({ x: right, y: top, width: 0, height })
      },
    }
  }, [])
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={400}
        render={
          <span ref={trigger} data-machine-card={host} className={className} />
        }
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        anchor={beside}
        side="right"
        align="start"
        alignOffset={-10}
        sideOffset={4}
        className="w-auto max-w-96 min-w-60 gap-0 p-0"
      >
        <Facts host={host} />
      </HoverCardContent>
    </HoverCard>
  )
}

/** The card's facts, as the Window shows the machine now. */
function Facts({ host }: { host: string }) {
  const shown = useShownOf(host)
  if (!shown) return null
  return <Drawn shown={shown} />
}

function Drawn({ shown }: { shown: Shown }) {
  const kept = useContext(HostsContext)
  const { name: key, named, state, power } = shown
  const live = state.state === "live"
  const read = useMemo(
    () => (live ? () => kept.engine(key).call("machines.get", {}) : null),
    [kept, key, live]
  )
  const naming = useRead(read)
  const turns = useTurnsOn(key)
  const now = useNow(15_000, state.state === "away")
  const said = naming.state === "ready" ? naming.value : undefined
  const facts = said && factsWords([said.model, said.system])
  const build = buildWords(state)
  const away = state.state === "away" && awayFor(shown.away, now)
  const words = live ? "live" : away ? `away · ${away}` : stateWords(state)
  const rows: [term: string, value: ReactNode][] = []
  if (facts) rows.push(["Machine", facts])
  if (power?.battery)
    rows.push([
      "Battery",
      <span className="flex items-center gap-1.5">
        <BatteryIcon battery={power.battery} />
        {batteryWords(power.battery)}
      </span>,
    ])
  if (power) rows.push(["Awake", awakeWords(power.awake, turns).short])
  if (build) rows.push(["Build", build])
  rows.push(["Address", <span className="font-mono">{state.ssh}</span>])
  return (
    <div role="group" aria-label={`${named.name} facts`}>
      <div className="flex items-center gap-3 px-3 pt-2.5 pb-2">
        <MachineMark
          named={named}
          form="full"
          className="text-sm font-medium text-foreground [&_svg]:text-muted-foreground"
        />
        <span className="ml-auto text-xs text-muted-foreground">{words}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 px-3 pb-3 text-xs">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="min-w-0 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
