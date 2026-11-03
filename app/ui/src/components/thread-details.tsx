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
import { cn } from "cn"
import type { PaneState, Place } from "../pane"

export type DetailsProps = {
  engine: Engine
  space: SpaceId
  /** The Thread the card is in; none while a new one is written. */
  thread: string | null
  /** Opens a Pane beside the Thread, as the Thread's own links do. */
  open: (pane: PaneState, place?: Place) => void
}

/** A module's rows in the card: drawn in a section of its own, gone
 * from it when they draw nothing. */
export type Details = {
  /** Dotted, its module's id first: `git.branch`. */
  id: string
  Rows: ComponentType<DetailsProps>
}

const Given = createContext<readonly Details[]>([])

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

/**
 * A row of the card, as T3 Code's: 32px, no fill at rest, a faint one
 * under the mouse; an icon, words and what goes at the end. A `button`
 * when it does something.
 */
export function DetailsRow({
  icon,
  end,
  className,
  children,
  ...props
}: ComponentProps<"button"> & {
  icon?: ReactNode
  /** After the words, at the row's end. */
  end?: ReactNode
}) {
  const inner = (
    <>
      {icon && (
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      {end && <span className="flex shrink-0 items-center gap-1.5">{end}</span>}
    </>
  )
  const look = cn(
    "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-foreground/80",
    className
  )
  if (!props.onClick) return <div className={look}>{inner}</div>
  return (
    <button
      type="button"
      className={cn(
        look,
        "outline-none hover:bg-black/[3.5%] focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/8"
      )}
      {...props}
    >
      {inner}
    </button>
  )
}
