import { useEffect, useMemo, useState } from "react"
import type { Engine } from "@banda/contract"
import { Spinner } from "@banda/ui/components/spinner"
import { HostsContext, KeptHosts, useOurs } from "@banda/core/react"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { Previewers } from "@banda/ui/lib/previewers"
import {
  followNamed,
  seenNamed,
  useMachine,
  useModules,
  useStatus,
} from "@banda/ui/hooks/use-status"
import { shownProjects } from "@banda/ui/lib/projects"
import { Slots } from "@banda/ui/slots"
import { previewers, slotsOf } from "./registry"
import { device } from "./boot"
import { Machines } from "./window/machines"
import { Shell } from "./window/Shell"
import { AskToShare } from "./sharing/AskToShare"

/**
 * The page: the engine's Projects, then the window. With no Project, a new
 * Thread is held on the machine until its first message or attachment.
 * The other machines of `hosts.toml` show below this one's (ADR 0081).
 */
export function App({ engine }: { engine: Engine }) {
  const status = useStatus(engine)
  const machine = useMachine(engine)
  const modules = useModules(engine)
  const slots = useMemo(() => slotsOf(modules), [modules])
  // A Project added here shows at once, as the engine answered it.
  const { listed, put } = useProjects(engine)
  // The names it shows each host by, as this device last saw them, are
  // the device's to keep (ADR 0081, decision 1).
  const [hosts] = useState(
    () => new KeptHosts(device.hosts, { seen: seenNamed, follow: followNamed })
  )
  useEffect(() => hosts.follow(), [hosts])
  useOurs(hosts, listed, machine)

  if (listed.state === "loading") {
    return (
      <div className="flex h-svh items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (listed.state === "refused") {
    return (
      <p role="alert" className="p-6 text-sm text-muted-foreground">
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
  // Every Pane draws a file with the modules' previewers (ADR 0073), and
  // every Slot's owner what the modules that run fill it with.
  return (
    <Previewers value={previewers}>
      <Slots value={slots}>
        <HostsContext value={hosts}>
          <Machines hosts={hosts}>
            <Shell
              engine={engine}
              status={status}
              modules={modules}
              projects={projects}
              home={home?.id ?? machine}
              onCreated={put}
            />
          </Machines>
        </HostsContext>
      </Slots>
      {projects.length > 0 && <AskToShare engine={engine} />}
    </Previewers>
  )
}
