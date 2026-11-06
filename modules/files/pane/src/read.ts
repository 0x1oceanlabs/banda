/**
 * A file as `files.file` shows it: what `files.stat` says it is, its text
 * when it is drawn as text, and the Project's folder it is named from.
 * It follows `files.watch` on the file's folder and reads again as it
 * changes, keeping what it showed till then.
 */
import { useEffect, useRef, useState } from "react"
import { type Engine, type ProjectId, Refused } from "@banda/contract"
import type { Stat } from "@banda/contract/files"
import { nameAndFolder } from "@banda/ui/lib/paths"
import { problem } from "@banda/ui/lib/words"
import { lineCount, startOf } from "./lines"
import { type Look, lookOf } from "./look"

/** A file's text as it is drawn: its start, at most 1 MiB and 20 000
 * lines, or none for a binary file. */
export type Drawn = {
  text?: string
  /** How many lines the text drawn has. */
  lines: number
  /** Whether the file is longer than what is drawn. */
  cut: boolean
  /** The file's whole size in bytes. */
  bytes: number
  binary: boolean
}

export type Shown =
  | { state: "loading" }
  | { state: "refused"; message: string }
  /** No file is there: never was, or went. */
  | { state: "gone" }
  | {
      state: "file"
      stat: Stat
      look: Look
      /** Its text, for a file drawn as text. */
      text?: Drawn
      /** The Project's folder, whole; none where it has none. */
      root: string | null
    }

const LOADING: Shown = { state: "loading" }
/** How long changes rest before the file is read again, in ms: a turn
 * that writes a file many times reads it once. */
const SETTLE = 200
/** How long to wait before reading again after the connection broke. */
const AGAIN = 500

/** What is at `path` in `project`, read now; `held`, what was read last,
 * when the file has not changed since. */
async function readNow(
  engine: Engine,
  project: ProjectId,
  path: string,
  held: Shown | undefined
): Promise<Shown> {
  // "" is the Project's folder, from which a relative path is named.
  const [stat, root] = await engine.call(
    "files.stat",
    { paths: [path, ""] },
    { project }
  )
  if (!stat) return { state: "gone" }
  if (held?.state === "file" && same(held.stat, stat)) return held
  const look = lookOf(stat)
  const shown = { state: "file", stat, look, root: root?.path ?? null } as const
  if (look !== "code" && look !== "markdown") return shown
  const read = await engine.call("files.read", { path: stat.path }, { project })
  const start = read.text === undefined ? undefined : startOf(read.text)
  const text: Drawn = {
    text: start?.text,
    lines: start ? lineCount(start.text) : 0,
    cut: read.truncated || (start?.cut ?? false),
    bytes: read.bytes,
    binary: read.binary,
  }
  return { ...shown, text }
}

/** Whether two looks at a file found it as it was. */
function same(was: Stat, now: Stat): boolean {
  return (
    was.path === now.path &&
    was.kind === now.kind &&
    was.size === now.size &&
    was.modified === now.modified
  )
}

/** What is at `path` in `project`, read again as it changes. */
export function useFile(
  engine: Engine,
  project: ProjectId,
  path: string
): Shown {
  const asked = `${project}\0${path}`
  const [round, setRound] = useState(0)
  const [held, setHeld] = useState<{ asked: string; shown: Shown }>()

  // What was read last, to keep while the file has not changed.
  const last = useRef<Shown>(undefined)
  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const start = () =>
      readNow(engine, project, path, last.current).then(
        (shown) => current && setHeld({ asked, shown }),
        (error: unknown) => {
          if (!current) return
          if (error instanceof Refused)
            setHeld({
              asked,
              shown: { state: "refused", message: problem(error) },
            })
          else timer = setTimeout(start, AGAIN)
        }
      )
    void start()
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [engine, project, path, asked, round])

  const shown = held?.asked === asked ? held.shown : LOADING
  useEffect(() => {
    last.current = shown
  })
  // The folder watched: the file's, as the engine named it, else as the
  // path names it; the Project's for a file at its top.
  const dir =
    shown.state === "file"
      ? (nameAndFolder(shown.stat.path).folder ?? "/")
      : shown.state === "gone"
        ? (nameAndFolder(path).folder ?? "")
        : null

  useEffect(() => {
    if (dir === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let watching = false
    const stop = engine.stream(
      project,
      "files.watch",
      { dirs: [dir] },
      (piece) => {
        // Watched again after the connection broke: what changed
        // meanwhile was not heard.
        if (piece.kind === "watching" && !watching) {
          watching = true
          return
        }
        if (piece.kind === "limit") return
        clearTimeout(timer)
        timer = setTimeout(() => setRound((round) => round + 1), SETTLE)
      },
      () => {}
    )
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [engine, project, dir])

  return shown
}
