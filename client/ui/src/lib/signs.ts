/**
 * The pictures Projects' signs show (ADR 0070): read from the engine by
 * `projects.sign`, one version a Project, kept for the window's life. A
 * picture read once draws at once wherever the sign is drawn again.
 */
import type { Engine, ProjectId } from "@banda/contract"
import { useSyncExternalStore } from "react"

type Source = (project: ProjectId) => Promise<string | null>

/** A Project's picture at one version: read, or still being read. */
type Kept = { version: string; url?: string }

let source: Source | undefined
const kept = new Map<ProjectId, Kept>()
const heard = new Set<() => void>()

/** Where this window reads signs' pictures: its engine. */
export function readSignsFrom(engine: Engine): void {
  source = (project) => engine.call("projects.sign", { project })
}

/** Reads `project`'s picture at `version`, once, in place of an older one;
 * a read that failed is tried again the next time it is drawn. */
function read(project: ProjectId, version: string): void {
  if (!source || kept.get(project)?.version === version) return
  kept.set(project, { version })
  source(project).then(
    (url) => {
      if (kept.get(project)?.version !== version) return
      if (url) kept.set(project, { version, url })
      else kept.delete(project)
      heard.forEach((hear) => hear())
    },
    () => {
      if (kept.get(project)?.version === version) kept.delete(project)
    }
  )
}

function listen(hear: () => void): () => void {
  heard.add(hear)
  return () => heard.delete(hear)
}

/** The picture of `project`'s sign at `version`, as a `data:` URL; none
 * until it is read, or when it cannot be. */
export function useSignPicture(
  project: ProjectId,
  version: string | undefined
): string | undefined {
  if (version) read(project, version)
  const now = () => {
    const one = kept.get(project)
    return version && one?.version === version ? one.url : undefined
  }
  // Drawn to a string, as a test draws it, a sign shows what is kept too.
  return useSyncExternalStore(listen, now, now)
}
