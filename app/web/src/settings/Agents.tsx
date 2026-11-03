/**
 * The Agents section (ADR 0016, decision 7): the agents module draws it;
 * this gives it the engine, a Space where there is one, the files through
 * `banda settings`, and a place for the Pane a sign-in opens, a terminal,
 * over the window. The Harnesses are the machine's (ADR 0040): they show
 * before any Space.
 */
import { useState } from "react"
import { AgentsSettings, type SettingsFile } from "@banda/agents-pane/settings"
import type { Engine } from "@banda/contract"
import { Dialog, DialogContent, DialogTitle } from "@banda/ui/components/dialog"
import { Spinner } from "@banda/ui/components/spinner"
import { useSpaces } from "@banda/ui/hooks/use-spaces"
import { shownSpaces } from "@banda/ui/lib/spaces"
import type { PaneState } from "@banda/ui/pane"
import { terminal } from "@banda/terminal-pane"

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
const agents = written("agents.toml")

export function Agents({ engine, lit }: { engine: Engine; lit?: string }) {
  // Any Space offers what a new Thread starts with, and runs a terminal:
  // the first, as the window's home, once there is one.
  const { listed } = useSpaces(engine)
  const [pane, setPane] = useState<PaneState>()
  const close = () => setPane(undefined)
  if (listed.state === "loading") return <Spinner />
  const space =
    listed.state === "ready"
      ? shownSpaces(listed.value).find((s) => !s.missing)?.id
      : undefined
  const kind = pane && kinds.find((k) => k.kind === pane.kind)
  return (
    <>
      <AgentsSettings
        engine={engine}
        space={space}
        open={setPane}
        harnesses={harnesses}
        agents={agents}
        lit={lit}
      />
      <Dialog
        open={kind !== undefined}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent className="flex h-[70vh] flex-col sm:max-w-3xl">
          {pane && kind && space && (
            <>
              <DialogTitle>{kind.title(pane.args)}</DialogTitle>
              <div className="min-h-0 flex-1">
                <kind.Pane
                  engine={engine}
                  space={space}
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
