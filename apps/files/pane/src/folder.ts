/**
 * A folder as a Files Pane reads it (ADR 0073, decisions 3 and 4): its
 * top listed at once, each folder listed as it opens, a few at a time,
 * and the open ones watched with `files.watch`, listed again as they
 * change. A folder opened again is listed again, as it was not watched
 * while it was folded.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type Engine, type ProjectId, Refused } from "@banda/contract"
import type { Entry } from "@banda/contract/files"
import { problem } from "@banda/ui/lib/words"
import { type Listed, merged, toList } from "./tree"
import { within, wholeOf } from "./where"

/** The folder at the top, as the engine found it. */
export type Top =
  | { state: "loading" }
  | { state: "refused"; message: string; gone: boolean }
  | {
      state: "listed"
      /** Whole, its links followed. */
      real: string
      /** Whether it is the Project's folder or in it. */
      inside: boolean
    }

const LOADING: Top = { state: "loading" }
const NONE: Listed = new Map()
/** How long to wait before listing again after the connection broke. */
const AGAIN = 500
/** How many folders are listed at once. */
const AT_ONCE = 4

export type Folder = {
  top: Top
  listed: Listed
  /** The folders open and not listed yet: a spinner on each. */
  listing: ReadonlySet<string>
  /** Whether the system has no watch left for some open folder. */
  limit: boolean
  /** Says Files changes `folder` itself, which the tree shows before the
   * folder is listed again; the call it gives back says the change is
   * done. A listing sent before then is dropped, as it may have read the
   * folder before the change, and the folder is listed again after. */
  change: (folder: string) => () => void
}

/**
 * Folder `dir` of `project`, with the folders `open` listed and watched;
 * `onListed` hears each listing, as the Pane opens a folder of one folder.
 */
export function useFolder(
  engine: Engine,
  project: ProjectId,
  dir: string,
  open: readonly string[],
  onListed: (folder: string, entries: readonly Entry[]) => void
): Folder {
  const [top, setTop] = useState<{ dir: string; top: Top }>()
  const [listed, setListed] = useState<{ dir: string; listed: Listed }>()
  const [limit, setLimit] = useState<string>()
  const heard = useRef(onListed)
  // What a listing that comes late checks it is still for.
  const now = useRef(dir)
  useEffect(() => {
    heard.current = onListed
    now.current = dir
  })

  // One listing at a time per folder, another after it when it changed
  // meanwhile; a few at once. What comes for another folder is dropped.
  const running = useRef(new Set<string>())
  const again = useRef(new Set<string>())
  const waiting = useRef<(() => void)[]>([])
  // Files' own changes running in each folder, when its last one was done,
  // and the folders whose listing was dropped meanwhile: by one clock that
  // counts each listing sent and each change done.
  const changing = useRef(new Map<string, number>())
  const changed = useRef(new Map<string, number>())
  const dropped = useRef(new Set<string>())
  const clock = useRef(0)
  const list = useCallback(
    function listing(folder: string) {
      if (running.current.has(folder)) {
        again.current.add(folder)
        return
      }
      running.current.add(folder)
      const keep = (entries: readonly Entry[]) =>
        setListed((was) => ({
          dir,
          listed: merged(was?.dir === dir ? was.listed : NONE, folder, entries),
        }))
      function go() {
        const sent = ++clock.current
        engine
          .call("files.list", { dir: wholeOf(dir, folder) }, { project })
          .then(
            (found) => {
              if (now.current !== dir) return
              // Sent before Files' own change was done: it may not hold it.
              const before =
                (changing.current.get(folder) ?? 0) > 0 ||
                sent < (changed.current.get(folder) ?? 0)
              if (before) return void dropped.current.add(folder)
              dropped.current.delete(folder)
              keep(found.entries)
              if (folder === "")
                setTop({
                  dir,
                  top: {
                    state: "listed",
                    real: found.dir,
                    inside: found.inside,
                  },
                })
              heard.current(folder, found.entries)
            },
            (error: unknown) => {
              if (now.current !== dir) return
              if (!(error instanceof Refused)) return void setTimeout(go, AGAIN)
              if (folder === "")
                setTop({
                  dir,
                  top: {
                    state: "refused",
                    message: problem(error),
                    gone: error.refusal.code === "not_found",
                  },
                })
              // A folder that cannot be read shows as holding nothing.
              else keep([])
            }
          )
          .finally(() => {
            running.current.delete(folder)
            waiting.current.shift()?.()
            if (again.current.delete(folder)) listing(folder)
          })
      }
      if (running.current.size <= AT_ONCE) go()
      else waiting.current.push(go)
    },
    [engine, project, dir]
  )
  // A change done: the folder is listed again if a listing was dropped
  // meanwhile, or after the one running, which is dropped as it comes.
  const change = useCallback(
    (folder: string) => {
      changing.current.set(folder, (changing.current.get(folder) ?? 0) + 1)
      let over = false
      return () => {
        if (over) return
        over = true
        changing.current.set(folder, (changing.current.get(folder) ?? 1) - 1)
        changed.current.set(folder, ++clock.current)
        if (running.current.has(folder)) again.current.add(folder)
        else if (dropped.current.delete(folder)) list(folder)
      }
    },
    [list]
  )

  // Another folder: its top at once.
  useEffect(() => list(""), [list])

  const shown = listed?.dir === dir ? listed.listed : NONE
  // Each folder opened and not listed yet, once the one above it is.
  const opened = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    for (const folder of toList(open, shown, running.current)) list(folder)
    // One listed before, folded since and opened again: listed again.
    for (const folder of open)
      if (!opened.current.has(folder) && shown.has(folder)) list(folder)
    opened.current = new Set(open)
  }, [open, shown, list])

  // The open folders that are listed are watched; each that changes is
  // listed again, and all of them after the system lost track.
  const key = ["", ...open.filter((folder) => shown.has(folder))].join("\n")
  useEffect(() => {
    const folders = key.split("\n")
    let heardOnce = false
    return engine.stream(
      project,
      "files.watch",
      { dirs: folders.map((folder) => wholeOf(dir, folder)) },
      (piece) => {
        const named = (dirs: readonly string[]) =>
          dirs.flatMap((whole) => {
            const path = within(dir, whole)
            return path === null ? [] : [path ? `${path}/` : ""]
          })
        switch (piece.kind) {
          case "watching":
            // Watched again after the connection broke: what changed
            // meanwhile was not heard.
            if (heardOnce) for (const folder of folders) list(folder)
            heardOnce = true
            return
          case "limit":
            setLimit(dir)
            return
          case "changed":
            for (const folder of named(piece.dirs)) list(folder)
            return
          case "rescan":
            for (const folder of folders) list(folder)
        }
      },
      () => {}
    )
  }, [engine, project, dir, key, list])

  const listing = useMemo(
    () => new Set(open.filter((folder) => !shown.has(folder))),
    [open, shown]
  )
  return {
    top: top?.dir === dir ? top.top : LOADING,
    listed: shown,
    listing,
    limit: limit === dir,
    change,
  }
}
