/**
 * Thread details (ADR 0034, decision 4): a quiet card in the Thread Pane,
 * as T3 Code's, whose rows the modules give, git's now and `pulls`' after.
 * The Thread Pane draws the card, the Slot `thread.details` (`slots.ts`),
 * with the rows of the modules that run; each module draws its own.
 */
import type { ComponentProps, ReactNode } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import { cn } from "../lib/utils"
import type { PaneState, Place } from "../pane"

export type DetailsProps = {
  engine: Engine
  project: ProjectId
  /** The Thread the card is in; none while a new one is written. */
  thread: string | null
  /** The Harness the Thread runs on, or a new one starts on: its id, and
   * what a sentence calls it (`Claude`); none when no Harness is on. */
  harness: { id: string; name: string } | null
  /** Opens a Pane beside the Thread, as the Thread's own links do. */
  open: (pane: PaneState, place?: Place) => void
  /** The part of a row a key asked the card to open, as Alt+Shift+G
   * the branch picker (`agents.thread.details` with its `part`), until
   * the row says it is `opened`. */
  opening: string | null
  opened: () => void
}

/** How wide the card is, and the room it keeps from the Pane's edge. */
export const DETAILS_CARD = 280
export const DETAILS_GAP = 12
/** The messages' column, `max-w-3xl`. */
const MESSAGES = 768
/** How wide a Pane holds the card beside its centred messages: what a
 * Pane beside the Thread can take as wide too. */
export const DETAILS_WIDE = MESSAGES + 2 * (DETAILS_CARD + DETAILS_GAP)

/** A row's faint fill under the mouse; a row split in two, as the git
 * button and its `▾`, puts it on what holds both. */
export const ROW_HOVER = "hover:bg-black/[3.5%] dark:hover:bg-white/8"

/**
 * A row of the card, as T3 Code's: 32px, no fill at rest, a faint one
 * under the mouse; an icon, words and what goes at the end. A `button`
 * when it does something.
 */
export function DetailsRow({
  icon,
  end,
  wrap = false,
  className,
  children,
  ...props
}: ComponentProps<"button"> & {
  icon?: ReactNode
  /** After the words, at the row's end. */
  end?: ReactNode
  /** Its words go on to a second line rather than be cut short. */
  wrap?: boolean
}) {
  const inner = (
    <>
      {icon && (
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
      )}
      <span
        className={cn(
          "min-w-0 flex-1 text-left",
          wrap ? "whitespace-normal" : "truncate"
        )}
      >
        {children}
      </span>
      {end && <span className="flex shrink-0 items-center gap-1.5">{end}</span>}
    </>
  )
  const look = cn(
    "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-foreground/80",
    wrap ? "min-h-8 py-1.5" : "h-8"
  )
  if (!props.onClick) return <div className={cn(look, className)}>{inner}</div>
  return (
    <button
      type="button"
      className={cn(
        look,
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        ROW_HOVER,
        className
      )}
      {...props}
    >
      {inner}
    </button>
  )
}
