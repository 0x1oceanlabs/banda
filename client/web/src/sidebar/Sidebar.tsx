import {
  type ComponentProps,
  Fragment,
  type ReactElement,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { BandaMark, MARK_WORDS } from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  useAfterMenu,
} from "@banda/ui/components/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { Kbd } from "@banda/ui/components/kbd"
import { ScrollArea } from "@banda/ui/components/scroll-area"
import { toast } from "@banda/ui/components/sonner"
import { trustProject } from "@banda/ui/lib/projects"
import { cn } from "@banda/ui/lib/utils"
import { clock, problem } from "@banda/ui/lib/words"
import { useNow } from "@banda/ui/hooks/use-now"
import { useHarnesses } from "@banda/ui/hooks/use-harnesses"
import type { Listed, PaneState } from "@banda/ui/pane"
import {
  HostsContext,
  holds,
  otherBuild,
  type Shown,
  useHosts,
} from "../calls/hosts"
import { useLists, useSnoozesNow } from "../calls/stores"
import {
  AlarmClockIcon,
  BadgeCheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  CopyIcon,
  FileCogIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  KeyboardIcon,
  ListFilterIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react"
import { LOCATE } from "../menu/menu"
import {
  arrange,
  type Elsewhere,
  type Row as Arranged,
  type Section,
  type ProjectLine,
} from "./arrange"
import { useLookSidebar } from "../look"
import { Row } from "./Row"
import { ThreadRows } from "../titles/ThreadMenu"
import { TitleField } from "../titles/Title"
import { useNaming } from "@banda/ui/lib/naming"
import { device } from "../window/device"
import { PRESET_WORDS, type Settings } from "./settings"
import { type Held, held, hold, rowKey } from "./hold"
import { useIsArchived } from "./archived"
import { seeWoke, snoozable } from "./snoozed"
import { FlowMenu } from "./FlowMenu"
import { ThemeMenu } from "./ThemeMenu"
import { TrustCard, type Trusting } from "../trust/TrustCard"
import { useKeyLabel, useKeyOf } from "@banda/ui/hooks/use-key-of"
import { keyCaps } from "@banda/ui/lib/keys"

/** The Banda menu's key in force, as its caps, in the Search field. */
function MenuKey() {
  const key = useKeyOf()("menu.open")
  if (!key) return null
  return (
    <Kbd className="h-4.5 px-0.5 text-[10px]">{keyCaps(key).join(" ")}</Kbd>
  )
}

/**
 * The sidebar, docked at the window's left edge (ADR 0005, decision 8):
 * every Thread of every Project, arranged as `sidebar.toml` says (ADR 0008).
 * The modules list what each Project has; the sidebar only arranges and
 * draws it. Its view menu writes the preset into the file, through the
 * desktop, and the new arrangement comes back with the look.
 */
export function Sidebar({
  over,
  onDismiss,
  hiding,
  ...props
}: {
  /**
   * Shown over the Strip in a narrow window (ADR 0025, decision 10): a
   * panel whatever the look, gone once it has done its work, a Pane or
   * a menu opened, or on Esc in it.
   */
  over?: boolean
  onDismiss?: () => void
  engine: Engine
  projects: ProjectSummary[]
  /** The Project a new Thread from the header starts in. */
  home: ProjectId
  /** Whether a Pane is the one that has the focus. */
  isCurrent: (project: ProjectId, pane: PaneState) => boolean
  /** Opens the Banda menu, as Alt+Space does (ADR 0017). */
  onMenu: () => void
  /** Opens the settings, as Alt+, does (ADR 0016). */
  onSettings: () => void
  /** Lists every action and its key, as Alt+K does. */
  onKeys: () => void
  /** Its edge is dragged past the narrowest: letting go hides it. */
  hiding?: boolean
  /**
   * Opens a Pane a row stands for: where a workspace shows it, or in a new
   * column of the current one.
   */
  onOpen: (project: ProjectId, pane: PaneState) => void
  onNewThread: (project: ProjectId) => void
  onNoProject: () => void
  /** Opens the snooze's picker for a row's Thread, by `anchor` if it is
   * given (ADR 0074). */
  onSnooze: (project: ProjectId, listed: Listed, anchor?: Element) => void
  /** Wakes a row's snoozed Thread now. */
  onWake: (project: ProjectId, thing: string) => void
  /** Opens "Add Project" in the Banda menu (ADR 0026). */
  onAddProject: () => void
  /** Pins the Project, so it comes first, or unpins it (ADR 0026). */
  onPin: (project: ProjectId, pinned: boolean) => void
  /** Opens the settings at the Project's own (ADR 0026). */
  onProjectSettings: (project: ProjectId) => void
  /** Finds the folder of a Project whose folder is missing (ADR 0026). */
  onLocate: (project: ProjectId) => void
}) {
  const keyFor = useKeyLabel()
  const { projects, home, isCurrent, onPin } = props
  // What every module lists, from the Window's items, and its snoozes by
  // the calls' clock.
  const lists = useLists()
  const done =
    <A extends unknown[]>(act: (...args: A) => void) =>
    (...args: A) => {
      onDismiss?.()
      act(...args)
    }
  const onMenu = done(props.onMenu)
  const onSettings = done(props.onSettings)
  const onKeys = done(props.onKeys)
  const onOpen = done(props.onOpen)
  const onNewThread = done(props.onNewThread)
  const onNoProject = done(props.onNoProject)
  const onAddProject = done(props.onAddProject)
  const onProjectSettings = done(props.onProjectSettings)
  const onLocate = done(props.onLocate)
  const settings = useLookSidebar()
  const { preset, presets } = settings
  const host = window.banda
  const [only, setOnly] = useState<ProjectId>()
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const [more, setMore] = useState<ReadonlySet<string>>(new Set())
  // Another preset starts afresh: no filter, nothing folded by hand.
  const [arrangedBy, setArrangedBy] = useState(preset)
  if (arrangedBy !== preset) {
    setArrangedBy(preset)
    setOnly(undefined)
    setToggled(new Set())
    setMore(new Set())
  }
  // The Threads the Person archived (ADR 0069), and those that sleep or
  // woke (ADR 0074).
  const archived = useIsArchived()
  const { asleep, woke } = useSnoozesNow()
  // The other machines of `hosts.toml`, below this one's (ADR 0081): the
  // rows of those live or away, each host's state by its name.
  const hosts = useHosts()
  const kept = useContext(HostsContext)
  const elsewhere = useMemo((): Elsewhere[] => hosts.filter(holds), [hosts])
  const fresh = useMemo(
    () =>
      arrange(
        lists,
        projects,
        settings,
        only,
        toggled,
        { archived, asleep, woke },
        elsewhere
      ),
    [
      lists,
      projects,
      settings,
      only,
      toggled,
      archived,
      asleep,
      woke,
      elsewhere,
    ]
  )
  const awayOf = (host: string) => hosts.find((one) => one.name === host)?.away
  const onStart = (host: string) => kept.start(host)
  // Under the pointer, the rows hold still; what would move or come
  // waits as updates, taken in by the pill or as the pointer leaves
  // (ADR 0065, decision 8).
  const [holding, setHolding] = useState<Held>()
  const { arranged, updates } = useMemo(
    () => hold(fresh, holding),
    [fresh, holding]
  )
  const take = () => setHolding(held(fresh))
  const edit = () => {
    host?.sidebar.edit().catch((error: unknown) => {
      console.error("banda: sidebar.toml did not open", error)
    })
  }
  // The Project whose trust a card by its row asks about (ADR 0083,
  // decision 5); taking it back needs no card, and says when it failed.
  const [trusting, setTrusting] = useState<Trusting>()
  const onTrust = (project: ProjectId, anchor: Element) =>
    setTrusting({ project, anchor })
  const onStopTrusting = (project: ProjectId) => {
    trustProject(props.engine, project, false).catch((error: unknown) =>
      toast.error(problem(error))
    )
  }
  // A Project's row, wherever it shows, has its right-click menu.
  const withMenu: WithMenu = (project, row) => (
    <ProjectMenu
      project={project}
      onNewThread={onNewThread}
      onPin={onPin}
      onTrust={onTrust}
      onStopTrusting={onStopTrusting}
      onSettings={onProjectSettings}
      onLocate={onLocate}
    >
      {row}
    </ProjectMenu>
  )
  const flip = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set)
    if (!next.delete(key)) next.add(key)
    return next
  }
  const drawn = (section: Section) => (
    <SectionView
      key={section.key}
      section={section}
      settings={settings}
      more={more.has(section.key)}
      isCurrent={isCurrent}
      onToggle={() => setToggled((set) => flip(set, section.key))}
      onMore={() => setMore((set) => flip(set, section.key))}
      onOpen={onOpen}
      onSnooze={(row, anchor) =>
        props.onSnooze(row.project.id, row.listed, anchor)
      }
      onWake={(row) => props.onWake(row.project.id, row.listed.id)}
      onNoProject={onNoProject}
      engine={props.engine}
      onNewThread={onNewThread}
      withMenu={withMenu}
      awayOf={awayOf}
    />
  )
  // Another host's label, with what it holds below it.
  const part = (host: Shown, held?: ReactNode) => (
    <HostPart key={host.name} host={host} onStart={onStart}>
      {held}
    </HostPart>
  )
  const byProject = settings.group.by === "project"
  const nothing =
    arranged.sections.every((s) => s.rows.length === 0) &&
    arranged.shelves.every((s) => s.rows.length === 0)

  return (
    <aside
      aria-label="Sidebar"
      onPointerEnter={take}
      onPointerLeave={() => setHolding(undefined)}
      onKeyDown={(event) => {
        // Not Esc in a menu it opened, drawn elsewhere in the page.
        if (
          event.key === "Escape" &&
          event.currentTarget.contains(event.target as Node)
        )
          onDismiss?.()
      }}
      className={cn(
        // An area of the window: what changes in it lays out and paints
        // nothing outside it (ADR 0088, decision 8).
        "absolute inset-y-(--gap-outer) left-(--gap-outer) z-20 flex w-(--sidebar-width) max-w-[calc(100%-2*var(--gap-outer))] flex-col overflow-hidden rounded-tile border bg-panel shadow-(--panel-shadow) [contain:layout_paint_style] *:transition-opacity",
        // Its panel stays, over the Strip; what is in it dims.
        hiding && "*:opacity-40",
        !over &&
          "sidebar-desk:inset-y-0 sidebar-desk:left-0 sidebar-desk:rounded-none sidebar-desk:border-0 sidebar-desk:bg-desk sidebar-desk:shadow-none"
      )}
    >
      <div className="flex items-center gap-0.5 px-2 pt-2 pb-1">
        <button
          type="button"
          onClick={onMenu}
          className="mr-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-md border bg-background/60 px-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <SearchIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Search</span>
          <MenuKey />
        </button>
        <FlowMenu />
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="New Thread"
          title="New Thread"
          onClick={() => onNewThread(only ?? home)}
        >
          <SquarePenIcon />
        </Button>
      </div>
      {updates > 0 && (
        <button
          type="button"
          onClick={take}
          className="absolute top-11 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary px-2.5 py-0.5 text-xs text-primary-foreground shadow-md"
        >
          ↑ {updates} {updates === 1 ? "update" : "updates"}
        </button>
      )}
      {/* Where more Threads are below, the list fades out at its foot
          instead of a line. */}
      <ScrollArea className="min-h-0 flex-1 data-overflow-y-end:mask-b-from-[calc(100%-1.5rem)]">
        <div className="flex flex-col gap-1 px-1.5 pb-2">
          {arranged.projects && (
            <ProjectsList
              lines={arranged.projects.filter((line) => !line.host)}
              settings={settings}
              only={only}
              onPick={(project) =>
                setOnly((was) => (was === project ? undefined : project))
              }
              onLocate={onLocate}
              onNewThread={onNewThread}
              withMenu={withMenu}
            >
              {hosts.map((host) =>
                part(
                  host,
                  <HostLines
                    lines={arranged.projects!.filter(
                      (line) => line.host === host.name
                    )}
                    settings={settings}
                  />
                )
              )}
            </ProjectsList>
          )}
          {nothing ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No Threads yet
            </p>
          ) : (
            arranged.sections.filter((section) => !section.host).map(drawn)
          )}
          {/* Grouped by Project, each host's sections follow under its
              label; grouped otherwise, its rows are among this machine's,
              and its label shows only what is not as usual. */}
          {byProject
            ? hosts.map((host) =>
                part(
                  host,
                  !nothing &&
                    arranged.sections
                      .filter((section) => section.host === host.name)
                      .map(drawn)
                )
              )
            : !arranged.projects &&
              hosts.filter(saysSomething).map((host) => part(host))}
        </div>
      </ScrollArea>
      {arranged.shelves.length > 0 && (
        <div className="max-h-[45%] overflow-y-auto px-1.5 py-1">
          {arranged.shelves.map(drawn)}
        </div>
      )}
      {/* Its foot: Banda's settings and keys, its theme, and how the
          sidebar arranges, with "Add Project" beside it. */}
      <div className="flex items-center gap-0.5 px-1.5 pt-0.5 pb-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Settings"
          title={keyFor("settings.open", "Settings")}
          onClick={onSettings}
        >
          <SettingsIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Every action and its key"
          title={keyFor("menu.keys", "Every action and its key")}
          onClick={onKeys}
        >
          <KeyboardIcon />
        </Button>
        <ThemeMenu />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`View: ${preset}`}
                title={`View: ${preset}`}
                className="text-muted-foreground"
              >
                <ListFilterIcon />
              </Button>
            }
          />
          <DropdownMenuContent side="top" className="w-auto min-w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>How the sidebar is arranged</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={preset}
                onValueChange={(next: string) => device.sidebar.preset(next)}
              >
                {presets.map(({ name, origin }) => (
                  <DropdownMenuRadioItem
                    key={name}
                    value={name}
                    disabled={!host}
                    closeOnClick
                  >
                    <span className="flex flex-col">
                      <span className="capitalize">{name}</span>
                      <span className="text-xs text-muted-foreground">
                        {origin === "yours"
                          ? "Your own preset"
                          : PRESET_WORDS[name]}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!host} onClick={edit}>
              <FileCogIcon />
              Edit sidebar.toml
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Add Project"
          title="Add Project"
          onClick={onAddProject}
        >
          <FolderPlusIcon />
        </Button>
      </div>
      <TrustCard
        engine={props.engine}
        projects={projects}
        target={trusting}
        onClose={() => setTrusting(undefined)}
      />
    </aside>
  )
}

/** A section: its header, which folds it, and its rows. */
function SectionView({
  section,
  settings,
  more,
  isCurrent,
  onToggle,
  onMore,
  onOpen,
  onSnooze,
  onWake,
  engine,
  onNoProject,
  onNewThread,
  withMenu,
  awayOf,
}: {
  section: Section
  settings: Settings
  more: boolean
  isCurrent: (project: ProjectId, pane: PaneState) => boolean
  onToggle: () => void
  onMore: () => void
  onOpen: (project: ProjectId, pane: PaneState) => void
  onSnooze: (row: Arranged, anchor?: Element) => void
  onWake: (row: Arranged) => void
  engine: Engine
  onNoProject: () => void
  onNewThread: (project: ProjectId) => void
  withMenu: WithMenu
  /** When another host went away, while it is. */
  awayOf: (host: string) => number | undefined
}) {
  const snoozeKey = useKeyLabel()("thread.snooze")
  const { limit } = settings.group
  const rows = limit > 0 && !more ? section.rows.slice(0, limit) : section.rows
  const hidden = section.rows.length - rows.length
  const Chevron = section.folded ? ChevronRightIcon : ChevronDownIcon
  const { project } = section
  // Another host's Project has no menu yet: each act would go to this
  // machine's engine.
  const mine = section.host === undefined
  const header = section.label && (
    <div className="group/head flex items-center">
      <button
        type="button"
        aria-expanded={!section.folded}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 pt-2 pb-1 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          project ? "font-medium text-foreground" : "text-muted-foreground"
        )}
        onClick={onToggle}
      >
        <Chevron className="size-3 shrink-0 text-muted-foreground" />
        {/* Grouped by Project, No Project's section has its dashed tile. */}
        {settings.group.by === "project" && <ProjectSign project={project} />}
        <span className="min-w-0 truncate" title={project?.folder}>
          {section.label}
        </span>
        <span className="ml-auto flex items-center gap-1 text-muted-foreground tabular-nums">
          {section.next !== undefined && (
            <span className="mr-1">next {clock(section.next)}</span>
          )}
          {section.folded && settings.projects.rollup && (
            <Rollup mark={section.mark} waiting={section.waiting} />
          )}
          {section.rows.length}
        </span>
      </button>
      {section.key === "no-project" && mine && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New Thread in No Project"
          title="New Thread"
          onClick={onNoProject}
        >
          <SquarePenIcon />
        </Button>
      )}
      {project && mine && settings.projects.newThread && (
        <NewThreadIn project={project} onNewThread={onNewThread} />
      )}
    </div>
  )
  return (
    <div role="group" aria-label={section.label || "Threads"}>
      {header && (project && mine ? withMenu(project, header) : header)}
      {!section.folded && (
        <div className="flex flex-col gap-px">
          {rows.map((row) => (
            <ThreadRow
              key={rowKey(row)}
              engine={engine}
              row={row}
              settings={settings}
              inProject={project !== undefined || row.project.scratch}
              current={isCurrent(row.project.id, row.listed.pane)}
              onOpen={() => {
                seeWoke(row.listed)
                onOpen(row.project.id, row.listed.pane)
              }}
              named={!mine}
              away={row.host === undefined ? undefined : awayOf(row.host)}
              action={
                row.state === "snoozed" ? (
                  <Button variant="ghost" size="xs" onClick={() => onWake(row)}>
                    <AlarmClockIcon />
                    Wake
                  </Button>
                ) : snoozable(row.listed) ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Snooze"
                    title={`Snooze ${snoozeKey}`}
                    onClick={(event) =>
                      onSnooze(
                        row,
                        event.currentTarget.closest("[data-row]") ?? undefined
                      )
                    }
                  >
                    <AlarmClockIcon />
                  </Button>
                ) : undefined
              }
            />
          ))}
          {(hidden > 0 || more) && (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={onMore}
            >
              {more ? "Show fewer" : `Show ${hidden} more`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A Thread's row, with the Thread menu a right click opens (ADR 0077,
 * decision 5); its Rename… opens the field in the row itself. Another
 * host's has neither yet (`ElsewhereRow`).
 */
function ThreadRow({
  engine,
  row,
  named,
  away,
  ...props
}: Omit<ComponentProps<typeof Row>, "field" | "host" | "stillAt"> & {
  engine: Engine
  /** A label above names its host, when it is another host's. */
  named: boolean
  /** When its host went away, while it is. */
  away?: number
}) {
  const project = row.project.id
  const naming = useNaming(project, row.listed.id, "row")
  const harnesses = useHarnesses(engine)
  if (row.host !== undefined)
    return (
      <ElsewhereRow
        row={row}
        settings={props.settings}
        inProject={props.inProject}
        current={props.current}
        onOpen={props.onOpen}
        named={named}
        away={away}
      />
    )
  if (naming)
    return (
      <Row
        row={row}
        {...props}
        harnesses={harnesses}
        field={
          <TitleField
            project={project}
            listed={row.listed}
            naming={naming}
            className="-my-0.5 -ml-1.5 h-6 text-sm"
          />
        }
      />
    )
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Row row={row} {...props} harnesses={harnesses} />
      </ContextMenuTrigger>
      <ContextMenuContent aria-label="Thread menu" className="min-w-60">
        <ThreadRows project={project} listed={row.listed} where="row" />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** The list of Projects, as Herdr's: a click shows only that Project's rows. */
function ProjectsList({
  lines,
  settings,
  only,
  onPick,
  onNewThread,
  onLocate,
  withMenu,
  children,
}: {
  lines: ProjectLine[]
  settings: Settings
  only?: ProjectId
  onPick: (project: ProjectId) => void
  onNewThread: (project: ProjectId) => void
  onLocate: (project: ProjectId) => void
  withMenu: WithMenu
  /** The other hosts' Projects, below this machine's. */
  children?: ReactNode
}) {
  return (
    <div
      role="group"
      aria-label="Projects"
      className="flex flex-col gap-px pb-1"
    >
      <div className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
        Projects
      </div>
      {lines.map(({ project, mark, waiting }) => (
        <Fragment key={project.id}>
          {withMenu(
            project,
            <div className="group/head flex items-center">
              <button
                type="button"
                aria-pressed={only === project.id}
                title={
                  project.missing
                    ? `The folder ${project.folder} is missing`
                    : project.folder
                }
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-left text-sm outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
                  only === project.id && "border-border bg-tile shadow-xs"
                )}
                onClick={() =>
                  project.missing ? onLocate(project.id) : onPick(project.id)
                }
              >
                <ProjectSign project={project} />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {project.missing && (
                  <span className="shrink-0 text-xs text-attention">
                    Missing
                  </span>
                )}
                {settings.projects.rollup && (
                  <Rollup mark={mark} waiting={waiting} />
                )}
              </button>
              {settings.projects.newThread && !project.missing && (
                <NewThreadIn project={project} onNewThread={onNewThread} />
              )}
            </div>
          )}
        </Fragment>
      ))}
      {children}
    </div>
  )
}

/** The loudest mark of a group, and how many in it need the Person. */
function Rollup({ mark, waiting }: { mark: Section["mark"]; waiting: number }) {
  return (
    <span className="flex items-center gap-1">
      {mark !== "rest" && (
        <BandaMark
          variant="agent"
          state={mark}
          playful={0}
          label={MARK_WORDS[mark]}
          className="size-3.5"
        />
      )}
      {waiting > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-attention px-1 text-[10px] font-semibold text-background">
          {waiting}
        </span>
      )}
    </span>
  )
}

function NewThreadIn({
  project,
  onNewThread,
}: {
  project: ProjectSummary
  onNewThread: (project: ProjectId) => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`New Thread in ${project.name}`}
      title="New Thread"
      className="opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100"
      onClick={() => onNewThread(project.id)}
    >
      <SquarePenIcon />
    </Button>
  )
}

/** A Project's row with its right-click menu around it. */
type WithMenu = (project: ProjectSummary, row: ReactElement) => ReactElement

/** A Project's right-click menu, in T3 Code's words (ADR 0026, decision
 * 5), with its trust (ADR 0083, decision 5). */
function ProjectMenu({
  project,
  onNewThread,
  onPin,
  onTrust,
  onStopTrusting,
  onSettings,
  onLocate,
  children,
}: {
  project: ProjectSummary
  onNewThread: (project: ProjectId) => void
  onPin: (project: ProjectId, pinned: boolean) => void
  /** Asks on a card by `row` whether to trust the Project. */
  onTrust: (project: ProjectId, row: Element) => void
  onStopTrusting: (project: ProjectId) => void
  onSettings: (project: ProjectId) => void
  onLocate: (project: ProjectId) => void
  children: ReactElement
}) {
  const row = useRef<HTMLDivElement>(null)
  return (
    <ContextMenu>
      <ContextMenuTrigger ref={row}>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {project.missing ? (
          <DropdownMenuItem onClick={() => onLocate(project.id)}>
            <FolderSearchIcon />
            {LOCATE}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onNewThread(project.id)}>
            <SquarePenIcon />
            New Thread
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => void navigator.clipboard.writeText(project.folder)}
        >
          <CopyIcon />
          Copy path
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPin(project.id, !project.pinned)}>
          {project.pinned ? <PinOffIcon /> : <PinIcon />}
          {project.pinned ? "Unpin Project" : "Pin Project"}
        </DropdownMenuItem>
        {!project.scratch && (
          <TrustItem
            trusted={project.trusted}
            onTrust={() => row.current && onTrust(project.id, row.current)}
            onStopTrusting={() => onStopTrusting(project.id)}
          />
        )}
        <DropdownMenuItem onClick={() => onSettings(project.id)}>
          <SettingsIcon />
          Project settings
        </DropdownMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Trust Project…, which asks on a card by the row once the menu has
 * gone, or Stop trusting, at once. */
function TrustItem({
  trusted,
  onTrust,
  onStopTrusting,
}: {
  trusted: boolean
  onTrust: () => void
  onStopTrusting: () => void
}) {
  const later = useAfterMenu()
  return trusted ? (
    <DropdownMenuItem onClick={onStopTrusting}>
      <CircleDashedIcon />
      Stop trusting
    </DropdownMenuItem>
  ) : (
    <DropdownMenuItem onClick={() => later(onTrust)}>
      <BadgeCheckIcon />
      Trust Project…
    </DropdownMenuItem>
  )
}

/** Whether a host's label says something, where its rows are among this
 * machine's: all but a live host of this build. */
function saysSomething(host: Shown): boolean {
  return host.state.state !== "live" || otherBuild(host.state) !== undefined
}

/**
 * Another host of `hosts.toml` (ADR 0081, decision 4): its quiet label,
 * as the list of Projects' own, what is not as usual in words on its
 * right, and what it holds below. Away, what it holds dims.
 */
function HostPart({
  host,
  onStart,
  children,
}: {
  host: Shown
  onStart: (host: string) => void
  children?: ReactNode
}) {
  const other = otherBuild(host.state)
  return (
    <div role="group" aria-label={host.name} className="flex flex-col">
      <div className="flex min-h-8 items-center gap-1.5 px-2 pt-3.5 pb-0.5 text-xs whitespace-nowrap text-muted-foreground">
        <h3 className="min-w-0 truncate">{host.name}</h3>
        <span className="ml-auto flex min-w-0 items-center gap-1.5 tabular-nums">
          <HostWords host={host} onStart={onStart} />
        </span>
      </div>
      {other && (
        <p
          className="px-2 pb-1 text-xs text-muted-foreground tabular-nums"
          title={`${host.name} runs another build of Banda than this window`}
        >
          {other}
        </p>
      )}
      {children && (
        <div
          className={cn(
            "flex flex-col gap-1",
            host.state.state === "away" && "opacity-45"
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** What a host's label says of its state: nothing when live, and only
 * the window's own words. */
function HostWords({
  host,
  onStart,
}: {
  host: Shown
  onStart: (host: string) => void
}) {
  const { state } = host
  switch (state.state) {
    case "connecting":
      return <Dots />
    case "signin":
      // A link opens in the system's browser, as every link of the page.
      return (
        <a
          href={state.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-ring underline-offset-3 hover:underline"
        >
          Sign in to Tailscale
        </a>
      )
    case "live":
      return otherBuild(state) ? <span>other build</span> : null
    case "away":
      return <Away since={host.away} why={state.why} />
    case "stopped":
      return (
        <>
          <span>stopped</span>
          <Button
            variant="ghost"
            size="xs"
            className="-my-1 -mr-1.5"
            onClick={() => onStart(host.name)}
          >
            <PlayIcon />
            Start
          </Button>
        </>
      )
    case "refused":
      return (
        <span className="min-w-0 truncate" title={state.why}>
          {state.why}
        </span>
      )
  }
}

/** How long a host has been away, in minutes. */
function Away({ since, why }: { since?: number; why: string }) {
  const now = useNow(15_000)
  const minutes = since === undefined ? 0 : Math.floor((now - since) / 60_000)
  return (
    <span title={why}>
      {minutes < 1
        ? "away"
        : minutes < 60
          ? `away · ${minutes} min`
          : `away · ${Math.floor(minutes / 60)} h`}
    </span>
  )
}

/** Three faint dots: ssh still reaches the host. */
function Dots() {
  return (
    <span
      role="status"
      aria-label="Connecting"
      title="Connecting over ssh"
      className="inline-flex h-4 items-center gap-0.75"
    >
      {[0, 200, 400].map((delay) => (
        <i
          key={delay}
          className="size-0.75 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  )
}

/** Another host's lines in the list of Projects: shown, not picked yet. */
function HostLines({
  lines,
  settings,
}: {
  lines: ProjectLine[]
  settings: Settings
}) {
  return lines.map(({ project, mark, waiting }) => (
    <div
      key={project.id}
      title={project.folder}
      className="flex min-w-0 items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-sm"
    >
      <ProjectSign project={project} />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {settings.projects.rollup && <Rollup mark={mark} waiting={waiting} />}
    </div>
  ))
}

/**
 * Another host's Thread (ADR 0081): shown as this machine's are, and a
 * click opens it there, as its listed Pane names its host; with no menu
 * or snooze yet, as the row's would go to this machine's engine. Where no
 * label above names its host, the row does; away, it dims and its timer
 * stands.
 */
function ElsewhereRow({
  row,
  settings,
  inProject,
  current,
  onOpen,
  named,
  away,
}: {
  row: Arranged
  settings: Settings
  inProject: boolean
  current: boolean
  onOpen: () => void
  /** A label above names its host. */
  named: boolean
  away?: number
}) {
  const drawn = (
    <Row
      row={row}
      settings={settings}
      inProject={inProject}
      current={current}
      onOpen={onOpen}
      host={named ? undefined : row.host}
      stillAt={away}
    />
  )
  return !named && away !== undefined ? (
    <div className="opacity-45">{drawn}</div>
  ) : (
    drawn
  )
}
