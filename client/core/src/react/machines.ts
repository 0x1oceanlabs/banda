/**
 * The machines a Window reaches, with their Projects, as a new Thread's
 * Project picker groups them (ADR 0095, decision 7): this machine first,
 * then each other machine of `hosts.toml` the Window shows. The Window
 * keeps them (`KeptHosts.machines`) and hands them down, in its root's
 * window and a popped-out Pane's alike; this holds no logic of its own.
 */
import { createContext, useContext } from "react"
import type { Machine } from "../hosts"

/** The Window's machines; none outside a Window, where a picker lists
 * its own engine's Projects. */
export const MachinesContext = createContext<readonly Machine[] | undefined>(
  undefined
)

/** The machines the Window reaches, drawn again as they change. */
export const useMachines = (): readonly Machine[] | undefined =>
  useContext(MachinesContext)
