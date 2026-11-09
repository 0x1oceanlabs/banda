import { useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { Engine } from "@banda/contract"
import { useMachine, useModules } from "@banda/ui/hooks/use-status"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { paneHost, type PaneState } from "@banda/ui/pane"
import { HostsContext, useNamedOf, useOurs } from "@banda/core/react"
import { labelOf, previewers, slotsOf } from "../registry"
import { closing } from "./actions"
import { device } from "../boot"
import { useKeys, usePoppedKeys } from "./keys"
import { Listed, Machines } from "./machines"
import type { Workspace as Kept } from "@banda/contract/workspaces"
import { send } from "../tiling/arrange"
import { useArranged } from "../tiling/useArranged"
import { type Entry, samePane } from "../tiling/model"
import { type Frame, PaneFrame } from "../tiling/PaneFrame"
import { KeysInForce } from "@banda/ui/hooks/use-key-of"
import { Previewers } from "@banda/ui/lib/previewers"
import { Slots } from "@banda/ui/slots"

/**
 * A Pane in a window of its own (ADR 0025, decision 9). The window keeps
 * its place in the workspace; this draws it alone, as the engine keeps it.
 * What it opens or runs goes to the window, which has the workspaces;
 * `Alt+W` closes it, and its pop-out key, as closing this window, brings
 * it back to its place.
 */
export function Popped({ engine, pane }: { engine: Engine; pane: string }) {
  const modules = useModules(engine)
  const slots = useMemo(() => slotsOf(modules), [modules])
  const { listed: projects } = useProjects(engine)
  // This machine's Projects and its Host scope win an ID a host has too,
  // as in the window, and its picker lists the window's machines.
  const hosts = useContext(HostsContext)
  useOurs(hosts, projects, useMachine(engine))
  const live = useArranged(engine)
  const kept = live.state === "ready" ? live.view : undefined
  // Its args as it asked for them, drawn until the engine's event is.
  const [asked, setAsked] = useState<{ args: unknown; until: number }>()
  const found = kept && keptPane(kept.workspaces, pane)
  const args = asked && kept && asked.until > kept.at ? asked.args : found?.args
  // The same object while it shows the same: an event of another Pane
  // does not draw it again.
  const [entry, setEntry] = useState<Entry>()
  const now: Entry | undefined = found && {
    id: pane,
    project: found.project,
    pane: { kind: found.kind, args: args as PaneState["args"] },
  }
  if (now ? !entry || !samePane(entry, now) : entry) setEntry(now)
  // Closed, by Alt+W here or by an Agent, it takes its window with it.
  const gone = kept !== undefined && !found
  const back = useCallback(() => device.popped.close(pane), [pane])
  useEffect(() => {
    if (gone) back()
  }, [gone, back])
  const title = entry ? labelOf(entry.pane).title : ""
  // The system's title names another machine, as its header does (ADR
  // 0095, decision 8), and it has no icon there.
  const machine = useNamedOf(entry?.project, entry && paneHost(entry.pane))
  useEffect(() => {
    const named = title && machine ? `${title} · ${machine.name}` : title
    document.title = named ? `${named} — Banda` : "Banda"
  }, [title, machine])

  const close = useCallback(() => {
    send(engine, closing(pane).command).catch((error: unknown) =>
      console.warn("The Pane did not close:", error)
    )
  }, [engine, pane])
  const frame: Frame = useMemo(
    () => ({
      focus: () => undefined,
      open: (project, opened, from, place) =>
        device.popped.ask({
          open: { project, pane: opened, from, ...(place && { place }) },
        }),
      update: (_entry, { args }: PaneState) => {
        setAsked({ args, until: Infinity })
        engine.command("workspaces.update", { pane, args }).then(
          (done) =>
            setAsked((was) =>
              was?.args === args ? { args, until: done.at ?? 0 } : was
            ),
          (error: unknown) => {
            console.warn("The workspaces did not change:", error)
            setAsked(undefined)
          }
        )
      },
      close,
      run: (action, args) =>
        device.popped.ask({ run: { action, ...(args && { args }) } }),
      arrange: () => Promise.resolve(),
      popOut: back,
    }),
    [engine, pane, close, back]
  )

  // Of the window's keys, this window takes the two that are its Pane's,
  // and its scopes' (keys.ts).
  const { mod, keyed, keys } = useKeys()
  usePoppedKeys(keyed, mod, close, back)

  const project =
    projects.state === "ready"
      ? projects.value.find((project) => project.id === entry?.project)
      : undefined
  return (
    <KeysInForce.Provider value={keys}>
      <div className="flex h-svh bg-desk text-foreground">
        {entry ? (
          // Its Pane draws a file with the modules' previewers, what the
          // modules fill the Slots with, and a new Thread's picker the
          // machines, as in the window.
          <Previewers value={previewers}>
            <Slots value={slots}>
              <Machines hosts={hosts}>
                <PaneFrame
                  entry={entry}
                  engine={engine}
                  modules={modules}
                  focused
                  marked={false}
                  listed={undefined}
                  project={project}
                  mixed={false}
                  frame={frame}
                  alone
                />
              </Machines>
              <Listed />
            </Slots>
          </Previewers>
        ) : (
          <p className="m-auto text-sm text-muted-foreground">
            {live.state === "ready"
              ? "This Pane was closed."
              : "Banda's engine is starting…"}
          </p>
        )}
      </div>
    </KeysInForce.Provider>
  )
}

/** Pane `id` as the engine keeps it, wherever it is. */
function keptPane(kept: readonly Kept[], id: string) {
  for (const workspace of kept)
    for (const column of workspace.columns)
      for (const pane of column.panes) if (pane.id === id) return pane
  return undefined
}
