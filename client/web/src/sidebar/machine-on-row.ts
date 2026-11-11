/**
 * What a row is given of the machine it names (ADR 0095, decisions 4 to
 * 6, and `[machines]` in `sidebar.toml`): the one place that says it, for
 * another machine's rows and this one's, so `off` simply gives a card no
 * machine on any of its lines, and `icon` its icon alone on each.
 */
import type { Named } from "@banda/contract/machines"
import type { MachineRows } from "@banda/contract/sidebar"

/** A machine as a row names it: its compact form, or its icon `alone`. */
export type OnRow = Named & { alone?: boolean }

/** The machine a row names: `named`, another machine's or this one's
 * where it is named (`thisNamed`); none under a label, which says it
 * (decision 6). */
export function machineOnRow(
  named: Named | undefined,
  { rows, labelled }: { rows: MachineRows; labelled: boolean }
): OnRow | undefined {
  if (!named || labelled || rows === "off") return undefined
  return rows === "icon" ? { ...named, alone: true } : named
}
