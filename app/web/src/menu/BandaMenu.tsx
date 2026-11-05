import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { Engine, SpaceId, SpaceSummary } from "@banda/contract"
import type { Bind } from "@banda/contract/look"
import { SpaceBadge } from "@banda/ui/components/space-badge"
import { MARK_WORDS, waits } from "@banda/ui/components/banda-mark"
import { Dialog, DialogContent, DialogTitle } from "@banda/ui/components/dialog"
import { Kbd, KbdGroup } from "@banda/ui/components/kbd"
import {
  Suggestion,
  SuggestionList,
  Suggestions,
} from "@banda/ui/components/suggestions"
import { useAct } from "@banda/ui/hooks/use-act"
import { useWrite } from "@banda/ui/hooks/use-write"
import {
  type Key,
  keyCaps,
  keyLabel,
  keyText,
  keyToBind,
  matches,
  sameKey,
} from "@banda/ui/lib/keys"
import type { Action, Here, MenuRow, Source } from "@banda/ui/module"
import {
  CheckIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
  CornerLeftUpIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  ListFilterIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"
import { KEYS_FILE, writeBind } from "../actions/actions"
import type { Lists } from "@banda/ui/pane"
import { useLookSidebar } from "../look"
import { runs, sources as allSources } from "../registry"
import type { Shell } from "../shell/actions"
import { ThreadMark } from "../sidebar/Row"
import { PRESET_WORDS } from "../sidebar/settings"
import { useIsArchived } from "../sidebar/archived"
import {
  type Act,
  actsOf,
  type Adding,
  type Branch,
  branchName,
  type Choice,
  isBranch,
  isOwn,
  menuOf,
  OPEN,
  type Found,
  type Opening,
  type Own,
  SOURCES,
  type Sources,
  wordsIn,
  isPathField,
  LOCATE,
  pathAdding,
} from "./menu"
import {
  PATH_PLACEHOLDER,
  PICK_FOLDER,
  useBrowsed,
  usePickFolder,
} from "./browse"
import { opened, useOpened, weightOf } from "./opened"

const ASK: Key = { code: "Enter", alt: true }

/**
 * The Banda menu (ADR 0017): one window in the middle that finds and runs
 * everything, opened by Alt+Space at its root, by Alt+K at its Actions,
 * or by `banda menu` at a route. It goes into branches itself; what else
 * is chosen, the window runs.
 */
export function BandaMenu({
  opening,
  onClose,
  onChoose,
  onAdded,
  engine,
  modules,
  space,
  lists,
  spaces,
  actions,
  binds,
}: {
  /** Where it opens; closed when none. */
  opening: Opening | null
  onClose: () => void
  /** Runs a chosen row, once the menu has closed. */
  onChoose: (row: Exclude<Choice, Branch | Own>) => void
  /** Hears a Space the menu added, once it has closed (ADR 0026). */
  onAdded: (space: SpaceSummary) => void
  engine: Engine
  /** The modules the engine runs: the sources of the others find nothing. */
  modules: readonly string[]
  /** The focused Space, where the sources look. */
  space: SpaceId
  lists: Lists
  spaces: readonly SpaceSummary[]
  actions: readonly Action<Shell>[]
  /** The Person's keys in force, from keys.toml. */
  binds: readonly Bind[]
}) {
  // What the menu looks for, and what each source found. The sources are
  // drawn while the menu is shut too, so what they load first is there as
  // it opens.
  const [looking, setLooking] = useState<Looking>(NOWHERE)
  const [rows, setRows] = useState<
    Readonly<Record<string, readonly MenuRow[]>>
  >({})
  const running = useMemo(
    () => allSources.filter(({ module }) => runs(module, modules)),
    [modules]
  )
  const found: Found[] = useMemo(
    () =>
      running.map(({ source }) => ({
        label: source.label,
        rows: rows[source.id] ?? NO_ROWS,
      })),
    [running, rows]
  )
  const here: Here = useMemo(() => {
    const at = looking.entered ?? space
    return {
      engine,
      space: at,
      folder: spaces.find((one) => one.id === at)?.folder,
      entered: looking.entered !== undefined,
    }
  }, [engine, space, spaces, looking.entered])
  const hear = useCallback((id: string, heard?: readonly MenuRow[]) => {
    setRows((rows) => {
      if (rows[id] === heard) return rows
      const next = { ...rows }
      if (heard) next[id] = heard
      else delete next[id]
      return next
    })
  }, [])
  // Esc shuts the open act list before the menu.
  const escapeRef = useRef<() => boolean>(() => false)
  return (
    <>
      {running.map(({ source }) => (
        <Finder
          key={source.id}
          source={source}
          words={looking.words}
          here={here}
          hear={hear}
        />
      ))}
      <Dialog
        open={opening !== null}
        onOpenChange={(open, details) => {
          if (open) return
          if (details.reason === "escape-key" && escapeRef.current())
            return details.cancel()
          onClose()
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Banda menu</DialogTitle>
          {opening && (
            <Menu
              key={opening.n}
              engine={engine}
              opening={opening}
              lists={lists}
              spaces={spaces}
              actions={actions}
              binds={binds}
              found={found}
              onLooking={setLooking}
              escapeRef={escapeRef}
              onChoose={(row) => {
                onClose()
                onChoose(row)
              }}
              onAdded={(space) => {
                onClose()
                onAdded(space)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** One source, finding for the menu; what it found leaves with it. */
function Finder({
  source,
  words,
  here,
  hear,
}: {
  source: Source
  words: string
  here: Here
  hear: (id: string, rows?: readonly MenuRow[]) => void
}) {
  const { id, Find } = source
  const found = useCallback(
    (rows: readonly MenuRow[]) => hear(id, rows),
    [hear, id]
  )
  useEffect(() => () => hear(id), [hear, id])
  return <Find words={words} here={here} found={found} />
}

/** What the menu looks for: the words typed at its root, or the Space it
 * went into. */
type Looking = { words: string; entered?: SpaceId }

const NOWHERE: Looking = { words: "" }

/** The menu while it is open: it starts where it is opened, each time. */
function Menu({
  engine,
  opening,
  lists,
  spaces,
  actions,
  binds,
  found,
  onLooking,
  escapeRef,
  onChoose,
  onAdded,
}: {
  engine: Engine
  opening: Opening
  lists: Lists
  spaces: readonly SpaceSummary[]
  actions: readonly Action<Shell>[]
  /** The Person's keys in force, from keys.toml. */
  binds: readonly Bind[]
  /** What the sources found for what it looks for. */
  found: readonly Found[]
  onLooking: (looking: Looking) => void
  escapeRef: React.RefObject<() => boolean>
  onChoose: (row: Exclude<Choice, Branch | Own>) => void
  onAdded: (space: SpaceSummary) => void
}) {
  const { preset, presets } = useLookSidebar()
  const archived = useIsArchived()
  const uses = useOpened()
  const [now] = useState(Date.now)
  const { at } = opening
  const [words, setWords] = useState(opening.words)
  const [path, setPath] = useState<Branch[]>(opening.path)
  const query = words.trim()
  // The sources look for the words at the root, and in a Space gone into.
  const inside = path.at(-1)
  const entered = inside?.kind === "space" ? inside.space.id : undefined
  const atRoot = at === "root" && path.length === 0
  // Before the paint, so no row is drawn for the words before.
  useLayoutEffect(
    () =>
      onLooking(
        entered
          ? { words: query, entered }
          : atRoot
            ? { words: query }
            : NOWHERE
      ),
    [onLooking, entered, atRoot, query]
  )
  useEffect(() => () => onLooking(NOWHERE), [onLooking])
  // The path field's folders, from the engine, as the path is typed.
  const browsed = useBrowsed(engine, isPathField(inside) ? words : undefined)
  const sources: Sources = useMemo(
    () => ({
      lists,
      spaces,
      actions,
      presets: { names: presets.map((one) => one.name), current: preset },
      archived,
      found,
      weight: (id) => weightOf(uses[id], now),
      browsed,
    }),
    [
      lists,
      spaces,
      actions,
      presets,
      preset,
      archived,
      found,
      uses,
      now,
      browsed,
    ]
  )
  const [index, setIndex] = useState(0)
  // The row's acts that Tab shows, and the one chosen among them.
  const [acting, setActing] = useState<number>()
  // The action that waits for a key to bind, and what the last change
  // of the keys did.
  const [taking, setTaking] = useState<Action<Shell>>()
  const [note, setNote] = useState<string>()
  const groups = useMemo(
    () => menuOf({ words, at, inside, sources }),
    [words, at, inside, sources]
  )
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups])
  const active = Math.min(index, rows.length - 1)
  const current = rows[active]
  const acts = useMemo(
    () => (current ? actsOf(current, sources) : []),
    [current, sources]
  )
  const optionId = (row: Choice) => `banda-menu-${row.id}`
  useEffect(() => {
    if (current)
      document
        .getElementById(optionId(current))
        ?.scrollIntoView({ block: "nearest" })
  }, [current])

  const restart = (next: Branch[]) => {
    setPath(next)
    setWords(wordsIn(next))
    setIndex(0)
    setActing(undefined)
  }
  // Writes `key` to keys.toml, bound to `action` or freed; the look
  // brings the change back. What it did shows once it is written, and a
  // key refused leaves the action waiting for another.
  const done = useRef("")
  const { refused, write: writing } = useWrite({
    onWritten: () => {
      setTaking(undefined)
      setNote(done.current)
    },
  })
  const write = (key: Key, action: string, did: string) => {
    done.current = did
    setNote(undefined)
    writing(writeBind(key, action))
  }
  // A Space added here opens its new Thread, as the menu closes; what the
  // engine refused shows, and the field stays as it was.
  const { busy: adding, problem, act } = useAct()
  const add = async (how: Adding) => {
    if (adding) return
    setNote(undefined)
    const space = await act(() =>
      "name" in how
        ? engine.command("spaces.create", { name: how.name })
        : "locate" in how
          ? engine.command("spaces.locate", {
              space: how.locate,
              folder: how.folder,
            })
          : engine.command("spaces.add", how)
    )
    if (space) onAdded(space)
  }
  // The system's folder picker: the folder picked is added at once, as
  // T3 Code does; the field takes the keys back when it is cancelled.
  const field = useRef<HTMLInputElement>(null)
  const picker = usePickFolder(browsed, (folder) =>
    folder ? void add(pathAdding(inside, folder)!) : field.current?.focus()
  )
  const own = (row: Own) => {
    setActing(undefined)
    switch (row.kind) {
      case "bind":
        setTaking(row.action)
        setNote(undefined)
        return
      case "free":
        return write(
          row.key,
          "none",
          `${keyLabel(row.key)} goes to the Pane now`
        )
      case "folder":
        setWords(row.path)
        setIndex(0)
        return
      case "adding":
        return void add(row.how)
    }
  }
  // A branch opens in the menu, and the menu does its own rows; any other
  // row runs. Each counts for the order next time, but a folder or a Space
  // to add, which are the Person's own.
  const choose = (row: Choice) => {
    if (isBranch(row)) restart([...path, row])
    else if (isOwn(row)) own(row)
    else onChoose(row)
    if (row.kind !== "folder" && row.kind !== "adding") opened(row.id)
  }

  // The key pressed while an action waits for one: bound to it, unless
  // the desktop's; `banda settings` refuses one that would be typed.
  const take = (event: React.KeyboardEvent, action: Action<Shell>) => {
    event.preventDefault()
    if (event.key === "Escape") return
    const pressed = keyToBind(event)
    if (!pressed) return
    if ("refused" in pressed) return setNote(pressed.refused)
    const { key } = pressed
    const had = actions.find(
      (one) => one !== action && one.keys?.some((mine) => sameKey(mine, key))
    )
    write(
      key,
      action.id,
      `${keyLabel(key)} runs “${action.title}” now` +
        (had ? `, not “${had.title}”` : "")
    )
  }

  useEffect(() => {
    escapeRef.current = () => {
      if (taking) setTaking(undefined)
      else if (acting !== undefined) setActing(undefined)
      else return false
      return true
    }
  }, [escapeRef, acting, taking])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (taking) return take(event, taking)
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    // The arrows and Enter work in the act list while it is open.
    if (step !== undefined) {
      event.preventDefault()
      if (acting !== undefined)
        setActing((acting + step + acts.length) % acts.length)
      else if (rows.length > 0)
        setIndex((active + step + rows.length) % rows.length)
      return
    }
    if (event.key === "Tab") {
      event.preventDefault()
      setActing(acting === undefined && acts.length > 0 ? 0 : undefined)
      return
    }
    if (event.key === "Backspace" && words === "" && path.length > 0) {
      event.preventDefault()
      restart(path.slice(0, -1))
      return
    }
    if (event.key !== "Enter") return
    event.preventDefault()
    if (acting !== undefined) return choose(acts[acting].row)
    // Alt+Enter starts a Thread with the words, whatever row is chosen;
    // another Enter does the row's act with that key, as Shift+Enter
    // opens a Thread beside.
    if (event.altKey) {
      if (query)
        onChoose({
          kind: "ask",
          id: "ask",
          words: query,
          ...(inside?.kind === "space" && { space: inside.space.id }),
        })
      return
    }
    const act = acts.find((one) => one.key && matches(event, one.key))
    if (act) choose(act.row)
    else if (current) choose(current)
  }

  return (
    <div className="relative flex max-h-[min(32rem,70vh)] flex-col">
      <div className="flex items-center gap-2 border-b px-3">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        {path.map((branch) => (
          <span
            key={branch.id}
            className="shrink-0 rounded-sm bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground"
          >
            {branchName(branch)}
          </span>
        ))}
        <input
          ref={field}
          autoFocus
          // Every key comes here while one is taken, the window's too.
          data-takes-keys={taking ? "" : undefined}
          value={taking ? "" : words}
          onChange={(event) => {
            setWords(event.currentTarget.value)
            setIndex(0)
            setActing(undefined)
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholderOf(taking, inside, at)}
          aria-label="Search"
          role="combobox"
          aria-expanded
          aria-controls="banda-menu-list"
          aria-activedescendant={current && optionId(current)}
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
      </div>
      {(note || problem || picker?.problem || adding || refused.length > 0) && (
        <div
          role="status"
          className="border-b px-3 py-1.5 text-xs text-muted-foreground"
        >
          {note ??
            problem ??
            picker?.problem ??
            (adding ? "Adding the Space…" : refused.join("; "))}
        </div>
      )}
      <SuggestionList
        id="banda-menu-list"
        aria-label="Banda menu"
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {groups.map((group) => (
          <div
            key={group.label || group.rows[0]?.id}
            role="group"
            aria-label={group.label || undefined}
          >
            {group.label && (
              <div className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
                {group.label}
              </div>
            )}
            {group.rows.map((row) => (
              <Suggestion
                key={row.id}
                id={optionId(row)}
                selected={row === current}
                onMouseMove={() => setIndex(rows.indexOf(row))}
                onClick={() => choose(row)}
                className="h-8 gap-2.5"
              >
                <RowView
                  row={row}
                  sources={sources}
                  inside={inside}
                  binds={binds}
                />
              </Suggestion>
            ))}
          </div>
        ))}
      </SuggestionList>
      {acting !== undefined && (
        <ActList
          acts={acts}
          chosen={acting}
          onHover={setActing}
          onChoose={(act) => choose(act.row)}
        />
      )}
      <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
        <KbdGroup>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          <span>Navigate</span>
        </KbdGroup>
        <KbdGroup>
          <Keys keyOf={OPEN} />
          <span>Open</span>
        </KbdGroup>
        {at === "root" && !inside && (
          <KbdGroup>
            <Keys keyOf={ASK} />
            <span>New Thread</span>
          </KbdGroup>
        )}
        <div className="ml-auto flex items-center gap-4">
          {isPathField(inside) && picker && (
            <button
              type="button"
              disabled={picker.busy || adding}
              onClick={() => void picker.pick()}
              className="hover:text-foreground disabled:opacity-50"
            >
              {PICK_FOLDER}
            </button>
          )}
          {acts.length > 0 && (
            <KbdGroup>
              <Kbd>Tab</Kbd>
              <span>Actions</span>
            </KbdGroup>
          )}
          {path.length > 0 && (
            <KbdGroup>
              <Kbd>⌫</Kbd>
              <span>Back</span>
            </KbdGroup>
          )}
          <KbdGroup>
            <Kbd>Esc</Kbd>
            <span>Close</span>
          </KbdGroup>
        </div>
      </div>
    </div>
  )
}

/** What can be done with the chosen row, over the list's corner. */
function ActList({
  acts,
  chosen,
  onHover,
  onChoose,
}: {
  acts: Act[]
  chosen: number
  onHover: (index: number) => void
  onChoose: (act: Act) => void
}) {
  return (
    <Suggestions className="absolute right-2 bottom-11 w-60">
      <SuggestionList aria-label="Actions">
        {acts.map((act, index) => (
          <Suggestion
            key={act.row.id + act.title}
            selected={index === chosen}
            onMouseMove={() => onHover(index)}
            onClick={() => onChoose(act)}
            className="h-7"
          >
            <span className="min-w-0 flex-1 truncate">{act.title}</span>
            {act.key && <Keys keyOf={act.key} />}
          </Suggestion>
        ))}
      </SuggestionList>
    </Suggestions>
  )
}

/** One row's words: what it is, then where it is or its key. */
function RowView({
  row,
  sources,
  inside,
  binds,
}: {
  row: Choice
  sources: Sources
  /** The Person's keys, which a row outlines. */
  binds: readonly Bind[]
  /** The branch the menu is in: a Space's rows leave out its name. */
  inside?: Branch
}) {
  switch (row.kind) {
    case "thread": {
      const { listed } = row
      const space =
        inside?.kind === "space"
          ? undefined
          : sources.spaces.find((one) => one.id === row.space)
      return (
        <>
          <ThreadMark listed={listed} />
          <span className="min-w-0 flex-1 truncate">{listed.title}</span>
          <Detail>
            {[space?.name, waits(listed.mark) && MARK_WORDS[listed.mark]]
              .filter(Boolean)
              .join(" · ")}
          </Detail>
        </>
      )
    }
    case "space":
      return (
        <>
          <SpaceBadge space={row.space} />
          <span className="min-w-0 flex-1 truncate">{row.space.name}</span>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </>
      )
    case "locate":
      return (
        <>
          <SpaceBadge space={row.space} />
          <span className="min-w-0 flex-1 truncate">{row.space.name}</span>
          <Detail>Folder missing · {LOCATE}</Detail>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </>
      )
    case "views":
      return (
        <>
          <ListFilterIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{branchName(row)}</span>
          <Detail>
            <span className="capitalize">{sources.presets.current}</span>
          </Detail>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </>
      )
    case "preset":
      return (
        <>
          <span className="min-w-0 flex-1 truncate capitalize">{row.name}</span>
          <Detail>{PRESET_WORDS[row.name] ?? "Your own preset"}</Detail>
          {row.current && <CheckIcon className="size-4 shrink-0" />}
        </>
      )
    case "action":
      return (
        <>
          <span className="min-w-0 flex-1 truncate">{row.action.title}</span>
          {row.action.keys?.map((key) => (
            <Keys
              key={keyText(key)}
              keyOf={key}
              bind={binds.find((bind) => sameKey(bind, key))}
            />
          ))}
        </>
      )
    case "family":
      return (
        <>
          <span className="min-w-0 flex-1 truncate">{row.title}</span>
          <FamilyKeys actions={row.actions} />
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </>
      )
    case "found": {
      const { icon, title, detail } = row.row
      return (
        <>
          {icon}
          <span className="min-w-0 truncate">{title}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {detail}
          </span>
        </>
      )
    }
    case "add":
      return (
        <>
          <FolderPlusIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{branchName(row)}</span>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </>
      )
    case "source": {
      const Icon = row.source === "new" ? PlusIcon : FolderOpenIcon
      return (
        <>
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{branchName(row)}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {SOURCES[row.source].about}
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </>
      )
    }
    case "adding": {
      const { how } = row
      const [title, detail] =
        "name" in how
          ? ["Create Space", how.name]
          : "locate" in how
            ? ["Locate", how.folder]
            : [how.create ? "Create & Add" : "Add", how.folder]
      const Icon = "locate" in how ? FolderSearchIcon : FolderPlusIcon
      return (
        <>
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0">{title}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {detail}
          </span>
        </>
      )
    }
    case "folder": {
      const Icon = row.up ? CornerLeftUpIcon : FolderIcon
      return (
        <>
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          {row.up && <Detail>{row.path}</Detail>}
        </>
      )
    }
    case "ask":
    case "archive":
    case "bind":
    case "free":
      return null
  }
}

/** The field's words before it is typed into. */
function placeholderOf(
  taking: Action<Shell> | undefined,
  inside: Branch | undefined,
  at: string
): string {
  if (taking) return `Press the keys for “${taking.title}”…`
  if (inside?.kind === "source" && inside.source === "new") return "Space name"
  if (isPathField(inside)) return PATH_PLACEHOLDER
  if (inside) return "Search…"
  return at === "actions"
    ? "Search actions…"
    : "Search actions, Spaces, Threads and files…"
}

const NO_ROWS: readonly MenuRow[] = []

function Detail({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 text-xs text-muted-foreground">{children}</span>
  )
}

/** A key as its caps: Alt, Shift, ↵. One the Person bound in keys.toml
 * is outlined, and says its line. */
function Keys({ keyOf, bind }: { keyOf: Key; bind?: Bind }) {
  return (
    <KbdGroup title={bind && `${KEYS_FILE}, line ${bind.line}`}>
      {keyCaps(keyOf).map((part) => (
        <Cap key={part} part={part} mine={!!bind} />
      ))}
    </KbdGroup>
  )
}

/** A family's keys at once: its mods, then each key, `1–9` for a run of
 * digits. None when they differ in their mods. */
function FamilyKeys({ actions }: { actions: readonly Action<Shell>[] }) {
  // Of the family's keys; an action with none, kept for keys.toml, adds
  // nothing.
  const keys = actions.flatMap((action) => action.keys?.[0] ?? [])
  const first = keys[0]
  if (!first || keys.some((key) => !sameKey(key, { ...first, code: key.code })))
    return null
  const mods = keyCaps(first).slice(0, -1)
  const names = keys.map((key) => keyCaps({ code: key.code }).join(""))
  const run =
    names.every((name, n) => name === String(Number(names[0]) + n)) &&
    names.length > 2
  return (
    <KbdGroup>
      {mods.map((mod) => (
        <Cap key={mod} part={mod} />
      ))}
      <Kbd>
        {run
          ? `${names[0]}–${names.at(-1)}`
          : names.map((name) => ARROWS[name] ?? name).join(" ")}
      </Kbd>
    </KbdGroup>
  )
}

const ARROWS: Record<string, string> = {
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
}

/** One cap: an arrow as its arrow, Return as ↵. */
function Cap({ part, mine }: { part: string; mine?: boolean }) {
  return (
    <Kbd className={mine ? "border-primary/60 text-foreground" : undefined}>
      {part === "Return" ? <CornerDownLeftIcon /> : (ARROWS[part] ?? part)}
    </Kbd>
  )
}
