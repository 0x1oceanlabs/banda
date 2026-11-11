import {
  type ComponentProps,
  type ReactNode,
  useContext,
  useEffect,
} from "react"
import type { Engine } from "@banda/contract"
import type { Machines } from "@banda/contract/sidebar"
import { HostsContext } from "@banda/core/react"
import { useHarnesses } from "@banda/ui/hooks/use-harnesses"
import { stopNaming, useNaming } from "@banda/ui/lib/naming"
import { TitleField } from "../titles/Title"
import type { Row } from "./arrange"
import { CardMenu } from "./CardMenu"
import { Card } from "./CardView"
import type { CardOf } from "./card"
import { useCard } from "./useCard"
import { useHoldWhile } from "./useHold"

/** Where a Thread's card is drawn, and how: what its card is made of but
 * its machine, which `useCard` reads, the sidebar's row, and how it is
 * drawn. */
type Placed = Omit<CardOf, "row" | "machine" | "away" | "stopped"> & {
  row: Row
} & Pick<ComponentProps<typeof Card>, "current" | "picked" | "acts">

/**
 * A Thread's card, the same on every machine (ADR 0098, decision 18),
 * named as `[machines]` asks (`useCard`): another machine's dims, where
 * no label above names it, while the Window does not reach it, its time
 * standing as of when it was last heard, and has its Harness's emblem
 * from that machine's engine. This machine's has its menu (`CardMenu`,
 * ADR 0098, decision 14), whose Rename… opens the field in the card
 * itself. Every card has its acts under the pointer (ADR 0098, decision
 * 10), which go to its host's engine; another machine's has no menu yet,
 * and one that left the tab while the list held has neither. The menu,
 * while open, and the field hold the list still, and what its Person does
 * from the menu is their own act, which the list draws at once where it
 * takes the card elsewhere (ADR 0098, decision 6).
 */
export function ThreadRow({
  engine,
  named,
  machines,
  acts,
  ...placed
}: Placed & {
  /** This machine's engine. */
  engine: Engine
  /** A label above names its machine. */
  named: boolean
  /** How the machines are named (`[machines]` in `sidebar.toml`). */
  machines: Machines
}) {
  const { row, went } = placed
  const project = row.project.id
  const mine = row.host === undefined
  const naming = useNaming(project, row.listed.id, "row")
  const kept = useContext(HostsContext)
  const harnesses = useHarnesses(
    row.host === undefined ? engine : kept.engine(row.host)
  )
  const card = useCard(placed, { named, machines })
  // A card that left takes its menu and its field with it, which say
  // nothing as it goes: the half-typed title is not kept, and neither
  // holds the list any more.
  const left = went !== undefined
  const renaming = naming !== null
  useEffect(() => {
    if (left && renaming) stopNaming()
  }, [left, renaming])
  useHoldWhile(renaming && !left)
  const drawn = (field?: ReactNode) => (
    <Card
      card={card}
      row={row}
      current={placed.current}
      picked={placed.picked}
      acts={acts}
      harnesses={harnesses}
      field={field}
    />
  )
  // Away from it, another machine's card dims where no label above does.
  if (!mine)
    return !named && card.away ? (
      <div className="opacity-45">{drawn()}</div>
    ) : (
      drawn()
    )
  if (left) return drawn()
  if (naming)
    return drawn(
      <TitleField
        project={project}
        listed={row.listed}
        naming={naming}
        className="-my-0.5 -ml-1.5 h-6 text-sm"
      />
    )
  return <CardMenu row={row}>{drawn()}</CardMenu>
}
