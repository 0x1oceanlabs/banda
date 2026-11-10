/**
 * What the git button runs (ADR 0034, decisions 3 and 4): the whole
 * chain at once, a message the Thread's Harness writes (`git.prompt`,
 * `agents.write`, `git.written`), then `git.act`. A run is the Project's,
 * not a card's: a card hidden and shown again finds it where it is, and
 * a second press while it runs does nothing. While the message is
 * written, Stop ends the run quietly: `agents.write` let go stops the
 * Harness's run, and nothing is committed.
 *
 * A press is one act (ADR 0106, law 4): its reads go `once`, as the
 * writer and `git.act` do, so while the Project's machine is away it is
 * refused whole, at once, and never completes later by itself.
 */
import {
  type Engine,
  Lost,
  type ProjectId,
  type Refusal,
  Refused,
  Unreachable,
} from "@banda/contract"
import type { Action, Step } from "@banda/contract/git"
import { problem } from "@banda/ui/lib/words"
import { afterRun, type Ended } from "./ended"
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
  | Ended

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

/** Each run's name, as its button says it, and as words that say it was
 * not done name it: "arc is away: Commit was not sent." */
const NAMES: Record<Action, string> = {
  commit: "Commit",
  commit_push: "Commit & push",
  push: "Push",
  pull: "Pull",
}

const STEPS: Record<Step, string> = {
  branching: "Making the branch…",
  committing: "Committing…",
  pushing: "Pushing…",
  pulling: "Pulling…",
}

const runs = new Map<ProjectId, Run>()
const hearing = new Map<ProjectId, Set<() => void>>()
/** What stops each Project's run while its message is written. */
const stopping = new Map<ProjectId, AbortController>()

function set(project: ProjectId, run: Run): void {
  runs.set(project, run)
  for (const hear of hearing.get(project) ?? []) hear()
}

/** The Project's run as it is now. */
export function runOf(project: ProjectId): Run {
  return runs.get(project) ?? IDLE
}

/** Hears each change of the Project's run; returns how to stop. */
export function hearRun(project: ProjectId, hear: () => void): () => void {
  const all = hearing.get(project) ?? new Set()
  hearing.set(project, all.add(hear))
  return () => all.delete(hear)
}

/** Puts a failed run's error away. */
export function dismiss(project: ProjectId): void {
  if (runOf(project).is === "failed") set(project, IDLE)
}

/** Stops the Project's run while its message is written: nothing is
 * committed, and the button is back. */
export function stop(project: ProjectId): void {
  stopping.get(project)?.abort()
}

/** Who writes a commit's message: a Thread's Harness, or the one a new
 * Thread starts on; `name` is the Harness's, as the window says it. */
export type Writer = { name: string } & (
  { thread: string } | { harness: string }
)

/** What `writer` replies to `prompt`, heard on `agents.write`; null once
 * `signal` aborts, which lets it go and so stops the Harness's run. Heard
 * once: a reconnect never runs the writer again, and one refused or cut
 * off by the client fails with its error, in its machine's words. */
function written(
  engine: Engine,
  project: ProjectId,
  { name, ...who }: Writer,
  prompt: string,
  signal: AbortSignal
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const letGo = engine.stream(
      project,
      "agents.write",
      { ...who, prompt },
      (piece) =>
        piece.kind === "reply"
          ? resolve(piece.text)
          : reject(new Refused(piece.refusal)),
      (refusal, error) => {
        const message = `${name} stopped without writing the message.`
        if (error) reject(unsent(error))
        else reject(new Refused(refusal ?? { code: "conflict", message }))
      },
      { once: true }
    )
    signal.addEventListener(
      "abort",
      () => {
        letGo()
        resolve(null)
      },
      { once: true }
    )
  })
}

/** `error` as one that was not sent: the writer cut off on its way may
 * have run, but nothing is committed before it replies, so the Commit was
 * not sent. */
function unsent(error: Error): Error {
  if (error instanceof Unreachable) {
    const { host, message, machine, as_of } = error
    return new Unreachable(host, message, { machine, as_of })
  }
  return error instanceof Lost ? new Lost() : error
}

/** How a commit goes: on a new branch named for the change (`feature`),
 * of these `files` alone, with the Person's `message`. */
export type Commit = {
  feature?: boolean
  files?: string[]
  message?: string
}

/** Runs `action` in `project`, its message the Person's, else written by
 * `writer`. */
export async function run(
  engine: Engine,
  project: ProjectId,
  writer: Writer | null,
  action: Action,
  { feature = false, files, message: own }: Commit = {}
): Promise<void> {
  if (runOf(project).is === "running") return
  const commits = action === "commit" || action === "commit_push"
  // A commit with no message of the Person's: the Harness writes it.
  const writes = commits && !own
  if (writes && writer === null)
    return set(project, { is: "failed", message: NO_WRITER })
  const thread = writer && "thread" in writer ? writer.thread : null
  const writing = writes ? writer : null
  const step = (label: string, stops?: true) =>
    set(project, {
      is: "running",
      label,
      since: Date.now(),
      ...(stops && { stops }),
    })
  // How it ended, which a Person with no card in sight hears too.
  const end = (how: Ended) => {
    set(project, how)
    afterRun(project, how)
  }
  // Stopped while the message is written, the run ends here quietly.
  const stopper = new AbortController()
  const { signal } = stopper
  if (writing) {
    stopping.set(project, stopper)
    signal.addEventListener("abort", () => set(project, IDLE), { once: true })
    step(`${writing.name} is writing the message…`, true)
  } else step("Starting…")
  try {
    let message = own
    let branch: string | undefined
    const ask = { project, once: true }
    if (writing) {
      const { prompt } = await engine.call(
        "git.prompt",
        { files, branch: feature },
        ask
      )
      if (signal.aborted) return
      const reply = await written(engine, project, writing, prompt, signal)
      if (reply === null || signal.aborted) return
      // Written: from here it goes on to the end, as a commit does.
      if (stopping.get(project) === stopper) stopping.delete(project)
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
      const now = runOf(project)
      if (now.is === "running") set(project, { ...now, line })
    }
    engine.stream(
      project,
      "git.act",
      // The Thread's Agent hears what each step changed (`git.acted`).
      { action, message, files, branch, ...(thread && { thread }) },
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
            const done: Ended = { is: "done", ...piece.done }
            end(done)
            // ✓ stays ten seconds, then the button is back.
            setTimeout(
              () => runOf(project) === done && set(project, IDLE),
              DONE_FOR
            )
            return
          }
          case "failed":
            ended = true
            return end({ is: "failed", message: piece.message })
        }
      },
      (refusal, error) => {
        // A line due after it ended shows nowhere: the run is not running.
        clearTimeout(showing)
        if (ended) return
        end({ is: "failed", message: endWords(action, refusal, error) })
      },
      // Heard again after a reconnect, it would commit or push again.
      { once: true }
    )
  } catch (error) {
    if (!signal.aborted)
      end({ is: "failed", message: problem(error, NAMES[action]) })
  } finally {
    if (stopping.get(project) === stopper) stopping.delete(project)
  }
}

/** Why `git.act` for `action` ended with no ✓ or error of git's: what
 * the client says, as it was refused or cut off on its way, naming the
 * machine and the run; else as the engine refused it. */
function endWords(
  action: Action,
  refusal: Refusal | undefined,
  error: Error | undefined
): string {
  if (error) return problem(error, NAMES[action])
  if (!refusal) return UNSAID
  return refusal.code === "may_have_run" ? LOST : refusal.message
}
