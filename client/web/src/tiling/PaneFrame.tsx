import {
  Component,
  memo,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ProjectName } from "@banda/ui/components/project-sign"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import { MachineIcon } from "@banda/ui/components/machine-icon"
import { seenNamed } from "@banda/ui/hooks/use-status"
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
import {
  type Label,
  type PaneProps,
  paneHost,
  type PaneState,
  type Place,
  withHost,
  within,
} from "@banda/ui/pane"
import type { Args } from "@banda/ui/module"
import { holdTile, TileBox, TileContext } from "@banda/ui/lib/tile"
import {
  LayoutPanelLeftIcon,
  Minimize2Icon,
  SquareArrowDownLeftIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react"
import {
  ELSEWHERE,
  kindOf,
  kindRuns,
  labelOf,
  sayLabel,
  showsOf,
  useLabel,
} from "../registry"
import {
  reachWords,
  runOnHost,
  usePaneOn,
  useReach,
  useShownNow,
} from "@banda/core/react"
import { sayComposer } from "../window/attach"
import { heightAt } from "./layout"
import type { Plan } from "./arrange"
import type { Entry } from "./model"
import { type MenuFrame, PaneMenu, type Stand } from "./PaneMenu"
import { PaneSlot } from "./PaneSlot"
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

/** What a Tile hands its Pane to act on its place: the same functions for
 * as long as it stands for the same Pane (ADR 0088, decision 7). */
type Handle = Pick<
  PaneProps<PaneState["args"]>,
  "open" | "update" | "close" | "label" | "composer"
>

/** The handle of the Pane of kind `kind` at `entry` in `project`, a
 * Project of another host's when `host` names one (ADR 0081): what it
 * opens, and its own args, keep that host, as it knows only that host's
 * Projects, unless what it opens names its own, as a new Thread moved to
 * another machine's Project does (ADR 0095, decision 7), or is in a
 * Project this machine has, as that wins a clash; and it takes nothing
 * this machine attaches, as that names this machine's files. The
 * Window's hosts decide that here, once, by their one rule (`paneOn`,
 * `KeptHosts.paneOn`), so what it opens, or its args a clash took back,
 * never says another host for a frame (#1004). */
export function handleOf(
  frame: Frame,
  entry: string,
  project: ProjectId,
  kind: string,
  host: string | undefined,
  paneOn: (project: ProjectId, pane: PaneState) => PaneState
): Handle {
  const there = (pane: PaneState) =>
    host === undefined || paneHost(pane) !== undefined
      ? pane
      : withHost(pane, host)
  return {
    open: (pane, place, into = project) =>
      frame.open(into, paneOn(into, there(pane)), entry, place),
    update: (args) =>
      frame.update(entry, paneOn(project, there({ kind, args }))),
    close: () => frame.close(entry),
    label: (label) => sayLabel(entry, label),
    // Its composer, the same between draws, so the Pane says it once.
    composer:
      host === undefined
        ? (take) => sayComposer(entry, project, take)
        : undefined,
  }
}

/**
 * One tile: a header with the Pane's icon and title, and its Project when the
 * workspace mixes Projects, unless the Pane draws its own; under it, the Pane
 * itself. A Pane that shows an Item, as a Thread, has what its App shows of
 * it in the icon's place, as a Thread's Mark, and its Project before the
 * title (ADR 0031); what the Apps show there and after the Project is the
 * Slot `pane.header`'s (ADR 0062, decision 17). A Deck's bar of names sits
 * over its tile, outside it (`Tabs`). It is drawn again only as its own
 * props change, so a key that moves the focus draws the two tiles it moves
 * between (ADR 0088, decision 7).
 */
export const PaneFrame = memo(function PaneFrame({
  entry,
  modules,
  focused,
  selected = focused,
  marked,
  zoomed = false,
  height,
  item = false,
  project,
  mixed,
  frame,
  actions,
  hidden = false,
  away = false,
  alone = false,
}: {
  entry: Entry
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
  /** It shows an Item, as its App lists what it shows: its header has the
   * Item's places for its Project and its title, which finds the Item. */
  item?: boolean
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
  const { title, detail, edits, Icon } = labelOf(entry.pane, useLabel(entry.id))
  // A Project of another host's is that host's engine's (ADR 0081): only
  // a kind that opens there does, on it; another says it is not there yet.
  const named = paneHost(entry.pane)
  const reach = useReach(entry.project, named)
  const there = reach.host
  const words =
    there === undefined ? undefined : reachWords(there, reach.shown, seenNamed)
  // Its host out of reach while the Pane shows: a pill under its header
  // says so, in a band of its own, so it covers none of the Pane (#955).
  const pill = !away && reach.engine !== undefined && words !== undefined
  // Another machine, by its name under its icon where its Pane cannot
  // show (ADR 0095, decision 7); its header names it in the Slot.
  const machine =
    there === undefined ? undefined : (reach.shown?.named ?? seenNamed(there))
  // The same function while the Window's hosts stay, so the handle does.
  const paneOn = usePaneOn()
  const handle = useMemo(
    () =>
      handleOf(frame, entry.id, entry.project, entry.pane.kind, there, paneOn),
    [frame, entry.id, entry.project, entry.pane.kind, there, paneOn]
  )
  const { close } = handle
  // What it runs of the Window's, there only what reaches neither this
  // machine's files nor its engine's Projects: an item action, on an Item
  // of that host's (ADR 0081).
  const shownNow = useShownNow()
  const subject = showsOf(entry.pane)
  const run = useMemo(
    () =>
      there === undefined
        ? frame.run
        : runOnHost(frame.run, ELSEWHERE, () => shownNow(there), {
            project: entry.project,
            item: subject,
          }),
    [frame, there, shownNow, entry.project, subject]
  )
  // It with the host it is on in its args: its Pane reads that at once,
  // as Here does, and the args keep it, so it comes back there after a
  // restart. One opened where its host went unsaid takes it, and one this
  // machine's Project took back, as it wins a clash, lets it go.
  const onHost = useMemo(() => withHost(entry.pane, there), [entry.pane, there])
  useEffect(() => {
    if (onHost !== entry.pane) frame.update(entry.id, onHost)
  }, [frame, entry.id, entry.pane, onHost])
  const summary =
    project ?? reach.shown?.projects.find((one) => one.id === entry.project)
  // What the Slot in its header is given: the Pane alone. What fills it
  // finds the Item the Pane shows itself (#943).
  const slot = { project: entry.project, pane: entry.pane }
  // Its Tile, which the Tiling configures and its Pane reads (ADR 0088,
  // decision 4): the same for as long as it is drawn, so no Configure
  // draws it again.
  const [tile] = useState(() => new TileBox())
  useLayoutEffect(() => {
    const own = element.current
    return own ? holdTile(own, tile) : undefined
  }, [tile])

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
      // Its layout is its own: what changes in it lays out nothing outside
      // it (ADR 0088, decision 8). Not its paint, as the focus frame and a
      // Deck's names sit outside it; nor its content's yet: contained, the
      // content would paint over the focus frame's round corners.
      className="group/tile relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-tile border-(length:--tile-border) border-focus-inactive bg-tile shadow-(--tile-shadow) [contain:layout_style] outline-none after:pointer-events-none after:absolute after:inset-0 after:bg-black after:opacity-(--tile-dim) data-alone:rounded-none data-alone:border-0 data-alone:shadow-none data-alone:outline-none data-away:border-dashed data-away:bg-transparent data-away:shadow-none data-marked:border-attention data-zoomed:fixed data-zoomed:inset-0 data-zoomed:z-10 data-zoomed:rounded-none data-zoomed:border-0 data-zoomed:shadow-none data-zoomed:outline-none data-[selected=true]:border-focus data-[selected=true]:outline-[length:calc(var(--tile-border)+var(--focus-ring))] data-[selected=true]:outline-offset-[calc(-1*var(--tile-border))] data-[selected=true]:outline-focus data-[selected=true]:outline-solid data-[selected=true]:[--tile-shadow:var(--focus-shadow)] data-[selected=true]:after:opacity-0"
    >
      {/* On the border, where no page covers it. */}
      {marked && (
        <AgentMark className="pointer-events-none absolute top-1.5 right-1.5 z-10" />
      )}
      <TileHeader value={header}>
        <HeaderSlot>
          {/* A stand-in draws the frame's header, as its Pane is not drawn. */}
          {(zoomed || away || kind?.header !== false) && (
            <PaneHeader
              title={title}
              icon={item ? undefined : Icon}
              onClose={close}
              className={kind?.header === "bare" ? "border-b-0" : undefined}
            >
              <PaneSlot {...slot} at="start" />
              {item && (
                <>
                  {summary && (
                    <ProjectName
                      project={summary}
                      className="shrink-0 text-muted-foreground"
                    />
                  )}
                  <PaneSlot {...slot} at="project" />
                </>
              )}
              {item && subject && reach.engine ? (
                <Title
                  project={entry.project}
                  thing={subject}
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
              {mixed && !item && summary && (
                <ProjectName
                  project={summary}
                  className="shrink-0 gap-1 rounded-sm bg-muted px-1.5 text-xs text-muted-foreground"
                />
              )}
              {!item && <PaneSlot {...slot} at="project" />}
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
          <div
            data-pill={pill || undefined}
            className="relative min-h-0 flex-1 data-pill:pt-8"
          >
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
            ) : machine && !kind?.elsewhere ? (
              <Elsewhere machine={machine}>Not on {machine.name} yet</Elsewhere>
            ) : !reach.engine ? (
              <Elsewhere machine={machine}>{words}</Elsewhere>
            ) : shown ? (
              <Broken close={close}>
                <TileContext value={tile}>
                  <shown.Pane
                    engine={reach.engine}
                    project={entry.project}
                    args={onHost.args}
                    focused={focused}
                    selected={selected}
                    {...handle}
                    run={run}
                  />
                </TileContext>
              </Broken>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">
                {kind
                  ? "This Pane comes back when the engine runs its module."
                  : "This window does not know this kind of Pane."}
              </p>
            )}
            {/* Its host out of reach, it shows what it showed, and
                catches up once that host is back. What the pill says and
                does is the Window's, in the Slot: it knows the machines. */}
            {pill && (
              <div className="pointer-events-none absolute inset-x-2 top-1 z-10 flex justify-center">
                <PaneSlot {...slot} at="pill" />
              </div>
            )}
          </div>
        </HeaderSlot>
      </TileHeader>
    </section>
  )
})

/** Why a Pane on another host shows nothing, under that host's icon: it
 * is not there yet, or that host is not known yet. */
function Elsewhere({
  machine,
  children,
}: {
  machine: Named | undefined
  children: ReactNode
}) {
  return (
    <p className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
      {machine && <MachineIcon icon={machine.icon} size={20} />}
      {children}
    </p>
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
