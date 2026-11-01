/** The Harnesses this computer can start, as the Panes show them. */
import { useCallback } from "react"
import type { Engine, SpaceId } from "@bandaso/contract"
import type { HarnessView } from "@bandaso/contract/agents"
import { useRead } from "@bandaso/ui/hooks/use-read"

/** The machine's Harnesses, in the order its list names them; none yet
 * while they load. */
export function useHarnesses(engine: Engine, space: SpaceId): HarnessView[] {
  const read = useRead(
    useCallback(
      () => engine.call<HarnessView[]>("agents.harnesses", {}, { space }),
      [engine, space]
    )
  )
  return read.state === "ready" ? read.value : NONE
}

const NONE: HarnessView[] = []

/** A Harness's name, or its ID when this computer does not know it. */
export function harnessName(harnesses: HarnessView[], id: string): string {
  return harnesses.find((harness) => harness.id === id)?.name ?? id
}
