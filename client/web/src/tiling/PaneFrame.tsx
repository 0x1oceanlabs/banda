import {
  memo,
  type ReactNode,
  useCallback,
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
  within,
} from "@banda/ui/pane"
import { withHost } from "@banda/core"
import type { Args } from "@banda/ui/module"
import { holdTile, TileBox, TileContext } from "@banda/ui/lib/tile"
import {
  LayoutPanelLeftIcon,
  Minimize2Icon,
  SquareArrowDownLeftIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react"
import { launcher } from "../launcher"
import { kindOf, labelOf, sayLabel, showsOf, useLabel } from "../registry"
import {
  type KeptHosts,
  reachWords,
  UNKNOWN,
  useMachineOf,
  usePaneOn,
  useReach,
  useWaitingFor,
} from "@banda/core/react"
import { sayComposer } from "../window/attach"
import { heightAt } from "./layout"
import type { Plan } from "./arrange"
import type { Entry } from "./model"
import { type MenuFrame, PaneMenu, type Stand } from "./PaneMenu"
import { gateOf, PaneMount, usePaneHandles, useWelcome } from "./mount"
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
  /** Runs an action by its id, as a key would; with `from`, as a click in
   * that tile asks it, as a path clicked in a Thread (ADR 0134). */
  run: (action: string, args?: Args, from?: string) => void
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
        className="shrink-0 animate-in text-meta text-muted-foreground fade-in-0 motion-reduce:animate-none"
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
 * opens, and its own args, name no host, as the directory says which
 * machine has each Project (ADR 0106, decision 1), whatever host its args
 * were handed (`paneOn`, `KeptHosts.paneOn`), so the arrangement keeps
 * none, and a Project no machine lists yet is taken as that host's. What
 * is attached goes to the composer of the file's own Project, on whatever
 * machine it is (`attach.ts`). */
export function handleOf(
  frame: Frame,
  entry: string,
  project: ProjectId,
  kind: string,
  host: string | undefined,
  paneOn: KeptHosts["paneOn"]
): Handle {
  return {
    open: (pane, place, into = project) =>
      frame.open(into, paneOn(into, pane, host), entry, place),
    update: (args) => frame.update(entry, paneOn(project, { kind, args })),
    close: () => frame.close(entry),
    label: (label) => sayLabel(entry, label),
    // Its composer, the same between draws, so the Pane says it once.
    composer: (take) => sayComposer(entry, project, take),
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
  item: listed = false,
  project,
  mixed,
  frame,
  actions,
  hidden = false,
  away = false,
  alone = false,
  noRoom = false,
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
  /** Nothing can be drawn beside it now, as in a narrow window or the
   * drawer: its Pane is told it is alone (`PaneProps.alone`). */
  noRoom?: boolean
}) {
  const keyFor = useKeyLabel()
  const kind = kindOf(entry.pane.kind)
  const element = useRef<HTMLElement>(null)
  const { title, detail, edits, Icon } = labelOf(entry.pane, useLabel(entry.id))
  // A Project of another host's is that host's engine's (ADR 0081): only
  // a kind that opens there does, on it; another says it is not there yet.
  // Its host is the one the directory says, its args' only as an
  // arrangement written before kept it; a Project no machine the Window
  // knows has shows why, and opens on none (ADR 0106, decision 1).
  const reach = useReach(entry.project, paneHost(entry.pane))
  // A Pane of a Project its machine just added is unknown until the list
  // that follows that machine says so (`useProjects`); one no machine has
  // stays unknown.
  const unknown = reach.host === null
  const there = reach.host ?? undefined
  // Why it cannot reach its machine, this one too (ADR 0124).
  const at = useMachineOf(entry.project, paneHost(entry.pane))
  const words = at && reachWords(at.key, at.shown, seenNamed)
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
  const subject = showsOf(entry.pane)
  // It with the host it is on in its args, as the directory says: its
  // Pane reads that at once, as Here does, while the Thread still asks.
  // The arrangement never keeps it: what the Pane opens or changes goes
  // back without it (`handleOf`).
  const onHost = useMemo(() => withHost(entry.pane, there), [entry.pane, there])
  // Its owner: its Project, on the host it is on. What it runs goes
  // through the one router from it, and whether it shows on another
  // machine is that machine's to say, by the Apps its welcome lists, so
  // the Frame is drawn again as they change (ADR 0106, law 3).
  const owner = useMemo(
    () => ({ project: entry.project, pane: onHost }),
    [entry.project, onHost]
  )
  const { runs } = usePaneHandles(owner, frame.run, onHost)
  // What its own content runs, it asks by a click in it.
  const clicked = useCallback(
    (action: string, args?: Args) => frame.run(action, args, entry.id),
    [frame, entry.id]
  )
  useWelcome(there === undefined ? undefined : reach.engine)
  const gate = gateOf(
    entry.pane,
    there === undefined ? undefined : runs,
    modules
  )
  // Where the Window has not heard its host, as after a restart while it
  // is away, a message waiting for it keeps what the header shows: its
  // Project, and that it shows an Item (ADR 0105, Q6). Not once heard: a
  // window that lists no Items, as a popped-out Pane's, keeps its header.
  const unheard =
    reach.shown?.state.state !== "live" && reach.shown?.asOf === undefined
  const kept = useWaitingFor(there, subject ?? null).find((wait) => wait.shows)
  const shows = unheard ? kept?.shows : undefined
  const item = listed || shows !== undefined
  const summary =
    project ??
    reach.shown?.projects.find((one) => one.id === entry.project) ??
    shows?.project
  const launches =
    entry.pane.kind === launcher.kind && there !== undefined && summary
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
      className="group/tile relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-tile border-(length:--tile-border) border-focus-inactive bg-tile shadow-tile [contain:layout_style] outline-none after:pointer-events-none after:absolute after:inset-0 after:bg-black after:opacity-(--tile-dim) data-alone:rounded-none data-alone:border-0 data-alone:shadow-none data-alone:outline-none data-away:border-dashed data-away:bg-transparent data-away:shadow-none data-marked:border-attention data-zoomed:fixed data-zoomed:inset-0 data-zoomed:z-10 data-zoomed:rounded-none data-zoomed:border-0 data-zoomed:shadow-none data-zoomed:outline-none data-[selected=true]:border-focus data-[selected=true]:outline-[length:calc(var(--tile-border)+var(--focus-ring))] data-[selected=true]:outline-offset-[calc(-1*var(--tile-border))] data-[selected=true]:outline-focus data-[selected=true]:outline-solid data-[selected=true]:[--tile-shadow:var(--focus-shadow)] data-[selected=true]:after:opacity-0"
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
                <span className="max-w-fit min-w-0 flex-[1_1_0] truncate text-meta text-muted-foreground">
                  {detail}
                </span>
              )}
              {/* New Pane on another machine says where what it opens
                  opens: "in banda on arc", the machine in the Slot. */}
              {launches && (
                <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-meta text-muted-foreground">
                  in
                  <ProjectName project={summary} />
                  on
                </span>
              )}
              {mixed && !item && !launches && summary && (
                <ProjectName
                  project={summary}
                  className="shrink-0 gap-1 rounded-small bg-muted px-1.5 text-meta text-muted-foreground"
                />
              )}
              {!item && <PaneSlot {...slot} at="project" />}
              {zoomed && (
                <button
                  type="button"
                  title={keyFor("pane.zoom", "Back in its column")}
                  className="flex shrink-0 items-center gap-1 rounded-small bg-muted px-1.5 text-meta text-muted-foreground hover:text-foreground"
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
                className="flex size-full flex-col items-center justify-center gap-2 text-ui text-muted-foreground outline-none hover:text-foreground"
                onClick={() => popOut?.(entry.id)}
              >
                <SquareArrowOutUpRightIcon className="size-5" />
                In its own window
              </button>
            ) : unknown ? (
              <Elsewhere machine={undefined}>{UNKNOWN}</Elsewhere>
            ) : machine && !reach.shown ? (
              <Elsewhere machine={machine}>{words}</Elsewhere>
            ) : "why" in gate ? (
              machine ? (
                <Elsewhere machine={machine}>{gate.why}</Elsewhere>
              ) : (
                <p className="p-4 text-ui text-muted-foreground">{gate.why}</p>
              )
            ) : !reach.engine ? (
              <Elsewhere machine={machine}>{words}</Elsewhere>
            ) : (
              <TileContext value={tile}>
                <PaneMount
                  kind={gate.opens}
                  engine={reach.engine}
                  project={entry.project}
                  pane={onHost}
                  id={entry.id}
                  owner={owner}
                  elsewhere={there !== undefined}
                  focused={focused}
                  selected={selected}
                  alone={noRoom}
                  handle={handle}
                  run={clicked}
                />
              </TileContext>
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
export function Elsewhere({
  machine,
  children,
}: {
  machine: Named | undefined
  children: ReactNode
}) {
  return (
    <p className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-ui text-muted-foreground">
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
