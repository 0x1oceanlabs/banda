/**
 * How the Diff reads what it shows, as T3 Code's: `git.diff`, and a turn's
 * changes from its tool calls where git kept no checkpoint of them. It
 * reads again on its button, as the window comes back, as an Agent's turn
 * ends and, while in front, as the folder's status changes; a read the
 * same as the last keeps its view, so nothing is drawn again.
 */
import { useMemo, useRef, useState } from "react"
import { Refused, type Engine, type SpaceId } from "@banda/contract"
import type {
  ChangedTurn,
  ChangesAsk,
  TurnChanges,
} from "@banda/contract/agents"
import type { Diff, DiffAsk } from "@banda/contract/git"
import {
  countsOf,
  fileOf,
  type FileDiffMetadata,
} from "@banda/ui/components/code-diff"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { READ_AGAIN, useLive, type Source } from "@banda/ui/hooks/use-live"
import { asked } from "./diff"
import type { Scope } from "./scope"
import { useGitStatus } from "./status"

/** What the Pane draws, as git answers it; a turn's changes from its tool
 * calls come beside git's patch as their files already diffed. A turn's
 * come with the Thread's turns that changed files. */
export type Drawn = Diff & { drawn?: FileDiffMetadata[]; turns?: ChangedTurn[] }

/** What makes the Diff read again: an Agent's turn ending. */
const TURNS = { module: "agents", kinds: ["turn.ended"] }

/** Whether two reads of git's diff say the same. */
function sameDiff(a: Diff, b: Diff): boolean {
  return (
    a.patch === b.patch &&
    a.truncated === b.truncated &&
    JSON.stringify([a.files, a.base]) === JSON.stringify([b.files, b.base])
  )
}

/** Calls `changed` with `value` as it changes from what it was, as the
 * Pane draws; none (`null`) is no value, and is not heard. */
function useChanged<T>(value: T | null, changed: (now: T) => void): void {
  const [was, setWas] = useState(value)
  if (value === null || value === was) return
  setWas(value)
  if (was !== null) changed(value)
}

/** Git has no checkpoint of the turn, or the folder is no repository. */
function noCheckpoint(error: unknown): boolean {
  if (!(error instanceof Refused)) return false
  const { code } = error.refusal
  return code === "not_found" || code === "conflict"
}

/** A file `agents.changes` names from the root, not from the Space's
 * folder: outside it, where git's checkpoints never look. */
function outside(path: string): boolean {
  return /^(\/|[A-Za-z]:[\\/])/.test(path)
}

/** A turn's changes as the Pane draws a diff: what git's checkpoints
 * `kept`, and the files they could not keep from its tool calls, each
 * diffed from its texts, whole. With no checkpoint every file is from its
 * tool calls; with one, those outside the Space's folder, as an Agent's
 * edits in a worktree beside it. */
export function turnRead(kept: Diff | null, changes: TurnChanges): Drawn {
  const unkept = kept
    ? changes.files.filter((file) => outside(file.path))
    : changes.files
  const drawn = unkept.map((file) => fileOf(file.path, file.old, file.new))
  const git = kept ?? { at: changes.at, files: [], patch: "", truncated: false }
  return {
    ...git,
    files: [
      ...git.files,
      ...unkept.map((file, index) => ({
        path: file.path,
        ...countsOf(drawn[index]!),
        binary: false,
      })),
    ],
    drawn,
    turns: changes.turns,
  }
}

/**
 * The Diff of `scope` in `space`, read again as it should be: `question`
 * and its `words` are what `git.diff` is asked; `again` reads again,
 * keeping what it shows until the answer, and `fresh` too, its answer a
 * new view though it says the same, as after a stage or a revert.
 */
export function useDiffRead(
  engine: Engine,
  space: SpaceId,
  scope: Scope,
  ignoreWhitespace: boolean
) {
  // It reads again on its button and as the window comes back, keeping
  // what it shows until the answer.
  const [round, setRound] = useState(0)
  const again = () => setRound((n) => n + 1)
  const front = useInFront()
  useChanged(front, (now) => now && again())
  // And, while in front, as the folder changes under it as the card sees
  // it: a commit, a pull or a switch from the card or a terminal, a file
  // written. A turn's or a commit's changes stay what they were.
  const follows = front && scope.kind !== "turn" && scope.kind !== "commit"
  const status = useGitStatus(engine, space, follows)
  const seen = useMemo(() => {
    if (!status) return null
    if (scope.kind === "staged")
      return JSON.stringify([
        status.head,
        status.files.map((file) => [file.path, file.staged]),
      ])
    return JSON.stringify([status.head, status.branch, status.files])
  }, [status, scope.kind])
  useChanged(seen, again)

  // The question's words decide: the same words ask the same.
  const words = JSON.stringify({
    scope: asked(scope),
    ignore_whitespace: ignoreWhitespace,
  })
  const question = useMemo(() => JSON.parse(words) as DiffAsk, [words])
  // A read the same as the last keeps its view, so nothing is drawn again.
  const last = useRef<Drawn>(undefined)
  const source = useMemo<Source<Drawn>>(() => {
    const diff = () => engine.call("git.diff", question, { space })
    const turn = question.scope.kind === "turn" ? question.scope : null
    if (!turn)
      return {
        read: async () => {
          const read: Drawn = await diff()
          const was = last.current
          if (was && sameDiff(was, read)) {
            was.at = read.at
            return was
          }
          last.current = read
          return read
        },
        filter: TURNS,
        apply: () => READ_AGAIN,
      }
    const asked: ChangesAsk = { thread: turn.thread, turn: turn.turn }
    return {
      read: async () => {
        const [kept, changes] = await Promise.all([
          diff().catch((error: unknown) => {
            if (!noCheckpoint(error)) throw error
            return null
          }),
          engine.call("agents.changes", asked, { space }),
        ])
        return turnRead(kept, changes)
      },
      filter: {
        module: "agents",
        subject: turn.thread,
        kinds: ["turn.ended", "thread.rewound"],
      },
      apply: () => READ_AGAIN,
    }
  }, [engine, space, question])
  const live = useLive(engine, space, source, round)
  const diff = live.state === "ready" ? live.view : undefined
  const fresh = () => {
    last.current = undefined
    again()
  }
  return { live, diff, question, words, again, fresh }
}
