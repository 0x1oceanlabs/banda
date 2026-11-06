/**
 * What the window keeps between runs in its own storage on this computer
 * (in the engine's state folder, `window/`): the view, the focus,
 * whether the sidebar shows and how wide it is. The workspaces themselves are the engine's
 * (ADR 0025, decisions 1 and 2): the arrangement the window kept before
 * moves over once.
 */
import { type Engine, newId, Refused, type ProjectId } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { keptOf, NO_VIEW, type View, viewOf } from "./arrange"
import {
  type Entry,
  focused,
  open,
  parse,
  start,
  type Width,
  type Workspaces,
} from "./model"
import { kept, WIDTH } from "../sidebar/width"

const WORKSPACES = "banda.workspaces"
const VIEW = "banda.view"
const SIDEBAR = "banda.sidebar"
const SIDEBAR_WIDTH = "banda.sidebar.width"
const LOOKED = "banda.looked"
const DRAWER = "banda.drawer"

/**
 * Moves the window's arrangement to the engine, which takes one once: the
 * one it kept, or, at the very first start, the Pane a Person starts
 * with, a Group from its opening when `grouped`. The view it had comes
 * back with it; none when the engine has taken one already.
 */
export async function moveOver(
  engine: Engine,
  project: ProjectId,
  first: { pane: PaneState; width?: Width; grouped?: boolean } | undefined
): Promise<View | undefined> {
  const kept =
    parse(parsed(read(WORKSPACES))) ?? (first && startWith(project, first))
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

/** The arrangement of the very first start: `first` alone, its column a
 * Group when `grouped`, as a Thread opens (ADR 0065, decision 7). */
function startWith(
  project: ProjectId,
  first: { pane: PaneState; width?: Width; grouped?: boolean }
): Workspaces {
  const state = open(start(), project, first.pane, { width: first.width })
  if (!first.grouped) return state
  const list = state.list.map((workspace) => ({
    ...workspace,
    columns: workspace.columns.map((column) => ({ ...column, group: newId() })),
  }))
  return { ...state, list }
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

/** How wide the sidebar is, in rem, as the Person dragged it. */
export function loadSidebarWidth(): number {
  return kept(Number(read(SIDEBAR_WIDTH) ?? Number.NaN))
}

export function keepSidebarWidth(rem: number): void {
  if (rem === WIDTH) forget(SIDEBAR_WIDTH)
  else keep(SIDEBAR_WIDTH, String(rem))
}

/**
 * The Panes an Agent opened that the Person has looked at: the others
 * carry a mark (ADR 0032).
 */
export function loadLooked(): ReadonlySet<string> {
  const ids = parsed(read(LOOKED))
  return new Set(
    Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []
  )
}

export function keepLooked(ids: ReadonlySet<string>): void {
  keep(LOOKED, JSON.stringify([...ids]))
}

/** The drawer's Pane, which is in no workspace (ADR 0025, decision 8). */
export function loadDrawer(): Entry | undefined {
  const entry = parsed(read(DRAWER)) as Partial<Entry> | null
  return typeof entry?.id === "string" &&
    typeof entry.project === "string" &&
    typeof entry.pane?.kind === "string"
    ? (entry as Entry)
    : undefined
}

export function keepDrawer(entry: Entry | undefined): void {
  if (entry) keep(DRAWER, JSON.stringify(entry))
  else forget(DRAWER)
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
