/**
 * A Pane that leaves every workspace lets its module let go, as a
 * terminal stops its program; one moved, or drawn still, has not left.
 */
import { useEffect, useRef } from "react"
import type { KeptHosts } from "@banda/core"
import type { useEngineOf } from "@banda/core/react"
import { closedOf, identityOf, keptAway } from "../registry"
import { left, type Workspaces } from "../tiling/model"

export function useLetsGo(
  standing: Workspaces,
  engineOf: ReturnType<typeof useEngineOf>,
  kept: KeptHosts
): void {
  const before = useRef(standing)
  useEffect(() => {
    for (const entry of left(before.current, standing, identityOf))
      closedOf(
        () => engineOf(entry.project, entry.pane),
        entry,
        keptAway(kept, entry)
      )
    before.current = standing
  }, [engineOf, kept, standing])
}
