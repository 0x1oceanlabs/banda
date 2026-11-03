import { useMemo } from "react"
import type { Engine } from "@banda/contract"
import { useMachineLive } from "@banda/ui/hooks/use-live"
import { arrangedSource } from "./arrange"

/** The engine's arrangement, live (ADR 0025): read once, then kept
 * current by the module's events. */
export function useArranged(engine: Engine) {
  const source = useMemo(() => arrangedSource(engine), [engine])
  return useMachineLive(engine, source)
}
