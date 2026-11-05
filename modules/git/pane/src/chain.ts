/**
 * What the git button runs (ADR 0034, decisions 3 and 4): the whole
 * chain at once, a message the Thread's Harness writes (`git.prompt`,
 * `agents.write`, `git.written`), then `git.act`. A run is the Space's,
 * not a card's: a card hidden and shown again finds it where it is, and
 * a second press while it runs does nothing. While the message is
 * written, Stop ends the run quietly: `agents.write` let go stops the
 * Harness's run, and nothing is committed.
 */
import { type Engine, Refused, type SpaceId } from "@banda/contract"
import type { Action, Step } from "@banda/contract/git"
import { problem } from "@banda/ui/lib/words"
import { NO_WRITER } from "./quick"

type Run =
  | { is: "idle" }
  | {
      is: "running"
      label: string
      line?: string
      since: number
      /** It can be stopped: the message is being written. */
      stops?: boolean
    }
  | { is: "done"; title: string; detail?: string }
  | { is: "failed"; message: string }

const IDLE: Run = { is: "idle" }

/** How long ✓ stays, as T3 Code's. */
const DONE_FOR = 10_000
/** How often a hook's lines are shown at most, as it prints them. */
const LINES_EVERY = 200

/** What a run says when the connection broke under it: it is not asked
 * again, as it may have run. */
export const LOST = "The connection to the engine was lost; check the status."
/** What a run says when its stream ended with neither ✓ nor an error. */
export const UNSAID = "Git stopped without saying how it ended."

const STEPS: Record<Step, string> = {
  branching: "Making the branch…",
  committing: "Committing…",
  pushing: "Pushing…",
  pulling: "Pulling…",
}

const runs = new Map<SpaceId, Run>()
const hearing = new Map<SpaceId, Set<() => void>>()
/** How to stop each Space's run while its message is written. */
const stopping = new Map<SpaceId, () => void>()

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

/** Stops the Space's run while its message is written: nothing is
 * committed, and the button is back. */
export function stop(space: SpaceId): void {
  stopping.get(space)?.()
}

/** Who writes a commit's message: a Thread's Harness, or the one a new
 * Thread starts on; `name` is the Harness's, as the window says it. */
export type Writer = { name: string } & (
  { thread: string } | { harness: string }
)

/** What `writer` replies to `prompt`, heard on `agents.write`; null once
 * `stopped`, which lets it go and so stops the Harness's run. */
function written(
  engine: Engine,
  space: SpaceId,
  writer: Writer,
  prompt: string,
  stopped: (stop: () => void) => void
): Promise<string | null> {
  const who =
    "thread" in writer ? { thread: writer.thread } : { harness: writer.harness }
  return new Promise((resolve, reject) => {
    const letGo = engine.stream(
      space,
      "agents.write",
      { ...who, prompt },
      (piece) =>
        piece.kind === "reply"
          ? resolve(piece.text)
          : reject(new Refused(piece.refusal)),
      (refusal) => {
        const message = `${writer.name} stopped without writing the message.`
        reject(new Refused(refusal ?? { code: "conflict", message }))
      }
    )
    stopped(() => {
      letGo()
      resolve(null)
    })
  })
}

/** How a commit goes: on a new branch named for the change (`feature`),
 * of these `files` alone, with the Person's `message`. */
export type Commit = {
  feature?: boolean
  files?: string[]
  message?: string
}

/** Runs `action` in `space`, its message the Person's, else written by
 * `writer`. */
export async function run(
  engine: Engine,
  space: SpaceId,
  writer: Writer | null,
  action: Action,
  { feature = false, files, message: own }: Commit = {}
): Promise<void> {
  if (runOf(space).is === "running") return
  const commits = action === "commit" || action === "commit_push"
  // A commit with no message of the Person's: the Harness writes it.
  const writes = commits && !own
  if (writes && writer === null)
    return set(space, { is: "failed", message: NO_WRITER })
  const step = (label: string) =>
    set(space, { is: "running", label, since: Date.now() })
  // Stopped while the message is written, the run ends here quietly.
  let stopped = false
  let letGo = () => {}
  const stopper = () => {
    stopped = true
    letGo()
    set(space, IDLE)
  }
  if (writes && writer !== null) {
    stopping.set(space, stopper)
    set(space, {
      is: "running",
      label: `${writer.name} is writing the message…`,
      since: Date.now(),
      stops: true,
    })
  } else step("Starting…")
  try {
    let message = own
    let branch: string | undefined
    const ask = { space }
    if (writes && writer !== null) {
      const { prompt } = await engine.call(
        "git.prompt",
        { files, branch: feature },
        ask
      )
      if (stopped) return
      const reply = await written(engine, space, writer, prompt, (stop) => {
        letGo = stop
      })
      if (stopped || reply === null) return
      // Written: from here it goes on to the end, as a commit does.
      if (stopping.get(space) === stopper) stopping.delete(space)
      step(STEPS[feature ? "branching" : "committing"])
      ;({ message, branch } = await engine.call(
        "git.written",
        { reply, branch: feature },
        ask
      ))
    } else if (commits && feature && own) {
      // The Person's message names the branch, as a Harness's subject would.
      ;({ branch } = await engine.call(
        "git.written",
        { reply: own, branch: true },
        ask
      ))
    }
    // A hook's lines come as fast as it prints them: the last one shows.
    let ended = false
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
      { action, message, files, branch },
      (piece) => {
        switch (piece.kind) {
          case "step":
          case "hook":
            line = undefined
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
            ended = true
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
            ended = true
            return set(space, { is: "failed", message: piece.message })
        }
      },
      (refusal) => {
        // A line due after it ended shows nowhere: the run is not running.
        clearTimeout(showing)
        if (ended) return
        const message = !refusal
          ? UNSAID
          : refusal.code === "may_have_run"
            ? LOST
            : refusal.message
        set(space, { is: "failed", message })
      },
      // Heard again after a reconnect, it would commit or push again.
      { once: true }
    )
  } catch (error) {
    if (!stopped) set(space, { is: "failed", message: problem(error) })
  } finally {
    if (stopping.get(space) === stopper) stopping.delete(space)
  }
}
