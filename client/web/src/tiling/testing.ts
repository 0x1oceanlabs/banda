/**
 * The Window's hosts as the router reads them (`Hosts`), for the tests of
 * what goes through it: this machine with its Project "mine" and its Host
 * scope m0, and arc, live, with "r1" and its Host scope m1. For tests
 * alone: the router's own tests, over the real `KeptHosts`, are the core's
 * (`client/core/src/route.test.ts`).
 */
import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Hosts, Machine, Shown } from "@banda/core"

/** arc's Project, and this machine's. */
export const R1 = "r1" as ProjectId
export const MINE = "mine" as ProjectId

/** A Pane of arc's "r1", where its args name arc, as its Frame keeps it. */
export const ON_ARC = { project: R1, pane: { args: { host: "arc" } } }

/**
 * The hosts with arc's engine open, its welcome listing `modules`; none
 * before it said. This machine wins an ID both have, and a Project arc's
 * Pane names is arc's.
 */
export function arcHosts(modules: readonly string[] | undefined): Hosts {
  const arc = {
    name: "arc",
    named: { name: "arc", icon: "server" },
    state: { name: "arc", ssh: "arc", state: "live" },
    projects: [{ id: R1 } as ProjectSummary],
  } as unknown as Shown
  const machines: Machine[] = [
    { machine: "m0" as ProjectId, state: "live", projects: [] },
    { host: "arc", machine: "m1" as ProjectId, state: "live", projects: [] },
  ]
  return {
    get: () => [arc],
    hostOf: (project, named) =>
      project === MINE
        ? undefined
        : (named ?? (project === R1 ? "arc" : undefined)),
    seen: (name) => ({ name, icon: "server" }),
    machines: { get: () => machines, subscribe: () => () => undefined },
    modulesOf: (name) => (name === "arc" ? modules : undefined),
  }
}
