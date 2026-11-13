import { cn } from "../lib/utils"

/** What a field could take next, in a list that opens beside it while the
 * focus stays in the field: the field moves the choice with its keys and
 * names it with `aria-activedescendant`. It floats as the chat's popups
 * do (ADR 0058): a block's corner, the popover's fill, a hairline ring and
 * one shadow. */
function Suggestions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="suggestions"
      className={cn(
        "z-top flex max-h-72 flex-col overflow-y-auto rounded-card bg-popover p-1 text-ui text-popover-foreground shadow-float ring-1 ring-foreground/10",
        className
      )}
      {...props}
    />
  )
}

/** The suggestions themselves; beside them the popup can hold a line that
 * says why there are none. */
function SuggestionList({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="listbox"
      data-slot="suggestion-list"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

/** One suggestion: its title, then what it does, on one line. A press
 * picks it without taking the focus from the field. */
function Suggestion({
  className,
  selected,
  onMouseDown,
  ...props
}: React.ComponentProps<"div"> & { selected?: boolean }) {
  return (
    <div
      role="option"
      aria-selected={selected ?? false}
      data-slot="suggestion"
      className={cn(
        "flex min-w-0 cursor-default items-center gap-2 rounded-control px-2.5 py-1.5 outline-none select-none hover:bg-accent/60 aria-selected:bg-accent aria-selected:text-accent-foreground",
        className
      )}
      onMouseDown={(event) => {
        event.preventDefault()
        onMouseDown?.(event)
      }}
      {...props}
    />
  )
}

function SuggestionTitle({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="suggestion-title"
      className={cn("max-w-[45%] shrink-0 truncate font-medium", className)}
      {...props}
    />
  )
}

function SuggestionDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="suggestion-description"
      className={cn("min-w-0 flex-1 truncate text-muted-foreground", className)}
      {...props}
    />
  )
}

/** Why there is nothing to suggest. */
function SuggestionsEmpty({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="suggestions-empty"
      className={cn("px-2.5 py-1.5 text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Suggestion,
  SuggestionDescription,
  SuggestionList,
  Suggestions,
  SuggestionsEmpty,
  SuggestionTitle,
}
