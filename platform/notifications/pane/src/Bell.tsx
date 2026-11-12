/**
 * The bell, the widget `notifications.recent` (ADR 0048, decision 2): a
 * click shows the last toasts again, the newest in front, as Sonner's
 * stack, opened, with their buttons. They stay till the bell is clicked
 * again, `Esc`, a click elsewhere, or one of their buttons is. A button
 * runs its action as the toast's did.
 *
 *   in    recent   the last notices, five at most, kept in the window's
 *                  own storage (`recent.ts`), read as the bell is
 *                  clicked
 *   draws the bell; a click shows the last notices again as toasts in a
 *         toaster of its own in the Top layer, or "Nothing yet" with
 *         none, and puts away the window's toasts on screen
 *   runs  the action of a toast's button, or of a click on the toast,
 *         with its args, as the toast first shown did
 */
import { Button } from "@banda/ui/components/button"
import { Toaster, type ToastT, toast } from "@banda/ui/components/sonner"
import { TopLayer } from "@banda/ui/components/top-layer"
import { useRun } from "@banda/core/react"
import { BellIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { LAST, recentNow } from "./recent"
import { toastTold } from "./toast"

type Id = ToastT["id"]

/** The toaster the bell shows the last notices again in. */
const RECENT = "recent"

/** What the bell shows with nothing kept. */
const NOTHING = {
  id: "nothing",
  title: "Nothing yet",
  description: "What still waits for you is in the sidebar.",
} satisfies ToastT

/** The bell, as the top of this file says. */
export function BellWidget() {
  const run = useRun()
  const [open, setOpen] = useState(false)
  const shown = useRef(new Set<Id>())
  const bell = useRef<HTMLButtonElement>(null)
  const toaster = useRef<HTMLElement>(null)

  const close = useCallback(() => {
    for (const id of shown.current) toast.dismiss(id)
    shown.current.clear()
    setOpen(false)
  }, [])
  const gone = useCallback((id: Id) => {
    shown.current.delete(id)
    if (shown.current.size === 0) setOpen(false)
  }, [])
  const show = () => {
    const last = recentNow()
    // The window's toasts are among the last: they show once, here.
    toast.dismiss()
    // Each as it was, under an id of its own here, so Sonner keeps one
    // copy of it however often the bell shows it.
    const here = {
      toasterId: RECENT,
      duration: Infinity,
      onDismiss: (toast: ToastT) => gone(toast.id),
    }
    shown.current = new Set(
      last.length > 0
        ? last.map((told) =>
            toastTold(told, (button) => run(button.action, button.args), {
              ...here,
              id: `${RECENT}:${told.key}`,
            })
          )
        : [toast(NOTHING.title, { ...NOTHING, ...here })]
    )
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    const press = (event: PointerEvent) => {
      const at = event.target as Node
      if (!bell.current?.contains(at) && !toaster.current?.contains(at)) close()
    }
    // A toast's button did its work, as Sonner ran it: all go.
    const click = (event: MouseEvent) => {
      const at = event.target as Element
      if (toaster.current?.contains(at) && at.closest("[data-button]")) close()
    }
    window.addEventListener("keydown", key)
    window.addEventListener("pointerdown", press)
    window.addEventListener("click", click)
    return () => {
      window.removeEventListener("keydown", key)
      window.removeEventListener("pointerdown", press)
      window.removeEventListener("click", click)
    }
  }, [open, close])

  return (
    <>
      <Button
        ref={bell}
        variant="ghost"
        size="icon-sm"
        aria-label="The last notifications"
        aria-pressed={open}
        title="The last notifications"
        onClick={open ? close : show}
        className="text-muted-foreground hover:text-foreground aria-pressed:text-foreground"
      >
        <BellIcon />
      </Button>
      <TopLayer>
        <Toaster
          ref={toaster}
          id={RECENT}
          expand
          visibleToasts={LAST}
          customAriaLabel="Shown again"
        />
      </TopLayer>
    </>
  )
}
