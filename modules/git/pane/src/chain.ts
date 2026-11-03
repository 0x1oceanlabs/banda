/**
 * What the git button runs (ADR 0034, decisions 3 and 4): the whole
 * chain at once, a message the Thread's Harness writes (`git.prompt`,
 * `agents.write`, `git.written`), then `git.act`. A run is the Space's,
 * not a card's: a card hidden and shown again finds it where it is, and
 * a second press while it runs does nothing.
 */
import type { Engine, SpaceId } from "@banda/contract"
import type { Action, Step } from "@banda/contract/git"
import { problem } from "@banda/ui/lib/words"

export type Run =
  | { is: "idle" }
  | { is: "running"; label: string; line?: string; since: number }
  | { is: "done"; title: string; detail?: string }
  | { is: "failed"; message: string }

const IDLE: Run = { is: "idle" }

/** How long ✓ stays, as T3 Code's. */
const DONE_FOR = 10_000
/** How often a hook's lines are shown at most, as it prints them. */
const LINES_EVERY = 200

const STEPS: Record<Step, string> = {
  branching: "Making the branch…",
  committing: "Committing…",
  pushing: "Pushing…",
  pulling: "Pulling…",
}

const runs = new Map<SpaceId, Run>()
const hearing = new Map<SpaceId, Set<() => void>>()

function set(space: SpaceId, run: Run): void {
  runs.set(space, run)
  for (const hear of hearing.get(space) ?? []) hear()
}

/** The Space's run as it is now. */
export function runOf(space: SpaceId): Run {
  return runs.get(space) ?? IDLE
}

/** Hears each change of the Space's run; returns how to stop. */
export function hearRun(space: SpaceId, hear: () => void): () => void {
  const all = hearing.get(space) ?? new Set()
  hearing.set(space, all.add(hear))
  return () => all.delete(hear)
}

/** Puts a failed run's error away. */
export function dismiss(space: SpaceId): void {
  if (runOf(space).is === "failed") set(space, IDLE)
}

/** Runs `action` in `space`, its message written by `thread`'s Harness;
 * with `feature`, on a new branch named for the change. */
export async function run(
  engine: Engine,
  space: SpaceId,
  thread: string | null,
  action: Action,
  feature = false
): Promise<void> {
  if (runOf(space).is === "running") return
  const commits = action === "commit" || action === "commit_push"
  if (commits && thread === null)
    return set(space, {
      is: "failed",
      message: "A new Thread has no Harness to write the message yet.",
    })
  const step = (label: string) =>
    set(space, { is: "running", label, since: Date.now() })
  step(commits ? "Writing commit message…" : "Starting…")
  try {
    let message: string | undefined
    let branch: string | undefined
    if (commits && thread !== null) {
      const ask = { space }
      const { prompt } = await engine.call(
        "git.prompt",
        { branch: feature },
        ask
      )
      const { text } = await engine.call(
        "agents.write",
        { thread, prompt },
        ask
      )
      const written = await engine.call(
        "git.written",
        { reply: text, branch: feature },
        ask
      )
      message = written.message
      branch = written.branch
    }
    // A hook's lines come as fast as it prints them: the last one shows.
    let line: string | undefined
    let showing: ReturnType<typeof setTimeout> | undefined
    const showLine = () => {
      showing = undefined
      const now = runOf(space)
      if (now.is === "running") set(space, { ...now, line })
    }
    engine.stream(
      space,
      "git.act",
      { action, message, branch },
      (piece) => {
        switch (piece.kind) {
          case "step":
          case "hook":
            line = undefined
            clearTimeout(showing)
            return step(
              piece.kind === "step"
                ? STEPS[piece.step]
                : `Running ${piece.name}…`
            )
          case "line":
            line = piece.line
            showing ??= setTimeout(showLine, LINES_EVERY)
            return
          case "done": {
            clearTimeout(showing)
            const done: Run = { is: "done", ...piece.done }
            set(space, done)
            // ✓ stays ten seconds, then the button is back.
            setTimeout(
              () => runOf(space) === done && set(space, IDLE),
              DONE_FOR
            )
            return
          }
          case "failed":
            clearTimeout(showing)
            return set(space, { is: "failed", message: piece.message })
        }
      },
      (refusal) => {
        if (refusal) set(space, { is: "failed", message: refusal.message })
      }
    )
  } catch (error) {
    set(space, { is: "failed", message: problem(error) })
  }
}
