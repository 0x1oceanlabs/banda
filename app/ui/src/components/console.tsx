import { cn } from "cn"

/** What a command printed: its text in a small block that scrolls, and a
 * footer for how it ended. */
function Console({ className, ...props }: React.ComponentProps<"figure">) {
  return (
    <figure
      data-slot="console"
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-md border bg-block text-code",
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
        "max-h-80 overflow-auto px-3 py-2 font-mono break-all whitespace-pre-wrap",
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
        "flex flex-wrap gap-x-2 border-t px-3 py-1 font-sans text-meta text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Console, ConsoleFooter, ConsoleText }
