/**
 * The clash's question (ADR 0073, decision 10): a name taken in the
 * folder a move or a copy goes to asks Replace, Keep both or Skip, one
 * after another, or once for all those left. Esc stops the job before it
 * begins.
 */
import { type ReactNode, useCallback, useState } from "react"
import { Button } from "@banda/ui/components/button"
import { Checkbox } from "@banda/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import type { Asker } from "./acts"
import { type Answer, answered, type Asking, asking, question } from "./clash"

type Open = {
  now: Asking
  dir: string
  done: (answers: Record<string, Answer> | null) => void
}

/** What asks the Person about clashes, and the dialog that does. */
export function useClashes(): { ask: Asker; dialog: ReactNode } {
  const [open, setOpen] = useState<Open | null>(null)
  const [forAll, setForAll] = useState(false)
  const ask: Asker = useCallback(
    (clashes, dir) =>
      new Promise((resolve) => {
        setForAll(false)
        setOpen({ now: asking(clashes), dir, done: resolve })
      }),
    []
  )
  const choose = (answer: Answer) => {
    if (!open) return
    const next = answered(open.now, answer, forAll)
    if ("next" in next) setOpen({ ...open, now: next.next })
    else {
      setOpen(null)
      open.done(next.answers)
    }
  }
  const left = open ? open.now.clashes.length - open.now.at : 0
  const dialog = (
    <Dialog
      open={open !== null}
      onOpenChange={(now) => {
        if (now || !open) return
        setOpen(null)
        open.done(null)
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {open ? `“${open.now.clashes[open.now.at].name}” is there` : ""}
          </DialogTitle>
          <DialogDescription>
            {open && question(open.now, open.dir)} Replace it, keep both, or
            skip this one?
          </DialogDescription>
        </DialogHeader>
        {left > 1 && (
          <label className="flex items-center gap-2 text-meta text-muted-foreground">
            <Checkbox
              checked={forAll}
              onCheckedChange={(on) => setForAll(on === true)}
            />
            Do this for all {left}
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => choose("skip")}>
            Skip
          </Button>
          <Button variant="outline" onClick={() => choose("keep-both")}>
            Keep both
          </Button>
          <Button variant="destructive" onClick={() => choose("replace")}>
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
  return { ask, dialog }
}
