import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react"
import { ProjectName } from "@banda/ui/components/project-sign"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
} from "@banda/ui/components/empty"
import {
  HeaderSlot,
  PaneHeader,
  TileHeader,
} from "@banda/ui/components/pane-header"
import { DetailsRows } from "@banda/ui/components/thread-details"
import {
  type Label,
  type Listed,
  type PaneState,
  type Place,
  within,
} from "@banda/ui/pane"
import type { Args } from "@banda/ui/module"
import {
  LayoutPanelLeftIcon,
  Minimize2Icon,
  SquareArrowDownLeftIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react"
import {
  detailsOf,
  kindOf,
  kindRuns,
  labelOf,
  sayLabel,
  useSaid,
} from "../registry"
import { sayComposer } from "../shell/attach"
import { heightAt } from "./layout"
import { ThreadMark } from "../sidebar/Row"
import type { Plan } from "./arrange"
import type { Entry } from "./model"
import { type MenuFrame, PaneMenu, type Stand } from "./PaneMenu"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { Title } from "../titles/Title"

/** What a framed Pane asks of the workspaces. */
export type Frame = {
  /** Done once the tile has the focus, where the window waits for it. */
  focus: (entry: string) => void | Promise<void>
  open: (
    project: ProjectId,
    pane: PaneState,
    from: string,
    place?: Place
  ) => void
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
  /** Where a Pane stands on its workspace, for the Pane menu (ADR 0066);
   * none where Panes stand on no workspace, as the drawer's. */
  stand?: (entry: string) => Stand | undefined
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

/** By the title: a dot while the Pane's file has work not saved yet, and
 * a quiet "Saved" a moment after it is (ADR 0073, decision 8). */
function Edits({ edits }: { edits: Label["edits"] }) {
  if (edits === "unsaved")
    return (
      <span
        role="img"
        aria-label="Not saved yet"
        title="Not saved yet"
        className="size-1.5 shrink-0 rounded-full bg-foreground/70"
      />
    )
  if (edits === "saved")
    return (
      <span
        role="status"
        className="shrink-0 animate-in text-xs text-muted-foreground fade-in-0 motion-reduce:animate-none"
      >
        Saved
      </span>
    )
  return null
}

/**
 * One tile: a header with the Pane's icon and title, and its Project when the
 * workspace mixes Projects, unless the Pane draws its own; under it, the Pane
 * itself. A Pane that shows a listed thing, as a Thread, has its mark in the
 * icon's place and its Project before the title (ADR 0031). A Deck's
 * bar of names sits over its tile, outside it (`Tabs`).
 */
export function PaneFrame({
  entry,
  engine,
  modules,
  focused,
  selected = focused,
  marked,
  zoomed = false,
  height,
  listed,
  project,
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
  /** Looks selected while the overview owns the keys. */
  selected?: boolean
  /** An Agent opened it, and the Person has not looked at it yet. */
  marked: boolean
  /** Over the whole window (`Alt+Shift+F`): its header says so, even a
   * Pane that draws its own, and takes it back. */
  zoomed?: boolean
  /** Its share of its column's height; left out, an even one. */
  height?: number
  /** The listed thing it shows, if it shows one. */
  listed: Listed | undefined
  /** The Project it is in; none while the list is read, which names none. */
  project: ProjectSummary | undefined
  /** The workspace mixes Projects, so each header names its Project. */
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
  const keyFor = useKeyLabel()
  const kind = kindOf(entry.pane.kind)
  const shown = kind && kindRuns(entry.pane.kind, modules) ? kind : undefined
  const element = useRef<HTMLElement>(null)
  const { title, detail, edits, Icon } = labelOf(
    entry.pane,
    useSaid().get(entry.id)
  )
  const close = () => frame.close(entry.id)
  const details = useMemo(() => detailsOf(modules), [modules])

  // What the Pane said it shows goes with it.
  useEffect(() => () => sayLabel(entry.id, null), [entry.id])
  // Its composer, the same between draws, so the Pane says it once.
  const composer = useCallback(
    (take: Parameters<typeof sayComposer>[2]) =>
      sayComposer(entry.id, entry.project, take),
    [entry.id, entry.project]
  )

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
  // Banda's buttons at the header's end (ADR 0066): the Pane menu, or in a window
  // of its own, where nothing tiles, the way back.
  const popOut = frame.popOut
  const placed = !alone && frame.stand !== undefined
  const menu: MenuFrame = useMemo(
    () => ({
      run: (action, args) =>
        void Promise.resolve(frame.focus(entry.id)).then(() =>
          frame.run(action, args)
        ),
      popOut: popOut !== undefined,
    }),
    [frame, entry.id, popOut]
  )
  const header = useMemo(() => {
    const rows = placed && (
      <Rows entry={entry.id} frame={frame} menu={menu} zoomed={zoomed} />
    )
    const end = alone
      ? popOut && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Back in its place"
            title="Back in its place in the workspace"
            className="shrink-0"
            onClick={() => popOut(entry.id)}
          >
            <SquareArrowDownLeftIcon />
          </Button>
        )
      : placed && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Pane menu"
                  title="Pane menu, or a right click on the header"
                  className="shrink-0"
                />
              }
            >
              <LayoutPanelLeftIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {rows}
            </DropdownMenuContent>
          </DropdownMenu>
        )
    return {
      actions: (
        <>
          {actions}
          {end}
        </>
      ),
      menu: rows || undefined,
      onWide: placed ? () => menu.run("column.maximize") : undefined,
    }
  }, [actions, alone, placed, popOut, entry.id, frame, menu, zoomed])
  return (
    <section
      ref={element}
      tabIndex={-1}
      aria-label={title}
      data-focused={focused}
      data-selected={selected}
      data-marked={marked || undefined}
      data-zoomed={zoomed || undefined}
      data-away={away || undefined}
      data-alone={alone || undefined}
      data-tile={entry.id}
      hidden={hidden}
      onPointerDownCapture={take}
      onFocusCapture={take}
      style={height === undefined ? undefined : { flex: heightAt(height) }}
      className="group/tile relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-tile border-(length:--tile-border) border-focus-inactive bg-tile shadow-(--tile-shadow) outline-none after:pointer-events-none after:absolute after:inset-0 after:bg-black after:opacity-(--tile-dim) data-alone:rounded-none data-alone:border-0 data-alone:shadow-none data-alone:outline-none data-away:border-dashed data-away:bg-transparent data-away:shadow-none data-marked:border-attention data-zoomed:fixed data-zoomed:inset-0 data-zoomed:z-10 data-zoomed:rounded-none data-zoomed:border-0 data-zoomed:shadow-none data-zoomed:outline-none data-[selected=true]:border-focus data-[selected=true]:outline-[length:calc(var(--tile-border)+var(--focus-ring))] data-[selected=true]:outline-offset-[calc(-1*var(--tile-border))] data-[selected=true]:outline-focus data-[selected=true]:outline-solid data-[selected=true]:[--tile-shadow:var(--focus-shadow)] data-[selected=true]:after:opacity-0"
    >
      {/* On the border, where no page covers it. */}
      {marked && (
        <AgentMark className="pointer-events-none absolute top-1.5 right-1.5 z-10" />
      )}
      <TileHeader value={header}>
        <HeaderSlot>
          <DetailsRows details={details}>
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
                      className={
                        listed.mark === "rest" ? "opacity-40" : undefined
                      }
                    />
                    {project && (
                      <ProjectName
                        project={project}
                        className="shrink-0 text-muted-foreground"
                      />
                    )}
                  </>
                )}
                {listed ? (
                  <Title
                    engine={engine}
                    project={entry.project}
                    listed={listed}
                    title={title}
                    focused={focused}
                  />
                ) : (
                  <h2 className="min-w-0 truncate font-medium text-muted-foreground group-data-[selected=true]/tile:text-foreground">
                    {title}
                  </h2>
                )}
                <Edits edits={edits} />
                {/* The detail takes what room the title leaves: a long
                    one, as a folder's path, gives way first. */}
                {detail && (
                  <span className="max-w-fit min-w-0 flex-[1_1_0] truncate text-xs text-muted-foreground">
                    {detail}
                  </span>
                )}
                {mixed && !listed && project && (
                  <ProjectName
                    project={project}
                    className="shrink-0 gap-1 rounded-sm bg-muted px-1.5 text-xs text-muted-foreground"
                  />
                )}
                {zoomed && (
                  <button
                    type="button"
                    title={keyFor("pane.zoom", "Back in its column")}
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
                    project={entry.project}
                    args={entry.pane.args}
                    focused={focused}
                    selected={selected}
                    open={(pane, place, project) =>
                      frame.open(
                        project ?? entry.project,
                        pane,
                        entry.id,
                        place
                      )
                    }
                    update={(args) =>
                      frame.update(entry.id, { kind: entry.pane.kind, args })
                    }
                    close={close}
                    label={(label) => sayLabel(entry.id, label)}
                    run={frame.run}
                    composer={composer}
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
          </DetailsRows>
        </HeaderSlot>
      </TileHeader>
    </section>
  )
}

/** The Pane menu's rows, with where the Pane stands as the menu opens. */
function Rows({
  entry,
  frame,
  menu,
  zoomed,
}: {
  entry: string
  frame: Frame
  menu: MenuFrame
  zoomed: boolean
}) {
  const stand = frame.stand?.(entry)
  return stand ? (
    <PaneMenu entry={entry} stand={stand} frame={menu} zoomed={zoomed} />
  ) : null
}

/**
 * A Pane that broke, as on args its kind cannot read, says so in its tile
 * and can be closed: the other Panes and the window go on.
 */
export class Broken extends Component<
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
