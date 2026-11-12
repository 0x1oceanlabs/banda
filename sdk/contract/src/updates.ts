/**
 * The updates module's words for TypeScript (ADR 0115): what a machine's
 * updates are, as its engine says them on `updates.state`, and what the
 * Person asks of them.
 */
export type { Moving } from "./generated/updates/Moving"
export type { Taking } from "./generated/updates/Taking"
export type { Updated } from "./generated/updates/Updated"
export type { UpdateState } from "./generated/updates/UpdateState"
export type { Waits } from "./generated/updates/Waits"

/** The stream of this machine's updates: its first piece is the
 * `UpdateState` it is now, and each after it the one it changed to. An
 * engine older than ADR 0115's step 3 refuses it. */
export const UPDATES_STATE = "updates.state"

/** Looks at this machine's channel now, as the Person asked; answers
 * the `UpdateState` it found. */
export const UPDATES_CHECK = "updates.check"
