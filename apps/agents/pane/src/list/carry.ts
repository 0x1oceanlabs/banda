/**
 * A Thread's move to a Project on another machine, as the Window carries
 * it (ADR 0116, decision 4). No engine talks to another, so the Window
 * reads the Thread from its machine and writes it to the other, in three
 * steps: it looks at both folders ({@link look}); it packs the Thread and
 * its folder's work and carries them in pieces; then the other machine
 * unpacks them and the Thread leaves ({@link carry}).
 *
 * Until the other machine unpacks, nothing there changed, and the move
 * stops as asked ({@link Stopped}). From then on it goes through: the
 * folder's work first, so what refuses a folder refuses the move before
 * the Thread arrives; then the Thread; then it leaves its machine. A
 * Thread that does not leave, as one that went on meanwhile, stays, and
 * the other machine gives its copy back.
 *
 * Each call goes `once`: a move said to have failed never lands later.
 */
import {
  type Answer,
  type Engine,
  newId,
  type ProjectId,
  Refused,
} from "@banda/contract"
import type { ThreadId } from "@banda/contract/agents"

/** One end of a move: its machine's engine and name, and the Project. */
export type End = {
  engine: Engine
  project: ProjectId
  /** The machine's name, as the Window shows it. */
  machine: string
  /** The Project's name. */
  name: string
}

/** A Thread's move from one machine to another. */
export type Way = { thread: ThreadId; from: End; to: End }

/**
 * What a move does with the folder's work, as both folders say before
 * anything is carried (ADR 0116, decision 8).
 */
export type Looked =
  /** It goes: the branch, how many files are changed and not committed,
   * how many commits its upstream lacks, and the commits the other folder
   * has already. */
  | {
      kind: "goes"
      branch?: string
      changed: number
      ahead: number
      have: readonly string[]
    }
  /** The Thread moves alone, and `why` says so. */
  | { kind: "stays"; why: string }
  /** Nothing moves, and `why` says what to do first. */
  | { kind: "refused"; why: string }

/** The move was stopped, as asked, before anything changed. */
export class Stopped extends Error {
  constructor() {
    super("The move was stopped.")
    this.name = "Stopped"
  }
}

/** How far a move is: the bytes carried, of all there are, and whether
 * the other machine unpacks them now, from when it goes through. */
export type Progress = { done: number; of: number; arriving?: true }

/** A read of an engine that fails at once while its machine is away. */
const read = <M extends "git.folder_for" | "git.status" | "agents.packed">(
  { engine, project }: End,
  method: M,
  params: Parameters<Engine["call"]>[1]
): Promise<Answer<M>> =>
  engine.call(method, params as never, { project, once: true }) as Promise<
    Answer<M>
  >

/** An act of an engine, sent once. */
async function act<T>(
  { engine, project }: End,
  method: string,
  params: object
): Promise<T> {
  const sent = await engine.commandAt(
    method as never,
    params as never,
    project,
    newId(),
    { once: true }
  )
  return sent.answer as T
}

/** The Git App's acts are calls that act: sent once, never again. */
const gitAct = <T>({ engine, project }: End, method: string, params: object) =>
  engine.call(method as never, params as never, {
    project,
    once: true,
  }) as Promise<T>

/** Whether `error` says a machine's engine has no such method, as one
 * whose Git App is off. */
const lacks = (error: unknown) =>
  error instanceof Refused &&
  (error.refusal.code === "not_found" || error.refusal.code === "invalid")

/**
 * What the move does with the folder's work: it goes when both folders
 * are the same repository and the other one is free; else the Thread
 * moves alone, or, where the other folder has changes of its own, nothing
 * moves.
 */
export async function look({ from, to }: Omit<Way, "thread">): Promise<Looked> {
  const stays = (why: string): Looked => ({
    kind: "stays",
    why: `${why}, so the code stays on ${from.machine}.`,
  })
  let ours: Answer<"git.folder_for">
  try {
    ours = await read(from, "git.folder_for", { commits: [] })
  } catch (error) {
    if (lacks(error)) return stays("Git is off for this Project")
    throw error
  }
  if (!ours.git) return stays("This folder is not a git repository")
  let theirs: Answer<"git.folder_for">
  try {
    theirs = await read(to, "git.folder_for", { commits: ours.tips })
  } catch (error) {
    if (lacks(error)) return stays(`Git is off for ${to.name} on ${to.machine}`)
    throw error
  }
  const there = `${to.name} on ${to.machine}`
  if (!theirs.git) return stays(`${there} is not a git repository`)
  if (theirs.has.length === 0)
    return stays(`${there} has none of this branch's commits`)
  if (!theirs.free)
    return {
      kind: "refused",
      why: `${there} has changes that are not committed: commit or stash them there, then move the Thread.`,
    }
  const status = await read(from, "git.status", {})
  return {
    kind: "goes",
    ...(status.branch && { branch: status.branch }),
    changed: status.files.length,
    ahead: status.ahead ?? 0,
    have: theirs.has,
  }
}

/** How many bytes a piece's base64 holds. */
const bytesOf = (data: string) =>
  Math.floor((data.length * 3) / 4) -
  (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0)

/**
 * Carries the Thread of `way`, and its folder's work when `looked` says
 * it goes, and has it leave its machine. `message`, if any, is sent to
 * its Agent on the other machine once it arrived. `stop`, asked before
 * the other machine unpacks, stops it there ({@link Stopped}).
 */
export async function carry(
  { thread, from, to }: Way,
  looked: Looked,
  {
    message,
    stop,
    onProgress,
  }: {
    message?: string
    stop?: AbortSignal
    onProgress?: (progress: Progress) => void
  } = {}
): Promise<void> {
  if (looked.kind === "refused") throw new Error(looked.why)
  const stopped = () => {
    if (stop?.aborted) throw new Stopped()
  }
  const packed = await act<Answer<"agents.pack_thread">>(
    from,
    "agents.pack_thread",
    { thread }
  )
  const move = packed.move
  stopped()
  const folder =
    looked.kind === "goes"
      ? await gitAct<Answer<"git.pack_folder">>(from, "git.pack_folder", {
          move,
          thread,
          have: looked.have,
        })
      : undefined
  const progress = { done: 0, of: packed.size + (folder?.size ?? 0) }
  onProgress?.(progress)
  const pieces = async (part: "thread" | "folder") => {
    for (let at = 0; ;) {
      stopped()
      const piece = await read(from, "agents.packed", { move, part, at })
      await act(to, "agents.take_piece", { move, part, at, data: piece.data })
      const size = bytesOf(piece.data)
      at += size
      progress.done += size
      onProgress?.({ ...progress })
      if (!piece.more) return
    }
  }
  if (folder) await pieces("folder")
  await pieces("thread")
  stopped()
  // From here the other machine changes: it goes through.
  onProgress?.({ ...progress, arriving: true })
  if (folder)
    await gitAct(to, "git.unpack_folder", {
      move,
      thread,
      ...(folder.branch && { branch: folder.branch }),
      head: folder.head,
      sha256: folder.sha256,
    })
  try {
    await act(to, "agents.unpack_thread", {
      move,
      sha256: packed.sha256,
      from: from.machine,
      on: to.machine,
      folder: folder !== undefined,
    })
  } catch (error) {
    if (!folder) throw error
    const on = folder.branch ? `, on ${folder.branch}` : ""
    throw new Error(
      `${wordsOf(error)} The folder's work is on ${to.machine} already${on}.`,
      { cause: error }
    )
  }
  try {
    await act(from, "agents.leave_thread", {
      move,
      project: to.project,
      machine: to.machine,
    })
  } catch (error) {
    // It stays where it was, so its copy goes: asked only now, as after a
    // Thread left its copy is the Thread.
    await act(to, "agents.give_back", { move }).catch(() => undefined)
    throw error
  }
  if (message?.trim())
    await act(to, "agents.send", { thread, text: message.trim() }).catch(
      (error: unknown) => {
        throw new Unsent(wordsOf(error), message.trim())
      }
    )
}

/** The Thread moved, and the message for its Agent there was not sent:
 * its words go back to the Person. */
export class Unsent extends Error {
  readonly words: string
  constructor(why: string, words: string) {
    super(why)
    this.name = "Unsent"
    this.words = words
  }
}

/** What an error says, as a sentence. */
function wordsOf(error: unknown): string {
  const said =
    error instanceof Refused
      ? error.refusal.message
      : error instanceof Error
        ? error.message
        : String(error)
  return /[.!?]$/.test(said) ? said : `${said}.`
}
