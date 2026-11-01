import { useEffect, useRef } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import { PaneHeader } from "@banda/ui/components/pane-header"
import { type PaneState, type Place, within } from "@banda/ui/pane"
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
 * workspace mixes Spaces, unless the Pane draws its own; under it, the Pane
 * itself.
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
    if (focused && own && !within(own, document.activeElement)) {
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
      data-tile={entry.id}
      onPointerDownCapture={take}
      onFocusCapture={take}
      className="group/tile relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-tile border-(length:--tile-border) border-focus-inactive bg-background outline-none after:pointer-events-none after:absolute after:inset-0 after:bg-black after:opacity-(--tile-dim) data-[focused=true]:border-focus data-[focused=true]:outline-[length:calc(var(--tile-border)+var(--focus-ring))] data-[focused=true]:outline-offset-[calc(-1*var(--tile-border))] data-[focused=true]:outline-focus data-[focused=true]:outline-solid data-[focused=true]:after:opacity-0"
    >
      {kind?.header !== false && (
        <PaneHeader title={title} onClose={() => frame.close(entry.id)}>
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
          <h2 className="min-w-0 truncate font-medium text-muted-foreground group-data-[focused=true]/tile:text-foreground">
            {title}
          </h2>
          {spaceName && (
            <span className="shrink-0 truncate rounded-sm bg-muted px-1.5 text-xs text-muted-foreground">
              {spaceName}
            </span>
          )}
        </PaneHeader>
      )}
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
