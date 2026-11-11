/**
 * The pictures Projects' signs show (ADR 0070): read by `projects.sign`
 * from the engine of the machine each Project is on (ADR 0106, law 1), one
 * version a Project, kept for the window's life, by session, as each
 * session is its own store. A picture read once draws at once wherever
 * the sign is drawn again.
 */
import type { Engine, ProjectId } from "@banda/contract"
import { useReach } from "@banda/core/react"
import { useSyncExternalStore } from "react"

/** A Project's picture at one version: read, or still being read. */
type Kept = { version: string; url?: string }

/** What each session has read, by Project. */
const kept = new WeakMap<Engine, Map<ProjectId, Kept>>()
const heard = new Set<() => void>()

function keptOn(engine: Engine): Map<ProjectId, Kept> {
  const was = kept.get(engine)
  if (was) return was
  const made = new Map<ProjectId, Kept>()
  kept.set(engine, made)
  return made
}

/** Reads `project`'s picture at `version` from `engine`, once, in place of
 * an older one; a read that failed is tried again the next time it is
 * drawn. */
function read(engine: Engine, project: ProjectId, version: string): void {
  const on = keptOn(engine)
  if (on.get(project)?.version === version) return
  on.set(project, { version })
  engine.call("projects.sign", { project }).then(
    (url) => {
      if (on.get(project)?.version !== version) return
      if (url) on.set(project, { version, url })
      else on.delete(project)
      heard.forEach((hear) => hear())
    },
    () => {
      if (on.get(project)?.version === version) on.delete(project)
    }
  )
}

function listen(hear: () => void): () => void {
  heard.add(hear)
  return () => heard.delete(hear)
}

/** The picture of `project`'s sign at `version`, as a `data:` URL, from
 * the machine it is on; none until it is read, or when it cannot be. */
export function useSignPicture(
  project: ProjectId,
  version: string
): string | undefined {
  const { engine } = useReach(project, undefined)
  if (engine) read(engine, project, version)
  const now = () => {
    const one = engine && kept.get(engine)?.get(project)
    return one?.version === version ? one.url : undefined
  }
  // Drawn to a string, as a test draws it, a sign shows what is kept too.
  return useSyncExternalStore(listen, now, now)
}
