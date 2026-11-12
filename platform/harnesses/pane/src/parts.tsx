/** The Usage Pane's small parts, which its tabs share. */
import { cn } from "@banda/ui/lib/utils"
import type { Account } from "./usage"

/** A row of small buttons, one pressed: the period, the chart's form. */
export function Segments({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 gap-0.5 rounded-control bg-muted/60 p-0.5",
        className
      )}
    >
      {children}
    </div>
  )
}

export function Segment({
  pressed,
  className,
  ...props
}: React.ComponentProps<"button"> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "rounded-control px-2 py-0.5 text-meta text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-foreground/10 aria-pressed:text-foreground",
        className
      )}
      {...props}
    />
  )
}

/** An account's dot, in its colour. */
export function Dot({
  account,
  on = true,
}: {
  account: Account
  on?: boolean
}) {
  return (
    <i
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        !on && "ring-[1.5px] ring-muted-foreground/60 ring-inset"
      )}
      style={on ? { background: account.colour } : undefined}
    />
  )
}

/** A quiet line in place of what is not there yet, or at all. */
export function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-ui text-muted-foreground">{children}</p>
}
