import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import { type Owner, withHost } from "@banda/core"
import { reachWords, UNKNOWN, useReach } from "@banda/core/react"
import { Button } from "@banda/ui/components/button"
import {
  HeaderSlot,
  PaneHeader,
  TileHeader,
} from "@banda/ui/components/pane-header"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import type { Args } from "@banda/ui/module"
import { seenNamed, useModules } from "@banda/ui/hooks/use-status"
import {
  type Label,
  paneHost,
  type PaneState,
  type Place,
} from "@banda/ui/pane"
import {
  Maximize2Icon,
  Minimize2Icon,
  SquareArrowOutUpRightIcon,
} from "lucide-react"
import { labelOf } from "../registry"
import { gateOf, type Handle, PaneMount, usePaneHandles } from "../tiling/mount"
import { Elsewhere } from "../tiling/PaneFrame"
import { PaneSlot } from "../tiling/PaneSlot"
import { opening, type Shell } from "./actions"
import { useTop } from "./top"

/** What peeks over the desk: a Pane of a Project, and whether it fills
 * the desk. */
export type Peeked = { project: ProjectId; pane: PaneState; fill: boolean }

/** Quick Look's tile over the desk (ADR 0073, decision 7): one Pane, in
 * no workspace, and whether it fills the desk. It is on its layer of the
 * Top layer's stack, which closes it on an Esc nothing kept while it is on
 * top, and takes no keys. */
export function usePeek() {
  const [peek, setPeek] = useState<Peeked | null>(null)
  const peekNow = useRef(peek)
  useEffect(() => {
    peekNow.current = peek
  }, [peek])
  const closePeek = useCallback(() => setPeek(null), [])
  const fillPeek = useCallback(() => {
    if (!peekNow.current) return false
    setPeek((was) => was && { ...was, fill: !was.fill })
    return true
  }, [])
  useTop(peek !== null, {
    part: "peek",
    layer: "peek",
    keys: false,
    close: closePeek,
  })
  return { peek, setPeek, peekNow, closePeek, fillPeek }
}

/**
 * Quick Look's tile (ADR 0073, decision 7): a Pane that floats over the
 * desk, in no workspace, and leaves the tiling as it is. It takes no
 * focus: the Pane it was opened from keeps the keys, as a tree its arrows,
 * and a Pane of the same kind it shows next takes the new args, so it is
 * not drawn anew. Floating as the window's menus do: their fill and hairline,
 * a deep shadow, and a blur of what is under it. Its Open makes it a Pane
 * of the workspace; ⌥Space, or its button, has it fill the desk. Its Pane
 * is drawn from its owner's session, as a Frame's is, on the machine its
 * Project is on, its acts go through the one router, and its header names
 * that machine as a Frame's does (ADR 0106, decision 1).
 */
export function Peek({
  peek,
  shell,
  onUpdate,
  onFill,
  onClose,
}: {
  peek: Peeked
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
  // Its machine as the directory says, its args' only as an arrangement
  // written before kept it; none the Window knows, it opens on none.
  const reach = useReach(project, paneHost(pane))
  const there = reach.host ?? undefined
  const owner = useMemo(
    () => ({ project, pane: withHost(pane, there) }),
    [project, pane, there]
  )
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
    <div className="pointer-events-none absolute inset-0 z-peek flex items-center justify-center py-(--gap-outer) pr-(--gap-outer) pl-[calc(var(--gap-outer)+var(--sidebar-inset))]">
      <section
        aria-label={`Quick Look: ${title}`}
        data-peek=""
        data-top="peek"
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
                <span className="max-w-fit min-w-0 flex-[1_1_0] truncate text-meta text-muted-foreground">
                  {detail}
                </span>
              )}
              <PaneSlot project={project} pane={pane} at="project" />
            </PaneHeader>
            {/* As a Frame's: arc going away shows on what it shows, which
                needs the machine's session to show anything. */}
            {there && reach.engine && (
              <div className="relative z-float h-0 shrink-0">
                <div className="pointer-events-none absolute inset-x-2 top-1 flex justify-center">
                  <PaneSlot project={project} pane={pane} at="pill" />
                </div>
              </div>
            )}
            {/* Its machine not known yet, it waits for it, in its words. */}
            {reach.engine ? (
              <FloatingPane
                engine={reach.engine}
                owner={owner}
                elsewhere={there !== undefined}
                project={project}
                pane={pane}
                open={open}
                update={onUpdate}
                close={onClose}
                label={label}
                run={run}
                peek
                alone
              />
            ) : (
              <Elsewhere
                machine={
                  there ? (reach.shown?.named ?? seenNamed(there)) : undefined
                }
              >
                {reach.host === null
                  ? UNKNOWN
                  : there && reachWords(there, reach.shown, seenNamed)}
              </Elsewhere>
            )}
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
  "rounded-card bg-popover/95 text-popover-foreground shadow-lift ring-1 ring-foreground/10 backdrop-blur-xl backdrop-saturate-150"

/** A Pane drawn over the desk, in no workspace, on its card's own fill:
 * a view that paints the page's background, as code does, paints the
 * card's. A Pane it opens goes in the workspace. It is mounted as a
 * Frame mounts its Pane (`PaneMount`), on its `owner`'s session `engine`,
 * and shows as that engine's Apps say (`gateOf`): on another machine
 * (`elsewhere`), by the router. */
export function FloatingPane({
  engine,
  owner,
  elsewhere = false,
  project,
  pane,
  open,
  update,
  close,
  label,
  run,
  focused = false,
  peek = false,
  alone = false,
}: {
  engine: Engine
  owner: Owner
  elsewhere?: boolean
  project: ProjectId
  pane: PaneState
  open: (project: ProjectId, pane: PaneState, place?: Place) => void
  update: (pane: PaneState) => void
  close: () => void
  label: (label: Label | null) => void
  run: (action: string, args?: Args) => void
  focused?: boolean
  peek?: boolean
  /** Nothing can be drawn beside it (`PaneProps.alone`), as in Quick Look. */
  alone?: boolean
}) {
  const { runs } = usePaneHandles(owner, run, pane)
  const gate = gateOf(pane, elsewhere ? runs : undefined, useModules(engine))
  const handle: Handle = {
    open: (next, place, other) => open(other ?? project, next, place),
    update: (args) => update({ kind: pane.kind, args }),
    close,
    label,
  }
  return (
    <div className="min-h-0 flex-1 [--background:var(--popover)]">
      {"why" in gate ? (
        <p className="p-4 text-ui text-muted-foreground">{gate.why}</p>
      ) : (
        <PaneMount
          kind={gate.opens}
          engine={engine}
          project={project}
          pane={pane}
          owner={owner}
          elsewhere={elsewhere}
          focused={focused}
          peek={peek}
          alone={alone}
          handle={handle}
          run={run}
        />
      )}
    </div>
  )
}
