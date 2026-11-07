/**
 * What Quit Banda asks while Agents are working (ADR 0086, decision 3):
 * quitting stops the engine and their turns with it, where closing the
 * window does not. `banda stop` asks the same in a terminal.
 */
import { Button } from "@banda/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"

/** The question, as the engine's `banda stop` words it. */
export function quitQuestion(working: number): string {
  return working === 1
    ? "An Agent is working. Stop it and quit?"
    : `${working} Agents are working. Stop them and quit?`
}

/** Asks whether to stop `working` Agents and quit; none while it is null. */
export function QuitDialog({
  working,
  onQuit,
  onClose,
}: {
  working: number | null
  onQuit: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open={working !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Quit Banda?</DialogTitle>
          <DialogDescription>{quitQuestion(working ?? 0)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            autoFocus
            onClick={() => {
              onClose()
              onQuit()
            }}
          >
            Stop and quit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
