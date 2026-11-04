/**
 * What a Person wrote to a Thread and has not sent yet, kept in this
 * window's storage, so it waits for them when they come back, as in T3
 * Code (ADR 0010, decision 7): its text, and the images it carries. Every
 * Pane on the same Thread holds the same draft. Its text is written once
 * typing stops, and before the window closes (ADR 0015, decisions 4 and
 * 5).
 */
import { useCallback, useState, useSyncExternalStore } from "react"
import type { Image } from "@banda/contract/agents"
import { kept as keptIn } from "@banda/ui/lib/kept"

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

function keep(thread: string, text: string) {
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

/** The composer's text for `thread`, kept as its draft; a Thread not yet
 * started keeps it only while its Pane is open. */
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

const NO_IMAGES: Image[] = []
const images = keptIn("banda.agents.draft-images", (value): value is Image[] =>
  Array.isArray(value)
)

/** The images the engine keeps for `thread`'s draft, by the order they
 * were added, and how to change them; a Thread not yet started keeps
 * them only while its Pane is open. Each waits in the engine as long as
 * an image no message took (ADR 0015, decision 5). */
export function useDraftImages(
  thread: string | null
): [Image[], (to: (all: Image[]) => Image[]) => void] {
  const [unstarted, setUnstarted] = useState(NO_IMAGES)
  const all = images.use()
  const change = useCallback(
    (to: (all: Image[]) => Image[]) =>
      thread === null
        ? setUnstarted(to)
        : images.put(thread, to(images.read()[thread] ?? NO_IMAGES)),
    [thread]
  )
  return [thread === null ? unstarted : (all[thread] ?? NO_IMAGES), change]
}

/** Whether `thread`'s draft holds a message to send: text, or an image. */
export function drafted(thread: string): boolean {
  return read(thread).trim() !== "" || (images.read()[thread]?.length ?? 0) > 0
}
