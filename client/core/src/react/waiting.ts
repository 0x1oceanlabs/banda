/**
 * What waits for another machine, from React (ADR 0105): the Window's
 * queue (`KeptHosts.waiting`), each part reading the messages it shows,
 * drawn again only as they change.
 */
import { useCallback, useContext } from "react"
import type { Leaving } from "../left"
import type { Queue, Wait } from "../queue"
import { sameEach } from "../store"
import { HostsContext } from "./hosts"
import { useStore } from "./store"

const NONE: readonly Wait[] = []

/** The Window's queue (ADR 0105), for an App to queue a message to a
 * machine that is away, change or take back one, and hear one that comes
 * back. */
export function useQueue(): Queue {
  return useContext(HostsContext).waiting
}

/**
 * The messages that wait for host `host`, in the order queued; with
 * `item`, only those to that Item, as a Thread shows its own. The pill
 * counts them all: every message this device has waiting for that host.
 * None for no host, as this machine's Panes name none.
 */
export function useWaiting(
  host: string | undefined,
  item?: string | null
): readonly Wait[] {
  const select = useCallback(
    (waits: readonly Wait[]) => {
      if (host === undefined || item === null) return NONE
      const these = waits.filter(
        (wait) =>
          wait.host === host && (item === undefined || wait.item === item)
      )
      return these.length === 0 ? NONE : these
    },
    [host, item]
  )
  return useStore(useContext(HostsContext).waiting, select, sameEach)
}

/** How many Panes closed while host `host` was away wait to be let go of
 * there (ADR 0106, decision 4), which the pill counts beside the
 * messages; none for no host. */
export function useLeftFor(host: string | undefined): number {
  const select = useCallback(
    (left: readonly Leaving[]) =>
      host === undefined ? 0 : left.filter((one) => one.host === host).length,
    [host]
  )
  return useStore(useContext(HostsContext).left, select)
}
