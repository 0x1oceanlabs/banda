/**
 * Git's rows in a Thread's details card (ADR 0034, decision 4), as T3
 * Code's: the branch with how far it is ahead and behind, the git button,
 * and Changes `· N files +N −M`, what a commit would take, new files too,
 * which opens the Diff on Uncommitted; none when nothing is uncommitted.
 * One Initialize Git row instead when the Project's folder is no
 * repository, and why git will not read it when it is one git refuses.
 * They follow `git.watch`.
 */
import {
  type DetailsProps,
  DetailsRow,
} from "@banda/ui/components/thread-details"
import type { Filler } from "@banda/ui/slots"
import { DiffCounts } from "@banda/ui/components/diff"
import { useAct } from "@banda/ui/hooks/use-act"
import { useEffect } from "react"
import { paneOf } from "@banda/ui/pane"
import { FileDiffIcon, GitBranchPlusIcon } from "lucide-react"
import { BranchPicker, PICKER } from "./BranchPicker"
import { diffPane } from "./DiffPane"
import { GitButton } from "./GitButton"
import { CHANGES, type Scope } from "./scope"
import { filesOf, useGitStatus } from "./status"
import { GitAlert } from "./GitAlert"
import { showDetails } from "./ended"

function GitRows({
  engine,
  project,
  thread,
  harness,
  open,
  opening,
  opened,
}: DetailsProps) {
  const status = useGitStatus(engine, project)
  const init = useAct()
  // Drawn while the card shows: how a run ends, the card says itself.
  useEffect(() => showDetails(project, thread), [project, thread])
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
            void init.act(() => engine.call("git.init", {}, { project }))
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
        project={project}
        thread={thread}
        status={status}
        asked={opening === PICKER}
        onOpened={opened}
      />
      <GitButton
        engine={engine}
        project={project}
        thread={thread}
        harness={harness}
        status={status}
      />
      {status.files.length > 0 && (
        <DetailsRow
          icon={<FileDiffIcon />}
          title="Open the Diff on what is not committed yet"
          end={<DiffCounts added={status.added} removed={status.removed} />}
          onClick={() => open(diffOn({ kind: "uncommitted" }))}
        >
          Changes
          <span className="text-muted-foreground">
            {" · "}
            {filesOf(status.files.length)}
          </span>
        </DetailsRow>
      )}
    </>
  )
}

/** The Diff on `scope`: the branch's changes for Alt+D, what a commit
 * would take for the Changes row. */
export const diffOn = (scope: Scope = CHANGES) =>
  paneOf(diffPane, { scope, file: null })

/** Git's rows in Threads' Slot `thread.details`. */
export const gitDetails: Filler<"thread.details"> = {
  id: "git.branch",
  slot: "thread.details",
  Fill: GitRows,
}
