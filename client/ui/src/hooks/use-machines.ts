/**
 * The machines a Window reaches, with their Projects, as a new Thread's
 * Project picker groups them (ADR 0095, decision 7): this machine first,
 * then each other machine of `hosts.toml` the Window shows. The Window
 * keeps them and hands them down; this holds no logic of its own.
 */
import { createContext, useContext } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"

/** A machine as a new Thread picks where it starts. */
export type Machine = {
  /** Its key in `hosts.toml`, a Pane's `args.host`; none for this machine. */
  host?: string
  /** Its name and icon, cleaned (ADR 0095, decision 2); none for this
   * machine, which goes unnamed (decision 4). */
  named?: Named
  /** Its Host scope's ID, where a Thread in its No Project starts; none
   * until its engine first said it. */
  machine?: ProjectId
  /** Whether the Window reaches it now, or shows it as it was. */
  state: "live" | "away"
  /** Since when it is away, in ms since the epoch. */
  away?: number
  /** Its Projects a Thread starts in, pinned first: none archived, none
   * whose folder is missing, none a Thread's own. */
  projects: readonly ProjectSummary[]
}

/** The Window's machines; none outside a Window, as in a window of its
 * own, where a picker lists its own engine's Projects. */
export const MachinesContext = createContext<readonly Machine[] | undefined>(
  undefined
)

/** The machines the Window reaches, drawn again as they change. */
export const useMachines = (): readonly Machine[] | undefined =>
  useContext(MachinesContext)
