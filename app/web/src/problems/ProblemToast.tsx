import type { Problem } from "@banda/contract/problems"
import { BandaMark } from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import { cn } from "@banda/ui/lib/utils"
import { XIcon } from "lucide-react"
import { TOAST_CARD } from "../calls/Toasts"
import { PLACES } from "./live"

/**
 * The new Problems, in one toast over the calls' (ADR 0039): the newest,
 * in its words, how many more, Look into it, which asks an Agent in a
 * new Thread, and Details, which opens it in Settings → Problems.
 */
export function ProblemToast({
  problem,
  more,
  onLookInto,
  onDetails,
  onClose,
}: {
  problem: Problem
  /** How many more new Problems came with it. */
  more: number
  onLookInto: () => void
  onDetails: () => void
  onClose: () => void
}) {
  return (
    <section
      aria-label="Something broke in Banda"
      className={cn(TOAST_CARD, "border-l-4 border-l-destructive")}
    >
      <BandaMark
        variant="agent"
        state="failed"
        playful={0}
        className="mt-0.5 size-4 shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">Something broke in Banda</span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {problem.kind}: {problem.message}
        </span>
        <span className="text-xs text-muted-foreground">
          In {PLACES[problem.source]}.
          {more > 0 && ` ${more} more ${more === 1 ? "is" : "are"} new.`} Kept
          in Settings → Problems.
        </span>
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" onClick={onLookInto}>
            Look into it
          </Button>
          <Button size="sm" variant="outline" onClick={onDetails}>
            Details
          </Button>
        </div>
      </div>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="text-muted-foreground hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </section>
  )
}
