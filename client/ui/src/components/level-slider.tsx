import { useState } from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "../lib/utils"

const GLIDE = "duration-150 ease-[cubic-bezier(0.2,0.7,0.2,1)]"

/**
 * A few named levels as stops on a track, as Codex draws its effort: the
 * thumb rides inside the track, the fill wraps it. The fill is the look's
 * own primary, every level alike: a level is not a warning, and the
 * terminal's palette is not the window's (ADR 0058, decision 1). A level
 * is chosen when the thumb is let go. `unset`, no level is chosen yet:
 * the track is empty and the thumb a ring at `at`.
 */
export function LevelSlider({
  names,
  at,
  unset = false,
  label,
  onSlide,
  onChoose,
}: {
  names: string[]
  at: number
  unset?: boolean
  label: string
  /** The level under the thumb while it is dragged. */
  onSlide?: (at: number) => void
  onChoose: (at: number) => void
}) {
  const last = names.length - 1
  // A press on the track or a key glides the thumb to its stop; a drag
  // moves it at once, so it keeps up with the pointer. Not on opening.
  const [glide, setGlide] = useState(false)
  // The control sits 2px inside the track, so the thumb's middle runs
  // 10px in from the control's ends.
  const left = (i: number) => `calc(10px + (100% - 20px) * ${i / last})`
  const end = (i: number) =>
    !unset && at === i ? "text-foreground" : "text-muted-foreground"
  return (
    <SliderPrimitive.Root
      value={at}
      min={0}
      max={last}
      step={1}
      thumbAlignment="edge"
      onValueChange={(value, { reason }) => {
        setGlide(reason !== "drag")
        onSlide?.(value)
      }}
      onValueCommitted={onChoose}
      className="px-2 pt-1 pb-2"
    >
      <div className="h-6 rounded-full bg-foreground/10 px-0.5">
        <SliderPrimitive.Control className="group/level relative h-full cursor-pointer touch-none">
          <SliderPrimitive.Track className="relative h-full">
            <SliderPrimitive.Indicator
              className={cn(
                unset && "invisible",
                glide && `transition-[width] ${GLIDE}`,
                "motion-reduce:transition-none"
              )}
            >
              {/* From the track's start to 2px past the thumb. */}
              <span className="absolute inset-y-0 -right-3 -left-0.5 rounded-full bg-primary" />
            </SliderPrimitive.Indicator>
            {names.map((name, i) => (
              <span
                key={name}
                aria-hidden
                className={cn(
                  "pointer-events-none absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors",
                  i < at && !unset
                    ? "bg-primary-foreground/50"
                    : "bg-foreground/25",
                  i === at && "invisible"
                )}
                style={{ left: left(i) }}
              />
            ))}
            <SliderPrimitive.Thumb
              aria-label={label}
              getAriaValueText={(_, value) => names[value] ?? ""}
              className={cn(
                "size-5 cursor-grab rounded-full outline-none data-dragging:scale-92 data-dragging:cursor-grabbing",
                "focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
                unset
                  ? "inset-ring-[1.5px] inset-ring-foreground/30"
                  : "bg-primary-foreground shadow-[0_0_0_0.5px_rgb(0_0_0/0.14),0_1px_2px_rgb(0_0_0/0.22),0_2px_6px_rgb(0_0_0/0.12)] group-hover/level:shadow-[0_0_0_0.5px_rgb(0_0_0/0.14),0_1px_3px_rgb(0_0_0/0.28),0_3px_10px_rgb(0_0_0/0.16)]",
                glide
                  ? `transition-[inset-inline-start,scale,box-shadow] ${GLIDE}`
                  : "transition-[scale,box-shadow] duration-150"
              )}
            />
          </SliderPrimitive.Track>
        </SliderPrimitive.Control>
      </div>
      <div className="flex justify-between px-1 pt-1.5 text-meta">
        <span className={cn("transition-colors", end(0))}>{names[0]}</span>
        <span className={cn("transition-colors", end(last))}>
          {names[last]}
        </span>
      </div>
    </SliderPrimitive.Root>
  )
}
