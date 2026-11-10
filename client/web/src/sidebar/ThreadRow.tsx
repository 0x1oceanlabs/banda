import {
  type ComponentProps,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import type { Engine } from "@banda/contract"
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
} from "@banda/core/react"
import { useHarnesses } from "@banda/ui/hooks/use-harnesses"
import { seenNamed } from "@banda/ui/hooks/use-status"
import { stopNaming, useNaming } from "@banda/ui/lib/naming"
import { ThreadRows } from "../titles/ThreadMenu"
import { TitleField } from "../titles/Title"
import type { Row as Arranged } from "./arrange"
import { Row } from "./Row"
import type { Settings } from "./settings"
import { HoldingContext, useHoldWhile } from "./useHold"

/**
 * A Thread's row, with the Thread menu a right click opens (ADR 0077,
 * decision 5); its Rename… opens the field in the row itself. Another
 * host's has neither yet (`ElsewhereRow`), nor has one that left the tab
 * while the list held. The menu, while open, and the field hold the list
 * still, and what its Person does from the menu is their own act, which
 * the list draws at once where it takes the card elsewhere (ADR 0098,
 * decision 6).
 */
export function ThreadRow({
  engine,
  row,
  named,
  ...props
}: Omit<ComponentProps<typeof Row>, "field" | "machine" | "stillAt"> & {
  engine: Engine
  /** A label above names its host, when it is another host's. */
  named: boolean
}) {
  const project = row.project.id
  const naming = useNaming(project, row.listed.id, "row")
  const harnesses = useHarnesses(engine)
  const [menu, setMenu] = useState(false)
  // A card that left takes its menu and its field with it, which say
  // nothing as it goes: the half-typed title is not kept, and neither
  // holds the list any more.
  const gone = props.gone !== undefined
  if (menu && gone) setMenu(false)
  const renaming = naming !== null
  useEffect(() => {
    if (gone && renaming) stopNaming()
  }, [gone, renaming])
  useHoldWhile((menu || renaming) && !gone)
  const holding = useContext(HoldingContext)
  if (row.host !== undefined)
    return (
      <ElsewhereRow
        row={row}
        settings={props.settings}
        inProject={props.inProject}
        current={props.current}
        named={named}
        gone={props.gone}
      />
    )
  if (props.gone !== undefined)
    return <Row row={row} {...props} harnesses={harnesses} />
  if (naming)
    return (
      <Row
        row={row}
        {...props}
        harnesses={harnesses}
        field={
          <TitleField
            project={project}
            listed={row.listed}
            naming={naming}
            className="-my-0.5 -ml-1.5 h-6 text-sm"
          />
        }
      />
    )
  return (
    <ContextMenu onOpenChange={setMenu}>
      <ContextMenuTrigger>
        <Row row={row} {...props} harnesses={harnesses} />
      </ContextMenuTrigger>
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
 * or put off yet, as the row's would go to this machine's engine. Where no
 * label above names its host, the row does; away or stopped, it dims
 * with its own words, its timer and how long ago standing.
 */
function ElsewhereRow({
  row,
  settings,
  inProject,
  current,
  named,
  gone,
}: {
  row: Arranged
  settings: Settings
  inProject: boolean
  current: boolean
  /** A label above names its host. */
  named: boolean
  /** It left the tab while the list held: where it went. */
  gone?: string
}) {
  const { host } = row
  const machineOf = useCallback(
    (hosts: readonly Shown[]) =>
      named || host === undefined ? undefined : namedIn(hosts, host, seenNamed),
    [named, host]
  )
  const machine = useHostsBy(machineOf, sameData)
  // As of when its host was last heard, while the Window does not reach
  // it, away or stopped.
  const awayOf = useCallback(
    (hosts: readonly Shown[]) => {
      const one = hosts.find((shown) => shown.name === host)
      return one && awaySince(one)
    },
    [host]
  )
  const away = useHostsBy(awayOf)
  const drawn = (
    <Row
      row={row}
      settings={settings}
      inProject={inProject}
      current={current}
      machine={machine}
      stillAt={away}
      gone={gone}
    />
  )
  return !named && away !== undefined ? (
    <div className="opacity-45">{drawn}</div>
  ) : (
    drawn
  )
}
