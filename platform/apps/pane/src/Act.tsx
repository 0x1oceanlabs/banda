/**
 * A control of an App's screen that sends one of its commands: at once,
 * after a question, or from a form it opens over the screen.
 */
import type { TreeForm, TreeTone } from "@banda/contract/apps"
import { Button } from "@banda/ui/components/button"
import {
  AlertDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { FieldError } from "@banda/ui/components/field"
import { Spinner } from "@banda/ui/components/spinner"
import { useAct } from "@banda/ui/hooks/use-act"
import { cn } from "@banda/ui/lib/utils"
import { type ComponentProps, useState } from "react"
import { Closing, FormNode, type Send } from "./Fields"
import type { Given } from "./form"
import { toneText } from "./tone"

/** What a control does. */
export type Doing = {
  label: string
  command: string
  /** The params it sends itself. */
  params: Record<string, unknown>
  confirm?: string | null
  form?: TreeForm | null
  tone?: TreeTone
}

export function ActButton({
  doing,
  given,
  send,
  variant = "outline",
  size = "sm",
}: {
  doing: Doing
  /** What its form's fields start from. */
  given?: Given
  send: Send
  variant?: ComponentProps<typeof Button>["variant"]
  size?: ComponentProps<typeof Button>["size"]
}) {
  const { busy, problem, act } = useAct()
  // What was clicked, held while its question or its form is open: the
  // Tree may be read again meanwhile, and another row stand in this
  // one's place.
  const [held, setHeld] = useState<{ doing: Doing; given?: Given }>()
  const open = held !== undefined
  // A row's button is a button alone until it is first asked: a page of
  // rows mounts no dialog.
  const [asking, setAsking] = useState(false)
  const setOpen = (open: boolean) => open || setHeld(undefined)
  const go = (doing: Doing) =>
    void act(() => send(doing.command, doing.params), doing.label)
  const bad = doing.tone === "bad"
  const asked = held?.doing ?? doing
  return (
    <div data-slot="tree-button" className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size={size}
        variant={variant}
        aria-busy={busy}
        className={cn(variant !== "destructive" && toneText(doing.tone))}
        onClick={() => {
          if (busy) return
          if (!doing.form && !doing.confirm) return go(doing)
          setAsking(true)
          setHeld({ doing, given })
        }}
      >
        {busy && <Spinner />}
        {doing.label}
      </Button>
      {problem && <FieldError>{problem}</FieldError>}
      {!asking ? null : doing.form ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{asked.label}</DialogTitle>
            </DialogHeader>
            <Closing value={() => setOpen(false)}>
              <FormNode
                form={asked.form ?? doing.form}
                send={send}
                given={held?.given}
                sent={asked.params}
              />
            </Closing>
          </DialogContent>
        </Dialog>
      ) : (
        doing.confirm && (
          <AlertDialog open={open} onOpenChange={setOpen}>
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>{asked.confirm}</DialogTitle>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  autoFocus
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant={bad ? "destructive" : "default"}
                  onClick={() => {
                    setOpen(false)
                    go(asked)
                  }}
                >
                  {asked.label}
                </Button>
              </DialogFooter>
            </DialogContent>
          </AlertDialog>
        )
      )}
    </div>
  )
}
