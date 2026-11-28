import { useEffect, useMemo, useState } from "react"
import type { Engine } from "@banda/contract"
import type { AccountList, HarnessView, Setup } from "@banda/contract/harnesses"

const NONE: Readonly<Record<string, Setup>> = {}

/**
 * The setups of `harnesses` as their machine's engine says them, each
 * followed while it changes (ADR 0140, decision 2); none yet for one whose
 * first answer has not come, and none from an engine that refuses it, as
 * one from before setups does.
 */
export function useSetups(
  engine: Engine,
  harnesses: readonly string[]
): Readonly<Record<string, Setup>> {
  const key = harnesses.join("\n")
  const [held, setHeld] = useState<{
    engine: Engine
    key: string
    all: Readonly<Record<string, Setup>>
  }>()
  useEffect(() => {
    if (!key) return
    const stops = key.split("\n").map((harness) =>
      engine.stream(
        undefined,
        "harnesses.setup_watch",
        { harness },
        (next) =>
          setHeld((now) => ({
            engine,
            key,
            all: {
              ...(now?.engine === engine && now.key === key ? now.all : NONE),
              [harness]: next,
            },
          })),
        () => {}
      )
    )
    return () => stops.forEach((stop) => stop())
  }, [engine, key])
  return held?.engine === engine && held.key === key ? held.all : NONE
}

/** One Harness's setup; `undefined` asks nothing. */
export function useSetup(
  engine: Engine,
  harness: string | undefined
): Setup | undefined {
  const one = useMemo(() => (harness ? [harness] : []), [harness])
  const all = useSetups(engine, one)
  return harness ? all[harness] : undefined
}

/** A Harness's first entry and its setup, as a row draws them. */
export type SetupRowOf = { account: HarnessView; setup: Setup }

/**
 * The rows a new Thread shows in place of its phrase (ADR 0140, decision
 * 6): one for each Harness Banda can set up, while none on the machine is
 * ready, and while a row's sheet is open, so the one that made its Harness
 * ready can say so. None otherwise. Only the entry the Thread starts on is
 * asked until that one is found not ready.
 */
export function useConnect(
  engine: Engine,
  startsOn: string | undefined,
  list: AccountList | undefined
): { rows: SetupRowOf[]; onSheet: (open: boolean) => void } | undefined {
  const [sheet, setSheet] = useState(false)
  const own = useSetup(engine, startsOn)
  const firsts = useMemo(
    () =>
      (list?.harnesses ?? []).flatMap((harness) => {
        const first = list!.accounts.find(
          (one) => one.harness === harness.id && one.enabled
        )
        return first ? [first] : []
      }),
    [list]
  )
  const watching = sheet || (own !== undefined && !own.ready)
  const ids = useMemo(
    () => (watching ? firsts.map((one) => one.id) : []),
    [watching, firsts]
  )
  const all = useSetups(engine, ids)
  if (!watching || ids.some((id) => !all[id])) return undefined
  if (!sheet && ids.some((id) => all[id]!.ready)) return undefined
  const rows = firsts
    .map((account) => ({ account, setup: all[account.id]! }))
    .filter((row) => row.setup.steps.length > 0)
  return rows.length > 0 ? { rows, onSheet: setSheet } : undefined
}
