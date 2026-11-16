import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cn } from "../lib/utils"

/** `value` held between 0 and `max`. */
function clamp(value: number, max = 100): number {
  return Math.min(Math.max(value, 0), max)
}

/** How far along, as a bar: `value` out of `max`, as shadcn/ui draws it. */
function Progress({
  className,
  value,
  max = 100,
  ...props
}: Omit<ProgressPrimitive.Root.Props, "value" | "max"> & {
  value: number
  max?: number
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={clamp(value, max)}
      max={max}
      className={cn("w-full", className)}
      {...props}
    >
      <ProgressPrimitive.Track className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <ProgressPrimitive.Indicator className="h-full rounded-full bg-primary" />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export { clamp, Progress }
