/**
 * The Agents section (ADR 0016, decision 7): the agents module draws it;
 * this gives it the engine, a Project where there is one, the machine's
 * files through that engine (ADR 0108, decision 1), and a place for the
 * Pane a sign-in opens, a terminal, over the window. The Harnesses are the
 * machine's (ADR 0040): they show before any Project.
 */
import { useContext, useMemo, useState } from "react"
import type { Engine } from "@banda/contract"
import {
  AgentsSettings,
  FENCE_LINK,
  type SettingsFile,
} from "@banda/agents-pane/settings"
import { Dialog, DialogContent, DialogTitle } from "@banda/ui/components/dialog"
import { Spinner } from "@banda/ui/components/spinner"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { shownProjects } from "@banda/ui/lib/projects"
import type { PaneState } from "@banda/ui/pane"
import { terminal } from "@banda/terminal-pane"
import { PaneMount, RoutingContext, routingOnly } from "../tiling/mount"
import { throughEngine } from "./machine-settings"
import type { SectionProps } from "./sections"
import { device } from "../boot"

/** The Panes a sign-in opens: a terminal, and no other kind. */
const kinds = terminal.panes

/** The one act of the window's a sign-in's terminal runs: a link it prints
 * opens in this device's browser, through the router as any Pane's. */
const LINK_OPEN = "link.open"

/** A machine's settings file, written through its engine as the Person
 * (ADR 0108, decision 1), which keeps the mode they choose for a Harness's
 * new Threads: only Full access chosen here counts where the fence does
 * not hold (ADR 0083). This computer opens only its own. */
const fileOf = (engine: Engine, name: string, here: boolean): SettingsFile => {
  const writer = throughEngine(engine)
  return {
    set: (key, value) => writer.set(name, key, value),
    reset: (key) => writer.reset(name, key),
    reveal: here ? () => device.settings.reveal(name) : undefined,
  }
}

export function Agents({ engine, on, lit, run }: SectionProps) {
  const here = on === undefined
  const [agents, harnesses] = useMemo(
    () => [
      fileOf(engine, "agents.toml", here),
      fileOf(engine, "harnesses.toml", here),
    ],
    [engine, here]
  )
  // Any Project offers what a new Thread starts with, and runs a terminal:
  // the first, as the window's home, once there is one.
  const { listed } = useProjects(engine)
  const [pane, setPane] = useState<PaneState>()
  const close = () => setPane(undefined)
  const project =
    listed.state === "ready"
      ? shownProjects(listed.value).find((s) => !s.missing)?.id
      : undefined
  // The same owner while the Project stays, so the sign-in terminal keeps
  // the handles it was given.
  const owner = useMemo(
    () => (project === undefined ? undefined : { project }),
    [project]
  )
  const routing = useContext(RoutingContext)
  const signIn = useMemo(
    () => ({
      routing: routingOnly(routing, LINK_OPEN),
      run: (action: string, args?: Parameters<NonNullable<typeof run>>[1]) => {
        if (action === LINK_OPEN) run?.(action, args)
      },
    }),
    [routing, run]
  )
  if (listed.state === "loading") return <Spinner />
  const kind = pane && kinds.find((k) => k.kind === pane.kind)
  return (
    <>
      <AgentsSettings
        engine={engine}
        project={project}
        open={setPane}
        harnesses={harnesses}
        agents={agents}
        lit={lit}
        onFence={() => run?.("settings.open", { link: FENCE_LINK })}
      />
      <Dialog
        open={kind !== undefined}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent className="flex h-[70vh] flex-col sm:max-w-3xl">
          {pane && kind && owner && (
            <>
              <DialogTitle>{kind.title(pane.args)}</DialogTitle>
              <div className="min-h-0 flex-1">
                {/* This machine's terminal, in its Project, mounted as
                    every Pane is (ADR 0106, decision 1); of the window's
                    actions it runs only the link's, as a dialog of the
                    settings. */}
                <RoutingContext value={signIn.routing}>
                  <PaneMount
                    kind={kind}
                    engine={engine}
                    project={owner.project}
                    pane={pane}
                    owner={owner}
                    focused
                    handle={{
                      open: setPane,
                      update: (args) => setPane({ ...pane, args }),
                      close,
                    }}
                    run={signIn.run}
                  />
                </RoutingContext>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
