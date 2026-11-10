/**
 * What a Person wrote to a Thread and has not sent yet, kept in this
 * window's storage, so it waits for them when they come back, as in T3
 * Code (ADR 0010, decision 7): its text, the images it carries, and the
 * comments on files' lines an App put in it (ADR 0034, decision 9). Every
 * Pane on the same Thread holds the same draft, in every window on the
 * device. Its text is written once typing stops, and before the window
 * closes (ADR 0015, decisions 4 and 5). It is kept whatever its machine
 * does: one of another machine's Thread stays while that machine is away
 * or not heard yet, and a new Thread's stays too, under a key its Pane's
 * args keep (#838).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { newId, Refused } from "@banda/contract"
import type { Image } from "@banda/contract/agents"
import { type Kept, kept as keptIn } from "@banda/ui/lib/kept"
import type { Comment } from "./comments"
import { MOST_IMAGES } from "./images"

const PREFIX = "banda.agents.draft."
const heard = new Set<() => void>()
/** The drafts read so far, and all of them for a window whose storage
 * fails: kept until it closes. */
const here = new Map<string, string>()

function read(thread: string): string {
  if (!here.has(thread))
    try {
      here.set(thread, localStorage.getItem(PREFIX + thread) ?? "")
    } catch {
      here.set(thread, "")
    }
  return here.get(thread) ?? ""
}

/** The Threads whose drafts are typed but not yet written to storage,
 * each written once typing stops for {@link WAIT} ms, and all as the
 * window goes. */
const unwritten = new Map<string, number>()
const WAIT = 300

/** The new Threads' drafts whose keys their Panes' args do not keep yet,
 * each with how to keep it there, once something is written in it. */
const unkept = new Map<string, () => void>()

function written(key: string) {
  const keepKey = unkept.get(key)
  if (!keepKey) return
  unkept.delete(key)
  keepKey()
}

/** The key a Thread's draft is kept under: its own ID once it started; a
 * new Thread's `new-<id>`, by the `id` its Pane's args keep. */
export const draftKey = (thread: string | null, id: string) =>
  thread ?? `new-${id}`

/** Calls `keep` once something is first written in the draft under
 * `key`, as a new Thread's Pane then keeps its key in its args; returns
 * how to stop waiting for it. */
export function onFirstWrite(key: string, keep: () => void): () => void {
  unkept.set(key, keep)
  return () => {
    if (unkept.get(key) === keep) unkept.delete(key)
  }
}

/**
 * The key the draft of a Pane on `thread` is kept under: a started
 * Thread's own; a new Thread's by the id its args keep (`kept`), or one
 * made here, which `keep` hands its args as something is first written in
 * it, so the draft is there after a restart (#838). Its Send stays off
 * while its machine is away (ADR 0105, Q1): its words wait here.
 */
export function useDraftKey(
  thread: string | null,
  kept: string | undefined,
  keep: (id: string) => void
): string {
  const [made] = useState(newId)
  const id = kept ?? made
  const key = draftKey(thread, id)
  const keepNow = useRef(keep)
  useLayoutEffect(() => {
    keepNow.current = keep
  })
  useEffect(() => {
    if (thread !== null || kept !== undefined) return
    return onFirstWrite(key, () => keepNow.current(id))
  }, [thread, kept, key, id])
  return key
}

function keep(thread: string, text: string) {
  if (text) written(thread)
  here.set(thread, text)
  clearTimeout(unwritten.get(thread))
  unwritten.set(
    thread,
    window.setTimeout(() => write(thread), WAIT)
  )
  heard.forEach((hear) => hear())
}

function write(thread: string) {
  clearTimeout(unwritten.get(thread))
  unwritten.delete(thread)
  const text = here.get(thread) ?? ""
  try {
    if (text) localStorage.setItem(PREFIX + thread, text)
    else localStorage.removeItem(PREFIX + thread)
  } catch {
    // `here` holds it.
  }
}

if (typeof window !== "undefined")
  window.addEventListener("pagehide", () => {
    for (const thread of [...unwritten.keys()]) write(thread)
  })

function listen(hear: () => void): () => void {
  heard.add(hear)
  // Another window on the same storage changed a draft.
  const elsewhere = (event: StorageEvent) => {
    if (!event.key?.startsWith(PREFIX)) return
    const thread = event.key.slice(PREFIX.length)
    // What is typed here, not yet written, is newer.
    if (unwritten.has(thread)) return
    here.delete(thread)
    hear()
  }
  window.addEventListener("storage", elsewhere)
  return () => {
    heard.delete(hear)
    window.removeEventListener("storage", elsewhere)
  }
}

/** The composer's text for `thread`, kept as its draft (`useDraftKey`);
 * with none, only while its Pane is open. */
export function useDraft(
  thread: string | null
): [string, React.Dispatch<React.SetStateAction<string>>] {
  const [unstarted, setUnstarted] = useState("")
  const kept = useSyncExternalStore(
    listen,
    () => (thread === null ? "" : read(thread)),
    () => ""
  )
  if (thread === null) return [unstarted, setUnstarted]
  return [
    kept,
    (next) =>
      keep(thread, typeof next === "function" ? next(read(thread)) : next),
  ]
}

/** A list a draft carries besides its text, kept in this window's
 * storage under `key`. */
function draftList<T>(key: string) {
  return keptIn(key, (value): value is T[] => Array.isArray(value))
}

const NONE: never[] = []
const images = draftList<Image>("banda.agents.draft-images")
const comments = draftList<Comment>("banda.agents.draft-comments")

/** What `store` keeps for `thread`'s draft, in the order it was added,
 * and how to change it; with none, only while its Pane is open. */
function useDraftList<T>(
  store: Kept<T[]>,
  thread: string | null
): [T[], (to: (all: T[]) => T[]) => void] {
  const [unstarted, setUnstarted] = useState<T[]>(NONE)
  const all = store.use()
  const change = useCallback(
    (to: (all: T[]) => T[]) => {
      if (thread === null) return setUnstarted(to)
      const next = to(store.read()[thread] ?? NONE)
      if (next.length > 0) {
        written(thread)
        store.put(thread, next)
      } else store.drop(thread)
    },
    [store, thread]
  )
  return [thread === null ? unstarted : (all[thread] ?? NONE), change]
}

/** Whether an image a draft carries is gone for good, as its engine says
 * it has none: it leaves the draft. One whose machine does not answer, as
 * one away or not heard yet since a restart, stays (#838). */
export const imageGone = (error: unknown) =>
  error instanceof Refused && error.refusal.code === "not_found"

/** The images the engine keeps for `thread`'s draft, and how to change
 * them. Each waits in the engine as long as an image no message took
 * (ADR 0015, decision 5). */
export function useDraftImages(thread: string | null) {
  return useDraftList(images, thread)
}

/** The comments on files' lines `thread`'s draft carries, and how to
 * change them (ADR 0034, decision 9). */
export function useDraftComments(thread: string | null) {
  return useDraftList(comments, thread)
}

/** Whether `thread`'s draft holds a message to send: text, an image, or
 * a comment. */
export function drafted(thread: string): boolean {
  return (
    read(thread).trim() !== "" ||
    (images.read()[thread]?.length ?? 0) > 0 ||
    (comments.read()[thread]?.length ?? 0) > 0
  )
}

/** Puts a message that was not sent back into `thread`'s draft: its
 * `text` above anything new there, after a blank line, and its `carried`
 * images after those there, as many as fit; so nothing is lost and
 * nothing goes by itself (ADR 0105, Q5). */
export function putBack(
  thread: string,
  text: string,
  carried: readonly Image[] = []
): void {
  if (text !== "") {
    // As kept now: another window may have changed it since this one read
    // it, as the one that shows the Thread does.
    if (!unwritten.has(thread)) here.delete(thread)
    const now = read(thread)
    keep(thread, now.trim() === "" ? text : `${text}\n\n${now}`)
  }
  if (carried.length === 0) return
  const all = images.read()[thread] ?? NONE
  images.put(
    thread,
    [
      ...all,
      ...carried.filter((one) => !all.some((k) => k.id === one.id)),
    ].slice(0, MOST_IMAGES)
  )
}
