/**
 * "Move all" (ADR 0078, decision 7): an account's limit stops every Thread
 * that runs on it, so its card and the limits widget move them all to
 * another account at one click of the Person's. Banda never moves one by
 * itself.
 */
import type { Engine, ProjectId } from "@banda/contract"
import type { ListedThread, TurnId } from "@banda/contract/agents"
import { useRead } from "@banda/ui/hooks/use-read"
import { openProjects } from "@banda/ui/lib/projects"
import { useMemo } from "react"
import { readThreads } from "../list/list"

/** A turn a limit stopped, and where its Thread is. */
export type Waiting = { project: ProjectId; turn: TurnId }

/** Whether `listed` waits on `account`: its latest turn ended by a usage
 * limit there, and it is not archived. */
export function waitsOn(listed: ListedThread, account: string): boolean {
  const { latest } = listed
  return (
    listed.harness === account &&
    !listed.archived &&
    latest?.state === "failed" &&
    latest.failure?.class === "usage_limit"
  )
}

/** The Threads of every Project on this machine that wait on `account`. */
export async function waitingOn(
  engine: Engine,
  account: string
): Promise<Waiting[]> {
  const projects = openProjects(await engine.call("projects.list", {}))
  const lists = await Promise.all(
    projects.map(async ({ id: project }) => {
      const { threads } = await readThreads(engine, project).catch(() => ({
        threads: [] as ListedThread[],
      }))
      return threads
        .filter((listed) => waitsOn(listed, account))
        .map((listed) => ({ project, turn: listed.latest!.turn }))
    })
  )
  return lists.flat()
}

/** Each of `waiting` goes on with account `to`, as its card's way on does:
 * woken, moved, and its stopped turn sent again. One the engine refuses
 * stays where it is. */
export async function moveAll(
  engine: Engine,
  waiting: readonly Waiting[],
  to: string
): Promise<void> {
  await Promise.allSettled(
    waiting.map(({ project, turn }) =>
      engine.command("agents.go_on", { turn, harness: to }, project)
    )
  )
}

/** The Threads that wait on `account`, read once as what draws them
 * mounts; none while there is no account. */
export function useWaitingOn(engine: Engine, account?: string): Waiting[] {
  const read = useRead(
    useMemo(
      () => (account === undefined ? null : () => waitingOn(engine, account)),
      [engine, account]
    )
  )
  return read.state === "ready" ? read.value : NONE
}

const NONE: Waiting[] = []
