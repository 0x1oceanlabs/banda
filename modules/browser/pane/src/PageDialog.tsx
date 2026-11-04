/** A page's dialog, centered in its own view (ADR 0060). Only that view
 * is blocked: the Person can still move to another Pane or tab. */
import { useEffect, useId, useRef, useState } from "react"
import type { Dialog } from "@banda/contract/browser"
import { Button } from "@banda/ui/components/button"
import { Input } from "@banda/ui/components/input"
import { GlobeIcon } from "lucide-react"
import { siteOf } from "./desktop"

export function PageDialog({
  dialog,
  focused,
  onAnswer,
  onDone,
  initialText,
  onText,
}: {
  dialog: Dialog
  focused: boolean
  onAnswer: (accept: boolean, text?: string) => Promise<void>
  onDone: () => void
  initialText: string
  onText: (text: string) => void
}) {
  const title = useId()
  const message = useId()
  const form = useRef<HTMLFormElement>(null)
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    if (focused)
      form.current?.querySelector<HTMLElement>("input, button")?.focus()
  }, [focused])
  const answer = async (accept: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      await onAnswer(
        accept,
        accept && dialog.kind === "prompt" ? text : undefined
      )
      onDone()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      setBusy(false)
    }
  }
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-background/40 p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          void answer(dialog.kind === "alert")
        }
      }}
    >
      <form
        ref={form}
        role="dialog"
        aria-modal={false}
        aria-labelledby={title}
        aria-describedby={message}
        className="grid max-h-full w-full max-w-sm gap-4 overflow-y-auto rounded-xl border bg-popover p-5 text-sm text-popover-foreground shadow-xl"
        onSubmit={(event) => {
          event.preventDefault()
          void answer(true)
        }}
      >
        <div
          id={title}
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <GlobeIcon className="size-3.5 shrink-0" />
          {siteOf(dialog.url)} says
        </div>
        <p
          id={message}
          className="max-h-40 overflow-y-auto break-words whitespace-pre-wrap"
        >
          {dialog.message}
        </p>
        {dialog.kind === "prompt" && (
          <Input
            aria-label="Response"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              onText(event.target.value)
            }}
            disabled={busy}
          />
        )}
        {error && (
          <p role="alert" className="text-xs break-words text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {dialog.kind !== "alert" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void answer(false)}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={busy}>
            OK
          </Button>
        </div>
      </form>
    </div>
  )
}
