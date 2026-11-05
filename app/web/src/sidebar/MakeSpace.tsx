import { useState } from "react"
import type { Engine, SpaceSummary } from "@banda/contract"
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
import { updateSpace } from "@banda/ui/lib/spaces"

/** Promotion keeps the Space's identity, its Thread and its history. */
export function MakeSpace({
  engine,
  space,
  onClose,
}: {
  engine: Engine
  space: SpaceSummary
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const [move, setMove] = useState(true)
  const { busy, problem, act } = useAct()
  const scratchAt = space.folder.lastIndexOf("/scratch/")
  const root = scratchAt < 0 ? "~/Banda" : space.folder.slice(0, scratchAt)
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
      updateSpace(engine, {
        space: space.id,
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
          <label className="flex flex-col gap-2 text-sm">
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
            className="flex min-w-0 flex-col gap-3 text-sm"
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
                <span className="block text-xs break-all text-muted-foreground">
                  {space.folder}
                </span>
              </span>
            </label>
          </fieldset>
          {move && name.trim() && !plain && (
            <p role="alert" className="text-sm text-destructive">
              Use a name without slashes or a leading dot to make a new folder.
            </p>
          )}
          {problem && (
            <p role="alert" className="text-sm text-destructive">
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
