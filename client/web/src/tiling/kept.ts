/**
 * The Tiling as what the Window draws reads it (ADR 0087, decision 11):
 * its workspaces as it draws them, by selector, its port of what the Apps
 * list of its Panes, the workspaces set aside, and the Flow this device
 * shows. The Window's `Kept`
 * gives them, beside the items, the calls and Here, so the Tiling's
 * widgets on the Bar are given the engine and the Projects alone, as
 * every widget is, and act by an action's id (`useRun`). A part that
 * reads the workspaces so is drawn again only as what it selects changes,
 * not on each key that moves the focus.
 */
import type { Aside, Flow } from "@banda/contract/workspaces"
import { type Readable, useStore } from "@banda/core/react"
import { createContext, useContext } from "react"
import type { Workspaces } from "./model"
import { WAITING } from "./unheard"

/** What the Window gives of its Tiling to what it draws. */
export type Tiled = {
  /** The workspaces as the Tiling draws them (`useTiling`), solo and
   * all, which only the Tiling changes. */
  store: Readable<Workspaces>
  /** The workspaces set aside, while they are (ADR 0039, decision 2). */
  aside: Aside | null
  /** The Flow as this device shows it (`flow.ts`): tiling.toml's, and
   * the device's own Solo. */
  flow: Flow
}

/** The workspaces as the Tiling draws them. Where no Window gives them,
 * as in a test, those it draws while it reads the arrangement. */
export const TilingContext = createContext<Readable<Workspaces>>({
  get: () => WAITING,
  subscribe: () => () => {},
})

/** The workspaces set aside, while they are: none where no Window says
 * so. */
export const AsideContext = createContext<Aside | null>(null)

/** The Flow as this device shows it: the row where no Window says. */
export const FlowContext = createContext<Flow>("row")

/** The Flow as this device shows it (`flow.ts`). */
export function useFlow(): Flow {
  return useContext(FlowContext)
}

/**
 * `select` of the workspaces as the Tiling drew them last, drawn again
 * only as what it selects changes, as `equal` tells, by default when it
 * is another value: a selection made afresh each time, as `pagerStateOf`'s, is
 * told by `sameData`. A `select` made once, not at each drawing, spares
 * React a read.
 */
export function useTiled<S>(
  select: (workspaces: Workspaces) => S,
  equal?: (a: S, b: S) => boolean
): S {
  return useStore(useContext(TilingContext), select, equal)
}
