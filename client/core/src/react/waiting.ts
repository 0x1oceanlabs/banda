/**
 * What waits for another machine, from React (ADR 0105): the Window's
 * queue (`KeptHosts.waiting`), each part reading the messages it shows,
 * drawn again only as they change. An App reads them by its Pane, never
 * by where the Pane is (ADR 0106, law 6); the Window, which shows the
 * machines, by machine.
 */
import { useCallback, useContext } from "react"
import type { ProjectId, Status } from "@banda/contract"
import type { Leaving } from "../left"
import { waitedName } from "../hosts"
import { HERE, paneHost, type PaneState } from "../pane"
import { type Queue, type Wait, waitsFor } from "../queue"
import { sameEach } from "../store"
import { HostsContext, useMachineOf } from "./hosts"
import { useStore } from "./store"

const NONE: readonly Wait[] = []

/** The Window's queue (ADR 0105), for an App to queue a message for its
 * Pane while that Pane's machine is away, change or take back one, and
 * hear one that comes back. */
export function useQueue(): Queue {
  return useContext(HostsContext).waiting
}

/** The waits `pick` picks, in the order queued; none as `NONE`, so a part
 * drawn again with none draws nothing new. */
function useWaitingBy(pick: (wait: Wait) => boolean): readonly Wait[] {
  const select = useCallback(
    (waits: readonly Wait[]) => {
      const these = waits.filter(pick)
      return these.length === 0 ? NONE : these
    },
    [pick]
  )
  return useStore(useContext(HostsContext).waiting, select, sameEach)
}

/**
 * The messages that wait to Item `item` of Project `project`, in the order
 * queued, as the Pane that shows it reads them: a Thread its own. None for
 * no Item, as a Thread not started yet has. Whichever machine they wait
 * for, the Pane does not ask.
 */
export function useWaiting(
  project: ProjectId,
  item: string | null
): readonly Wait[] {
  const pick = useCallback(
    (wait: Wait) => wait.project === project && wait.item === item,
    [project, item]
  )
  return useWaitingBy(pick)
}

/**
 * The messages this device has waiting for host `host`, in the order
 * queued, as the Window reads them, which shows the machines: its pill
 * counts them all (ADR 0105, Q3), and a Frame reads those to the Item it
 * shows, `item`. No host is this machine, as its Panes name none.
 */
export function useWaitingFor(
  host: string | undefined,
  item?: string | null
): readonly Wait[] {
  const pick = useCallback(
    (wait: Wait) =>
      wait.host === (host ?? HERE) &&
      (item === undefined || wait.item === item),
    [host, item]
  )
  return useWaitingBy(pick)
}

/**
 * Whether what `pane` of `project` sends now waits for its machine, as
 * "Send when back" (ADR 0105, Q2), by its engine's connection `status`
 * (`waitsFor`): that machine's name, for the words, while it does; none
 * while it goes now. Worked out from the Pane, as its session is
 * (`KeptHosts.sessionOf`), so an App never asks where its Pane is (ADR
 * 0106, law 6).
 */
export function useWaitsOn(
  project: ProjectId,
  pane: Pick<PaneState, "args">,
  status: Status["state"]
): string | undefined {
  const shown = useMachineOf(project, paneHost(pane))?.shown
  return shown && waitsFor(shown, status)
    ? waitedName(shown.name, shown.named.name)
    : undefined
}

/** How many Panes closed while host `host` was away wait to be let go of
 * there (ADR 0106, decision 4), which the pill counts beside the
 * messages; no host is this machine. */
export function useLeftFor(host: string | undefined): number {
  const select = useCallback(
    (left: readonly Leaving[]) =>
      left.filter((one) => one.host === (host ?? HERE)).length,
    [host]
  )
  return useStore(useContext(HostsContext).left, select)
}
