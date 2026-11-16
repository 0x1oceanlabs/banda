import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "../lib/utils"

/** One number between two, set by dragging, as shadcn/ui draws it. */
function Slider({
  className,
  value,
  onChange,
  ...props
}: Omit<
  SliderPrimitive.Root.Props<number>,
  "value" | "onValueChange" | "onChange"
> & {
  value: number
  onChange: (value: number) => void
}) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={value}
      onValueChange={(value) => onChange(Number(value))}
      className={cn("w-full", className)}
      {...props}
    >
      <SliderPrimitive.Control className="flex h-5 w-full touch-none items-center select-none">
        <SliderPrimitive.Track className="relative h-1.5 w-full rounded-full bg-muted">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb className="size-4 rounded-full border border-primary bg-background shadow-float outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
