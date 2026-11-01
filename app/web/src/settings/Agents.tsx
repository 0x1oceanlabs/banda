/**
 * The Agents section (ADR 0016, decision 7): the agents module draws it;
 * this gives it the engine, a Space to ask each Harness in, the file
 * through `banda settings`, and a place for the Pane a sign-in opens, a
 * terminal, over the window.
 */
import { useCallback, useState } from "react"
import { AgentsSettings, type HarnessFile } from "@banda/agents-pane/settings"
import type { Engine, JsonValue } from "@banda/contract"
import { Dialog, DialogContent, DialogTitle } from "@banda/ui/components/dialog"
import { Spinner } from "@banda/ui/components/spinner"
import { useRead } from "@banda/ui/hooks/use-read"
import type { PaneKind, PaneState } from "@banda/ui/pane"
import { panes as terminalPanes } from "@banda/terminal-pane"

const FILE = "harnesses.toml"

/** The Panes a sign-in opens: a terminal. Not the whole registry, which
 * would load every module's Panes into this window. */
const kinds = terminalPanes as unknown as PaneKind<{
  [key: string]: JsonValue
}>[]

const file: HarnessFile = {
  set: (key, value) =>
    window.banda?.settings.set(FILE, key, value) ?? Promise.resolve([]),
  reset: (key) =>
    window.banda?.settings.reset(FILE, key) ?? Promise.resolve([]),
  reveal: () => void window.banda?.settings.reveal(FILE),
}

export function Agents({ engine, lit }: { engine: Engine; lit?: string }) {
  // An account serves every Space on this computer: any one asks.
  const spaces = useRead(
    useCallback(() => engine.call("spaces.list", {}), [engine])
  )
  const [pane, setPane] = useState<PaneState>()
  // A sign-in in a terminal ends by closing it: the cards ask anew.
  const [closed, setClosed] = useState(0)
  const close = () => {
    setPane(undefined)
    setClosed((n) => n + 1)
  }
  if (spaces.state === "loading") return <Spinner />
  const space = spaces.state === "ready" ? spaces.value[0]?.id : undefined
  if (!space)
    return (
      <p className="text-sm text-muted-foreground">
        A Harness starts in a Space: create one in Banda, and its Harnesses show
        here.
      </p>
    )
  const kind = pane && kinds.find((k) => k.kind === pane.kind)
  return (
    <>
      <AgentsSettings
        key={closed}
        engine={engine}
        space={space}
        open={setPane}
        file={file}
        lit={lit}
      />
      <Dialog
        open={kind !== undefined}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent className="flex h-[70vh] flex-col sm:max-w-3xl">
          {pane && kind && (
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
