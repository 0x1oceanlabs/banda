import { type ReactNode, useEffect, useRef } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import { PaneHeader } from "@banda/ui/components/pane-header"
import { type PaneState, type Place, within } from "@banda/ui/pane"
import type { Args } from "@banda/ui/module"
import { kindOf, kindRuns, labelOf } from "../registry"
import type { Entry } from "./model"

/** What a framed Pane asks of the workspaces. */
export type Frame = {
  focus: (entry: string) => void
  open: (space: SpaceId, pane: PaneState, from: string, place?: Place) => void
  update: (entry: string, pane: PaneState) => void
  close: (entry: string) => void
  /** Runs an action by its id, as a key would. */
  run: (action: string, args?: Args) => void
}

/**
 * One tile: a header with the Pane's icon and title, and its Space when the
 * workspace mixes Spaces, unless the Pane draws its own; under it, the Pane
 * itself. A `header` given, as a tabbed column's tabs, takes the header's
 * place.
 */
export function PaneFrame({
  entry,
  engine,
  modules,
  focused,
  spaceName,
  frame,
  header,
  hidden = false,
}: {
  entry: Entry
  engine: Engine
  modules: readonly string[]
  focused: boolean
  /** Shown in the header when the workspace mixes Spaces. */
  spaceName: string | undefined
  frame: Frame
  /** Drawn in the header's place. */
  header?: ReactNode
  /** Kept drawn, so the Pane keeps running, but not shown. */
  hidden?: boolean
}) {
  const kind = kindOf(entry.pane.kind)
  const shown = kind && kindRuns(entry.pane.kind, modules) ? kind : undefined
  const element = useRef<HTMLElement>(null)
  const { title, Icon } = labelOf(entry.pane)

  useEffect(() => {
    const own = element.current
    if (focused && own && !within(own, document.activeElement)) {
      own.focus({ preventScroll: true })
    }
  }, [focused])

  // A tile that has the focus already only hears its own echo.
  const take = () => {
    if (!focused) frame.focus(entry.id)
  }
  return (
    <section
      ref={element}
      tabIndex={-1}
      aria-label={title}
      data-focused={focused}
      data-tile={entry.id}
      hidden={hidden}
      onPointerDownCapture={take}
      onFocusCapture={take}
      className="group/tile relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-tile border-(length:--tile-border) border-focus-inactive bg-tile shadow-(--tile-shadow) outline-none after:pointer-events-none after:absolute after:inset-0 after:bg-black after:opacity-(--tile-dim) data-[focused=true]:border-focus data-[focused=true]:outline-[length:calc(var(--tile-border)+var(--focus-ring))] data-[focused=true]:outline-offset-[calc(-1*var(--tile-border))] data-[focused=true]:outline-focus data-[focused=true]:outline-solid data-[focused=true]:after:opacity-0"
    >
      {header ??
        (kind?.header !== false && (
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
        ))}
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
            run={frame.run}
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
