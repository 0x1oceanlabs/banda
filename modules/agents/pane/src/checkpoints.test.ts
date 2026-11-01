/**
 * The Pane's projection is the engine's (ADR 0014, decision 3). The
 * engine's tests write checkpoints from real scenarios when
 * `BANDA_CHECKPOINTS` names a folder, as `scripts/check.sh` does: a
 * Thread's view, the facts after it, and the view the engine read then.
 * Applying those facts to the first view must give the last one.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"
import type { Event } from "@banda/contract"
import type { ThreadView } from "@banda/contract/agents"
import { apply, fromView, type ThreadState } from "./thread"

type Checkpoint = { start: ThreadView; events: Event[]; end: ThreadView }

const folder = process.env.BANDA_CHECKPOINTS
const files = folder
  ? readdirSync(folder).filter((file) => file.endsWith(".json"))
  : []

/** The state without its place in the log: the engine's view stands where
 * the whole Space's log stood, the Pane's where its Thread's last fact did. */
function placeless(state: ThreadState): ThreadState {
  return { ...state, at: 0 }
}

test.skipIf(folder === undefined)("the engine wrote checkpoints", () => {
  expect(files.length).toBeGreaterThan(0)
})

test.each(files)(
  "facts after a view give the engine's next view: %s",
  (file) => {
    const { start, events, end } = JSON.parse(
      readFileSync(join(folder!, file), "utf8")
    ) as Checkpoint
    const applied = events.reduce(apply, fromView(start))
    expect(placeless(applied)).toEqual(placeless(fromView(end)))
  }
)
