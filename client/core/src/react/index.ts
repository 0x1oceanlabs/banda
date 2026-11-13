/**
 * The core as React reads it (ADR 0089, decision 1): all of `@banda/core`,
 * and the hooks and contexts that read it, which depend on `react` alone.
 * An App's view imports the core only from here (decision 11).
 */
export * from "../index"
export { HereContext, useHere } from "./here"
export {
  HostsContext,
  type Reach,
  useAnyHost,
  useAwayFor,
  useEngineOf,
  useHereNamed,
  useHosts,
  useHostsBy,
  useMachinesOf,
  useNamedOf,
  useNowOf,
  useOurs,
  usePaneOn,
  usePlaced,
  useReach,
  useShownNow,
  useShownOf,
  useThisNamed,
  useWrittenFrom,
} from "./hosts"
export { MachinesContext, useMachines } from "./machines"
export { RunContext, useRun } from "./run"
export { useSelected, useStore } from "./store"
export {
  useLeftFor,
  useQueue,
  useWaiting,
  useWaitingFor,
  useWaitsOn,
} from "./waiting"
