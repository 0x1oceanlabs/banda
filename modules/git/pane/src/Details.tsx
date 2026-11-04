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
import { CircleAlertIcon, FileDiffIcon, GitBranchPlusIcon } from "lucide-react"
import { BranchPicker, PICKER } from "./BranchPicker"
import { diffPane } from "./DiffPane"
import { GitButton } from "./GitButton"
import { VIEW } from "./diff"
import { CHANGES } from "./scope"
import { useGitStatus } from "./status"

function GitRows({
  engine,
  space,
  thread,
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
      <div
        role="alert"
        className="flex items-start gap-2 px-2 py-1 text-xs text-muted-foreground"
      >
        <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 break-words">{status.problem}</span>
      </div>
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
          <p role="alert" className="px-2 pb-1 text-xs text-destructive">
            {init.problem}
          </p>
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
  paneOf(diffPane, { scope: CHANGES, view: VIEW, file: null })

export const gitDetails: Details = { id: "git.branch", Rows: GitRows }
