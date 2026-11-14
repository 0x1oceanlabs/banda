/**
 * The workspaces module's words for TypeScript: how this machine's Panes
 * are arranged, and the places a Pane goes (ADR 0025, decision 1). A
 * column's display is the look's `Display`.
 */
import { canonical, uuidV5 } from "./ids"
import { DEFAULT_WIDTHS, type ModuleFile } from "./look"
import type { Tiling } from "./generated/workspaces/Tiling"

export type { Arranged } from "./generated/workspaces/Arranged"
export type { Aside } from "./generated/workspaces/Aside"
export type { Changed } from "./generated/workspaces/Changed"
export type { Column } from "./generated/workspaces/Column"
export type { Flow } from "./generated/workspaces/Flow"
export type { Opens } from "./generated/workspaces/Opens"
export type { Rule } from "./generated/workspaces/Rule"
export type { Tiling } from "./generated/workspaces/Tiling"
export type { ColumnId } from "./generated/workspaces/ColumnId"
export type { Pane } from "./generated/workspaces/Pane"
export type { PaneId } from "./generated/workspaces/PaneId"
export type { Place } from "./generated/workspaces/Place"
export type { Side } from "./generated/workspaces/Side"
export type { Via } from "./generated/workspaces/Via"
export type { Workspace } from "./generated/workspaces/Workspace"
export type { WorkspaceId } from "./generated/workspaces/WorkspaceId"

/** How the Tiling behaves with no `tiling.toml`, as `banda look` gives
 * it: for before the first look. */
export const DEFAULT_TILING: Tiling = {
  flow: "row",
  columns: DEFAULT_WIDTHS,
  rules: {},
}

/** The Tiling's file, `tiling.toml`: the Flow, a column's widths, and the
 * rules by kind of Pane that the engine places by (ADR 0127, decision 4). */
export const TILING_FILE: ModuleFile<Tiling> = {
  name: "tiling.toml",
  before: DEFAULT_TILING,
}

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
