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
 * refused whole, at once, and never completes later by itself. A run cut
 * off once `git.act` was asked may have gone through: it goes on on its
 * machine, and is never asked again by itself (a safe resend is #1233).
 * Check reads that machine's git again and says what became of it.
 */
import {
  type Engine,
  Lost,
  type ProjectId,
  type Refusal,
  Refused,
  Unreachable,
} from "@banda/contract"
import type { Action, Status, Step } from "@banda/contract/git"
import { problem } from "@banda/ui/lib/words"
import { afterRun, type Ended, type Unsure } from "./ended"
import { NO_WRITER } from "./quick"
import { statusOf } from "./status"

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

/** Shows ✓ for `done`; it stays ten seconds, then the button is back. */
function showDone(project: ProjectId, done: Ended & { is: "done" }): void {
  set(project, done)
  setTimeout(() => runOf(project) === done && set(project, IDLE), DONE_FOR)
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
    // What Check compares with, should this be cut off on its way.
    const before = statusOf(engine, project)
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
            const done = { is: "done" as const, ...piece.done }
            showDone(project, done)
            afterRun(project, done)
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
        end({
          is: "failed",
          message: endWords(action, refusal, error),
          // Cut off on its way, it may have gone through: Check tells.
          ...(refusal?.code === "may_have_run" &&
            before && { check: { action, head: before.head } }),
        })
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

/**
 * Reads the Project's git again after a run cut off on its way, and says
 * what became of it: ✓ if it went through; else the run stays one to
 * Check, in words that say it has not gone through yet, as it goes on on
 * its machine and may still. A read the Person asked for, it is refused
 * at once while the machine is away, never answered later by itself.
 */
export async function check(engine: Engine, project: ProjectId): Promise<void> {
  const was = runOf(project)
  if (was.is !== "failed" || !was.check) return
  set(project, { is: "running", label: "Checking…", since: Date.now() })
  try {
    const now = await engine.call("git.status", {}, { project, once: true })
    const done = wentThrough(was.check, now)
    if (done) showDone(project, { is: "done", title: done })
    else set(project, { ...was, message: notThrough(was.check, now) })
  } catch (error) {
    set(project, { ...was, message: problem(error, "Check") })
  }
}

/** Whether the commit `now` is made since the run, as its head moved. */
const committed = ({ head }: Unsure, now: Status) => now.head !== head

/** Whether the branch `now` has nothing its upstream lacks. */
const pushed = (now: Status) => now.upstream !== undefined && now.ahead === 0

/** What says the run went through, as git reads `now`; none if not yet. */
function wentThrough(unsure: Unsure, now: Status): string | undefined {
  const { action } = unsure
  const went =
    action === "commit"
      ? committed(unsure, now)
      : action === "push"
        ? pushed(now)
        : action === "pull"
          ? now.behind === 0
          : committed(unsure, now) && pushed(now)
  return went ? `${NAMES[action]} went through` : undefined
}

/** What says the run has not gone through, as git reads `now`: a commit
 * made with its push not yet says so. */
function notThrough(unsure: Unsure, now: Status): string {
  return unsure.action === "commit_push" && committed(unsure, now)
    ? "Committed, but Push has not gone through yet."
    : `${NAMES[unsure.action]} has not gone through yet.`
}
