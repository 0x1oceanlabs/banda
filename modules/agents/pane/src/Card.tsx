import { cn } from "@banda/ui/lib/utils"

/** A box in the Thread that waits on the Person, as T3 Code draws one: an
 * icon and what it is, `action` at the end of that line, then `children`.
 * It reads as `label`, or as its title. */
export function Card({
  icon,
  title,
  label,
  action,
  className,
  children,
}: {
  icon: React.ReactNode
  title: string
  label?: string
  action?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label ?? title}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-3 text-sm",
        className
      )}
    >
      <div className="flex items-start gap-2 font-medium">
        <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
        <span className="min-w-0 flex-1 wrap-break-word">{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}
