import { useEffect, useMemo, useState } from "react"
import type { Engine } from "@banda/contract"
import type { AccountList, HarnessView, Setup } from "@banda/contract/harnesses"

type Setups = Readonly<Record<string, Setup>>
const NONE: Setups = {}

/**
 * The setups of `harnesses` as their machine's engine says them, each
 * followed while it changes (ADR 0140, decision 2); none yet for one whose
 * first answer has not come, and none from an engine that refuses it, as
 * one from before setups does. One asked before and still asked keeps its
 * last answer while the list changes.
 */
export function useSetups(
  engine: Engine,
  harnesses: readonly string[]
): Setups {
  const key = harnesses.join("\n")
  const [held, setHeld] = useState<{ engine: Engine; all: Setups }>()
  useEffect(() => {
    if (!key) return
    const put = (harness: string, setup: Setup | undefined) =>
      setHeld((now) => {
        const all = { ...(now?.engine === engine ? now.all : NONE) }
        if (setup) all[harness] = setup
        else delete all[harness]
        return { engine, all }
      })
    const stops = key.split("\n").map((harness) =>
      engine.stream(
        undefined,
        "harnesses.setup_watch",
        { harness },
        // An engine from before `ready` says none: as one that refuses.
        // Remove once no machine runs an engine from before it.
        (next) => typeof next.ready === "boolean" && put(harness, next),
        // Ended or refused, it is not said again.
        () => put(harness, undefined)
      )
    )
    return () => stops.forEach((stop) => stop())
  }, [engine, key])
  return useMemo(() => {
    if (held?.engine !== engine || !key) return NONE
    const asked = key.split("\n").filter((harness) => held.all[harness])
    return Object.fromEntries(asked.map((one) => [one, held.all[one]!]))
  }, [held, engine, key])
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
 * 6): one for each Harness Banda can set up, while no entry on the machine
 * is ready, and while a row's sheet is open, so the one that made its
 * Harness ready can say so. None otherwise. Only the entry the Thread
 * starts on is asked until that one is found not ready; then every entry
 * that is on, as a second account may be the one signed in.
 */
export function useConnect(
  engine: Engine,
  startsOn: string | undefined,
  list: AccountList | undefined
): { rows: SetupRowOf[]; onSheet: (open: boolean) => void } | undefined {
  const [sheet, setSheet] = useState(false)
  const own = useSetup(engine, startsOn)
  const watching = sheet || own?.ready === false
  const ids = useMemo(
    () =>
      watching
        ? (list?.accounts ?? []).filter((one) => one.enabled).map((o) => o.id)
        : [],
    [watching, list]
  )
  const all = useSetups(engine, ids)
  // What the Person did elsewhere, an install or a sign-in in a terminal,
  // is found when they come back: asked, the engine tells its watchers.
  useEffect(() => {
    if (ids.length === 0) return
    const again = () =>
      ids.forEach((harness) => {
        engine.call("harnesses.setup", { harness }).catch(() => {})
      })
    window.addEventListener("focus", again)
    return () => window.removeEventListener("focus", again)
  }, [engine, ids])
  if (!list || ids.length === 0 || ids.some((id) => !all[id])) return undefined
  if (!sheet && ids.some((id) => all[id]!.ready)) return undefined
  // A row for each Harness: its first entry that is on.
  const rows = list.harnesses.flatMap((harness) => {
    const account = list.accounts.find(
      (one) => one.harness === harness.id && one.enabled
    )
    const setup = account && all[account.id]
    return setup && setup.steps.length > 0 ? [{ account, setup }] : []
  })
  return rows.length > 0 ? { rows, onSheet: setSheet } : undefined
}
