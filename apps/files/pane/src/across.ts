/**
 * A file's copy from one machine to another, as the window carries it
 * (ADR 0120, decision 4). No engine talks to another, so the window reads
 * the file where it is, a piece at a time, and writes each piece to the
 * machine it goes to (`files.take_piece`), which then puts it in its
 * folder (`files.place`).
 *
 * Whole or not at all: the file is looked at before it is read and
 * after, and one that changed meanwhile is not placed ({@link Changed}).
 * Each call goes `once`: a copy said to have failed never lands later.
 */
import { type Engine, newId, type ProjectId, Refused } from "@banda/contract"
import type { Mint } from "@banda/ui/hooks/use-file-url"
import { nameOf } from "./where"

/** The most bytes of a file one piece carries, as the engine takes it. */
export const PIECE = 512 * 1024

/** How long a piece may take to read, in ms. */
const SLOW = 60_000

/** One end of a copy: its machine's engine, and the Project. */
export type End = { engine: Engine; project: ProjectId }

/** What a file is before it is read and after: its bytes, and what says
 * it is the same file still. */
export type Looked = { size: number; stamp: string }

/** A file to carry: its name, how it is looked at, and how its bytes
 * from `at` are read, `PIECE` of them at most, until `stop` says. */
export type Source = {
  name: string
  look: () => Promise<Looked>
  read: (at: number, stop: AbortSignal) => Promise<Uint8Array>
}

/** A folder was asked to go, and only files do. */
export class Folder extends Error {
  constructor() {
    super("Folders don't go between machines yet.")
    this.name = "Folder"
  }
}

/** The file changed where it is while it was read. */
export class Changed extends Error {
  readonly file: string
  constructor(file: string) {
    super(`${file} changed while it was copied.`)
    this.file = file
    this.name = "Changed"
  }
}

/** The copy was stopped, as asked. */
export class Stopped extends Error {
  constructor() {
    super("The copy was stopped.")
    this.name = "Stopped"
  }
}

/** A file that cannot be read where it is, in words. */
const unread = (message: string) => new Refused({ code: "conflict", message })

/** The file at `path` on the machine of `from`, read through the URL
 * `mint` gives it, by range. */
export function machineFile(from: End, path: string, mint: Mint): Source {
  let url: Promise<string | null> | undefined
  return {
    name: nameOf(path),
    look: async () => {
      const [stat] = await from.engine.call(
        "files.stat",
        { paths: [path] },
        { project: from.project, once: true }
      )
      if (!stat) throw unread(`${nameOf(path)} is not there.`)
      if (stat.kind === "folder") throw new Folder()
      const size = stat.size ?? 0
      return { size, stamp: `${size} ${stat.modified}` }
    },
    read: async (at, stop) => {
      // Asked for again where the URL died, as its hour ended or its
      // engine restarted; and never waited on for ever, as while its
      // machine is away.
      for (const again of [true, false]) {
        url ??= mint(path)
        const from = await url
        if (from === null) throw unread(`${nameOf(path)} may not be read.`)
        const answer = await fetch(from, {
          headers: { Range: `bytes=${at}-${at + PIECE - 1}` },
          signal: AbortSignal.any([stop, AbortSignal.timeout(SLOW)]),
        }).catch(() => undefined)
        if (answer?.status === 206)
          return new Uint8Array(await answer.arrayBuffer())
        url = undefined
        if (answer?.ok || !again) break
      }
      throw unread(`${nameOf(path)} could not be read.`)
    },
  }
}

/** A file another app dropped, read from the drop. */
export function droppedFile(file: File): Source {
  return {
    name: file.name,
    look: () =>
      Promise.resolve({
        size: file.size,
        stamp: `${file.size} ${file.lastModified}`,
      }),
    read: async (at) =>
      new Uint8Array(await file.slice(at, at + PIECE).arrayBuffer()),
  }
}

/** Bytes as base64, a part at a time: a piece is too long to spread. */
function base64(bytes: Uint8Array): string {
  let text = ""
  for (let at = 0; at < bytes.length; at += 0x8000)
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(text)
}

/**
 * Carries `source`, as it `looked` before, to the machine of `to` as
 * copy `job`: each piece in its order, `onBytes` hearing how many went,
 * until `stop` says the Person stopped it ({@link Stopped}). Nothing is in a
 * folder yet: `files.place` puts it there, and `files.cancel` takes the
 * pieces away.
 */
export async function carry(
  to: End,
  source: Source,
  looked: Looked,
  job: string,
  onBytes: (bytes: number) => void,
  stop: AbortSignal
): Promise<void> {
  const stopped = () => {
    if (stop.aborted) throw new Stopped()
  }
  for (let at = 0; at < looked.size;) {
    stopped()
    const piece = await source.read(at, stop).catch((error: unknown) => {
      stopped()
      throw error
    })
    if (piece.length === 0) break
    stopped()
    await to.engine.commandAt(
      "files.take_piece",
      { job, at, data: base64(piece) },
      to.project,
      newId(),
      { once: true }
    )
    at += piece.length
    onBytes(piece.length)
  }
  if ((await source.look()).stamp !== looked.stamp)
    throw new Changed(source.name)
}
