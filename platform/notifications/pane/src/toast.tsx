import { BandaMark } from "@banda/ui/components/banda-mark"
import { type ExternalToast, toast } from "@banda/ui/components/sonner"
import type { Chime } from "@banda/ui/sound"
import { type Button, clicked, type Told } from "./told"

/** How long each call's toast shows, in ms: the louder, the longer (ADR
 * 0011, decision 2). */
export const LIFE: Record<Chime, number> = {
  done: 5000,
  failed: 8000,
  // What asks stays until it is answered or seen (ADR 0056, decision 3).
  asking: Infinity,
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
  const id = options?.id ?? told.key
  const opens = clicked(told)
  if (opens) clicks.set(String(id), () => run(opens))
  else clicks.delete(String(id))
  return KIND[told.kind](titleOf(told), {
    id,
    testId: String(id),
    duration: LIFE[told.kind],
    closeButton: told.close === true,
    className: [
      "grid! grid-cols-[auto_minmax(0,1fr)] items-start! [&>[data-content]]:col-start-2 [&>[data-content]]:min-w-0",
      opens ? "cursor-pointer" : "",
    ].join(" "),
    classNames: {
      description: "line-clamp-3 whitespace-pre-line wrap-anywhere",
      actionButton:
        "col-start-2 ml-0! h-auto! min-h-6 max-w-full justify-self-end py-1! text-left whitespace-normal! wrap-anywhere",
      cancelButton:
        "col-start-2 ml-0! h-auto! min-h-6 max-w-full justify-self-end py-1! text-left whitespace-normal! wrap-anywhere",
    },
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

/** Its title, with its Project after it, dimmer. */
function titleOf(told: Told) {
  if (!told.project) return told.title
  return (
    <>
      {told.title}{" "}
      <span className="font-normal text-muted-foreground">
        · {told.project}
      </span>
    </>
  )
}

/** What a click on each toast does, by its id (`Told.open`). */
const clicks = new Map<string, () => void>()

/**
 * A click anywhere on a toast does what its `open` says, and the
 * toast goes (ADR 0056, decision 3); a click on a button is the button's,
 * and a swipe is Sonner's. Returns how to stop.
 */
export function clickToasts(): () => void {
  const click = (event: MouseEvent) => {
    const at = event.target instanceof Element ? event.target : null
    const card = at?.closest<HTMLElement>("[data-sonner-toast]")
    if (!card || at?.closest("button, a")) return
    if (card.dataset.swiped === "true") return
    const id = card.dataset.testid
    const run = id ? clicks.get(id) : undefined
    if (!id || !run) return
    run()
    toast.dismiss(id)
  }
  document.addEventListener("click", click)
  return () => document.removeEventListener("click", click)
}
