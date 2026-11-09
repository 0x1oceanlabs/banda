/**
 * The core every client shares (ADR 0089, decision 1): TypeScript with no
 * DOM and no device, which names no App. What reads it from React is
 * `@banda/core/react`.
 */
export {
  type HostEntry,
  type HostState,
  type HostTest,
  type Note,
  type PoppedAsk,
  type Update,
  follow,
  poppedOf,
  poppedRoute,
} from "./device"
export type { Here, HereStore } from "./here"
export {
  awayFor,
  emptyIn,
  holds,
  hostOfPane,
  type HostsDevice,
  KeptHosts,
  keyNamed,
  liveIn,
  type Machine,
  machinesOf,
  namedIn,
  type Names,
  otherBuild,
  type Ours,
  ownItem,
  reachWords,
  runOnHost,
  type Shown,
  shownOf,
} from "./hosts"
export { KeptHere } from "./kept-here"
export { paneHost, type PaneState, type Place, withHost } from "./pane"
export { openProjects, shownProjects } from "./projects"
export type { Args, Run } from "./run"
export { type Readable, sameData, sameEach, Store } from "./store"
