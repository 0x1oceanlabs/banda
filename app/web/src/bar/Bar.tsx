import type { Status } from "@bandaso/contract"
import { Button } from "@bandaso/ui/components/button"
import { Spinner } from "@bandaso/ui/components/spinner"
import { PanelLeftIcon } from "lucide-react"

/**
 * The bar across the window's top (ADR 0005, decision 9): the sidebar's
 * button on the left, then the workspaces' numbers. A click on another
 * number goes there; on the current one, opens the overview. More comes
 * later as small icons, once real use asks for them.
 */
export function Bar({
  status,
  numbers,
  current,
  sidebar,
  onSidebar,
  onPick,
}: {
  status: Status
  /** The workspaces it shows: those with Panes, and the current one. */
  numbers: number[]
  current: number
  sidebar: boolean
  onSidebar: () => void
  onPick: (index: number) => void
}) {
  return (
    <header className="flex h-9 shrink-0 items-center gap-1 border-b px-1.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Sidebar"
        aria-pressed={sidebar}
        title="Sidebar (Alt+A)"
        onClick={onSidebar}
      >
        <PanelLeftIcon />
      </Button>
      <nav aria-label="Workspaces" className="flex items-center gap-0.5">
        {numbers.map((index) => {
          const here = index === current
          return (
            <button
              key={index}
              type="button"
              aria-current={here || undefined}
              title={
                here
                  ? "Overview (Alt+O)"
                  : `Workspace ${index + 1} (Alt+${index + 1})`
              }
              className="flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs text-muted-foreground tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current]:bg-muted aria-[current]:font-medium aria-[current]:text-foreground"
              onClick={() => onPick(index)}
            >
              {index + 1}
            </button>
          )
        })}
      </nav>
      <Connection status={status} />
    </header>
  )
}

/** Says nothing while the engine answers; otherwise, what is going on. */
function Connection({ status }: { status: Status }) {
  if (status.state === "open") return null
  const words =
    status.state === "connecting"
      ? "Connecting…"
      : status.state === "lost"
        ? "Reconnecting…"
        : status.refusal.message
  return (
    <div
      role="status"
      className="ml-auto flex items-center gap-2 px-2 text-xs text-muted-foreground"
    >
      {status.state === "refused" ? (
        <span className="size-2 rounded-full bg-destructive" />
      ) : (
        <Spinner className="size-3" />
      )}
      {words}
    </div>
  )
}
