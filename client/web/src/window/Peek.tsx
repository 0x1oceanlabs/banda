import { useCallback, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  HeaderSlot,
  PaneHeader,
  TileHeader,
} from "@banda/ui/components/pane-header"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import type { Args } from "@banda/ui/module"
import type { Label, PaneState, Place } from "@banda/ui/pane"
import {
  Maximize2Icon,
  Minimize2Icon,
  SquareArrowOutUpRightIcon,
} from "lucide-react"
import { kindOf, kindRuns, labelOf } from "../registry"
import { Broken } from "../tiling/PaneFrame"
import { opening, type Shell } from "./actions"

/** What peeks over the desk: a Pane of a Project, and whether it fills
 * the desk. */
export type Peeked = { project: ProjectId; pane: PaneState; fill: boolean }

/**
 * Quick Look's tile (ADR 0073, decision 7): a Pane that floats over the
 * desk, in no workspace, and leaves the tiling as it is. It takes no
 * focus: the Pane it was opened from keeps the keys, as a tree its arrows,
 * and a Pane of the same kind it shows next takes the new args, so it is
 * not drawn anew. Floating as the window's menus do: their fill and hairline,
 * a deep shadow, and a blur of what is under it. Its Open makes it a Pane
 * of the workspace; ⌥Space, or its button, has it fill the desk.
 */
export function Peek({
  peek,
  engine,
  modules,
  shell,
  onUpdate,
  onFill,
  onClose,
}: {
  peek: Peeked
  engine: Engine
  modules: readonly string[]
  /** What opens a Pane the peeking Pane asks for, in the workspace, opens
   * it there itself, and runs actions. */
  shell: Pick<Shell, "change" | "open" | "run">
  onUpdate: (pane: PaneState) => void
  onFill: () => void
  onClose: () => void
}) {
  const { run } = shell
  const open = (project: ProjectId, pane: PaneState, place?: Place) =>
    shell.change((w) => opening(w, project, pane, { place }))
  const onOpen = () =>
    shell.open(peek.pane, peek.project, { again: false, update: true })
  const keyFor = useKeyLabel()
  const { project, pane, fill } = peek
  // What the Pane says it shows, kept for the header while it peeks.
  const [said, setSaid] = useState<Label | null>(null)
  const label = useCallback((label: Label | null) => setSaid(label), [])
  const { title, detail, Icon } = labelOf(pane, said ?? undefined)
  const actions = (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Open"
        title="Open as a Pane · ↵"
        className="shrink-0"
        onClick={onOpen}
      >
        <SquareArrowOutUpRightIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={fill ? "Float over the desk" : "Fill the desk"}
        aria-pressed={fill}
        title={keyFor(
          "menu.open",
          fill ? "Float over the desk" : "Fill the desk"
        )}
        className="shrink-0"
        onClick={onFill}
      >
        {fill ? <Minimize2Icon /> : <Maximize2Icon />}
      </Button>
    </>
  )
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center py-(--gap-outer) pr-(--gap-outer) pl-[calc(var(--gap-outer)+var(--sidebar-inset))]">
      <section
        aria-label={`Quick Look: ${title}`}
        data-peek=""
        data-fill={fill || undefined}
        data-selected="true"
        className={`${FLOATING} group/tile pointer-events-auto flex h-[82%] w-[min(100%,max(64%,36rem),56rem)] animate-in flex-col overflow-hidden transition-[width,height] duration-200 ease-out fade-in-0 zoom-in-95 data-fill:h-full data-fill:w-full motion-reduce:animate-none motion-reduce:transition-none`}
      >
        <TileHeader value={{ actions }}>
          <HeaderSlot>
            <PaneHeader
              title={title}
              icon={Icon}
              onClose={onClose}
              closeTitle="Close · Space or Esc"
            >
              <h2 className="min-w-0 truncate font-medium">{title}</h2>
              {detail && (
                <span className="max-w-fit min-w-0 flex-[1_1_0] truncate text-xs text-muted-foreground">
                  {detail}
                </span>
              )}
            </PaneHeader>
            <FloatingPane
              engine={engine}
              modules={modules}
              project={project}
              pane={pane}
              open={open}
              update={onUpdate}
              close={onClose}
              label={label}
              run={run}
              peek
            />
          </HeaderSlot>
        </TileHeader>
      </section>
    </div>
  )
}

/** The card what floats over the desk is drawn on, Quick Look's tile and
 * the Sheet: as the window's menus, their fill and hairline, a deep
 * shadow, and a blur of what is under it. */
export const FLOATING =
  "rounded-xl bg-popover/95 text-popover-foreground shadow-[0_30px_80px_-12px_rgb(0_0_0/0.45)] ring-1 ring-foreground/10 backdrop-blur-xl backdrop-saturate-150"

/** A Pane drawn over the desk, in no workspace, on its card's own fill:
 * a view that paints the page's background, as code does, paints the
 * card's. A Pane it opens goes in the workspace. */
export function FloatingPane({
  engine,
  modules,
  project,
  pane,
  open,
  update,
  close,
  label,
  run,
  focused = false,
  peek = false,
}: {
  engine: Engine
  modules: readonly string[]
  project: ProjectId
  pane: PaneState
  open: (project: ProjectId, pane: PaneState, place?: Place) => void
  update: (pane: PaneState) => void
  close: () => void
  label: (label: Label | null) => void
  run: (action: string, args?: Args) => void
  focused?: boolean
  peek?: boolean
}) {
  const kind = kindOf(pane.kind)
  const shown = kind && kindRuns(pane.kind, modules) ? kind : undefined
  return (
    <div className="min-h-0 flex-1 [--background:var(--popover)]">
      {shown ? (
        <Broken close={close}>
          <shown.Pane
            engine={engine}
            project={project}
            args={pane.args}
            focused={focused}
            open={(next, place, other) => open(other ?? project, next, place)}
            update={(args) => update({ kind: pane.kind, args })}
            close={close}
            label={label}
            run={run}
            peek={peek}
          />
        </Broken>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          This window does not show this kind of Pane now.
        </p>
      )}
    </div>
  )
}
