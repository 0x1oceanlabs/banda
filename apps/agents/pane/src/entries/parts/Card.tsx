import { cn } from "@banda/ui/lib/utils"

/**
 * A card in the Thread, one recipe for all (ADR 0058, decisions 1 and 3):
 * a block with a line round it; a header of an icon, what it is, `detail`
 * beside that and `action` at the end; then `children`, in a
 * {@link CardBody} or as rows of their own. It reads as `label`, or as
 * its title; a card the Person finds the Thread by, as the turn's changes
 * or the plan, is a region of it.
 */
export function Card({
  icon,
  title,
  label,
  detail,
  action,
  region = false,
  className,
  children,
}: {
  icon: React.ReactNode
  title: string
  label?: string
  /** Beside the title, such as how many lines changed. */
  detail?: React.ReactNode
  action?: React.ReactNode
  /** A landmark of the Thread, rather than a group in it. */
  region?: boolean
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      role={region ? "region" : "group"}
      aria-label={label ?? title}
      className={cn(
        "flex flex-col rounded-card border bg-block text-sm",
        className
      )}
    >
      <div className="flex min-h-10 items-center gap-2 px-3 py-1.5">
        <span className="flex shrink-0 text-muted-foreground [&_svg]:size-3.75">
          {icon}
        </span>
        <span className="min-w-0 font-[550] wrap-break-word">{title}</span>
        {detail}
        {action && (
          <span className="ml-auto flex shrink-0 items-center">{action}</span>
        )}
      </div>
      {children}
    </div>
  )
}

/** What a card holds under its header, at the card's sides. */
export function CardBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-3 px-3 pb-3", className)}
      {...props}
    />
  )
}

/**
 * What docks on the composer, the same shape as it (ADR 0058, decisions 6
 * and 8): a Question that waits for the Person, a plan ready to carry out.
 */
export function Docked({
  label,
  className,
  ...props
}: React.ComponentProps<"div"> & { label: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("rounded-card border bg-block text-sm", className)}
      {...props}
    />
  )
}
