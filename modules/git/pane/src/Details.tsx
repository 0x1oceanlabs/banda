/**
 * Git's rows in a Thread's details card (ADR 0034, decision 4), as T3
 * Code's: the branch with how far it is ahead and behind, and Changes
 * `+N −M`, which opens the Diff on them; one Initialize Git row instead
 * when the Space's folder is no repository. They follow `git.watch`.
 */
import { useCallback, useSyncExternalStore } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type { Status } from "@banda/contract/git"
import {
  type Details,
  type DetailsProps,
  DetailsRow,
} from "@banda/ui/components/thread-details"
import { DiffCounts } from "@banda/ui/components/diff"
import { useAct } from "@banda/ui/hooks/use-act"
import { paneOf } from "@banda/ui/pane"
import { FileDiffIcon, GitBranchIcon, GitBranchPlusIcon } from "lucide-react"
import { diffPane } from "./DiffPane"
import { GitButton } from "./GitButton"
import { VIEW } from "./diff"
import { CHANGES } from "./scope"

/** A Space's `git.watch`, shared by every card that shows it: one
 * stream, one fetch every 30 seconds, however many Threads are open. */
type Watched = {
  status: Status | null
  hearing: Set<() => void>
  stop: () => void
  leaving?: ReturnType<typeof setTimeout>
}

const watched = new WeakMap<Engine, Map<SpaceId, Watched>>()

/** How long a Space's watch stays after its last card went: a popover
 * opened again has the status at once, and fetches no more. */
const LINGER = 60_000

function watching(engine: Engine, space: SpaceId): Watched {
  let spaces = watched.get(engine)
  if (!spaces) watched.set(engine, (spaces = new Map()))
  const known = spaces.get(space)
  if (known) return known
  const made: Watched = { status: null, hearing: new Set(), stop: () => {} }
  const tell = (status: Status | null) => {
    made.status = status
    for (const hear of made.hearing) hear()
  }
  made.stop = engine.stream(space, "git.watch", {}, tell, () => {
    // The engine ended it: the next card to come starts it again.
    spaces.delete(space)
    tell(null)
  })
  spaces.set(space, made)
  return made
}

/** The Space's status as `git.watch` says it; none until it first does,
 * or when the engine refuses it. */
function useGitStatus(engine: Engine, space: SpaceId): Status | null {
  const subscribe = useCallback(
    (hear: () => void) => {
      const watch = watching(engine, space)
      clearTimeout(watch.leaving)
      watch.hearing.add(hear)
      return () => {
        watch.hearing.delete(hear)
        if (watch.hearing.size > 0) return
        watch.leaving = setTimeout(() => {
          watch.stop()
          watched.get(engine)?.delete(space)
        }, LINGER)
      }
    },
    [engine, space]
  )
  return useSyncExternalStore(
    subscribe,
    () => watched.get(engine)?.get(space)?.status ?? null
  )
}

function GitRows({ engine, space, thread, open }: DetailsProps) {
  const status = useGitStatus(engine, space)
  const init = useAct()
  if (!status) return null
  if (!status.repo)
    return (
      <>
        <DetailsRow
          icon={<GitBranchPlusIcon />}
          disabled={init.busy}
          onClick={() =>
            void init.act(() => engine.call("git.init", {}, { space }))
          }
        >
          {init.busy ? "Initializing…" : "Initialize Git"}
        </DetailsRow>
        {init.problem && (
          <p role="alert" className="px-2 pb-1 text-xs text-destructive">
            {init.problem}
          </p>
        )}
      </>
    )
  return (
    <>
      <DetailsRow
        icon={<GitBranchIcon />}
        title={status.upstream && `Follows ${status.upstream}`}
        end={<Distance ahead={status.ahead} behind={status.behind} />}
      >
        {status.branch ?? "Detached HEAD"}
      </DetailsRow>
      <GitButton
        engine={engine}
        space={space}
        thread={thread}
        status={status}
      />
      {status.files.length > 0 && (
        <DetailsRow
          icon={<FileDiffIcon />}
          title="Open the Diff on these changes"
          end={<DiffCounts added={status.added} removed={status.removed} />}
          onClick={() =>
            open(paneOf(diffPane, { scope: CHANGES, view: VIEW, file: null }))
          }
        >
          Changes
        </DetailsRow>
      )}
    </>
  )
}

/** `↑2 ↓3`: the commits the upstream lacks, and those it has. */
function Distance({ ahead, behind }: { ahead?: number; behind?: number }) {
  if (!ahead && !behind) return null
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {[ahead && `↑${ahead}`, behind && `↓${behind}`].filter(Boolean).join(" ")}
    </span>
  )
}

export const gitDetails: Details = { id: "git.branch", Rows: GitRows }
