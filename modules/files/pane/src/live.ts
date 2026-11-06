/**
 * What Files hears of the Agents of a Project, from the engine by the
 * methods' names (ADR 0073, decisions 3 and 9): its Threads and how their
 * turns stand, the file each running turn works on now, and what a turn
 * changed, from git's checkpoints or else its tool calls.
 */
import { useEffect, useMemo, useState } from "react"
import { Refused, type Engine, type ProjectId } from "@banda/contract"
import type { ListedThread, Touched } from "@banda/contract/agents"
import { READ_AGAIN, type Source, useLive } from "@banda/ui/hooks/use-live"
import { turnPaths } from "./agent"

const NO_THREADS: ListedThread[] = []
const NO_TOUCHED: Touched[] = []

/** The Project's Threads, read again as one starts or a turn starts or
 * ends; none where the engine runs no Agents. */
export function useThreads(
  engine: Engine,
  project: ProjectId
): readonly ListedThread[] {
  const source = useMemo<Source<{ at: number; threads: ListedThread[] }>>(
    () => ({
      read: () => engine.call("agents.threads", {}, { project }),
      filter: {
        module: "agents",
        kinds: ["thread.started", "turn.started", "turn.ended"],
      },
      apply: () => READ_AGAIN,
    }),
    [engine, project]
  )
  const live = useLive(engine, project, source)
  return live.state === "ready" ? live.view.threads : NO_THREADS
}

/** The file each turn at work in the Project works on now
 * (`agents.touching`). */
export function useTouched(
  engine: Engine,
  project: ProjectId
): readonly Touched[] {
  const [touched, setTouched] = useState<readonly Touched[]>(NO_TOUCHED)
  useEffect(
    () =>
      engine.stream(
        project,
        "agents.touching",
        {},
        (piece) => setTouched(piece.touched),
        () => setTouched(NO_TOUCHED)
      ),
    [engine, project]
  )
  return touched
}

/**
 * The files, whole, that the turn `turn` of `thread` changed, in the
 * Project whose folder is `top`: read as it starts, and again as it ends
 * or the Thread is rewound.
 */
export function useTurned(
  engine: Engine,
  project: ProjectId,
  thread: string | null,
  turn: string | null,
  top: string | null
): readonly string[] {
  const source = useMemo<Source<{ at: number; paths: string[] }> | null>(
    () =>
      thread && turn && top
        ? {
            read: async () => {
              const scope = { kind: "turn" as const, thread, turn }
              const [kept, changes] = await Promise.all([
                engine
                  .call("git.diff", { scope }, { project })
                  // No checkpoint of the turn, no repository, or no git.
                  .catch((error: unknown) => {
                    if (error instanceof Refused) return null
                    throw error
                  }),
                engine.call("agents.changes", { thread, turn }, { project }),
              ])
              return {
                at: changes.at,
                paths: turnPaths(
                  kept ? kept.files.map((file) => file.path) : null,
                  changes.files.map((file) => file.path),
                  top
                ),
              }
            },
            filter: {
              module: "agents",
              subject: thread,
              kinds: ["turn.ended", "thread.rewound"],
            },
            apply: () => READ_AGAIN,
          }
        : null,
    [engine, project, thread, turn, top]
  )
  const live = useLive(engine, project, source)
  return live.state === "ready" ? live.view.paths : NO_PATHS
}

const NO_PATHS: string[] = []
