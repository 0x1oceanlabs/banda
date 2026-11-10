/**
 * The workspaces module's words for TypeScript: how this machine's Panes
 * are arranged, and the places a Pane goes (ADR 0025, decision 1). A
 * column's display is the look's `Display`.
 */
import { canonical, uuidV5 } from "./ids"

export type { Arranged } from "./generated/workspaces/Arranged"
export type { Aside } from "./generated/workspaces/Aside"
export type { Changed } from "./generated/workspaces/Changed"
export type { Column } from "./generated/workspaces/Column"
export type { ColumnId } from "./generated/workspaces/ColumnId"
export type { Pane } from "./generated/workspaces/Pane"
export type { PaneId } from "./generated/workspaces/PaneId"
export type { Place } from "./generated/workspaces/Place"
export type { Side } from "./generated/workspaces/Side"
export type { Workspace } from "./generated/workspaces/Workspace"
export type { WorkspaceId } from "./generated/workspaces/WorkspaceId"

/** What a workspaces command makes, each at most once; `bottom N`, the
 * `N`th of the new empty workspaces one makes one after another, as
 * `workspaces.arrange` does (`Seed::nth`). */
export type Made =
  "pane" | "column" | "group" | "workspace" | "bottom" | `bottom ${number}`

/** Fixed for good, as `MADE` in `model.rs`. */
const MADE = "63bdd961-aad0-4575-bfc1-5f1d352969ad"

/**
 * The ID a command whose seed is `seed`, its CommandId, gives what it
 * makes, as `Seed` derives it in the engine (ADR 0088, decision 11): the
 * client that sends it knows the ID before the answer.
 */
export function seeded(seed: string, made: Made): string {
  return uuidV5(uuidV5(MADE, canonical(seed)), made)
}
