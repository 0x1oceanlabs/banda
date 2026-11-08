import { useEffect, useState } from "react"
import type { Engine, Fence, ProjectId, Status } from "@banda/contract"

/** The engine connection's status, kept current. */
export function useStatus(engine: Engine): Status {
  const [status, setStatus] = useState(engine.status)
  useEffect(() => engine.watch(setStatus), [engine])
  return status
}

/**
 * The modules the engine ran when it last answered. A connection that
 * breaks for a moment keeps them, so the Panes on the workspaces stay as they
 * are and follow on when it comes back.
 */
export function useModules(engine: Engine): readonly string[] {
  const [modules, setModules] = useState<readonly string[]>([])
  useEffect(
    () =>
      engine.watch((status) => {
        if (status.state !== "open") return
        setModules((was) =>
          was.join() === status.modules.join() ? was : status.modules
        )
      }),
    [engine]
  )
  return modules
}

/**
 * The ID this machine's modules are followed by, from when the engine
 * first named it; a connection that breaks keeps it, as the modules.
 */
export function useMachine(engine: Engine): ProjectId | undefined {
  const [machine, setMachine] = useState<ProjectId>()
  useEffect(
    () =>
      engine.watch((status) => {
        if (status.state === "open" && status.machine) {
          setMachine(status.machine)
        }
      }),
    [engine]
  )
  return machine
}

/** The fence of an engine that says none: one from before the fence,
 * which gets it as it starts again. */
const BEFORE_THE_FENCE: Fence = {
  fence: "missing",
  why: "not_built",
  words: "This engine is from before the fence.",
}

/**
 * Whether the fence around the engine's Harnesses holds, as the engine
 * last said (ADR 0083, decision 1): what a new Thread's mode follows. A
 * connection that breaks keeps it; none until the engine first answered.
 */
export function useFence(engine: Engine): Fence | undefined {
  const [fence, setFence] = useState<Fence>()
  useEffect(
    () =>
      engine.watch((status) => {
        if (status.state !== "open") return
        const now = status.fence ?? BEFORE_THE_FENCE
        setFence((was) =>
          JSON.stringify(was) === JSON.stringify(now) ? was : now
        )
      }),
    [engine]
  )
  return fence
}

/**
 * Whether `fence` holds whole, as the engine's `Fence::holds_whole` says:
 * with Landlock's scopes too, and for a user outside the `docker` group.
 * Only there is Full access the default, and an Agent in it not the
 * Person in Banda.
 */
export function holdsWhole(fence: Fence | undefined): boolean {
  return (
    fence?.fence === "holds" &&
    !fence.docker_group &&
    !hasGaps(fence) &&
    !hasLinks(fence)
  )
}

/** Whether some of the settings a fence that holds keeps from Agents are
 * links, which an Agent could point elsewhere: dotfiles kept as links. */
export function hasLinks(fence: Fence & { fence: "holds" }): boolean {
  return (fence.movable?.length ?? 0) > 0
}

/** Whether a fence that holds lacks Landlock's scopes, its second layer:
 * it has gaps. */
export function hasGaps(fence: Fence & { fence: "holds" }): boolean {
  return !fence.layers.includes("landlock")
}
