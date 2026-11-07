import { Meter as MeterPrimitive } from "@base-ui/react/meter"
import { cn } from "../lib/utils"

const RADIUS = 6
const AROUND = 2 * Math.PI * RADIUS

/** How full something is, in percent, as a small ring that fills
 * clockwise. */
function RingMeter({
  className,
  value,
  ...props
}: Omit<MeterPrimitive.Root.Props, "min" | "max">) {
  const share = Math.min(100, Math.max(0, value)) / 100
  return (
    <MeterPrimitive.Root
      data-slot="ring-meter"
      value={value}
      className={cn("inline-flex size-4 shrink-0", className)}
      {...props}
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="size-full -rotate-90"
      >
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          fill="none"
          strokeWidth="2"
          className="stroke-current opacity-25"
        />
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={AROUND}
          strokeDashoffset={AROUND * (1 - share)}
          className="stroke-current transition-[stroke-dashoffset]"
        />
      </svg>
    </MeterPrimitive.Root>
  )
}

export { RingMeter }
