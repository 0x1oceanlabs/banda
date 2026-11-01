import { useEffect, useRef } from "react"
import type { SpaceId } from "@banda/contract"
import { kindOf } from "../registry"
import { share, type Workspaces } from "./model"

/**
 * Every workspace zoomed out, one under another, as niri's overview: each
 * column at its share of the screen, shrunk together when a Strip is wider
 * than the screen; each Pane by its icon, title and Space. A click on
 * a Pane focuses it; on a workspace, goes there. Esc goes back.
 *
 * For now it draws the layout, not the Panes' pictures.
 */
export function Overview({
  workspaces,
  spaceName,
  onFocus,
  onGo,
  onClose,
}: {
  workspaces: Workspaces
  spaceName: (space: SpaceId) => string
  onFocus: (entry: string) => void
  onGo: (index: number) => void
  onClose: () => void
}) {
  // The keys come here while it is open, not to a Pane under it.
  const element = useRef<HTMLDivElement>(null)
  useEffect(() => element.current?.focus(), [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      ref={element}
      role="dialog"
      aria-label="Overview"
      tabIndex={-1}
      className="absolute inset-0 z-10 overflow-y-auto bg-muted/80 p-6 backdrop-blur-sm outline-none"
      onClick={onClose}
    >
      <ol className="mx-auto flex max-w-xl flex-col gap-4">
        {workspaces.list.map((workspace, i) => {
          const wide = workspace.columns.reduce(
            (sum, column) => sum + (share(column.width) ?? 0.5),
            0
          )
          const fit = Math.max(1, wide)
          return (
            <li
              key={workspace.id}
              aria-current={i === workspaces.current || undefined}
              className="flex aspect-[16/6] cursor-pointer gap-1 rounded-lg border bg-background p-1 hover:border-ring/60 aria-[current]:border-ring"
              onClick={(event) => {
                event.stopPropagation()
                onGo(i)
              }}
            >
              <button
                type="button"
                aria-label={`Workspace ${i + 1}`}
                className="h-fit w-6 shrink-0 rounded-sm pt-0.5 text-center text-xs text-muted-foreground tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {i + 1}
              </button>
              <div className="flex min-w-0 flex-1 gap-1">
                {workspace.columns.length === 0 && (
                  <span className="m-auto text-xs text-muted-foreground">
                    Empty
                  </span>
                )}
                {workspace.columns.map((column) => (
                  <div
                    key={column.id}
                    className="flex min-w-0 flex-col gap-1"
                    style={{
                      width: `${((share(column.width) ?? 0.5) / fit) * 100}%`,
                    }}
                  >
                    {column.entries.map((entry) => {
                      const kind = kindOf(entry.pane.kind)
                      const Icon = kind?.icon
                      const title = kind ? kind.title(entry.pane.args) : "Pane"
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          aria-label={`${title} in ${spaceName(entry.space)}`}
                          className="flex min-h-0 flex-1 flex-col justify-center gap-1 rounded-md border bg-muted/40 p-2 text-left text-xs outline-none hover:border-ring/60 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                          onClick={(event) => {
                            event.stopPropagation()
                            onFocus(entry.id)
                          }}
                        >
                          <span className="flex min-w-0 items-center gap-1.5 font-medium">
                            {Icon && <Icon className="size-3.5 shrink-0" />}
                            <span className="truncate">{title}</span>
                          </span>
                          <span className="truncate text-muted-foreground">
                            {spaceName(entry.space)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
