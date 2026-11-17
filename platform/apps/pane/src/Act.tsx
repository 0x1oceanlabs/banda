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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { FieldError } from "@banda/ui/components/field"
import { Spinner } from "@banda/ui/components/spinner"
import { useAct } from "@banda/ui/hooks/use-act"
import { cn } from "@banda/ui/lib/utils"
import { EllipsisIcon } from "lucide-react"
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

/**
 * How a control sends what it does: at once, or after the question or
 * the form it asks first, drawn by `asking`. One for a button, and one
 * for all the items of a menu.
 */
function useDoing(send: Send) {
  const { busy, problem, act } = useAct()
  // What was clicked, held while its question or its form is open: the
  // Tree may be read again meanwhile, and another row stand in this
  // one's place.
  const [held, setHeld] = useState<{ doing: Doing; given?: Given }>()
  // What it asked last, kept as its dialog closes. A row's control is a
  // control alone until it is first asked: a page of rows mounts no
  // dialog.
  const [asked, setAsked] = useState<Doing>()
  const open = held !== undefined
  const setOpen = (open: boolean) => open || setHeld(undefined)
  const go = (doing: Doing) =>
    void act(() => send(doing.command, doing.params), doing.label)
  const start = (doing: Doing, given?: Given) => {
    if (busy) return
    if (!doing.form && !doing.confirm) return go(doing)
    setAsked(doing)
    setHeld({ doing, given })
  }
  const asking = !asked ? null : asked.form ? (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{asked.label}</DialogTitle>
        </DialogHeader>
        <Closing value={() => setOpen(false)}>
          <FormNode
            form={asked.form}
            send={send}
            given={held?.given}
            sent={asked.params}
          />
        </Closing>
      </DialogContent>
    </Dialog>
  ) : (
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
            variant={asked.tone === "bad" ? "destructive" : "default"}
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
  return { busy, problem, start, asking }
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
  const { busy, problem, start, asking } = useDoing(send)
  return (
    <div data-slot="tree-button" className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size={size}
        variant={variant}
        aria-busy={busy}
        className={cn(variant !== "destructive" && toneText(doing.tone))}
        onClick={() => start(doing, given)}
      >
        {busy && <Spinner />}
        {doing.label}
      </Button>
      {problem && <FieldError>{problem}</FieldError>}
      {asking}
    </div>
  )
}

/**
 * The rest of what can be done with a row, under one button: each as
 * [`ActButton`] does it. What cannot be undone comes last, after a line.
 */
export function ActMenu({
  doings,
  send,
}: {
  doings: readonly { doing: Doing; given?: Given }[]
  send: Send
}) {
  const { busy, problem, start, asking } = useDoing(send)
  const bad = ({ doing }: { doing: Doing }) => doing.tone === "bad"
  const calm = doings.filter((one) => !bad(one))
  const last = doings.filter(bad)
  const item = ({ doing, given }: (typeof doings)[number], place: number) => (
    <DropdownMenuItem
      key={`${doing.command}:${place}`}
      variant={doing.tone === "bad" ? "destructive" : "default"}
      onClick={() => start(doing, given)}
    >
      {doing.label}
    </DropdownMenuItem>
  )
  return (
    <div data-slot="tree-menu" className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="More"
              aria-busy={busy}
            />
          }
        >
          {busy ? <Spinner /> : <EllipsisIcon />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-40">
          {calm.map(item)}
          {calm.length > 0 && last.length > 0 && <DropdownMenuSeparator />}
          {last.map(item)}
        </DropdownMenuContent>
      </DropdownMenu>
      {problem && <FieldError>{problem}</FieldError>}
      {asking}
    </div>
  )
}
