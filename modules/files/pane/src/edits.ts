/**
 * What editing in Files decides (ADR 0073, decision 8): why a file is not
 * edited here, who changed one on disk under the Person's text, and a
 * markdown task's box ticked in its text. Pure, so plain tests cover it.
 */
import type { Touched } from "@banda/contract/agents"
import type { Locked } from "@banda/contract/files"

/** Why the file shown is not edited here, as the pencil says it on
 * hover; none when it may be. */
export function lockedWhy(file: {
  mode: "quick" | "pane"
  binary: boolean
  /** Only its start is shown: past 1 MiB or 20 000 lines. */
  cut: boolean
  locked?: Locked | null
}): string | null {
  if (file.mode === "quick") return "Quick Look only shows: ↵ opens it to edit"
  if (file.binary) return "A binary file is not edited here"
  if (file.cut) return "Past 1 MB or 20,000 lines, a file is read-only here"
  switch (file.locked) {
    case "git":
      return "Inside .git, files are git's own"
    case "settings":
      return "Banda's settings are changed in Settings"
    case "denied":
      return "This file may not be written"
  }
  return null
}

/** How long after an Agent's turn was last seen writing a file a change
 * there is taken to be its, in ms. */
export const NAMED = 5_000
/** How long a turn's write is remembered once it is no longer heard. */
const KEPT = 60_000

/** A file a Thread's turn wrote, and when it was last heard doing so. */
export type Wrote = { path: string; thread: string; left: number }

/**
 * The writes heard, after `agents.touching` says `now` what each turn
 * works on: a write no longer said is kept as left `at`, for a minute.
 */
export function heardWrites(
  was: readonly Wrote[],
  before: readonly Touched[],
  now: readonly Touched[],
  at: number
): Wrote[] {
  const still = (one: Touched) =>
    now.some(
      (other) =>
        other.kind === "write" &&
        other.thread === one.thread &&
        other.path === one.path
    )
  const left = before
    .filter((one) => one.kind === "write" && !still(one))
    .map((one) => ({ path: one.path, thread: one.thread, left: at }))
  return [...was.filter((one) => at - one.left < KEPT), ...left]
}

/**
 * The Thread whose turn wrote the file at `paths` (whole, and as named
 * from the Project's folder) about when the disk was found moved `at`:
 * one writing it now, or that left off at most {@link NAMED} before. None
 * when no Agent's turn did, as far as is heard.
 */
export function writtenBy(
  touched: readonly Touched[],
  wrote: readonly Wrote[],
  paths: readonly string[],
  at: number
): string | null {
  const now = touched.find(
    (one) => one.kind === "write" && paths.includes(one.path)
  )
  if (now) return now.thread
  const left = wrote
    .filter((one) => paths.includes(one.path) && one.left >= at - NAMED)
    .at(-1)
  return left?.thread ?? null
}

/** A task's box at the start of a list item: `- [ ] `, `1. [x] `, in a
 * quote too. */
const TASK =
  /^(?:[ \t]*>)*[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+\[([ xX])\](?=[ \t]|$)/
/** A fence that opens or closes a block of code. */
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/

/**
 * Where each task's box is in markdown `text`, from `from` on, in order:
 * the offset of the letter between its brackets. Those in fenced code are
 * not tasks.
 */
export function taskBoxes(text: string, from = 0): number[] {
  const boxes: number[] = []
  let fence: string | null = null
  let at = from
  while (at <= text.length) {
    const end = text.indexOf("\n", at)
    const line = text.slice(at, end === -1 ? text.length : end)
    const opens = FENCE.exec(line)?.[1]
    if (fence) {
      if (opens && opens[0] === fence[0] && opens.length >= fence.length)
        fence = null
    } else if (opens) fence = opens
    else {
      const task = TASK.exec(line)
      if (task) boxes.push(at + task[0].length - 2)
    }
    if (end === -1) break
    at = end + 1
  }
  return boxes
}

/** `text` with the box of its task `nth` (from 0, from `from` on) ticked,
 * or not; none when it has no such task, the box is so already, or `of`
 * says how many tasks were shown and it has another count. */
export function tickTask(
  text: string,
  nth: number,
  done: boolean,
  from = 0,
  of?: number
): string | null {
  const boxes = taskBoxes(text, from)
  const at = boxes[nth]
  if (at === undefined || (of !== undefined && of !== boxes.length)) return null
  const ticked = text[at] !== " "
  if (ticked === done) return null
  return text.slice(0, at) + (done ? "x" : " ") + text.slice(at + 1)
}
