/**
 * Thread details (ADR 0034, decision 4): a quiet card in the Thread Pane,
 * as T3 Code's, whose rows the modules give, git's now and `pulls`' after.
 * The Thread Pane draws the card; the window hands it the rows of the
 * modules that run; each module draws its own.
 */
import {
  type ComponentProps,
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
} from "react"
import type { Engine, SpaceId } from "@banda/contract"
import { cn } from "../lib/utils"
import type { PaneState, Place } from "../pane"

export type DetailsProps = {
  engine: Engine
  space: SpaceId
  /** The Thread the card is in; none while a new one is written. */
  thread: string | null
  /** The Harness the Thread runs on, or a new one starts on: its id, and
   * what a sentence calls it (`Claude`); none when no Harness is on. */
  harness: { id: string; name: string } | null
  /** Opens a Pane beside the Thread, as the Thread's own links do. */
  open: (pane: PaneState, place?: Place) => void
  /** The part of a row a key asked the card to open, as Alt+Shift+G
   * the branch picker (`askDetails`), until the row says it is `opened`. */
  opening: string | null
  opened: () => void
}

/** A module's rows in the card: drawn in a section of its own, gone
 * from it when they draw nothing. */
export type Details = {
  /** Dotted, its module's id first: `git.branch`. */
  id: string
  Rows: ComponentType<DetailsProps>
}

const Given = createContext<readonly Details[]>([])

const hearing = new Set<(id: string) => void>()

/** Asks the focused Thread's card to show, and to open the part `id` of
 * its rows, as Alt+Shift+G the branch picker. */
export function askDetails(id: string) {
  for (const hear of hearing) hear(id)
}

/** Calls `listener` with each ask; returns how to stop. The focused
 * Thread's card hears them. */
export function hearAsks(listener: (id: string) => void): () => void {
  hearing.add(listener)
  return () => hearing.delete(listener)
}

/** Hands the Panes drawn inside it the rows of the modules that run. */
export function DetailsRows({
  details,
  children,
}: {
  details: readonly Details[]
  children: ReactNode
}) {
  return <Given value={details}>{children}</Given>
}

/** The rows the modules that run give the card. */
export function useDetails(): readonly Details[] {
  return useContext(Given)
}

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
