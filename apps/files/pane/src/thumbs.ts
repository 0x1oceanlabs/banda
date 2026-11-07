/**
 * Files' small pictures in the window (ADR 0073, step F6): what
 * `files.thumb` answers, as an address an `<img>` draws, asked a few at a
 * time and kept by the file's path, time and size and the size asked, so
 * a filmstrip scrolled back draws at once. A picture asked for by a view that
 * went before its turn came is not asked.
 */
import { useEffect, useMemo, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import { extensionOf } from "@banda/ui/lib/previewers"

/** A file as its picture is kept by: its whole path, its time and size. */
export type Pictured = {
  path: string
  modified?: number | null
  size?: number | null
}

/** How many pictures are asked of the engine at once. */
const AT_ONCE = 4
/** How many pictures the window keeps. */
const KEPT = 400
/** The extensions of what the engine makes a picture of; any other file
 * may have freedesktop's, which the Gallery and the info ask for. */
const PICTURES = new Set([
  "png",
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
])

/** Whether a file is a picture the engine makes a small one of, by its
 * name: what the tree's rows ask for. */
export function isPicture(path: string): boolean {
  return PICTURES.has(extensionOf(path))
}

/** The size to ask for a picture drawn `side` px wide, as the screen
 * draws it. */
export function sideFor(side: number): number {
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio
  return Math.ceil(side * (ratio || 1))
}

/** The pictures kept, by `keyOf`, the latest used last: an address, or
 * null for a file that has none. */
const kept = new Map<string, string | null>()
/** The asks on their way, by key. */
const asking = new Map<string, Promise<string | null>>()
/** The asks waiting for their turn, and how many run. */
const waiting: (() => void)[] = []
let running = 0

function keyOf(project: ProjectId, file: Pictured, side: number): string {
  return [project, file.path, file.modified ?? "", file.size ?? "", side].join(
    "\0"
  )
}

/** What is kept for `key`, used now; undefined when nothing is. */
function keptFor(key: string): string | null | undefined {
  if (!kept.has(key)) return undefined
  const picture = kept.get(key) ?? null
  kept.delete(key)
  kept.set(key, picture)
  return picture
}

function keep(key: string, picture: string | null): void {
  kept.set(key, picture)
  if (kept.size > KEPT) kept.delete(kept.keys().next().value as string)
}

/** Runs `ask` once its turn comes; nothing, as undefined, when `signal`
 * is aborted before. */
function inTurn<T>(
  ask: () => Promise<T>,
  signal: AbortSignal
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const go = () => {
      if (signal.aborted) {
        resolve(undefined)
        next()
        return
      }
      running++
      ask()
        .then(resolve)
        .finally(() => {
          running--
          next()
        })
    }
    if (running < AT_ONCE) go()
    else waiting.push(go)
  })
}

function next(): void {
  if (running < AT_ONCE) waiting.shift()?.()
}

/** The picture of `file` at `side`: an address, or null when it has none;
 * kept, and asked once however many views want it at once; undefined
 * when `signal` is aborted before it is asked. */
export function askThumb(
  engine: Engine,
  project: ProjectId,
  file: Pictured,
  side: number,
  signal: AbortSignal
): Promise<string | null | undefined> {
  const key = keyOf(project, file, side)
  const known = keptFor(key)
  if (known !== undefined) return Promise.resolve(known)
  return inTurn(() => {
    const now = keptFor(key)
    if (now !== undefined) return Promise.resolve(now)
    const already = asking.get(key)
    if (already) return already
    const asked = engine
      .call("files.thumb", { path: file.path, size: side }, { project })
      .then(
        (thumb) => {
          const picture = thumb
            ? `data:${thumb.mime};base64,${thumb.data}`
            : null
          keep(key, picture)
          return picture
        },
        () => null
      )
      .finally(() => asking.delete(key))
    asking.set(key, asked)
    return asked
  }, signal)
}

/** The picture of `file`, drawn `side` px wide: its address; null when it
 * has none; undefined while it is asked. None is asked for no file. */
export function useThumb(
  engine: Engine,
  project: ProjectId,
  file: Pictured | null,
  side: number
): string | null | undefined {
  const asked = sideFor(side)
  const key = file && keyOf(project, file, asked)
  const [found, setFound] = useState<{ key: string; picture: string | null }>()
  useEffect(() => {
    if (!file || !key) return
    const controller = new AbortController()
    void askThumb(engine, project, file, asked, controller.signal).then(
      (picture) =>
        picture !== undefined &&
        !controller.signal.aborted &&
        setFound({ key, picture })
    )
    return () => controller.abort()
    // `key` says all of `file` that counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, project, key, asked])
  if (!key) return null
  if (found?.key === key) return found.picture
  return keptFor(key)
}

/** The pictures of `files`, each drawn `side` px wide, by the keys they
 * are given: those that have one, as they come. */
export function useThumbs(
  engine: Engine,
  project: ProjectId,
  files: ReadonlyMap<string, Pictured>,
  side: number
): ReadonlyMap<string, string> {
  const asked = sideFor(side)
  const key = [...files.values()]
    .map((file) => keyOf(project, file, asked))
    .join("\n")
  const [found, setFound] = useState<{
    key: string
    pictures: ReadonlyMap<string, string>
  }>()
  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const pictures = new Map<string, string>()
    let frame = 0
    const say = () => {
      frame = 0
      setFound({ key, pictures: new Map(pictures) })
    }
    for (const [named, file] of files)
      void askThumb(engine, project, file, asked, controller.signal).then(
        (picture) => {
          if (!picture || controller.signal.aborted) return
          pictures.set(named, picture)
          // Many at once draw once a frame.
          frame ||= requestAnimationFrame(say)
        }
      )
    return () => {
      controller.abort()
      cancelAnimationFrame(frame)
    }
    // `key` says all of `files` that counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, project, key, asked])
  return useMemo(
    () => (found?.key === key ? found.pictures : new Map()),
    [found, key]
  )
}
