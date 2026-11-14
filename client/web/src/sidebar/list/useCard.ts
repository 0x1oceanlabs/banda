import { useCallback } from "react"
import type { Machines } from "@banda/contract/sidebar"
import {
  awaySince,
  namedIn,
  sameData,
  type Shown,
  useHostsBy,
  useThisNamed,
} from "@banda/core/react"
import { seenNamed } from "@banda/ui/hooks/use-status"
import { type CardModel, cardOf, type CardOf } from "../cards/model"
import { machineOnRow } from "../model/machine-on-row"

/** What of a card its machine says, as the Window's hosts show it. */
type Machine = Pick<CardOf, "machine" | "away" | "stopped">

/**
 * The card `placed` makes (`cardOf`), on whichever machine its Thread is
 * (ADR 0098, decision 18), named as `machineOnRow` gives it from
 * `machines`, `[machines]` in `sidebar.toml`: none where a label above
 * names it (`named`); this machine's only where the Person asked it named
 * as the others are. Another's, while the Window does not reach it, away
 * or stopped, stands as of when it was last heard. It is drawn again only
 * as what it says of the machine changes.
 */
export function useCard(
  placed: Omit<CardOf, keyof Machine>,
  { named, machines }: { named: boolean; machines: Machines }
): CardModel {
  const host = placed.row.host
  const { rows, thisToo } = machines
  const here = machineOnRow(useThisNamed(thisToo), { rows, labelled: named })
  const machineOf = useCallback(
    (hosts: readonly Shown[]): Machine => {
      if (host === undefined) return {}
      const shown = hosts.find((one) => one.name === host)
      const machine = machineOnRow(namedIn(hosts, host, seenNamed), {
        rows,
        labelled: named,
      })
      const away = shown && awaySince(shown)
      return {
        ...(machine ? { machine } : {}),
        ...(away === undefined ? {} : { away }),
        ...(shown?.state.state === "stopped" ? { stopped: true } : {}),
      }
    },
    [host, named, rows]
  )
  const there = useHostsBy(machineOf, sameData)
  return cardOf({
    ...placed,
    ...(host === undefined && here ? { machine: here } : {}),
    ...there,
  })
}
