/**
 * The machines module's words for TypeScript (ADR 0095): what a machine is
 * called and drawn by, as its engine says it in its welcome
 * (`Status.named`), in `machines.get`, and on `MACHINE_NAMED` as it
 * changes. The settings' `set` changes it, in `machine.toml`.
 */
export type { MachineIcon } from "./generated/MachineIcon"
export type { Named } from "./generated/Named"
export type { Naming } from "./generated/machines/Naming"

/** The stream of this machine's name and icon: a stream of the machine's,
 * which names no Project. Its first piece is the `Named` it is now, and
 * each after it the `Named` it changed to. */
export const MACHINE_NAMED = "machine.named"
