import { cn } from "../lib/utils"

/** On or off, as a setting is: a click turns it the other way. */
function Switch({
  label,
  on,
  onChange,
}: {
  label: string
  on: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      data-slot="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        on ? "bg-primary" : "bg-input"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow transition-transform",
          on && "translate-x-4"
        )}
      />
    </button>
  )
}

export { Switch }
