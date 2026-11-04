/**
 * The last toasts, out of what Sonner keeps (ADR 0048, decision 2). Pure,
 * so plain tests cover it.
 */
import type { toast, ToastT } from "@banda/ui/components/sonner"

/** The toaster the bell shows the last toasts again in. */
export const RECENT = "recent"

/** How many of the last toasts the bell shows. */
export const LAST = 5

/**
 * The last `LAST` toasts in Sonner's history, the oldest first, as they
 * are shown again, so the newest stands in front: in the window's
 * toaster, or told away; none the bell itself shows again. Sonner keeps
 * one entry a toast, where its last call put it.
 */
export function recentOf(
  history: ReturnType<typeof toast.getHistory>
): ToastT[] {
  const toasts = history.filter(
    (kept): kept is ToastT => "title" in kept && kept.toasterId !== RECENT
  )
  return toasts.slice(-LAST)
}
