import { useCallback } from "react"
import type { Engine } from "@banda/contract"
import type { HarnessView } from "@banda/contract/harnesses"
import { useRead } from "./use-read"

const NONE: HarnessView[] = []

/** The Harnesses this machine can run, in the order its list names them
 * (the machine's module `harnesses`, ADR 0040); none yet while they
 * load. */
export function useHarnesses(engine: Engine): HarnessView[] {
  const read = useRead(
    useCallback(() => engine.call("harnesses.list", {}), [engine])
  )
  return read.state === "ready" ? read.value : NONE
}
