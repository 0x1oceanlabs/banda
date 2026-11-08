/**
 * The Agents section (ADR 0016, decision 7): the agents module draws it;
 * this gives it the engine, a Project where there is one, the files through
 * `banda settings`, `agents.toml` through the engine, and a place for the
 * Pane a sign-in opens, a terminal, over the window. The Harnesses are the
 * machine's (ADR 0040): they show before any Project.
 */
import { useMemo, useState } from "react"
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
import { problem } from "@banda/ui/lib/words"
import type { PaneState } from "@banda/ui/pane"
import { terminal } from "@banda/terminal-pane"
import type { SectionProps } from "./sections"

/** The Panes a sign-in opens: a terminal. Not the whole registry, which
 * would load every module's Panes into this window. */
const kinds = terminal.panes

/** A settings file, written through `banda settings`. */
const written = (name: string): SettingsFile => ({
  set: (key, value) =>
    window.banda?.settings.set(name, key, value) ?? Promise.resolve([]),
  reset: (key) =>
    window.banda?.settings.reset(name, key) ?? Promise.resolve([]),
  reveal: () => void window.banda?.settings.reveal(name),
})

const harnesses = written("harnesses.toml")

/** `agents.toml`, written through the engine as the Person, which keeps the
 * mode they choose for a Harness's new Threads: only Full access chosen
 * here counts where the fence does not hold (ADR 0083). */
const throughEngine = (engine: Engine): SettingsFile => {
  const name = "agents.toml"
  const said = (asked: Promise<unknown>) =>
    asked.then(
      (): string[] => [],
      (error: unknown) => problem(error).split("\n")
    )
  return {
    set: (key, value) =>
      said(engine.call("keys.settings_set", { file: name, key, value })),
    reset: (key) =>
      said(engine.call("keys.settings_reset", { file: name, key })),
    reveal: written(name).reveal,
  }
}

export function Agents({ engine, lit, run }: SectionProps) {
  const agents = useMemo(() => throughEngine(engine), [engine])
  // Any Project offers what a new Thread starts with, and runs a terminal:
  // the first, as the window's home, once there is one.
  const { listed } = useProjects(engine)
  const [pane, setPane] = useState<PaneState>()
  const close = () => setPane(undefined)
  if (listed.state === "loading") return <Spinner />
  const project =
    listed.state === "ready"
      ? shownProjects(listed.value).find((s) => !s.missing)?.id
      : undefined
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
          {pane && kind && project && (
            <>
              <DialogTitle>{kind.title(pane.args)}</DialogTitle>
              <div className="min-h-0 flex-1">
                <kind.Pane
                  engine={engine}
                  project={project}
                  args={pane.args}
                  focused
                  open={setPane}
                  update={(args) => setPane({ ...pane, args })}
                  close={close}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
