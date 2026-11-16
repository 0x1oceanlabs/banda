/**
 * A tap on a push opens what it told of (ADR 0124, decision 10; SE7): the
 * machine that pushed says where in the page the tap goes (`Pushed.to`),
 * `#go/<what>`, with the Project and the Pane to go to, as `pane.pick`
 * takes them, in base64url. The page knows no App by it: the machine
 * names the Pane, as a notice's button carries its own. The page reads it
 * in its own address as it starts, where the worker opened it, and in the
 * worker's word where the page was open already (`sw.js`).
 *
 * It waits until the window knows which machine has the Project, so the
 * Pane opens there: a machine it reaches a moment after it starts has
 * said so by then.
 */
import { bytesOf, type ProjectSummary } from "@banda/contract"
import type { Args } from "@banda/ui/module"
import { useRun } from "@banda/core/react"
import { useEffect, useRef, useState } from "react"
import { DIRECTORY } from "../directory"

/** Where a push's tap goes: what `pane.pick` takes, of the Project named
 * apart. */
type Told = { project: string; pick: Args }

/** Where `to` says a push's tap goes; none for anything else, as the
 * page's own address most often is. */
export function toldOf(to: unknown): Told | undefined {
  const said = typeof to === "string" && /#go\/([\w-]{1,4096})$/.exec(to)?.[1]
  if (!said) return undefined
  try {
    const pick: unknown = JSON.parse(new TextDecoder().decode(bytesOf(said)))
    const project = (pick as { project?: unknown } | null)?.project
    return typeof project === "string"
      ? { project, pick: pick as Args }
      : undefined
  } catch {
    return undefined
  }
}

export function PushTap({ projects }: { projects: readonly ProjectSummary[] }) {
  const run = useRun()
  const [told, setTold] = useState(() => toldOf(location.hash))
  useEffect(() => {
    const worker = navigator.serviceWorker as ServiceWorkerContainer | undefined
    if (!worker) return
    const hear = (said: MessageEvent) => {
      const told = toldOf((said.data as { to?: unknown } | null)?.to)
      if (told) setTold(told)
    }
    worker.addEventListener("message", hear)
    return () => worker.removeEventListener("message", hear)
  }, [])
  const placed = DIRECTORY.use()
  const known =
    told !== undefined &&
    (projects.some((one) => one.id === told.project) || told.project in placed)
  // The one it went to: each is gone to once.
  const went = useRef<Told>(undefined)
  useEffect(() => {
    if (!told || !known || went.current === told) return
    went.current = told
    // A page reloaded after it goes nowhere again.
    if (toldOf(location.hash))
      history.replaceState(null, "", location.pathname + location.search)
    run("pane.pick", told.pick)
  }, [told, known, run])
  return null
}
