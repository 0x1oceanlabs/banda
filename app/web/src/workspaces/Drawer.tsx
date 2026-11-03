import { memo, useMemo } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { cn } from "@banda/ui/lib/utils"
import type { Listed, PaneState } from "@banda/ui/pane"
import { PinIcon } from "lucide-react"
import type { Entry } from "./model"
import { type Frame, PaneFrame } from "./PaneFrame"

/**
 * The drawer (ADR 0025, decision 8): a Thread that drops from the top
 * over the workspace, as a terminal that drops down does. Lifted, it is
 * kept drawn, so it stays as it was; its pin makes it a column of the
 * workspace on screen. It is the window's, in no workspace. The workspace
 * under it is covered, so its focus comes back when it is lifted.
 */
export const Drawer = memo(function Drawer({
  entry,
  shown,
  height,
  engine,
  modules,
  listed,
  spaceName,
  frame,
  onLift,
  onPin,
  onChange,
  onClose,
}: {
  entry: Entry
  shown: boolean
  /** How far down it drops: a share of the room under the bar. */
  height: number
  engine: Engine
  modules: readonly string[]
  listed: Listed | undefined
  spaceName: (id: SpaceId) => string
  /** The workspaces' frame: what its Pane opens goes there. */
  frame: Frame
  onLift: () => void
  onPin: () => void
  onChange: (pane: PaneState) => void
  onClose: () => void
}) {
  const own: Frame = useMemo(
    () => ({
      ...frame,
      // The focus is the drawer's while it shows; the workspace keeps its own.
      focus: () => undefined,
      open: (space, pane, _from, place) => frame.open(space, pane, "", place),
      update: (_entry, pane) => onChange(pane),
      close: onClose,
    }),
    [frame, onChange, onClose]
  )
  const pin = useMemo(
    () => (
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0 text-muted-foreground"
        title="A column of this workspace"
        onClick={onPin}
      >
        <PinIcon />
        Pin
      </Button>
    ),
    [onPin]
  )
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div
        aria-hidden
        onPointerDown={onLift}
        className={cn(
          "absolute inset-0 bg-black/10 transition-opacity duration-200 motion-reduce:transition-none",
          shown ? "pointer-events-auto opacity-100" : "opacity-0"
        )}
      />
      {/* A dialog over the workspace: the window's keys that work its
          Panes wait until it is lifted. */}
      <div
        role="dialog"
        aria-label="Drawer"
        inert={!shown}
        data-drawer={shown || undefined}
        onKeyDown={(event) => {
          // Esc lifts it, but for what in it keeps its Esc and stops it
          // there: a text field's prevents its default always.
          if (event.key === "Escape") onLift()
        }}
        style={{ height: `calc(${height * 100}% - var(--gap-outer))` }}
        className={cn(
          "pointer-events-auto absolute top-0 right-(--gap-outer) left-[calc(var(--gap-outer)+var(--sidebar-inset))] flex transition-transform duration-200 ease-out motion-reduce:transition-none",
          shown ? "translate-y-0" : "-translate-y-[calc(100%+var(--gap-outer))]"
        )}
      >
        <PaneFrame
          entry={entry}
          engine={engine}
          modules={modules}
          focused={shown}
          marked={false}
          listed={listed}
          spaceName={spaceName(entry.space)}
          mixed={false}
          frame={own}
          actions={pin}
        />
      </div>
    </div>
  )
})
