/**
 * The core every client shares (ADR 0089, decision 1): TypeScript with no
 * DOM and no device, which names no App. What reads it from React is
 * `@banda/core/react`.
 */
export {
  type Cap,
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
  agentsWork,
  awakeWords,
  awayFor,
  batteryWords,
  cleanPower,
  emptyIn,
  FORGETTING,
  heldWords,
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
  onBattery,
  otherBuild,
  type Ours,
  reachWords,
  type Shown,
  shownOf,
  Unreachable,
} from "./hosts"
export { KeptHere } from "./kept-here"
export { paneHost, type PaneState, type Place, withHost } from "./pane"
export { openProjects, shownProjects } from "./projects"
export {
  type Act,
  type Device,
  deviceFor,
  type From,
  type Hosts,
  type Owner,
  type Route,
  routeAct,
} from "./route"
export type { Args, Run } from "./run"
export { type Readable, sameData, sameEach, Store } from "./store"
