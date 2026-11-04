import { BandaMark } from "@banda/ui/components/banda-mark"
import { type ExternalToast, toast } from "@banda/ui/components/sonner"
import type { Chime } from "@banda/ui/sound"
import type { Button, Told } from "./told"

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
 * Shows a notice in Sonner's toast (ADR 0048, ADR 0056, decision 2): its
 * Mark, its code line and words, and its buttons, each running its
 * action. Its id is its key, so what it tells next replaces it; `options`
 * are Sonner's beside.
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
    closeButton: told.close === true,
    classNames: { description: "line-clamp-2" },
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
