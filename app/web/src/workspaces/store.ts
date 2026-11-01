/**
 * Where the window keeps its workspaces between runs: its own storage on
 * this computer (`$BANDASO_STATE/window` when that is set). They move into
 * the engine later, so the CLI and Agents can arrange them too (ADR 0005,
 * decision 3); this file is the one place that changes then.
 */
import type { SpaceId } from "@bandaso/contract"
import type { PaneState } from "@bandaso/ui/pane"
import { open, parse, start, type Width, type Workspaces } from "./model"

const WORKSPACES = "bandaso.workspaces"
const SIDEBAR = "bandaso.sidebar"

/** The workspaces kept, or a first one with the Pane a Person starts with. */
export function loadWorkspaces(
  space: SpaceId,
  first: { pane: PaneState; width: Width } | undefined
): Workspaces {
  try {
    const kept = parse(JSON.parse(localStorage.getItem(WORKSPACES) ?? "null"))
    if (kept) return kept
  } catch {
    // Broken or missing workspaces start over.
  }
  return first
    ? open(start(), space, first.pane, { width: first.width })
    : start()
}

export function keepWorkspaces(workspaces: Workspaces): void {
  keep(WORKSPACES, JSON.stringify(workspaces))
}

/** Whether the sidebar shows; it does unless the Person hid it. */
export function loadSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR) !== "hidden"
  } catch {
    return true
  }
}

export function keepSidebar(shows: boolean): void {
  keep(SIDEBAR, shows ? "shown" : "hidden")
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The layout is a convenience; the work is in the engine.
  }
}
