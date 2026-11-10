/**
 * What Quit Banda asks while Agents are working (ADR 0086, decision 3):
 * quitting stops the engine and their turns with it, where closing the
 * window does not. It asks in the words Quit says everywhere, `banda
 * stop` in a terminal too (`quitAsks`), Cancel the default.
 */
import { quitAsks } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { isMac } from "@banda/ui/lib/keys"

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
  // One at least: the words stay as the dialog fades out.
  const asks = quitAsks(Math.max(working ?? 1, 1), isMac)
  return (
    <Dialog
      open={working !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{asks?.title}</DialogTitle>
          <DialogDescription>{asks?.detail}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" autoFocus onClick={onClose}>
            {asks?.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onClose()
              onQuit()
            }}
          >
            {asks?.quit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
