/**
 * What Files can undo (ADR 0073, decision 10): each operation answers the
 * steps that undo it, and the window keeps the last few, its own, the
 * latest last. Mod+Z takes the latest, and a toast's Undo its own. The
 * steps are Files' commands again, run in order; a move back asks, so
 * nothing is written over a name taken since.
 */
import { type Engine, type ProjectId, Refused } from "@banda/contract"
import type { Job, MoveAsk, Step } from "@banda/contract/files"

/** One operation that can be undone: what it was, and its steps. */
export type Undoable = {
  /** As a toast says it: `Moved a.txt to the Trash`. */
  title: string
  project: ProjectId
  steps: readonly Step[]
}

/** How many operations a window keeps to undo. */
const KEPT = 20

let kept: Undoable[] = []

/** Keeps `done` to undo, the latest; none with no steps. */
export function remember(done: Undoable): void {
  if (done.steps.length === 0) return
  kept = [...kept.filter((one) => one !== done), done].slice(-KEPT)
}

/** Takes the latest operation to undo, in `project` if it says one. */
export function takeLatest(project?: ProjectId): Undoable | undefined {
  const at = kept.findLastIndex(
    (one) => project === undefined || one.project === project
  )
  if (at === -1) return undefined
  const [latest] = kept.splice(at, 1)
  return latest
}

/** Takes `done` out, as its toast's Undo runs it; whether it was kept. */
export function take(done: Undoable): boolean {
  const before = kept.length
  kept = kept.filter((one) => one !== done)
  return kept.length < before
}

/** Forgets every one: for tests. */
export function forgetAll(): void {
  kept = []
}

/** Runs `steps` in order, as Files' commands; the first that cannot be
 * done stops the rest, and says why. */
export async function runSteps(
  engine: Engine,
  project: ProjectId,
  steps: readonly Step[]
): Promise<void> {
  for (const step of steps) {
    switch (step.kind) {
      case "rename":
        await engine.command(
          "files.rename",
          { path: step.path, name: step.name },
          project
        )
        break
      case "move": {
        const job = await lastPiece(engine, project, "files.move", {
          paths: step.paths,
          dir: step.dir,
          clash: "ask",
        })
        if (job.kind === "clashes")
          throw new Refused({
            code: "conflict",
            message: `${job.clashes.map((one) => one.name).join(", ")} ${job.clashes.length === 1 ? "is" : "are"} there again.`,
          })
        if (job.kind === "done" && job.failed)
          throw new Refused({ code: "conflict", message: job.failed })
        break
      }
      case "trash":
        await engine.command("files.trash", { paths: step.paths }, project)
        break
      case "restore":
        await engine.command("files.restore", { items: step.items }, project)
        break
    }
  }
}

/** A move's or a copy's last piece, as it ends: its clashes, or what it
 * did. */
export function lastPiece(
  engine: Engine,
  project: ProjectId,
  method: "files.move" | "files.copy",
  ask: MoveAsk,
  onPiece?: (job: Job) => void
): Promise<Exclude<Job, { kind: "progress" }>> {
  return new Promise((resolve, reject) => {
    let last: Exclude<Job, { kind: "progress" }> | undefined
    engine.stream(
      project,
      method,
      ask,
      (job) => {
        onPiece?.(job)
        if (job.kind !== "progress") last = job
      },
      (refusal) => {
        if (refusal) reject(new Refused(refusal))
        else if (last) resolve(last)
        else
          reject(
            new Refused({
              code: "conflict",
              message: "Files stopped without saying what it did.",
            })
          )
      },
      { once: true }
    )
  })
}
