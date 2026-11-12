import { useCallback, useEffect, useMemo, useState } from "react"
import type { Engine, ProjectSummary } from "@banda/contract"
import { Spinner } from "@banda/ui/components/spinner"
import { HostsContext, KeptHosts, onDevice, useOurs } from "@banda/core/react"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { Previewers } from "@banda/ui/lib/previewers"
import {
  followNamed,
  followThisNamed,
  seenNamed,
  useMachine,
  useModules,
} from "@banda/ui/hooks/use-status"
import { shownProjects } from "@banda/ui/lib/projects"
import { Slots } from "@banda/ui/slots"
import { previewers, slotsOf } from "./registry"
import { device } from "./boot"
import { Machines } from "./window/machines"
import { ROUTING } from "./window/actions"
import { Shell } from "./window/Shell"
import { DIRECTORY } from "./directory"
import { RoutingContext } from "./tiling/mount"
import { AskToShare } from "./sharing/AskToShare"
import { relayBytesFrom } from "@banda/ui/hooks/use-file-url"
import { Updates } from "./bar/heard"

/**
 * The page: the engine's Projects, then the window. With no Project, a new
 * Thread is held on the machine until its first message or attachment.
 * The other machines of `hosts.toml` show below this one's (ADR 0081).
 */
export function App({ engine }: { engine: Engine }) {
  const machine = useMachine(engine)
  const modules = useModules(engine)
  const slots = useMemo(() => slotsOf(modules), [modules])
  // A Project added here shows at once, as the engine answered it.
  const { listed, put } = useProjects(engine)
  // The names it shows each host by, as this device last saw them, are
  // the device's to keep (ADR 0081, decision 1), and so is which machine
  // has each Project (ADR 0106, decision 1); this machine's own Projects
  // are its engine's. What waits for a host is the device's too, and this
  // window sends it (ADR 0105, Q6).
  const [hosts] = useState(
    () =>
      new KeptHosts(
        device.hosts,
        { seen: seenNamed, follow: followNamed, followHere: followThisNamed },
        engine,
        {
          waiting: onDevice(() => localStorage, window),
          directory: DIRECTORY,
          relay: relayBytesFrom,
        }
      )
  )
  useEffect(() => hosts.follow(), [hosts])
  useOurs(hosts, listed, machine)
  // A Project made here is this machine's before the list says so, for
  // what opens in it at once.
  const created = useCallback(
    (project: ProjectSummary) => {
      hosts.added(project)
      put(project)
    },
    [hosts, put]
  )

  if (listed.state === "loading") {
    return (
      <div className="flex h-svh items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (listed.state === "refused") {
    return (
      <p role="alert" className="p-6 text-ui text-muted-foreground">
        {listed.refusal.message}
      </p>
    )
  }
  const projects = [
    ...shownProjects(listed.value),
    ...listed.value.filter((s) => s.scratch && !s.archived),
  ]
  // The first Project is home until Banda makes a default one (ADR 0006);
  // one whose folder is missing opens nothing.
  const home = projects.find((project) => !project.missing && !project.scratch)
  if (!machine) return <Spinner />
  // Every Pane draws a file with the modules' previewers (ADR 0073),
  // every Slot's owner what the modules that run fill it with, and every
  // Pane's host weighs its acts by the window's (ADR 0106, law 3).
  return (
    <Previewers value={previewers}>
      <Slots value={slots}>
        <HostsContext value={hosts}>
          <RoutingContext value={ROUTING}>
            <Machines hosts={hosts}>
              <Updates>
                <Shell
                  engine={engine}
                  modules={modules}
                  projects={projects}
                  home={home?.id ?? machine}
                  onCreated={created}
                />
              </Updates>
            </Machines>
          </RoutingContext>
        </HostsContext>
      </Slots>
      {projects.length > 0 && <AskToShare engine={engine} />}
    </Previewers>
  )
}
