import { useCallback, useEffect, useMemo, useState } from "react"
import type { Engine } from "@banda/contract"
import { useModules } from "@banda/ui/hooks/use-status"
import { useSpaces } from "@banda/ui/hooks/use-spaces"
import type { PaneState } from "@banda/ui/pane"
import { actionFor, keysOf, rebind } from "../actions/actions"
import type { Host } from "../host"
import { useLookKeys } from "../look"
import { labelOf } from "../registry"
import { ACTIONS, closing } from "../shell/actions"
import type { Workspace as Kept } from "@banda/contract/workspaces"
import { send } from "./arrange"
import { useArranged } from "./useArranged"
import { type Entry, samePane } from "./model"
import { type Frame, PaneFrame } from "./PaneFrame"
import { ActionKeys } from "@banda/ui/hooks/use-key-of"

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
  const { listed: spaces } = useSpaces(engine)
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
    space: found.space,
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
      open: (space, opened, from, place) =>
        host.popped.ask({
          open: { space, pane: opened, from, ...(place && { place }) },
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

  // Of the window's keys, this window takes the two that are its Pane's.
  const keys = useLookKeys()
  const keyed = useMemo(() => rebind(ACTIONS, keys), [keys])
  const inForce = useMemo(() => keysOf(keyed.actions), [keyed])
  useEffect(() => {
    const own: Record<string, () => void> = {
      "pane.close": close,
      "pane.pop-out": back,
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest("[data-takes-keys]")) return
      const run = own[actionFor(keyed.actions, event)?.id ?? ""]
      if (!run) return
      event.preventDefault()
      event.stopPropagation()
      run()
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [keyed, close, back])

  const spaceName =
    (spaces.state === "ready" &&
      spaces.value.find((space) => space.id === entry?.space)?.name) ||
    "Project"
  return (
    <ActionKeys.Provider value={inForce}>
      <div className="flex h-svh bg-desk text-foreground">
        {entry ? (
          <PaneFrame
            entry={entry}
            engine={engine}
            modules={modules}
            focused
            marked={false}
            listed={undefined}
            spaceName={spaceName}
            mixed={false}
            frame={frame}
            alone
          />
        ) : (
          <p className="m-auto text-sm text-muted-foreground">
            {live.state === "ready"
              ? "This Pane was closed."
              : "Banda's engine is starting…"}
          </p>
        )}
      </div>
    </ActionKeys.Provider>
  )
}

/** Pane `id` as the engine keeps it, wherever it is. */
function keptPane(kept: readonly Kept[], id: string) {
  for (const workspace of kept)
    for (const column of workspace.columns)
      for (const pane of column.panes) if (pane.id === id) return pane
  return undefined
}
