/**
 * The question before a Project is removed from Banda, in T3 Code's words:
 * how many Threads go with it, that its files stay, and that it cannot be
 * undone. Project settings ask it by their Remove, and the Window's
 * `projects.remove` by the sidebar's Project menu and a missing Project's
 * card (ADR 0098, decision 16).
 */
import { useEffect, useState } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { toast } from "@banda/ui/components/sonner"
import { removeProject } from "@banda/ui/lib/projects"
import { problem } from "@banda/ui/lib/words"

/** The Project a removal asks about, and how many Threads go with it, if
 * the agents module said. */
export type Removing = { project: ProjectSummary; threads?: number }

/** What removing `project` asks: how many Threads go with it, as its
 * agents module counts them, or none where it does not say. */
export async function removingOf(
  engine: Engine,
  project: ProjectSummary
): Promise<Removing> {
  const threads = await engine
    .call("agents.threads", {}, { project: project.id })
    .then(
      (list) => list.threads.length,
      () => undefined
    )
  return { project, threads }
}

/** What a removal asks, as T3 Code does. */
function questionOf({ project, threads }: Removing): string {
  const what =
    threads === undefined
      ? "its Threads"
      : `its ${threads} ${threads === 1 ? "Thread" : "Threads"}`
  return `Remove Project "${project.name}" and delete ${what}?`
}

/** The question, open while `removing` names a Project: Remove Project
 * runs `onRemove`, Cancel or Esc closes it. */
export function RemoveProjectDialog({
  removing,
  onRemove,
  onClose,
}: {
  removing: Removing | undefined
  onRemove: (project: ProjectId) => void
  onClose: () => void
}) {
  return (
    <Dialog
      open={removing !== undefined}
      onOpenChange={(open) => !open && onClose()}
    >
      {removing && (
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{questionOf(removing)}</DialogTitle>
            <DialogDescription className="font-mono text-meta break-all">
              {removing.project.folder}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1 text-ui text-muted-foreground">
            <p>This removes only the Project entries, not the files on disk.</p>
            <p>This action cannot be undone.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => onRemove(removing.project.id)}
            >
              Remove Project
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

/** What `askRemoval` sends the Window's question, a Window's own, as
 * its page is. */
const ASKED = "banda:remove-project"

/** Asks whether to remove `project`, by the Window's question; whether
 * one heard it. */
export function askRemoval(project: ProjectSummary): boolean {
  const asked = new CustomEvent<ProjectSummary>(ASKED, {
    detail: project,
    cancelable: true,
  })
  document.dispatchEvent(asked)
  return asked.defaultPrevented
}

/** The Window's own question, for `projects.remove`, once the Project's
 * Threads are counted. A removal that fails says why in a toast. */
export function RemovingProject({ engine }: { engine: Engine }) {
  const [removing, setRemoving] = useState<Removing>()
  useEffect(() => {
    const ask = (event: Event) => {
      event.preventDefault()
      void removingOf(
        engine,
        (event as CustomEvent<ProjectSummary>).detail
      ).then(setRemoving)
    }
    document.addEventListener(ASKED, ask)
    return () => document.removeEventListener(ASKED, ask)
  }, [engine])
  const close = () => setRemoving(undefined)
  return (
    <RemoveProjectDialog
      removing={removing}
      onClose={close}
      onRemove={(project) => {
        close()
        removeProject(engine, project).catch((error: unknown) =>
          toast.error(problem(error))
        )
      }}
    />
  )
}
