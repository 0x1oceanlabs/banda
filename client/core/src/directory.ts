/**
 * The directory (ADR 0106, decision 1): which machine has each Project, as
 * this device last found it, so a Pane goes to its Project's machine by
 * its Project alone, and one restored while that machine is away still
 * goes there and says so, never to this machine in its place. A Project,
 * by its ID, is kept with its machine's ID, its Host scope's as its
 * engine's welcome says it (`welcome.machine`, a stand-in for ADR 0082
 * decision 15's `Host(key)` until pairing), and the key this device
 * reaches that machine by in `hosts.toml`, none for this window's own.
 * The Window's hosts learn it from what each machine lists (`KeptHosts`),
 * and the Window hands in the memory the device keeps it in, as it does
 * the hosts' names: the view is each device's (ADR 0081, decision 1).
 * Nothing kept here is a route the Person shares: it is this device's
 * cache, and what each machine lists now wins over it.
 */
import type { ProjectId } from "@banda/contract"

/** Where a Project is, as this device found it last: its machine's ID,
 * where its engine said one, and that machine's key in `hosts.toml`,
 * none for this window's own machine. */
export type Placed = { machine?: ProjectId; host?: string }

/** The memory a device keeps the directory in, by ProjectId: every window
 * on the device shares it, so a popped-out Pane's finds what the main
 * window learned. */
export type DirectoryMemory = {
  /** Each Project's place, as kept now. */
  read: () => Readonly<Record<string, Placed>>
  /** Keeps `placed` for `project`. */
  put: (project: string, placed: Placed) => void
}

/** Whether a kept value is a place: anything else a device kept is
 * dropped as it is read. */
export function isPlaced(value: unknown): value is Placed {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false
  const { machine, host } = value as Record<string, unknown>
  return (
    (machine === undefined || typeof machine === "string") &&
    (host === undefined || typeof host === "string")
  )
}

/** A directory kept in this window's memory alone, as where no Window
 * keeps one: it is gone with the window. */
export function inWindow(): DirectoryMemory {
  const kept: Record<string, Placed> = {}
  return {
    read: () => kept,
    put: (project, placed) => {
      kept[project] = placed
    },
  }
}
