/**
 * What the window keeps between runs in its own storage on this computer
 * (`$BANDA_STATE/window` when that is set): the view, the focus and
 * whether the sidebar shows. The workspaces themselves are the engine's
 * (ADR 0025, decisions 1 and 2): the arrangement the window kept before
 * moves over once.
 */
import { type Engine, Refused, type SpaceId } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { keptOf, NO_VIEW, type View, viewOf } from "./arrange"
import { focused, open, parse, start, type Width } from "./model"

const WORKSPACES = "banda.workspaces"
const VIEW = "banda.view"
const SIDEBAR = "banda.sidebar"

/**
 * Moves the window's arrangement to the engine, which takes one once: the
 * one it kept, or, at the very first start, the Pane a Person starts
 * with. The view it had comes back with it; none when the engine has
 * taken one already.
 */
export async function moveOver(
  engine: Engine,
  space: SpaceId,
  first: { pane: PaneState; width?: Width } | undefined
): Promise<View | undefined> {
  const kept =
    parse(parsed(read(WORKSPACES))) ??
    (first && open(start(), space, first.pane, { width: first.width }))
  if (!kept) return undefined
  const taken = await engine
    .command("workspaces.take", { workspaces: keptOf(kept) })
    .catch((error: unknown) => {
      if (error instanceof Refused && error.refusal.code === "conflict")
        return null
      throw error
    })
  forget(WORKSPACES)
  if (!taken) return undefined
  // Its focus, once the arrangement it took is drawn.
  const pane = focused(kept)?.id
  const want = pane && { pane, after: taken.at ?? 0 }
  return { ...viewOf(kept), ...(want && { want }) }
}

export function loadView(): View {
  const view = parsed(read(VIEW))
  return isView(view) ? view : NO_VIEW
}

/** The view as last kept, so the same is not written again. */
let keptView = ""

export function keepView(view: View): void {
  const text = JSON.stringify(view)
  if (text === keptView) return
  keptView = text
  keep(VIEW, text)
}

/** Whether the sidebar shows; it does unless the Person hid it. */
export function loadSidebar(): boolean {
  return read(SIDEBAR) !== "hidden"
}

export function keepSidebar(shows: boolean): void {
  keep(SIDEBAR, shows ? "shown" : "hidden")
}

function isView(value: unknown): value is View {
  if (typeof value !== "object" || value === null) return false
  const view = value as Partial<View>
  return typeof view.focus === "object" && typeof view.active === "object"
}

function parsed(text: string | null): unknown {
  try {
    return JSON.parse(text ?? "null")
  } catch {
    // Broken: as if nothing was kept.
    return null
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The view is a convenience; the work is in the engine.
  }
}

function forget(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // As above.
  }
}
