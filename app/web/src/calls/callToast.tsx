import { BandaMark } from "@banda/ui/components/banda-mark"
import { toast } from "@banda/ui/components/sonner"
import type { Chime } from "@banda/ui/sound"
import { noticeOf } from "./system"
import type { Heard } from "./useCalls"

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
 * next call replaces it.
 */
export function toastCall(
  call: Heard,
  detail: boolean,
  answer: (call: Heard) => void
): void {
  const { title, body, answer: label } = noticeOf(call, detail)
  KIND[call.chime](title, {
    id: call.key,
    duration: LIFE[call.chime],
    icon: markOf(call.chime),
    description: body,
    action: { label, onClick: () => answer(call) },
    classNames: { description: "line-clamp-2" },
  })
}
