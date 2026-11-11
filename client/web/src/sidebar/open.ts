import { createContext, useContext } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { HereContext, type Run, useRun } from "@banda/core/react"
import type { Row } from "./rows"

/**
 * How the Sidebar shown over the Strip lets itself go, for its parts that
 * open a Pane or a menu: it has done its work then (ADR 0025, decision
 * 10). None while it is docked.
 */
export const Dismiss = createContext<(() => void) | undefined>(undefined)

/**
 * How a part of the sidebar runs what opens a Pane or a menu, by the
 * Window's actions (ADR 0087, decision 11): the Sidebar over the Strip
 * goes first. What changes in place, as a pin, a wake or a Flow, runs by
 * `useRun` and leaves it there.
 */
export function useOpen(): Run {
  const run = useRun()
  const dismiss = useContext(Dismiss)
  return (action, args) => {
    dismiss?.()
    run(action, args)
  }
}

/** The action that starts a new Thread, the agents module's, by which its
 * key in force is read too. */
export const NEW_THREAD = "thread.new"

/** Where a new Thread starts, as its key's action takes it. */
export type NewThread = {
  /** Its Project, on the machine that has it, or a machine's No Project. */
  project: ProjectId
  /** The Harness it starts on, by its entry's ID; none, the machine's
   * default. */
  harness?: string
  /** The Project's folder is missing. */
  missing?: boolean
}

/**
 * A new Thread where `args` say, as its key starts one; a Project whose
 * folder is missing finds it first (ADR 0026, decision 6).
 */
export function newThread(
  open: Run,
  { project, harness, missing = false }: NewThread
) {
  if (missing) open("projects.locate", { project })
  else open(NEW_THREAD, { project, ...(harness && { harness }) })
}

/**
 * What the sidebar's own buttons start: in `only`, the Project whose rows
 * alone the list shows, if one, else in `starts`, where Alt+Enter starts
 * one (`Here.starts`, ADR 0102). A Project whose folder is missing is
 * found first.
 */
export function clickOf(
  starts: ProjectId,
  only: ProjectId | undefined,
  projects: readonly ProjectSummary[]
): NewThread {
  const project = only ?? starts
  const { missing } = projects.find((one) => one.id === project) ?? {}
  return { project, ...(missing && { missing }) }
}

/**
 * How the sidebar's own buttons start a Thread, ✎ and the Working tab's
 * when empty: where `clickOf` says, read as it is pressed.
 */
export function useNewThread(
  only: ProjectId | undefined,
  projects: readonly ProjectSummary[]
): () => void {
  const open = useOpen()
  const here = useContext(HereContext)
  return () => newThread(open, clickOf(here.get().starts, only, projects))
}

/**
 * Opens the Pane a row stands for, as `pane.pick` does: where a workspace
 * shows it, or in a new column of the current one. A Thread that woke is
 * seen as its Pane shows it to its Person (ADR 0074).
 */
export function useOpenRow(row: Row): () => void {
  const open = useOpen()
  return () =>
    open("pane.pick", { project: row.project.id, pane: row.listed.pane })
}
