import {
  Component,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react"
import type { Engine, SpaceId } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
} from "@banda/ui/components/empty"
import { PaneHeader, TileActions } from "@banda/ui/components/pane-header"
import { cn } from "@banda/ui/lib/utils"
import { type Listed, type PaneState, type Place, within } from "@banda/ui/pane"
import type { Args } from "@banda/ui/module"
import {
  Minimize2Icon,
  SquareArrowDownLeftIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react"
import { kindOf, kindRuns, labelOf, sayLabel, useSaid } from "../registry"
import { heightAt } from "./layout"
import { ThreadMark } from "../sidebar/Row"
import type { Plan } from "./arrange"
import type { Entry } from "./model"

/** What a framed Pane asks of the workspaces. */
export type Frame = {
  focus: (entry: string) => void
  open: (space: SpaceId, pane: PaneState, from: string, place?: Place) => void
  update: (entry: string, pane: PaneState) => void
  close: (entry: string) => void
  /** Runs an action by its id, as a key would. */
  run: (action: string, args?: Args) => void
  /** Sends the engine a change, as the mouse's sizing does; done once
   * it is drawn, or refused. */
  arrange: (plan: Plan) => Promise<void>
  /** Opens the Pane in a window of its own, or brings that window to the
   * front (ADR 0025, decision 9); none where a Pane cannot pop out. */
  popOut?: (entry: string) => void
}

/** Says an Agent opened the Pane and the Person has not looked at it. */
export function AgentMark({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      title="An Agent opened this Pane"
      className={`size-2 shrink-0 rounded-full bg-attention ${className}`}
    >
      <span className="sr-only">Opened by an Agent</span>
    </span>
  )
}

/**
 * One tile: a header with the Pane's icon and title, and its Space when the
 * workspace mixes Spaces, unless the Pane draws its own; under it, the Pane
 * itself. A Pane that shows a listed thing, as a Thread, has its mark in the
 * icon's place and its Space before the title (ADR 0031). A tabbed
 * column's group bar sits over its tile, outside it (`Tabs`).
 */
export function PaneFrame({
  entry,
  engine,
  modules,
  focused,
  marked,
  zoomed = false,
  height,
  listed,
  spaceName,
  mixed,
  frame,
  actions,
  hidden = false,
  away = false,
  alone = false,
}: {
  entry: Entry
  engine: Engine
  modules: readonly string[]
  focused: boolean
  /** An Agent opened it, and the Person has not looked at it yet. */
  marked: boolean
  /** Over the whole window (`Alt+Shift+F`): its header says so, even a
   * Pane that draws its own, and takes it back. */
  zoomed?: boolean
  /** Its share of its column's height; left out, an even one. */
  height?: number
  /** The listed thing it shows, if it shows one. */
  listed: Listed | undefined
  spaceName: string
  /** The workspace mixes Spaces, so each header names its Space. */
  mixed: boolean
  frame: Frame
  /** Buttons of its own in the header, beside the close button. */
  actions?: ReactNode
  /** Kept drawn, so the Pane keeps running, but not shown. */
  hidden?: boolean
  /** In a window of its own: its place keeps a stand-in that goes there. */
  away?: boolean
  /** It is that window's one Pane, drawn over the whole of it; the
   * frame's `popOut` brings it back. */
  alone?: boolean
}) {
  const kind = kindOf(entry.pane.kind)
  const shown = kind && kindRuns(entry.pane.kind, modules) ? kind : undefined
  const element = useRef<HTMLElement>(null)
  const { title, detail, Icon } = labelOf(entry.pane, useSaid().get(entry.id))
  const close = () => frame.close(entry.id)

  // What the Pane said it shows goes with it.
  useEffect(() => () => sayLabel(entry.id, null), [entry.id])

  // As it is drawn focused, not a frame later: a key pressed meanwhile
  // would go to the tile that had the focus.
  useLayoutEffect(() => {
    const own = element.current
    if (focused && own && !within(own, document.activeElement)) {
      own.focus({ preventScroll: true })
    }
  }, [focused])

  // A tile that has the focus already only hears its own echo.
  const take = () => {
    if (!focused) frame.focus(entry.id)
  }
  // Out of its window, or back from its own: the frame's own button.
  const popOut = frame.popOut
  const own = useMemo(() => {
    const back = alone
      ? { Icon: SquareArrowDownLeftIcon, label: "Back in its place" }
      : { Icon: SquareArrowOutUpRightIcon, label: "Pop out" }
    return (
      <>
        {actions}
        {popOut && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={back.label}
            title={
              alone
                ? "Back in its place in the workspace"
                : "In a window of its own"
            }
            className={cn(
              "shrink-0",
              !alone &&
                "opacity-0 transition-opacity group-hover/tile:opacity-100 group-data-[focused=true]/tile:opacity-100 focus-visible:opacity-100"
            )}
            onClick={() => popOut(entry.id)}
          >
            <back.Icon />
          </Button>
        )}
      </>
    )
  }, [actions, popOut, alone, entry.id])
  return (
    <section
      ref={element}
      tabIndex={-1}
      aria-label={title}
      data-focused={focused}
      data-marked={marked || undefined}
      data-zoomed={zoomed || undefined}
      data-away={away || undefined}
      data-alone={alone || undefined}
      data-tile={entry.id}
      hidden={hidden}
      onPointerDownCapture={take}
      onFocusCapture={take}
      style={height === undefined ? undefined : { flex: heightAt(height) }}
      className="group/tile relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-tile border-(length:--tile-border) border-focus-inactive bg-tile shadow-(--tile-shadow) outline-none after:pointer-events-none after:absolute after:inset-0 after:bg-black after:opacity-(--tile-dim) data-alone:rounded-none data-alone:border-0 data-alone:shadow-none data-alone:outline-none data-away:border-dashed data-away:bg-transparent data-away:shadow-none data-marked:border-attention data-zoomed:fixed data-zoomed:inset-0 data-zoomed:z-10 data-zoomed:rounded-none data-zoomed:border-0 data-zoomed:shadow-none data-zoomed:outline-none data-[focused=true]:border-focus data-[focused=true]:outline-[length:calc(var(--tile-border)+var(--focus-ring))] data-[focused=true]:outline-offset-[calc(-1*var(--tile-border))] data-[focused=true]:outline-focus data-[focused=true]:outline-solid data-[focused=true]:after:opacity-0"
    >
      {/* On the border, where no page covers it. */}
      {marked && (
        <AgentMark className="pointer-events-none absolute top-1.5 right-1.5 z-10" />
      )}
      <TileActions value={own}>
        {/* A stand-in draws the frame's header, as its Pane is not drawn. */}
        {(zoomed || away || kind?.header !== false) && (
          <PaneHeader
            title={title}
            icon={listed ? undefined : Icon}
            onClose={close}
            className={kind?.header === "bare" ? "border-b-0" : undefined}
          >
            {listed && (
              <>
                <ThreadMark
                  listed={listed}
                  className={listed.mark === "rest" ? "opacity-40" : undefined}
                />
                <span className="shrink-0 text-muted-foreground">
                  {spaceName}
                </span>
              </>
            )}
            <h2 className="min-w-0 truncate font-medium text-muted-foreground group-data-[focused=true]/tile:text-foreground">
              {title}
            </h2>
            {detail && (
              <span className="min-w-0 shrink-[2] truncate text-xs text-muted-foreground">
                {detail}
              </span>
            )}
            {mixed && !listed && (
              <span className="shrink-0 truncate rounded-sm bg-muted px-1.5 text-xs text-muted-foreground">
                {spaceName}
              </span>
            )}
            {zoomed && (
              <button
                type="button"
                title="Back in its column (Alt+Shift+F)"
                className="flex shrink-0 items-center gap-1 rounded-sm bg-muted px-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => frame.run("pane.zoom")}
              >
                <Minimize2Icon className="size-3" />
                Zoomed
              </button>
            )}
          </PaneHeader>
        )}
        <div className="min-h-0 flex-1">
          {away ? (
            <button
              type="button"
              title="Go to its window"
              className="flex size-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground outline-none hover:text-foreground"
              onClick={() => popOut?.(entry.id)}
            >
              <SquareArrowOutUpRightIcon className="size-5" />
              In its own window
            </button>
          ) : shown ? (
            <Broken close={close}>
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
                close={close}
                label={(label) => sayLabel(entry.id, label)}
                run={frame.run}
              />
            </Broken>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              {kind
                ? "This Pane comes back when the engine runs its module."
                : "This window does not know this kind of Pane."}
            </p>
          )}
        </div>
      </TileActions>
    </section>
  )
}

/**
 * A Pane that broke, as on args its kind cannot read, says so in its tile
 * and can be closed: the other Panes and the window go on.
 */
class Broken extends Component<
  { close: () => void; children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Empty className="h-full">
        <EmptyDescription>
          This Pane could not show what it keeps.
        </EmptyDescription>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={this.props.close}>
            Close it
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
}
