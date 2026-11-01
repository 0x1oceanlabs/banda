import { useMemo, useState } from "react"
import type { Engine, SpaceId, SpaceSummary } from "@banda/contract"
import { BandaMark, MARK_WORDS } from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
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
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { Kbd } from "@banda/ui/components/kbd"
import { ScrollArea } from "@banda/ui/components/scroll-area"
import { useNow } from "@banda/ui/hooks/use-now"
import { cn } from "@banda/ui/lib/utils"
import type { PaneState } from "@banda/ui/pane"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileCogIcon,
  FolderPlusIcon,
  ListFilterIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react"
import { keyName } from "../actions/actions"
import type { Lists } from "../bar/Watches"
import { MENU_KEY } from "../menu/menu"
import { NewSpace } from "../Spaces"
import {
  arrange,
  type Row as Arranged,
  type Section,
  type SpaceLine,
} from "./arrange"
import { useLookSidebar } from "../look"
import { Row, SpaceBadge } from "./Row"
import { PRESET_WORDS, type Settings } from "./settings"
import { isSettled, settle, settles, useSettled } from "./settled"

/**
 * The sidebar, docked at the window's left edge (ADR 0005, decision 8):
 * every Thread of every Space, arranged as `sidebar.toml` says (ADR 0008).
 * The modules list what each Space has; the sidebar only arranges and
 * draws it. Its view menu writes the preset into the file, through the
 * desktop, and the new arrangement comes back with the look.
 */
export function Sidebar({
  engine,
  spaces,
  lists,
  home,
  isCurrent,
  onMenu,
  onOpen,
  onNewThread,
  onCreated,
}: {
  engine: Engine
  spaces: SpaceSummary[]
  lists: Lists
  /** The Space a new Thread from the header starts in. */
  home: SpaceId
  /** Whether a Pane is the one that has the focus. */
  isCurrent: (space: SpaceId, pane: PaneState) => boolean
  /** Opens the Banda menu, as Alt+Space does (ADR 0017). */
  onMenu: () => void
  /**
   * Opens a Pane a row stands for: where a workspace shows it, or in a new
   * column of the current one.
   */
  onOpen: (space: SpaceId, pane: PaneState) => void
  onNewThread: (space: SpaceId) => void
  onCreated: (space: SpaceSummary) => void
}) {
  const [creating, setCreating] = useState(false)
  const settings = useLookSidebar()
  const { preset, presets } = settings
  const host = window.banda
  const [only, setOnly] = useState<SpaceId>()
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
  // The Person's settled Threads (ADR 0008): what they said, or three
  // quiet days.
  const says = useSettled()
  const now = useNow(60 * 60 * 1000)
  const arranged = useMemo(
    () =>
      arrange(lists, spaces, settings, only, toggled, (listed) =>
        isSettled(listed, says[listed.id], now)
      ),
    [lists, spaces, settings, only, toggled, says, now]
  )
  const pick = (next: string) => {
    host?.sidebar.preset(next).catch((error: unknown) => {
      console.error("banda: the sidebar's preset was not written", error)
    })
  }
  const edit = () => {
    host?.sidebar.edit().catch((error: unknown) => {
      console.error("banda: sidebar.toml did not open", error)
    })
  }
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
      onSettle={(row) => settle(row.listed.id, row.state !== "settled")}
      onNewThread={onNewThread}
    />
  )
  const nothing =
    arranged.sections.every((s) => s.rows.length === 0) &&
    arranged.shelves.every((s) => s.rows.length === 0)

  return (
    <aside
      aria-label="Sidebar"
      className="flex w-64 shrink-0 flex-col border-r bg-sidebar/60"
    >
      <div className="flex items-center gap-0.5 px-2 pt-2 pb-1">
        <button
          type="button"
          onClick={onMenu}
          className="mr-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-md border bg-background/60 px-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <SearchIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Search</span>
          <Kbd className="h-4.5 px-0.5 text-[10px]">
            {keyName(MENU_KEY).replaceAll("+", " ")}
          </Kbd>
        </button>
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
          <DropdownMenuContent align="start" className="w-auto min-w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>How the sidebar is arranged</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={preset}
                onValueChange={(next: string) => pick(next)}
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
          aria-label="New Space"
          title="New Space"
          onClick={() => setCreating(true)}
        >
          <FolderPlusIcon />
        </Button>
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
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 px-1.5 pb-2">
          {arranged.spaces && (
            <SpacesList
              lines={arranged.spaces}
              settings={settings}
              only={only}
              onPick={(space) =>
                setOnly((was) => (was === space ? undefined : space))
              }
              onNewThread={onNewThread}
            />
          )}
          {nothing ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No Threads yet
            </p>
          ) : (
            arranged.sections.map(drawn)
          )}
        </div>
      </ScrollArea>
      {arranged.shelves.length > 0 && (
        <div className="max-h-[45%] overflow-y-auto border-t px-1.5 py-1">
          {arranged.shelves.map(drawn)}
        </div>
      )}
      <NewSpace
        engine={engine}
        open={creating}
        onOpenChange={setCreating}
        onCreated={onCreated}
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
  onSettle,
  onNewThread,
}: {
  section: Section
  settings: Settings
  more: boolean
  isCurrent: (space: SpaceId, pane: PaneState) => boolean
  onToggle: () => void
  onMore: () => void
  onOpen: (space: SpaceId, pane: PaneState) => void
  /** Settles the row, or brings it back. */
  onSettle: (row: Arranged) => void
  onNewThread: (space: SpaceId) => void
}) {
  const { limit } = settings.group
  const rows = limit > 0 && !more ? section.rows.slice(0, limit) : section.rows
  const hidden = section.rows.length - rows.length
  const Chevron = section.folded ? ChevronRightIcon : ChevronDownIcon
  const { space } = section
  return (
    <div role="group" aria-label={section.label || "Threads"}>
      {section.label && (
        <div className="group/head flex items-center">
          <button
            type="button"
            aria-expanded={!section.folded}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 pt-2 pb-1 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              space ? "font-medium text-foreground" : "text-muted-foreground"
            )}
            onClick={onToggle}
          >
            <Chevron className="size-3 shrink-0 text-muted-foreground" />
            {space && <SpaceBadge space={space} />}
            <span className="min-w-0 truncate" title={space?.folder}>
              {section.label}
            </span>
            <span className="ml-auto flex items-center gap-1 text-muted-foreground tabular-nums">
              {section.folded && settings.spaces.rollup && (
                <Rollup mark={section.mark} waiting={section.waiting} />
              )}
              {section.rows.length}
            </span>
          </button>
          {space && settings.spaces.newThread && (
            <NewThreadIn space={space} onNewThread={onNewThread} />
          )}
        </div>
      )}
      {!section.folded && (
        <div className="flex flex-col gap-px">
          {rows.map((row) => (
            <ContextMenu key={`${row.space.id}:${row.listed.id}`}>
              <ContextMenuTrigger>
                <Row
                  row={row}
                  settings={settings}
                  inSpace={space !== undefined}
                  current={isCurrent(row.space.id, row.listed.pane)}
                  onOpen={() => onOpen(row.space.id, row.listed.pane)}
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <DropdownMenuItem
                  disabled={row.state !== "settled" && !settles(row.listed)}
                  onClick={() => onSettle(row)}
                >
                  {row.state === "settled"
                    ? "Un-settle thread"
                    : "Settle thread"}
                  <DropdownMenuShortcut>Alt+S</DropdownMenuShortcut>
                </DropdownMenuItem>
              </ContextMenuContent>
            </ContextMenu>
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

/** The list of Spaces, as Herdr's: a click shows only that Space's rows. */
function SpacesList({
  lines,
  settings,
  only,
  onPick,
  onNewThread,
}: {
  lines: SpaceLine[]
  settings: Settings
  only?: SpaceId
  onPick: (space: SpaceId) => void
  onNewThread: (space: SpaceId) => void
}) {
  return (
    <div role="group" aria-label="Spaces" className="flex flex-col gap-px pb-1">
      <div className="px-2 pt-2 pb-1 text-xs text-muted-foreground">Spaces</div>
      {lines.map(({ space, mark, waiting }) => (
        <div key={space.id} className="group/head flex items-center">
          <button
            type="button"
            aria-pressed={only === space.id}
            title={space.folder}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-left text-sm outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
              only === space.id && "border-border bg-background shadow-xs"
            )}
            onClick={() => onPick(space.id)}
          >
            <SpaceBadge space={space} />
            <span className="min-w-0 flex-1 truncate">{space.name}</span>
            {settings.spaces.rollup && <Rollup mark={mark} waiting={waiting} />}
          </button>
          {settings.spaces.newThread && (
            <NewThreadIn space={space} onNewThread={onNewThread} />
          )}
        </div>
      ))}
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
  space,
  onNewThread,
}: {
  space: SpaceSummary
  onNewThread: (space: SpaceId) => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`New Thread in ${space.name}`}
      title="New Thread"
      className="opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100"
      onClick={() => onNewThread(space.id)}
    >
      <SquarePenIcon />
    </Button>
  )
}
