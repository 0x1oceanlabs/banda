/**
 * The machines a new Thread starts on, as the Window gives them to its
 * Panes' pickers (ADR 0095, decision 7): its root and a popped-out Pane's
 * window alike, from the hosts it keeps (`KeptHosts.machines`), and what
 * each host lists, which the Window takes in as its engine lists it.
 */
import { type ReactNode, useContext, useEffect } from "react"
import type { Engine } from "@banda/contract"
import {
  HostsContext,
  type KeptHosts,
  liveIn,
  MachinesContext,
  sameEach,
  useHostsBy,
  useMachinesOf,
} from "@banda/core/react"
import { useProjects } from "@banda/ui/hooks/use-projects"

/** Gives what it draws the machines `hosts` tells, drawn again as they
 * change, and the window not with them. */
export function Machines({
  hosts,
  children,
}: {
  hosts: KeptHosts
  children: ReactNode
}) {
  return (
    <MachinesContext value={useMachinesOf(hosts)}>{children}</MachinesContext>
  )
}

/**
 * Takes each live host's Projects into the Window's hosts where no
 * Watches do (`bar/Watches.tsx`): a popped-out Pane's window, which draws
 * no sidebar. So its picker lists them under their machine, and its Pane
 * on a host finds its Items there. It draws nothing.
 */
export function Listed() {
  const hosts = useContext(HostsContext)
  const live = useHostsBy(liveIn, sameEach)
  return live.map((name) => <ListedOn key={name} hosts={hosts} name={name} />)
}

function ListedOn({ hosts, name }: { hosts: KeptHosts; name: string }) {
  useListedOn(hosts, name)
  return null
}

/** Host `name`'s engine, whose Projects `hosts` takes as it lists them,
 * and again as the window comes to the front (`useProjects`). */
export function useListedOn(hosts: KeptHosts, name: string): Engine {
  const engine = hosts.engine(name)
  const { listed } = useProjects(engine)
  useEffect(() => {
    if (listed.state === "ready") hosts.projects(name, listed.value)
  }, [hosts, name, listed])
  return engine
}
