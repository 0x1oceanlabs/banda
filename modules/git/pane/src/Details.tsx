/**
 * Git's rows in a Thread's details card (ADR 0034, decision 4), as T3
 * Code's: the branch with how far it is ahead and behind, and Changes
 * `+N −M`, which opens the Diff on them; one Initialize Git row instead
 * when the Space's folder is no repository, and why git will not read it
 * when it is one git refuses. They follow `git.watch`.
 */
import {
  type Details,
  type DetailsProps,
  DetailsRow,
} from "@banda/ui/components/thread-details"
import { DiffCounts } from "@banda/ui/components/diff"
import { useAct } from "@banda/ui/hooks/use-act"
import { paneOf } from "@banda/ui/pane"
import { FileDiffIcon, GitBranchPlusIcon } from "lucide-react"
import { BranchPicker, PICKER } from "./BranchPicker"
import { diffPane } from "./DiffPane"
import { GitButton } from "./GitButton"
import { CHANGES } from "./scope"
import { useGitStatus } from "./status"
import { GitAlert } from "./GitAlert"

function GitRows({
  engine,
  space,
  thread,
  harness,
  open,
  opening,
  opened,
}: DetailsProps) {
  const status = useGitStatus(engine, space)
  const init = useAct()
  if (!status) return null
  // A repository git will not read, as another user's: why, and no
  // Initialize Git, which would make another inside it.
  if (status.problem)
    return (
      <GitAlert quiet className="px-2 py-1">
        {status.problem}
      </GitAlert>
    )
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
          <GitAlert className="px-2 pb-1">{init.problem}</GitAlert>
        )}
      </>
    )
  return (
    <>
      <BranchPicker
        engine={engine}
        space={space}
        status={status}
        asked={opening === PICKER}
        onOpened={opened}
      />
      <GitButton
        engine={engine}
        space={space}
        thread={thread}
        harness={harness}
        status={status}
      />
      {status.files.length > 0 && (
        <DetailsRow
          icon={<FileDiffIcon />}
          title="Open the Diff on these changes"
          end={<DiffCounts added={status.added} removed={status.removed} />}
          onClick={() => open(changesDiff())}
        >
          Changes
        </DetailsRow>
      )}
    </>
  )
}

/** The Diff on the Space's changes: the Changes row's, and Alt+D's. */
export const changesDiff = () =>
  paneOf(diffPane, { scope: CHANGES, file: null })

export const gitDetails: Details = { id: "git.branch", Rows: GitRows }
