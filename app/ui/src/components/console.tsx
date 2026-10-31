import { cn } from "cn"

/** What a command printed: its text in a box that scrolls, and a footer
 * for how it ended. */
function Console({ className, ...props }: React.ComponentProps<"figure">) {
  return (
    <figure
      data-slot="console"
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-md border bg-card text-xs text-card-foreground",
        className
      )}
      {...props}
    />
  )
}

function ConsoleText({ className, ...props }: React.ComponentProps<"pre">) {
  return (
    <pre
      data-slot="console-text"
      className={cn(
        "max-h-80 overflow-auto p-2 font-mono leading-5 break-all whitespace-pre-wrap",
        className
      )}
      {...props}
    />
  )
}

function ConsoleFooter({
  className,
  ...props
}: React.ComponentProps<"figcaption">) {
  return (
    <figcaption
      data-slot="console-footer"
      className={cn(
        "flex flex-wrap gap-x-2 border-t px-2 py-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Console, ConsoleFooter, ConsoleText }
