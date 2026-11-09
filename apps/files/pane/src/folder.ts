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
import { type Expected, type Listed, merged, toList } from "./tree"
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
const NOTHING: Expecting = new Map()
const NO_EXPECTED: Folder["expected"] = new Map()
/** How long to wait before listing again after the connection broke. */
const AGAIN = 500
/** How many folders are listed at once. */
const AT_ONCE = 4

/** How a change Files made itself went, when not plainly done: what it
 * made, or that it failed. */
type Outcome = { made: Pick<Entry, "name" | "kind"> } | { failed: true }

/** What a change done is expected to show, and the clock as it was done;
 * a change of a name, from its start. */
type Expectation = { expected: Expected; done?: number }
type Expecting = ReadonlyMap<string, readonly Expectation[]>

export type Folder = {
  top: Top
  listed: Listed
  /** What Files changed itself in each folder, not listed since: the tree
   * shows it already, so it lays it over `listed`. The same while
   * nothing changes. */
  expected: ReadonlyMap<string, readonly Expected[]>
  /** The folders open and not listed yet: a spinner on each. */
  listing: ReadonlySet<string>
  /** Whether the system has no watch left for some open folder. */
  limit: boolean
  /** Says Files changes `folder` itself, which the tree shows before the
   * folder is listed again: a thing in it `renamed`, as the tree shows at
   * once. The call it gives back says the change is done, with what it
   * made, or that it failed. A listing sent before then is dropped, as it
   * may have read the folder before the change, and the folder is listed
   * again after; what the change shows is expected of the folder until
   * that listing comes, and a change that failed expects nothing. */
  change: (
    folder: string,
    renamed?: { from: string; to: string }
  ) => (outcome?: Outcome) => void
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
  // What Files changed itself in each folder, until a listing of it sent
  // after the change was done comes; none kept from another folder.
  const [expecting, setExpecting] = useState<{ dir: string; by: Expecting }>()
  if (expecting !== undefined && expecting.dir !== dir) setExpecting(undefined)
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
  // A change that ends after the Pane went to another folder expects
  // nothing of the one it shows now.
  const expectIn = useCallback(
    (
      folder: string,
      edit: (those: readonly Expectation[]) => readonly Expectation[]
    ) => {
      if (now.current !== dir) return
      setExpecting((was) => {
        const by = was?.dir === dir ? was.by : NOTHING
        const next = edited(by, folder, edit)
        return next === by ? was : { dir, by: next }
      })
    },
    [dir]
  )
  const list = useCallback(
    function listing(folder: string) {
      if (running.current.has(folder)) {
        again.current.add(folder)
        return
      }
      running.current.add(folder)
      // A listing sent after a change was done shows what it did, which
      // is expected no longer.
      const keep = (entries: readonly Entry[], sent: number) => {
        setListed((was) => ({
          dir,
          listed: merged(was?.dir === dir ? was.listed : NONE, folder, entries),
        }))
        expectIn(folder, (those) =>
          those.filter((one) => one.done === undefined || one.done > sent)
        )
      }
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
              keep(found.entries, sent)
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
              else keep([], sent)
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
    [engine, project, dir, expectIn]
  )
  // A change done: the folder is listed again if a listing was dropped
  // meanwhile, or after the one running, which is dropped as it comes;
  // and always when the change shows, so what it shows is not expected
  // for longer than a listing takes.
  const change = useCallback(
    (folder: string, renamed?: { from: string; to: string }) => {
      changing.current.set(folder, (changing.current.get(folder) ?? 0) + 1)
      const mine = renamed && { expected: { renamed } }
      if (mine) expectIn(folder, (those) => [...those, mine])
      let over = false
      return (outcome?: Outcome) => {
        if (over) return
        over = true
        changing.current.set(folder, (changing.current.get(folder) ?? 1) - 1)
        const done = ++clock.current
        changed.current.set(folder, done)
        const failed = outcome !== undefined && "failed" in outcome
        const made = outcome && "made" in outcome ? outcome.made : undefined
        // What was made is expected only once it was, so a make that
        // failed never shows a row; a rename that failed, its old name.
        const shows = !failed && (mine !== undefined || made !== undefined)
        if (mine || made)
          expectIn(folder, (those) => [
            ...those.flatMap((one) =>
              one !== mine ? [one] : failed ? [] : [{ ...one, done }]
            ),
            ...(made ? [{ expected: { made }, done }] : []),
          ])
        if (running.current.has(folder)) again.current.add(folder)
        else if (dropped.current.delete(folder) || shows) list(folder)
      }
    },
    [list, expectIn]
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
  const expected = useMemo(
    () =>
      expecting?.dir === dir && expecting.by.size > 0
        ? new Map(
            [...expecting.by].map(([folder, those]) => [
              folder,
              those.map((one) => one.expected),
            ])
          )
        : NO_EXPECTED,
    [expecting, dir]
  )
  return {
    top: top?.dir === dir ? top.top : LOADING,
    listed: shown,
    expected,
    listing,
    limit: limit === dir,
    change,
  }
}

/** `by` with `folder`'s changes as `edit` leaves them, a folder with none
 * left out; `by` itself when they are the same. */
function edited(
  by: Expecting,
  folder: string,
  edit: (those: readonly Expectation[]) => readonly Expectation[]
): Expecting {
  const was = by.get(folder) ?? []
  const now = edit(was)
  if (now.length === was.length && now.every((one, n) => one === was[n]))
    return by
  const next = new Map(by)
  if (now.length > 0) next.set(folder, now)
  else next.delete(folder)
  return next
}
