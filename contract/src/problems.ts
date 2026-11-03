/**
 * The problems module's words for TypeScript (ADR 0039, decision 1), and
 * a JavaScript error as the Record the page and the window's main keep.
 */
import type { Frame } from "./generated/problems/Frame"
import type { Record } from "./generated/problems/Record"
import type { Source } from "./generated/problems/Source"

export type { Fingerprint } from "./generated/problems/Fingerprint"
export type { Frame } from "./generated/problems/Frame"
export type { Listed } from "./generated/problems/Listed"
export type { Log } from "./generated/problems/Log"
export type { Problem } from "./generated/problems/Problem"
export type { Recorded } from "./generated/problems/Recorded"
export type { Record } from "./generated/problems/Record"
export type { Report } from "./generated/problems/Report"
export type { Source } from "./generated/problems/Source"

/**
 * Where a frame's script is, as the repository names it, or `null` for a
 * script that is not Banda's own (a library, a browser's page).
 */
export type Own = (script: string) => string | null

/** What was thrown, as the Record of `source`, with Banda's own frames. */
export function recordOf(thrown: unknown, source: Source, own: Own): Record {
  const error =
    thrown instanceof Error
      ? thrown
      : new Error(typeof thrown === "string" ? thrown : safe(thrown))
  return {
    source,
    kind: error.name || "Error",
    message: error.message,
    frames: framesOf(error.stack ?? "", own),
  }
}

/** A thrown value that is not an Error, in words. */
function safe(thrown: unknown): string {
  try {
    return JSON.stringify(thrown) ?? String(thrown)
  } catch {
    return String(thrown)
  }
}

/** V8's `at function (script:line:column)`, or `at script:line:column`. */
const FRAME = /^\s*at (?:async )?(?:(.+?) \()?(.+?):(\d+):\d+\)?$/

/** A V8 stack's frames that are Banda's own, nearest first. */
export function framesOf(stack: string, own: Own): Frame[] {
  const frames: Frame[] = []
  for (const line of stack.split("\n")) {
    const [, named, script, number] = FRAME.exec(line) ?? []
    if (!script || !number) continue
    const file = own(script)
    if (file === null) continue
    frames.push({
      file,
      function: (named ?? "").replace(/^new /, ""),
      line: Number(number),
    })
  }
  return frames
}

/** The most a part of Banda sends in a minute, so a fault in a loop that
 * runs again and again does not fill the store: the engine counts the
 * ones it keeps as one Problem. */
const MOST = 20
const MINUTE = 60_000

/** Hands each Record to `send`, {@link MOST} a minute at most. A Record
 * `send` cannot keep now is let go: it is not one more Problem. */
export function keeper(
  send: (record: Record) => Promise<unknown>
): (record: Record) => void {
  let sent: number[] = []
  return (record) => {
    const now = Date.now()
    sent = sent.filter((at) => now - at < MINUTE)
    if (sent.length >= MOST) return
    sent.push(now)
    void send(record).catch(() => undefined)
  }
}

/** The parts of the repository Banda's scripts come from. */
const PARTS = /\/((?:app|modules|contract)\/.*)$/

/** `path`'s part from the repository's root, if it has one there. */
export function fromRoot(path: string): string | null {
  return PARTS.exec(path.replace(/[?#].*$/, ""))?.[1] ?? null
}
