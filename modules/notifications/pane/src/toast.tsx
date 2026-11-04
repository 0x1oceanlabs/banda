import { BandaMark } from "@banda/ui/components/banda-mark"
import { type ExternalToast, toast } from "@banda/ui/components/sonner"
import type { Chime } from "@banda/ui/sound"
import { noticeOf } from "./system"
import type { Button, Told } from "./told"
import type { Call } from "@banda/ui/pane"

/** How long each call's toast shows, in ms: the louder, the longer (ADR
 * 0011, decision 2). */
export const LIFE: Record<Chime, number> = {
  done: 5000,
  failed: 8000,
  asking: 12000,
}

/** Sonner's kind of each call's toast, which colours its edge. */
const KIND = { done: toast, asking: toast.warning, failed: toast.error }

/** The Mark in a call's state, as a toast's icon. */
export const markOf = (chime: Chime) => (
  <BandaMark variant="agent" state={chime} playful={0} />
)

/**
 * Tells of a call in Sonner's toast (ADR 0048), in the words of its
 * system notification: what calls, what it said unless `detail` is off,
 * and a button that goes there. Its id is the call's key, so the thing's
 * next call replaces it; `options` are Sonner's beside.
 */
export function toastCall(
  call: Call,
  detail: boolean,
  answer: (call: Call) => void,
  options?: ExternalToast
): string | number {
  const { title, body, answer: label } = noticeOf(call, detail)
  return KIND[call.chime](title, {
    id: call.key,
    duration: LIFE[call.chime],
    icon: markOf(call.chime),
    description: body,
    action: { label, onClick: () => answer(call) },
    classNames: { description: "line-clamp-2" },
    ...options,
  })
}

/**
 * Shows what a module told in Sonner's toast (ADR 0056, decision 2): its
 * Mark, its code line and words, and its buttons, each running its
 * action. Its id is its key, so what it tells next replaces it.
 */
export function toastTold(
  told: Told,
  run: (button: Button) => void,
  options?: ExternalToast
): string | number {
  const [main, other] = told.buttons
  return KIND[told.kind](told.title, {
    id: told.key,
    duration: LIFE[told.kind],
    closeButton: true,
    icon: markOf(told.kind),
    description: (
      <>
        {told.code && (
          <span className="block truncate font-mono">{told.code}</span>
        )}
        {told.body}
      </>
    ),
    ...(main
      ? { action: { label: main.label, onClick: () => run(main) } }
      : {}),
    ...(other
      ? { cancel: { label: other.label, onClick: () => run(other) } }
      : {}),
    ...options,
  })
}
