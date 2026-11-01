import { useEffect, useState } from "react"
import type { Engine, Status } from "@banda/contract"

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
