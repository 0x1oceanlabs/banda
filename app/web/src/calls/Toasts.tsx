import { BandaMark, MARK_WORDS } from "@banda/ui/components/banda-mark"
import type { Chime } from "@banda/ui/sound"
import { cn } from "@banda/ui/lib/utils"
import { SHOWN, type Toast } from "./toast"
import type { Heard } from "./useCalls"

/** The edge that says each call at a glance, as the Mark's colours do. */
const EDGE: Record<Chime, string> = {
  done: "border-l-foreground",
  asking: "border-l-attention",
  failed: "border-l-destructive",
}

/** What a click on each does. */
const ANSWER: Record<Chime, string> = {
  done: "Open",
  asking: "Answer",
  failed: "Open",
}

/**
 * The window's toasts, at its top right, below the bar (ADR 0011, decision
 * 2): each names what calls and what it said, and a click goes there. At
 * most three show; the rest are counted, and the sidebar lists them all.
 * The pointer over them holds them.
 */
export function Toasts({
  toasts,
  calling,
  detail,
  onAnswer,
  onMore,
  onHold,
}: {
  toasts: readonly Toast[]
  calling: readonly Heard[]
  /** Whether a toast says what was said, or only names what calls. */
  detail: boolean
  onAnswer: (call: Heard) => void
  onMore: () => void
  onHold: (holds: boolean) => void
}) {
  const shown = toasts.flatMap((toast) => {
    const call = calling.find((c) => c.key === toast.key)
    return call ? [{ toast, call }] : []
  })
  if (shown.length === 0) return null
  const more = shown.length - SHOWN
  return (
    <section
      aria-label="Calls"
      aria-live="polite"
      className="pointer-events-none absolute top-2 right-2 z-30 flex w-80 flex-col gap-2"
      onPointerEnter={() => onHold(true)}
      onPointerLeave={() => onHold(false)}
    >
      {shown.slice(0, SHOWN).map(({ toast, call }) => (
        <button
          key={toast.key}
          type="button"
          onClick={() => onAnswer(call)}
          className={cn(
            "pointer-events-auto flex w-full items-start gap-2.5 rounded-lg border border-l-4 bg-popover p-3 text-left text-popover-foreground shadow-lg outline-none",
            "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-3",
            EDGE[call.chime]
          )}
        >
          <BandaMark
            variant="agent"
            state={call.chime}
            playful={0}
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{call.title}</span>
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {MARK_WORDS[call.chime]}
              {detail && call.detail ? ` · ${call.detail}` : ""}
            </span>
          </span>
          <span className="shrink-0 rounded border px-1.5 py-0.5 text-xs">
            {ANSWER[call.chime]}
          </span>
        </button>
      ))}
      {more > 0 && (
        <button
          type="button"
          onClick={onMore}
          className="pointer-events-auto self-end rounded-md border bg-popover px-2.5 py-1 text-xs text-muted-foreground shadow hover:bg-accent"
        >
          {more} more in the sidebar
        </button>
      )}
    </section>
  )
}
