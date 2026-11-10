/** What a sub-agent's row and their group's line share (ADR 0103,
 * decisions 14 and 15): one line on the Thread's edge that opens in place,
 * and text that fades where it is cut. */
import { ChevronRightIcon } from "lucide-react"
import { CollapsibleTrigger } from "@banda/ui/components/collapsible"
import { stopFollowing } from "@banda/ui/components/message-scroller"
import { cn } from "@banda/ui/lib/utils"

/** Text cut at its end fades there, and only when it is cut: the look's
 * "Fades, not …" (the kit's `.s-fit`). */
export const FADES =
  "overflow-hidden whitespace-nowrap scroll-fade-e scroll-fade-e-7 [--scroll-fade-reveal:1px]"

/** The line that opens a row or a group, its chevron at its end. The
 * Person opening it keeps it where it is: the Thread stops following its
 * end, so what opens grows downward and nothing above it moves. */
export function RowTrigger({
  className,
  children,
  onClick,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger
      className={cn(
        "group/row -mx-2 flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-control px-2 text-left text-sm whitespace-nowrap transition-colors outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
      onClick={(event) => {
        stopFollowing(event.currentTarget)
        onClick?.(event)
      }}
      {...props}
    >
      {children}
      <ChevronRightIcon
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground/55 transition-transform group-aria-expanded/row:rotate-90 motion-reduce:transition-none"
      />
    </CollapsibleTrigger>
  )
}
