/**
 * The Harnesses this computer can start, and who is signed in to each, as
 * the Panes show them: the machine's module `harnesses` (ADR 0040), which
 * names no Space.
 */
import { useCallback, useMemo } from "react"
import type { Engine } from "@banda/contract"
import type { Accounted, HarnessView } from "@banda/contract/harnesses"
import {
  type Live,
  READ_AGAIN,
  type Source,
  useMachineLive,
} from "@banda/ui/hooks/use-live"
import { useRead } from "@banda/ui/hooks/use-read"

/** The machine's Harnesses, in the order its list names them; none yet
 * while they load. */
export function useHarnesses(engine: Engine): HarnessView[] {
  const read = useRead(
    useCallback(() => engine.call("harnesses.list", {}), [engine])
  )
  return read.state === "ready" ? read.value : NONE
}

const NONE: HarnessView[] = []

/**
 * Who is signed in to `harness`, which asks it, so starts it if need be.
 * It is read again as the machine says its account changed, a sign-in or
 * sign-out anywhere, and at each new `round`, a Person's "check again".
 */
export function useAccount(
  engine: Engine,
  harness: string,
  round = 0
): Live<Accounted> {
  const source = useMemo<Source<Accounted>>(
    () => ({
      read: () => engine.call("harnesses.account", { harness }),
      filter: {
        module: "harnesses",
        subject: harness,
        kinds: ["account_changed"],
      },
      apply: () => READ_AGAIN,
    }),
    [engine, harness]
  )
  return useMachineLive(engine, source, round)
}

/** A Harness's name, or its ID when this computer does not know it. */
export function harnessName(harnesses: HarnessView[], id: string): string {
  return harnesses.find((harness) => harness.id === id)?.name ?? id
}
