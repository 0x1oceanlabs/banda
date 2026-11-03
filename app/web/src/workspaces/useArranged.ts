import { useMemo } from "react"
import type { Engine } from "@banda/contract"
import { useLive } from "@banda/ui/hooks/use-live"
import { useMachine } from "@banda/ui/hooks/use-status"
import { arrangedSource } from "./arrange"

/** The engine's arrangement, live (ADR 0025): read once, then kept
 * current by the module's events. */
export function useArranged(engine: Engine) {
  const machine = useMachine(engine)
  const source = useMemo(
    () => (machine ? arrangedSource(engine) : null),
    [engine, machine]
  )
  return useLive(engine, machine ?? "", source)
}
