import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import type { Engine } from "@banda/contract"
import type { MachineRows, Machines } from "@banda/contract/sidebar"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import {
  awaySince,
  namedIn,
  sameData,
  type Shown,
  useHostsBy,
  useThisNamed,
} from "@banda/core/react"
import { useHarnesses } from "@banda/ui/hooks/use-harnesses"
import { seenNamed } from "@banda/ui/hooks/use-status"
import { stopNaming, useNaming } from "@banda/ui/lib/naming"
import { ThreadRows } from "../titles/ThreadMenu"
import { TitleField } from "../titles/Title"
import { Card } from "./CardView"
import { cardOf, type CardOf } from "./card"
import { machineOnRow } from "./machine-on-row"
import { HoldingContext, useHoldWhile } from "./useHold"

/** Where a Thread's card is drawn, and how: what its card is made of but
 * its machine, which is read here, and how it is drawn. */
type Placed = Omit<CardOf, "machine" | "away"> &
  Pick<ComponentProps<typeof Card>, "current" | "action">

/**
 * A Thread's card, with the Thread menu a right click opens (ADR 0077,
 * decision 5); its Rename… opens the field in the card itself. Another
 * host's has neither yet (`ElsewhereRow`), nor has one that left the tab
 * while the list held. The menu, while open, and the field hold the list
 * still, and what its Person does from the menu is their own act, which
 * the list draws at once where it takes the card elsewhere (ADR 0098,
 * decision 6).
 */
export function ThreadRow({
  engine,
  named,
  machines,
  ...placed
}: Placed & {
  engine: Engine
  /** A label above names its machine. */
  named: boolean
  /** How the machines are named (`[machines]` in `sidebar.toml`). */
  machines: Machines
}) {
  const { row, went } = placed
  const project = row.project.id
  const naming = useNaming(project, row.listed.id, "row")
  const harnesses = useHarnesses(engine)
  const [menu, setMenu] = useState(false)
  // A card that left takes its menu and its field with it, which say
  // nothing as it goes: the half-typed title is not kept, and neither
  // holds the list any more.
  const left = went !== undefined
  if (menu && left) setMenu(false)
  const renaming = naming !== null
  useEffect(() => {
    if (left && renaming) stopNaming()
  }, [left, renaming])
  useHoldWhile((menu || renaming) && !left)
  const holding = useContext(HoldingContext)
  // This machine, where the Person asked it named as the others are.
  const here = machineOnRow(useThisNamed(machines.thisToo), {
    rows: machines.rows,
    labelled: named,
  })
  if (row.host !== undefined)
    return <ElsewhereRow {...placed} named={named} rows={machines.rows} />
  const card = cardOf({ ...placed, ...(here ? { machine: here } : {}) })
  const drawn = (field?: ReactNode) => (
    <Card
      card={card}
      row={row}
      current={placed.current}
      action={placed.action}
      harnesses={harnesses}
      field={field}
    />
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
  return (
    <ContextMenu onOpenChange={setMenu}>
      <ContextMenuTrigger>{drawn()}</ContextMenuTrigger>
      <ContextMenuContent aria-label="Thread menu" className="min-w-60">
        <ThreadRows
          project={project}
          listed={row.listed}
          where="row"
          onAct={() => holding?.act(row)}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * Another host's Thread (ADR 0081): shown as this machine's are, and a
 * click opens it there, as the directory places its Project; with no menu
 * or put off yet, as the card's would go to this machine's engine. Where
 * no label above names its host, the card does; away or stopped, it dims
 * with its own words, its time standing as of when it was last heard.
 */
function ElsewhereRow({
  named,
  rows,
  ...placed
}: Placed & {
  /** A label above names its host. */
  named: boolean
  /** How another machine shows on its rows. */
  rows: MachineRows
}) {
  const { there, away, stopped } = useElsewhere(placed.row.host)
  const machine = machineOnRow(there, { rows, labelled: named })
  const card = cardOf({
    ...placed,
    ...(machine ? { machine } : {}),
    ...(away === undefined ? {} : { away }),
    ...(stopped ? { stopped } : {}),
  })
  const drawn = <Card card={card} row={placed.row} current={placed.current} />
  return !named && away !== undefined ? (
    <div className="opacity-45">{drawn}</div>
  ) : (
    drawn
  )
}

/** Another host's name and icon; as of when it was last heard, while the
 * Window does not reach it, away or stopped; and that it is stopped. */
function useElsewhere(host: string | undefined) {
  const machineOf = useCallback(
    (hosts: readonly Shown[]) =>
      host === undefined ? undefined : namedIn(hosts, host, seenNamed),
    [host]
  )
  const there = useHostsBy(machineOf, sameData)
  const shownOf = useCallback(
    (hosts: readonly Shown[]) => hosts.find((one) => one.name === host),
    [host]
  )
  const awayOf = useCallback(
    (hosts: readonly Shown[]) => {
      const one = shownOf(hosts)
      return one && awaySince(one)
    },
    [shownOf]
  )
  const stoppedOf = useCallback(
    (hosts: readonly Shown[]) => shownOf(hosts)?.state.state === "stopped",
    [shownOf]
  )
  const away = useHostsBy(awayOf)
  const stopped = useHostsBy(stoppedOf)
  return { there, away, stopped }
}
