/**
 * What Files' Panes of a Project share for Follow (ADR 0073, decision 9),
 * in this window: when the Person last pressed a key or clicked in one,
 * what they hold there (text or lines picked, a comment being written),
 * and the `files.file` Panes drawn, which Follow moves to the Agent's
 * file. A Pane is one tile; this is how the tree reaches the file it
 * opened without a module of the window's own.
 */
import { useEffect } from "react"
import type { ProjectId } from "@banda/contract"

/** When the Person last pressed a key or clicked in a Files Pane, by
 * Project. */
const worked = new Map<ProjectId, number>()
/** What each Pane holds now, by Project. */
const holds = new Map<ProjectId, Set<object>>()

/** The Person pressed a key or clicked in a Files Pane of `project`. */
export function workedIn(project: ProjectId): void {
  worked.set(project, Date.now())
}

/** When the Person last worked in `project`'s Files Panes. */
export function workedAt(project: ProjectId): number | null {
  return worked.get(project) ?? null
}

/** Whether the Person holds something in `project`'s Files Panes: lines
 * picked or a comment written, or text picked in one. */
export function holding(project: ProjectId): boolean {
  if ((holds.get(project)?.size ?? 0) > 0) return true
  const picked = document.getSelection()
  if (!picked || picked.isCollapsed) return false
  const at = picked.anchorNode
  const element = at instanceof Element ? at : at?.parentElement
  return element?.closest(`[data-files="${project}"]`) != null
}

/** Says, while `held`, that a Pane of `project` holds something. */
export function useHolding(project: ProjectId, held: boolean): void {
  useEffect(() => {
    if (!held) return
    const one = {}
    const all = holds.get(project) ?? new Set()
    holds.set(project, all.add(one))
    return () => {
      all.delete(one)
    }
  }, [project, held])
}

/** A `files.file` Pane drawn: its Project, the file it shows, and how it
 * goes to another file at a line. */
export type ShownFile = {
  project: ProjectId
  path: () => string
  go: (path: string, line: number | null) => void
}

/** The `files.file` Panes drawn, the latest drawn last. */
const shown: ShownFile[] = []

/** Keeps `file` among those drawn while it is; returns how to let go. */
export function showing(file: ShownFile): () => void {
  shown.push(file)
  return () => {
    const at = shown.indexOf(file)
    if (at !== -1) shown.splice(at, 1)
  }
}

/**
 * Moves the `files.file` of `project` that shows `from`, else the one
 * drawn last there, to `to` at `line`; one that shows `to` already only
 * goes to the line. What it shows now, or none when no file is shown.
 */
export function moveFile(
  project: ProjectId,
  from: string | null,
  to: string,
  line: number | null
): string | null {
  const here = shown.filter((file) => file.project === project)
  const pane =
    here.find((file) => file.path() === to) ??
    here.find((file) => file.path() === from) ??
    here.at(-1)
  if (!pane) return null
  pane.go(to, line)
  return to
}
