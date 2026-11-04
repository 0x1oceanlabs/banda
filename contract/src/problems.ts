/**
 * The problems module's words for TypeScript (ADR 0039, decision 1), and
 * a JavaScript error as the Record the page and the window's main keep.
 */
import {
  originalPositionFor,
  type SourceMapInput,
  TraceMap,
} from "@jridgewell/trace-mapping"
import type { Frame } from "./generated/problems/Frame"
import type { Record } from "./generated/problems/Record"
import type { Source } from "./generated/problems/Source"

export type { Fingerprint } from "./generated/problems/Fingerprint"
export type { Frame } from "./generated/problems/Frame"
export type { Issue } from "./generated/problems/Issue"
export type { Listed } from "./generated/problems/Listed"
export type { Log } from "./generated/problems/Log"
export type { Problem } from "./generated/problems/Problem"
export type { Recorded } from "./generated/problems/Recorded"
export type { Record } from "./generated/problems/Record"
export type { Report } from "./generated/problems/Report"
export type { Sent } from "./generated/problems/Sent"
export type { Source } from "./generated/problems/Source"

/**
 * Where a frame's script is, as the repository names it, or `null` for a
 * script that is not Banda's own (a library, a browser's page).
 */
export type Own = (script: string) => string | null

/**
 * The map a built script has beside it, as JSON, or `null` for one with
 * none. Built, Banda's maps keep only where each place of a script is in
 * its source, not the source's text (ADR 0039, decision 9).
 */
export type MapOf = (script: string) => Promise<unknown>

/** What was thrown, as the Record of `source`, with Banda's own frames,
 * read through the maps of the scripts they are in. */
export async function recordOf(
  thrown: unknown,
  source: Source,
  own: Own,
  mapOf: MapOf
): Promise<Record> {
  const error =
    thrown instanceof Error
      ? thrown
      : new Error(typeof thrown === "string" ? thrown : safe(thrown))
  return {
    source,
    kind: error.name || "Error",
    message: error.message,
    frames: await framesOf(error.stack ?? "", own, mapOf),
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
const FRAME = /^\s*at (?:async )?(?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/

/**
 * A V8 stack's frames that are Banda's own, nearest first. A frame of a
 * script with a map is named as the map names its source, with no
 * function: built, a function's name is short and changes with each
 * build, and a map names what a place calls, not the function it is in.
 * Each map is read once for the stack, and not kept.
 */
export async function framesOf(
  stack: string,
  own: Own,
  mapOf: MapOf
): Promise<Frame[]> {
  const maps = new Map<string, Promise<TraceMap | null>>()
  const mapped = (script: string) => {
    let map = maps.get(script)
    if (!map) {
      map = mapOf(script)
        .then((read) =>
          read ? new TraceMap(read as SourceMapInput, `${script}.map`) : null
        )
        .catch(() => null)
      maps.set(script, map)
    }
    return map
  }
  const frames = await Promise.all(
    stack.split("\n").map(async (line): Promise<Frame[]> => {
      const [, named, script, number, column] = FRAME.exec(line) ?? []
      if (!script || !number || !column || own(script) === null) return []
      const map = await mapped(script)
      const at =
        map &&
        originalPositionFor(map, {
          line: Number(number),
          column: Number(column) - 1,
        })
      const [where, name, place] = at?.source
        ? [at.source, "", at.line ?? undefined]
        : [script, (named ?? "").replace(/^new /, ""), Number(number)]
      const file = own(where)
      return file === null ? [] : [{ file, function: name, line: place }]
    })
  )
  return frames.flat()
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
