/**
 * Here as the Window keeps it (ADR 0087, decision 4): one record of where
 * the Person is, folded from what the Tiling drew last, the Window's own
 * areas and the device. Only the Window writes it; its widgets read it by
 * selector (`useHere`) and its acts as they run (`WindowApi.here`). Pure
 * but for its hook and its provider, so plain tests cover it.
 * `client/core` takes it at W0 (ADR 0089).
 */
import type { ProjectId } from "@banda/contract"
import { type Here, HereContext, type HereStore } from "@banda/ui/here"
import { inFront } from "@banda/ui/hooks/use-in-front"
import { sameData, Store } from "@banda/ui/lib/store"
import { type ReactNode, useEffect, useState } from "react"
import type { Shows } from "../calls/sight"
import { type Stores, StoresContext } from "../calls/stores"
import { current, focused, projectIn, type Workspaces } from "../tiling/model"
import { useSteady } from "./steady"

/** What the Window and the device say besides the Tiling. */
export type Around = {
  /** The Sidebar shows. */
  sidebar: boolean
  /** The Window is in front. */
  front: boolean
  /** The Project where a Pane of no Project starts. */
  home: ProjectId
}

/** Here, from the workspaces as the Tiling drew them and what is
 * `around` them. While the Tiling reads the arrangement, no workspace is
 * on screen. */
export function hereOf(
  state: Workspaces,
  { sidebar, front, home }: Around,
  shows: Shows
): Here {
  const workspace = current(state)
  const entry = focused(state)
  const subject = entry && shows(entry.pane)
  return {
    front,
    sidebar,
    workspace: workspace.id
      ? {
          id: workspace.id,
          ...(workspace.project && { project: workspace.project }),
        }
      : null,
    pane: entry
      ? {
          id: entry.id,
          project: entry.project,
          ...(subject && { subject }),
        }
      : null,
    project: projectIn(state) ?? home,
  }
}

/** `now`, with each part that says what it said in `was` kept as it was,
 * and all of `was` when nothing changed: a reader that selects the Pane
 * is not drawn again as the Window comes to the front. */
export function keptHere(was: Here, now: Here): Here {
  if (sameData(was, now)) return was
  const old: Record<string, unknown> = was
  return Object.fromEntries(
    Object.entries(now).map(([key, part]) => [
      key,
      sameData(old[key], part) ? old[key] : part,
    ])
  ) as Here
}

/**
 * Here as one Window keeps it. `read` works it out from its sources as
 * they are now, so `get` is always current: a change the Tiling made and
 * React has not drawn yet is in it, and two keys in one slow frame each
 * act where the last left the Person. Each part stays the same object
 * while it says the same.
 *
 * Its readers are told by `tell`, once the Window has drawn a change of
 * it, never inside a tick of the clock. Every source of Here is the
 * Window's to draw (the Tiling's hook, the Sidebar, the Window in front),
 * so each change draws the Window, which tells; a source the Window
 * stops drawing for has to tell it itself. Told after the Window draws, a
 * reader draws in the commit after it: for a key, in the same task; for
 * what the engine says, maybe a frame later.
 */
export class KeptHere implements HereStore {
  readonly #read: () => Here
  #last: Here
  /** What the readers were told last. */
  readonly #told: Store<Here>

  constructor(read: () => Here) {
    this.#read = read
    this.#last = read()
    this.#told = new Store(this.#last)
  }

  readonly get = (): Here => {
    this.#last = keptHere(this.#last, this.#read())
    return this.#last
  }

  readonly subscribe = (listener: () => void): (() => void) =>
    this.#told.subscribe(listener)

  /** Tells each reader, once, that Here changed since they were told.
   * Back to what they were told, they hear nothing. */
  tell(): void {
    this.#last = keptHere(this.#told.get(), this.get())
    this.#told.set(this.#last)
  }
}

/**
 * The Window's Here, from the workspaces as the Tiling drew them last
 * (`drawn`), what is around them and the device: one store for the
 * Window's life, whose readers are told after each drawing of the Window
 * that changed it. Called after the Tiling's hook, so its effect runs
 * once the Tiling has kept what it drew.
 */
export function useKeptHere(
  drawn: () => Workspaces,
  around: Omit<Around, "front">,
  shows: Shows
): KeptHere {
  const now = useSteady({ ...around, drawn, shows })
  const [here] = useState(
    () =>
      new KeptHere(() =>
        hereOf(
          now.drawn(),
          { sidebar: now.sidebar, front: inFront(), home: now.home },
          now.shows
        )
      )
  )
  useEffect(() => here.tell())
  return here
}

/** What the Window keeps outside React, for all it draws to read by
 * selector: the items and the calls (ADR 0088, decision 7), and Here. */
export function Kept({
  stores,
  here,
  children,
}: {
  stores: Stores
  here: HereStore
  children: ReactNode
}) {
  return (
    <StoresContext value={stores}>
      <HereContext value={here}>{children}</HereContext>
    </StoresContext>
  )
}
