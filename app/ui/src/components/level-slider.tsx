import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "cn"

/** The colour of level `at` of `last`, in the theme's blue; the top
 * level stands out in its magenta. As text unless `as` says otherwise. */
export function levelTone(
  at: number,
  last: number,
  as: "text" | "bg" = "text"
) {
  const top = at === last
  if (as === "bg") return top ? "bg-(--ansi-5)" : "bg-(--ansi-4)"
  return top ? "text-(--ansi-5)" : "text-(--ansi-4)"
}

/**
 * A few named levels as stops on a track, as Codex draws its effort: the
 * part up to the thumb filled, the top level in its own colour. A level is
 * chosen when the thumb is let go. `unset`, no level is chosen yet: the
 * track is empty and the thumb waits faded at `at`.
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
  // With the thumb inside the track, its middle runs 12px in from each end.
  const left = (i: number) => `calc(12px + (100% - 24px) * ${i / last})`
  return (
    <SliderPrimitive.Root
      value={at}
      min={0}
      max={last}
      step={1}
      thumbAlignment="edge"
      onValueChange={onSlide}
      onValueCommitted={onChoose}
      className="px-2 pt-1 pb-2"
    >
      <SliderPrimitive.Control className="flex h-7 touch-none items-center">
        <SliderPrimitive.Track className="relative h-6 w-full rounded-full bg-foreground/10 ring-1 ring-foreground/5 ring-inset">
          <SliderPrimitive.Indicator
            className={cn(
              "rounded-full",
              levelTone(at, last, "bg"),
              unset && "opacity-0"
            )}
          />
          {names.map((name, i) => (
            <span
              key={name}
              aria-hidden
              className={cn(
                "pointer-events-none absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
                i < at && !unset ? "bg-white/40" : "bg-muted-foreground/50"
              )}
              style={{ left: left(i) }}
            />
          ))}
          <SliderPrimitive.Thumb
            aria-label={label}
            getAriaValueText={(_, value) => names[value] ?? ""}
            className={cn(
              "size-6 rounded-full border border-black/10 bg-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              unset && "opacity-60"
            )}
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
      <div className="flex justify-between px-1 pt-1.5 text-xs text-muted-foreground">
        <span>{names[0]}</span>
        <span>{names[last]}</span>
      </div>
    </SliderPrimitive.Root>
  )
}
