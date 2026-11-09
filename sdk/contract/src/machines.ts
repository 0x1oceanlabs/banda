/**
 * The machines module's words for TypeScript (ADR 0095): what a machine is
 * called and drawn by, as its engine says it in its welcome
 * (`Status.named`), in `machines.get`, and on `MACHINE_NAMED` as it
 * changes; and when it stays awake, in `machines.get` (ADR 0097). The
 * settings' `set` changes them, in `machine.toml`. Its battery, and why it
 * is held awake now, `MACHINE_POWER` says.
 */
export type { Awake } from "./generated/machines/Awake"
export type { AwakeWhy } from "./generated/machines/AwakeWhy"
export type { Battery } from "./generated/machines/Battery"
export type { MachineIcon } from "./generated/MachineIcon"
export type { Named } from "./generated/Named"
export type { Naming } from "./generated/machines/Naming"
export type { Power } from "./generated/machines/Power"

/** The stream of this machine's name and icon: a stream of the machine's,
 * which names no Project. Its first piece is the `Named` it is now, and
 * each after it the `Named` it changed to. */
export const MACHINE_NAMED = "machine.named"

/** The stream of this machine's battery and why it is held awake (ADR
 * 0097): a stream of the machine's, which names no Project. Its first
 * piece is the `Power` it is now, and each after it the `Power` it changed
 * to, as a word of it would change. The engine reads the battery only
 * while one hears it. An engine older than it refuses it. */
export const MACHINE_POWER = "machine.power"
