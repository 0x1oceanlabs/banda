import { cn } from "cn"

/** A file change, line by line: a header, then its lines in a box that
 * scrolls both ways. */
function Diff({
  className,
  children,
  ...props
}: React.ComponentProps<"figure">) {
  return (
    <figure
      data-slot="diff"
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-md border bg-card text-xs text-card-foreground",
        className
      )}
      {...props}
    >
      {children}
    </figure>
  )
}

function DiffHeader({
  className,
  ...props
}: React.ComponentProps<"figcaption">) {
  return (
    <figcaption
      data-slot="diff-header"
      className={cn(
        "flex min-w-0 items-center gap-2 border-b px-2 py-1 font-mono",
        className
      )}
      {...props}
    />
  )
}

/** A file's path in a header: its folder quiet, its name plain. */
function DiffPath({ path }: { path: string }) {
  const slash = path.lastIndexOf("/") + 1
  return (
    <span data-slot="diff-path" className="min-w-0 truncate">
      <span className="text-muted-foreground">{path.slice(0, slash)}</span>
      {path.slice(slash)}
    </span>
  )
}

function DiffLines({
  className,
  children,
  ...props
}: React.ComponentProps<"pre">) {
  return (
    <pre
      data-slot="diff-lines"
      className={cn(
        "max-h-80 overflow-auto py-1 font-mono leading-5",
        className
      )}
      {...props}
    >
      <div className="w-max min-w-full">{children}</div>
    </pre>
  )
}

const SIGNS = { same: " ", added: "+", removed: "−" } as const

/** One line: kept, added or removed, with its sign. */
function DiffLine({
  className,
  kind,
  children,
  ...props
}: React.ComponentProps<"div"> & { kind: keyof typeof SIGNS }) {
  return (
    <div
      data-slot="diff-line"
      data-kind={kind}
      className={cn(
        "px-2 data-[kind=added]:bg-added/10 data-[kind=added]:text-added data-[kind=removed]:bg-removed/10 data-[kind=removed]:text-removed",
        className
      )}
      {...props}
    >
      <span className="pr-2 select-none">{SIGNS[kind]}</span>
      {children}
    </div>
  )
}

/** Unchanged lines left out between two parts of a change. */
function DiffGap({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="diff-gap"
      className={cn("px-2 text-muted-foreground select-none", className)}
      {...props}
    />
  )
}

/** How many lines a change added and removed: +3 −1. */
function DiffCounts({
  className,
  added,
  removed,
  ...props
}: React.ComponentProps<"span"> & { added: number; removed: number }) {
  return (
    <span
      data-slot="diff-counts"
      className={cn(
        "flex shrink-0 gap-1 font-mono text-xs tabular-nums",
        className
      )}
      {...props}
    >
      {added > 0 && <span className="text-added">+{added}</span>}
      {removed > 0 && <span className="text-removed">−{removed}</span>}
    </span>
  )
}

export { Diff, DiffCounts, DiffGap, DiffHeader, DiffLine, DiffLines, DiffPath }
