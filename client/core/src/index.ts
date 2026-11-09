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
export { KeptHere } from "./kept-here"
export type { PaneState, Place } from "./pane"
export type { Args, Run } from "./run"
export { type Readable, sameData, sameEach, Store } from "./store"
