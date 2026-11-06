import { useCallback, useEffect, useMemo, useState } from "react"
import type { Engine } from "@banda/contract"
import { useModules } from "@banda/ui/hooks/use-status"
import { useProjects } from "@banda/ui/hooks/use-projects"
import type { PaneState } from "@banda/ui/pane"
import { inScope, keysInForce, pressFor, withKeys } from "../actions/actions"
import { scopesOf } from "@banda/ui/hooks/use-scope"
import type { Host } from "../host"
import { useLookKeys } from "../look"
import { labelOf, previewers } from "../registry"
import { ACTIONS, closing, heldBy } from "../shell/actions"
import type { Workspace as Kept } from "@banda/contract/workspaces"
import { send } from "./arrange"
import { useArranged } from "./useArranged"
import { type Entry, samePane } from "./model"
import { type Frame, PaneFrame } from "./PaneFrame"
import { KeysInForce } from "@banda/ui/hooks/use-key-of"
import { Previewers } from "@banda/ui/lib/previewers"

/**
 * A Pane in a window of its own (ADR 0025, decision 9). The window keeps
 * its place in the workspace; this draws it alone, as the engine keeps it.
 * What it opens or runs goes to the window, which has the workspaces;
 * `Alt+W` closes it, and its pop-out key, as closing this window, brings
 * it back to its place.
 */
export function Popped({
  engine,
  host,
  pane,
}: {
  engine: Engine
  host: Host
  pane: string
}) {
  const modules = useModules(engine)
  const { listed: projects } = useProjects(engine)
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
  const back = useCallback(() => host.popped.close(pane), [host, pane])
  useEffect(() => {
    if (gone) back()
  }, [gone, back])
  const title = entry ? labelOf(entry.pane).title : ""
  useEffect(() => {
    document.title = title ? `${title} — Banda` : "Banda"
  }, [title])

  const close = useCallback(() => {
    send(engine, closing(pane).command).catch((error: unknown) =>
      console.warn("The Pane did not close:", error)
    )
  }, [engine, pane])
  const frame: Frame = useMemo(
    () => ({
      focus: () => undefined,
      open: (project, opened, from, place) =>
        host.popped.ask({
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
        host.popped.ask({ run: { action, ...(args && { args }) } }),
      arrange: () => Promise.resolve(),
      popOut: back,
    }),
    [engine, host, pane, close, back]
  )

  // Of the window's keys, this window takes the two that are its Pane's,
  // and its scopes' (ADR 0071), as the Composer's Enter.
  const keys = useLookKeys()
  const keyed = useMemo(() => withKeys(ACTIONS, keys.actions), [keys])
  const inForce = useMemo(() => keysInForce(keys.mod, keyed), [keys, keyed])
  useEffect(() => {
    const own: Record<string, () => void> = {
      "pane.close": close,
      "pane.pop-out": back,
    }
    const stillHeld = heldBy(keys.mod)
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest("[data-takes-keys]")) return
      const pressed = pressFor(keyed, event, scopesOf(target), stillHeld)
      if (!pressed || inScope(pressed, event)) return
      const run = own[pressed.action.id]
      if (!run) return
      event.preventDefault()
      event.stopPropagation()
      run()
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [keyed, keys.mod, close, back])

  const project =
    projects.state === "ready"
      ? projects.value.find((project) => project.id === entry?.project)
      : undefined
  return (
    <KeysInForce.Provider value={inForce}>
      <div className="flex h-svh bg-desk text-foreground">
        {entry ? (
          // Its Pane draws a file with the modules' previewers.
          <Previewers value={previewers}>
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
