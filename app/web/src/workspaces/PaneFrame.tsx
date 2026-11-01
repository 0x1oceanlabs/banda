import { useEffect, useRef } from "react"
import type { Engine, SpaceId } from "@bandaso/contract"
import { Button } from "@bandaso/ui/components/button"
import type { PaneState, Place } from "@bandaso/ui/pane"
import { XIcon } from "lucide-react"
import { kindOf, runs } from "../registry"
import type { Entry } from "./model"

/** What a framed Pane asks of the workspaces. */
export type Frame = {
  focus: (entry: string) => void
  open: (space: SpaceId, pane: PaneState, from: string, place?: Place) => void
  update: (entry: string, pane: PaneState) => void
  close: (entry: string) => void
}

/**
 * One tile: a header with the Pane's icon and title, and its Space when the
 * workspace mixes Spaces; under it, the Pane itself.
 */
export function PaneFrame({
  entry,
  engine,
  modules,
  focused,
  spaceName,
  frame,
}: {
  entry: Entry
  engine: Engine
  modules: readonly string[]
  focused: boolean
  /** Shown in the header when the workspace mixes Spaces. */
  spaceName: string | undefined
  frame: Frame
}) {
  const kind = kindOf(entry.pane.kind)
  const shown = kind && runs(kind, modules) ? kind : undefined
  const element = useRef<HTMLElement>(null)
  const title = kind ? kind.title(entry.pane.args) : "Unknown Pane"
  const Icon = kind?.icon

  useEffect(() => {
    const own = element.current
    if (focused && own && !own.contains(document.activeElement)) {
      own.focus({ preventScroll: true })
    }
  }, [focused])

  const take = () => frame.focus(entry.id)
  return (
    <section
      ref={element}
      tabIndex={-1}
      aria-label={title}
      data-focused={focused}
      onPointerDownCapture={take}
      onFocusCapture={take}
      className="group/tile flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background outline-none data-[focused=true]:border-ring/60"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-2.5 text-sm">
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
        <h2 className="min-w-0 truncate font-medium text-muted-foreground group-data-[focused=true]/tile:text-foreground">
          {title}
        </h2>
        {spaceName && (
          <span className="shrink-0 truncate rounded-sm bg-muted px-1.5 text-xs text-muted-foreground">
            {spaceName}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Close ${title}`}
          title="Close (Alt+W)"
          className="ml-auto opacity-0 transition-opacity group-hover/tile:opacity-100 group-data-[focused=true]/tile:opacity-100 focus-visible:opacity-100"
          onClick={() => frame.close(entry.id)}
        >
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {shown ? (
          <shown.Pane
            engine={engine}
            space={entry.space}
            args={entry.pane.args}
            focused={focused}
            open={(pane, place, space) =>
              frame.open(space ?? entry.space, pane, entry.id, place)
            }
            update={(args) =>
              frame.update(entry.id, { kind: entry.pane.kind, args })
            }
            close={() => frame.close(entry.id)}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {kind
              ? "This Pane comes back when the engine runs its module."
              : "This window does not know this kind of Pane."}
          </p>
        )}
      </div>
    </section>
  )
}
