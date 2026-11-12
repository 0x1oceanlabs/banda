import { useState } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { Input } from "@banda/ui/components/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { useAct } from "@banda/ui/hooks/use-act"
import { updateProject } from "@banda/ui/lib/projects"
import { Store, useStore } from "@banda/core/react"

/** The No Project's Project the dialog makes a Project of, while it is
 * open. */
const making = new Store<ProjectId | undefined>(undefined)
const now = (project: ProjectId | undefined) => project

/** Opens "Make a Project from this Thread" for `project`, a Thread's own
 * in No Project (ADR 0046), as Threads' item action asks it. */
export function makeProject(project: ProjectId) {
  making.set(project)
}

/** The dialog, while it is asked for one of `projects` in No Project. */
export function Making({
  engine,
  projects,
}: {
  engine: Engine
  projects: readonly ProjectSummary[]
}) {
  const asked = useStore(making, now)
  const project = projects.find((one) => one.id === asked)
  if (!project?.scratch) return null
  return (
    <MakeProject
      engine={engine}
      project={project}
      onClose={() => making.set(undefined)}
    />
  )
}

/** Promotion keeps the Project's identity, its Thread and its history. */
export function MakeProject({
  engine,
  project,
  onClose,
}: {
  engine: Engine
  project: ProjectSummary
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const [move, setMove] = useState(true)
  const { busy, problem, act } = useAct()
  const scratchAt = project.folder.lastIndexOf("/scratch/")
  const root = scratchAt < 0 ? "~/Banda" : project.folder.slice(0, scratchAt)
  const folder = `${root || "~/Banda"}/${name.trim()}`
  const plain = !name.trim().startsWith(".") && !/[\\/]/.test(name)
  const ready =
    name.trim().length > 0 &&
    name.trim().length <= 64 &&
    (!move || plain) &&
    !busy
  const promote = async () => {
    if (!ready) return
    const made = await act(() =>
      updateProject(engine, {
        project: project.id,
        scratch: false,
        name: name.trim(),
        ...(move && { folder }),
      })
    )
    if (made) onClose()
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void promote()
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Make a Project from this Thread</DialogTitle>
            <DialogDescription>
              The Thread, its files and history stay together.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-2 text-ui">
            Name
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>
          <fieldset
            disabled={busy}
            className="flex min-w-0 flex-col gap-3 text-ui"
          >
            <legend className="mb-2 font-medium">Folder</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="folder"
                checked={move}
                onChange={() => setMove(true)}
              />
              <span>
                Move to{" "}
                <span className="font-mono break-all">
                  {name.trim() ? folder : `${root || "~/Banda"}/<name>`}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="folder"
                checked={!move}
                onChange={() => setMove(false)}
              />
              <span>
                Keep it where it is
                <span className="block text-meta break-all text-muted-foreground">
                  {project.folder}
                </span>
              </span>
            </label>
          </fieldset>
          {move && name.trim() && !plain && (
            <p role="alert" className="text-ui text-destructive">
              Use a name without slashes or a leading dot to make a new folder.
            </p>
          )}
          {problem && (
            <p role="alert" className="text-ui text-destructive">
              {problem}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              {busy ? "Making Project…" : "Make Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
