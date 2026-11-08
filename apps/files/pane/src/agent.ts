/**
 * The Agent's work as Files shows it (ADR 0073, decisions 3 and 9): which
 * Thread a Files Pane is with, the colour of each Thread's Agent, the rows
 * that pulse, where Follow goes and when it waits, and what the turn
 * changed. Pure, so plain tests cover it.
 */
import type { ListedThread, Touched, TouchKind } from "@banda/contract/agents"
import { emblemColour } from "@banda/ui/components/emblem"
import type { HarnessView } from "@banda/contract/harnesses"
import { wholeOf, within } from "./where"

/**
 * The Thread whose turns a Files Pane marks and follows: the one it was
 * opened from, while the Project has it; else the one at work that began
 * last; else the one whose latest turn began last. None in a Project
 * whose Threads never ran.
 */
export function threadOf(
  threads: readonly ListedThread[],
  asked: string | null | undefined
): ListedThread | null {
  const named = threads.find((thread) => thread.id === asked)
  if (named) return named
  let best: ListedThread | null = null
  for (const thread of threads) {
    const latest = thread.latest
    if (!latest) continue
    const was = best?.latest
    const runs = latest.state === "running"
    const ran = was?.state === "running"
    if (!was || (runs && !ran) || (runs === ran && latest.began > was.began))
      best = thread
  }
  return best
}

/** A Thread's colour: its account's emblem's (ADR 0093, decision 3); the
 * primary colour for one this computer does not know. */
export function colourOf(
  harnesses: readonly HarnessView[],
  harness: string
): string {
  const found = harnesses.find((one) => one.id === harness)
  return found ? emblemColour(found) : "var(--primary)"
}

/** `path` whole: one the Harness named from the Project's folder `top`
 * starts there. */
export function wholeFrom(path: string, top: string | null): string | null {
  if (path.startsWith("/")) return path
  return top ? wholeOf(top.replace(/\/$/, ""), path) : null
}

/** The rows of the tree of `dir` that pulse: each Thread's file under it,
 * in the colour of its Thread. */
export function pulsesOf(
  touched: readonly Touched[],
  dir: string,
  top: string | null,
  colour: (thread: string) => string
): Map<string, string> {
  const pulses = new Map<string, string>()
  for (const one of touched) {
    const whole = wholeFrom(one.path, top)
    const path = whole === null ? null : within(dir, whole)
    if (path) pulses.set(path, colour(one.thread))
  }
  return pulses
}

/** Where Follow goes: a file, whole, and the line its tool call named. */
export type Target = {
  path: string
  line: number | null
  kind: TouchKind
  at: number
}

/** How long a write holds Follow against the reads after it, in ms: an
 * Agent reads around what it writes, and Follow stays on the write. */
export const HOLD = 4_000

/**
 * Where Follow goes as the Thread's turn touches `touch`, from `was`: to
 * the file being written, or the one read when no write is happening,
 * which is when the last write came {@link HOLD} or more before it. The
 * same touch heard again changes nothing.
 */
export function nextTarget(
  was: Target | null,
  touch: Touched,
  top: string | null
): Target | null {
  const path = wholeFrom(touch.path, top)
  if (path === null) return was
  if (was && was.at === touch.at && was.path === path) return was
  const held =
    touch.kind === "read" && was?.kind === "write" && touch.at - was.at < HOLD
  if (held) return was
  return { path, line: touch.line ?? null, kind: touch.kind, at: touch.at }
}

/** How long Follow waits after the Person's last key or click where it
 * moves things, in ms. */
export const QUIET = 5_000

/**
 * When Follow may move, at `now`: at once (`now`), or once the Person
 * has been still {@link QUIET} after their last key or click (`worked`);
 * never (`null`) while they hold something there, text or lines picked,
 * or a comment being written.
 */
export function followsAt(
  now: number,
  worked: number | null,
  holding: boolean
): number | null {
  if (holding) return null
  if (worked === null) return now
  return Math.max(now, worked + QUIET)
}

/**
 * What a turn changed, whole, from the Project's folder `top`: with git's
 * checkpoints (`kept`, from the repository's top, taken to be the
 * Project's folder as the Diff takes it), what they hold and the files
 * its tool calls changed outside the folder, where they never look;
 * without, what its tool calls changed (`changes`, from the folder or
 * whole).
 */
export function turnPaths(
  kept: readonly string[] | null,
  changes: readonly string[],
  top: string
): string[] {
  const from = (path: string) => wholeFrom(path, top) ?? path
  if (kept === null) return [...new Set(changes.map(from))]
  const outside = changes.filter((path) => path.startsWith("/"))
  return [...new Set([...kept.map(from), ...outside])]
}

/** The files of the tree of `dir` among the whole `paths`. */
export function turnedIn(paths: readonly string[], dir: string): Set<string> {
  const turned = new Set<string>()
  for (const whole of paths) {
    const path = within(dir, whole)
    if (path) turned.add(path)
  }
  return turned
}
