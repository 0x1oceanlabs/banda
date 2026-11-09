import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type { Bind } from "@banda/contract/look"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { MARK_WORDS, waits } from "@banda/ui/components/banda-mark"
import { MachineIcon, MachineMark } from "@banda/ui/components/machine-icon"
import { Dialog, DialogContent, DialogTitle } from "@banda/ui/components/dialog"
import { Kbd, KbdGroup } from "@banda/ui/components/kbd"
import { Switch } from "@banda/ui/components/switch"
import {
  Suggestion,
  SuggestionList,
  Suggestions,
} from "@banda/ui/components/suggestions"
import { useAct } from "@banda/ui/hooks/use-act"
import { useWrite } from "@banda/ui/hooks/use-write"
import { seenNamed } from "@banda/ui/hooks/use-status"
import {
  type Key,
  keyCaps,
  keyLabel,
  keyText,
  keyToBind,
  matches,
  sameKey,
} from "@banda/ui/lib/keys"
import {
  type Here,
  namedIn,
  type Shown,
  useHere,
  useHosts,
} from "@banda/core/react"
import type { Action, MenuAt, MenuRow, Source } from "@banda/ui/module"
import {
  BadgeCheckIcon,
  BoxIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  CornerDownLeftIcon,
  CornerLeftUpIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  GitBranchIcon,
  ListFilterIcon,
  type LucideIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"
import { KEYS_FILE, writeBind } from "../actions/actions"
import { paneHost } from "@banda/ui/pane"
import { useLists } from "../calls/stores"
import { useLookSidebar } from "../look"
import { runs, sources as allSources } from "../registry"
import type { Shell } from "../window/actions"
import { ThreadMark } from "@banda/ui/components/banda-mark"
import { PRESET_WORDS } from "../sidebar/settings"
import { useIsArchived } from "../sidebar/archived"
import { itemActionsOf } from "../sidebar/items"
import {
  type Act,
  actsOf,
  type Adding,
  back,
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
  restarted,
  LOCATE,
  lookedAt,
  pathAdding,
  trustBranch,
} from "./menu"
import {
  PATH_PLACEHOLDER,
  PICK_FOLDER,
  useBrowsed,
  usePickFolder,
} from "./browse"
import { opened, useOpened, weightOf } from "./opened"
import { Soon, Waits } from "../trust/TrustCard"
import { ASK, ASK_ABOUT, askedOf, ISOLATED } from "../trust/trust"
import { useKeyOf } from "@banda/ui/hooks/use-key-of"

/**
 * The Banda menu (ADR 0017): one window in the middle that finds and runs
 * everything, opened by Alt+Space at its root, by Alt+K at its Actions,
 * or by `banda menu` at a route. It goes into branches itself; what else
 * is chosen, the window runs. Drawn again only as its own props change:
 * what the Apps list it reads only while open.
 */
export const BandaMenu = memo(function BandaMenu({
  opening,
  onClose,
  onChoose,
  onAdded,
  engine,
  modules,
  snoozeNow,
  projects,
  actions,
  binds,
}: {
  /** Where it opens; closed when none. */
  opening: Opening | null
  onClose: () => void
  /** Runs a chosen row, once the menu has closed. */
  onChoose: (row: Exclude<Choice, Branch | Own>) => void
  /** Hears a Project the menu added, once it has closed (ADR 0026). */
  onAdded: (project: ProjectSummary) => void
  engine: Engine
  /** The modules the engine runs: the sources of the others find nothing. */
  modules: readonly string[]
  /** The clock a Thread's snooze is read by (ADR 0074): the window's. */
  snoozeNow: number
  projects: readonly ProjectSummary[]
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
        id: source.id,
        label: source.label,
        rows: rows[source.id] ?? NO_ROWS,
      })),
    [running, rows]
  )
  // The sources look in the Project the Person is in, or the one gone into.
  const project = useHere(projectOf)
  const at: MenuAt = useMemo(() => {
    const where = looking.entered ?? project
    return {
      engine,
      project: where,
      folder: projects.find((one) => one.id === where)?.folder,
      entered: looking.entered !== undefined,
      ...(looking.only && { only: looking.only }),
    }
  }, [engine, project, projects, looking.entered, looking.only])
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
          at={at}
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
              snoozeNow={snoozeNow}
              projects={projects}
              actions={actions}
              binds={binds}
              found={found}
              onLooking={setLooking}
              escapeRef={escapeRef}
              onChoose={(row) => {
                onClose()
                onChoose(row)
              }}
              onAdded={(project) => {
                onClose()
                onAdded(project)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
})

/** The other machines whose names fit `query`, as a source's rows under
 * "Machines" (ADR 0095, decision 8): choosing one opens its row in
 * Settings → Machines. None when none fits. */
function machinesFound(
  hosts: readonly Shown[],
  query: string
): Found | undefined {
  const words = query.toLowerCase()
  const rows: MenuRow[] = hosts
    .filter(({ named }) => named.name.toLowerCase().includes(words))
    .map(({ name, named }) => ({
      id: `machines.${name}`,
      title: named.name,
      detail: "Machine settings",
      icon: (
        <MachineIcon
          icon={named.icon}
          size={14}
          className="text-muted-foreground"
        />
      ),
      run: (api) => api.run("settings.open", { link: `machines/${name}` }),
    }))
  return rows.length > 0
    ? { id: "machines", label: "Machines", rows }
    : undefined
}

/** One source, finding for the menu; what it found leaves with it. */
function Finder({
  source,
  words,
  at,
  hear,
}: {
  source: Source
  words: string
  at: MenuAt
  hear: (id: string, rows?: readonly MenuRow[]) => void
}) {
  const { id, Find } = source
  const found = useCallback(
    (rows: readonly MenuRow[]) => hear(id, rows),
    [hear, id]
  )
  useEffect(() => () => hear(id), [hear, id])
  return <Find words={words} at={at} found={found} />
}

/** The Project the Person is in, as Here says it. */
const projectOf = (here: Here) => here.project

/** What the menu looks for: the words typed at its root, or the Project it
 * went into, or in one source alone. */
type Looking = { words: string; entered?: ProjectId; only?: string }

const NOWHERE: Looking = { words: "" }

/** The menu while it is open: it starts where it is opened, each time. */
function Menu({
  engine,
  opening,
  snoozeNow,
  projects,
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
  snoozeNow: number
  projects: readonly ProjectSummary[]
  actions: readonly Action<Shell>[]
  /** The Person's keys in force, from keys.toml. */
  binds: readonly Bind[]
  /** What the sources found for what it looks for. */
  found: readonly Found[]
  onLooking: (looking: Looking) => void
  escapeRef: React.RefObject<() => boolean>
  onChoose: (row: Exclude<Choice, Branch | Own>) => void
  onAdded: (project: ProjectSummary) => void
}) {
  const lists = useLists()
  const hosts = useHosts()
  // New Thread's key in force starts one with the words.
  const ask = useKeyOf()("thread.new")
  const { preset, presets } = useLookSidebar()
  const archived = useIsArchived()
  const uses = useOpened()
  const [now] = useState(Date.now)
  const { at } = opening
  const [words, setWords] = useState(opening.words)
  const [path, setPath] = useState<Branch[]>(opening.path)
  const query = words.trim()
  // The sources look for the words at the root, and in a Project gone into.
  const inside = path.at(-1)
  const entered = inside?.kind === "project" ? inside.project.id : undefined
  const atRoot = at === "root" && path.length === 0
  // Before the paint, so no row is drawn for the words before.
  const only = inside?.kind === "finds" ? inside.source : undefined
  useLayoutEffect(
    () =>
      onLooking(
        entered
          ? { words: query, entered }
          : only
            ? { words: query, only }
            : atRoot
              ? { words: query }
              : NOWHERE
      ),
    [onLooking, entered, only, atRoot, query]
  )
  useEffect(() => () => onLooking(NOWHERE), [onLooking])
  // The path field's folders, from the engine, as the path is typed.
  const browsed = useBrowsed(engine, isPathField(inside) ? words : undefined)
  // The other machines whose names fit the words, at the root.
  const machines = useMemo(
    () => (atRoot && query ? machinesFound(hosts, query) : undefined),
    [atRoot, query, hosts]
  )
  const sources: Sources = useMemo(
    () => ({
      lists,
      projects,
      actions,
      presets: { names: presets.map((one) => one.name), current: preset },
      archived,
      now: snoozeNow,
      items: itemActionsOf,
      found: machines ? [...found, machines] : found,
      weight: (id) => weightOf(uses[id], now),
      browsed,
    }),
    [
      lists,
      projects,
      actions,
      presets,
      preset,
      archived,
      snoozeNow,
      found,
      machines,
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

  const restart = (next: Branch[], typed = wordsIn(next)) => {
    setPath(next)
    setWords(typed)
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
  const write = (key: Key, action: Action<Shell>, did: string, to?: string) => {
    done.current = did
    setNote(undefined)
    writing(writeBind({ ...key, scope: action.scope }, to ?? action.id))
  }
  // A Project added here opens its new Thread, as the menu closes; what the
  // engine refused shows, and the field stays as it was. A folder on disk,
  // there or to be made, that looks foreign asks first, here, whether the
  // Person trusts it (ADR 0083, decision 5; ADR 0084, decision 13). One
  // that does not, or already is a Project, is added with no word of its
  // trust: the engine trusts the Person's own, and a Project keeps its own.
  const { busy: adding, problem, act } = useAct()
  const { busy: lookingIn, problem: unseen, act: lookIn } = useAct()
  const field = useRef<HTMLInputElement>(null)
  const add = async (how: Adding) => {
    if (adding || lookingIn) return
    setNote(undefined)
    const folder = lookedAt(how)
    if (folder) {
      const foreign = await lookIn(() =>
        engine.call("projects.foreign", { folder: folder.folder })
      )
      if (!foreign) return
      if (foreign.foreign && !foreign.project) {
        restart([...path, trustBranch(folder, foreign)], "")
        field.current?.focus()
        return
      }
    }
    const project = await act(() =>
      "name" in how
        ? engine.command("projects.create", { name: how.name })
        : "locate" in how
          ? engine.command("projects.locate", {
              project: how.locate,
              folder: how.folder,
            })
          : engine.command("projects.add", how)
    )
    if (project) onAdded(project)
  }
  // The system's folder picker: the folder picked is added at once, as
  // T3 Code does; the field takes the keys back when it is cancelled.
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
          row.action,
          `${keyLabel(row.key)} goes to the Pane now`,
          "none"
        )
      case "folder":
        setWords(row.path)
        setIndex(0)
        return
      case "adding":
      case "answer":
        return void add(row.how)
    }
  }
  // A branch opens in the menu, and the menu does its own rows; any other
  // row runs. Each counts for the order next time, but a folder or a Project
  // to add, which are the Person's own.
  const choose = (row: Choice) => {
    if (isBranch(row)) restart([...path, row])
    else if (isOwn(row)) own(row)
    else onChoose(row)
    if (row.kind !== "folder" && row.kind !== "adding" && row.kind !== "answer")
      opened(row.id)
  }

  // The key pressed while an action waits for one: bound to it, unless
  // the desktop's; `banda settings` refuses one that would be typed.
  const take = (event: React.KeyboardEvent, action: Action<Shell>) => {
    event.preventDefault()
    if (event.key === "Escape") return
    const key = keyToBind(event)
    if (!key) return
    const had = actions.find(
      (one) =>
        one !== action &&
        one.scope === action.scope &&
        one.keys?.some((mine) => sameKey(mine, key))
    )
    write(
      key,
      action,
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
      const went = back(path)
      restart(went.path, went.words)
      return
    }
    const asking = ask !== undefined && matches(event, ask)
    if (event.key !== "Enter" && !asking) return
    event.preventDefault()
    if (acting !== undefined) return choose(acts[acting].row)
    // New Thread's key starts a Thread with the words, whatever row is
    // chosen; another Enter does the row's act with that key, as
    // Shift+Enter opens a Thread beside.
    if (asking) {
      if (query)
        onChoose({
          kind: "ask",
          id: "ask",
          words: query,
          ...(inside?.kind === "project" && { project: inside.project.id }),
        })
      return
    }
    const act = acts.find((one) => one.key && matches(event, one.key))
    if (act) choose(act.row)
    else if (current) choose(current)
  }

  // The question a folder that looks foreign asks, and why.
  const asked = inside?.kind === "trust" ? askedOf(inside.foreign) : undefined
  const said =
    note ??
    problem ??
    unseen ??
    picker?.problem ??
    (lookingIn
      ? "Looking at the folder…"
      : adding
        ? "Adding the Project…"
        : refused.length > 0
          ? refused.join("; ")
          : undefined)
  const From = asked?.from ? GitBranchIcon : FileIcon
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
            const typed = event.currentTarget.value
            // Only what is typed or pasted starts it over: a part taken
            // out of the middle leaves `//` for a moment.
            const added = typed.length > words.length
            setWords(isPathField(inside) && added ? restarted(typed) : typed)
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
      {(said || asked?.line) && (
        <div
          role="status"
          className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground"
        >
          {said ?? (
            <>
              <From className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{asked?.line}</span>
            </>
          )}
        </div>
      )}
      {asked && (
        <div className="flex flex-col gap-1 px-3.5 pt-3">
          <h3 className="text-[15px] font-semibold">{ASK}</h3>
          <p className="mb-1 text-xs text-muted-foreground">{ASK_ABOUT}</p>
          <Waits waits={asked.waits} />
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
                className={row.kind === "answer" ? "gap-2.5" : "h-8 gap-2.5"}
              >
                <RowView
                  row={row}
                  sources={sources}
                  hosts={hosts}
                  inside={inside}
                  binds={binds}
                />
              </Suggestion>
            ))}
          </div>
        ))}
      </SuggestionList>
      {asked && <Isolated cloned={asked.cloned} />}
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
          <span>{asked ? "Choose" : "Open"}</span>
        </KbdGroup>
        {at === "root" && !inside && ask && (
          <KbdGroup>
            <Keys keyOf={ask} />
            <span>New Thread</span>
          </KbdGroup>
        )}
        <div className="ml-auto flex items-center gap-4">
          {isPathField(inside) && picker && (
            <button
              type="button"
              disabled={picker.busy || adding || lookingIn}
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
  hosts,
  inside,
  binds,
}: {
  row: Choice
  sources: Sources
  /** The other machines, which name another machine's Threads. */
  hosts: readonly Shown[]
  /** The Person's keys, which a row outlines. */
  binds: readonly Bind[]
  /** The branch the menu is in: a Project's rows leave out its name. */
  inside?: Branch
}) {
  switch (row.kind) {
    case "thread": {
      const { listed } = row
      // Another machine's names its Project and then that machine (ADR
      // 0095, decision 8): "banda ▭ arc · waits".
      const host = paneHost(listed.pane)
      const there =
        host === undefined ? undefined : namedIn(hosts, host, seenNamed)
      const listing =
        host === undefined
          ? sources.projects
          : hosts.find((one) => one.name === host)?.projects
      const project =
        inside?.kind === "project"
          ? undefined
          : listing?.find((one) => one.id === row.project)
      const waiting = waits(listed.mark) && MARK_WORDS[listed.mark]
      return (
        <>
          <ThreadMark listed={listed} />
          <span className="min-w-0 flex-1 truncate">{listed.title}</span>
          <Detail>
            {there ? (
              <span className="flex items-center gap-1">
                {project && <span>{project.name}</span>}
                <MachineMark named={there} form="compact" />
                {waiting && <span>· {waiting}</span>}
              </span>
            ) : (
              [project?.name, waiting].filter(Boolean).join(" · ")
            )}
          </Detail>
        </>
      )
    }
    case "project":
      return (
        <>
          <ProjectSign project={row.project} />
          <span className="min-w-0 flex-1 truncate">{row.project.name}</span>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </>
      )
    case "locate":
      return (
        <>
          <ProjectSign project={row.project} />
          <span className="min-w-0 flex-1 truncate">{row.project.name}</span>
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
    case "answer":
      return (
        <TwoLines
          icon={row.how.trusted ? BadgeCheckIcon : CircleDashedIcon}
          {...row.answer}
        />
      )
    case "adding": {
      const { how } = row
      const [title, detail] =
        "name" in how
          ? ["Create Project", how.name]
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
    case "item":
    case "bind":
    case "free":
      return null
  }
}

/** A row of the question: its icon, then its title over a quiet line. */
function TwoLines({
  icon: Icon,
  title,
  about,
}: {
  icon: LucideIcon
  title: string
  about: string
}) {
  return (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{about}</span>
      </span>
    </>
  )
}

/** Running the Project isolated, under the question: greyed until it is
 * built, on for a clone from a URL as it will be (ADR 0084, decision
 * 13). It is no answer, so the keys pass it by. */
function Isolated({ cloned }: { cloned: boolean }) {
  return (
    <div className="mx-1.5 mb-1.5 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground">
      <TwoLines
        icon={BoxIcon}
        title={ISOLATED.title}
        about={cloned ? `${ISOLATED.about} ${ISOLATED.cloned}` : ISOLATED.about}
      />
      <Soon />
      <Switch label={ISOLATED.title} on={cloned} disabled />
    </div>
  )
}

/** The field's words before it is typed into. */
function placeholderOf(
  taking: Action<Shell> | undefined,
  inside: Branch | undefined,
  at: string
): string {
  if (taking) return `Press the keys for “${taking.title}”…`
  if (inside?.kind === "source" && inside.source === "new")
    return "Project name"
  if (isPathField(inside)) return PATH_PLACEHOLDER
  if (inside?.kind === "trust") return inside.how.folder
  if (inside) return "Search…"
  return at === "actions"
    ? "Search actions…"
    : "Search actions, Projects, Threads and files…"
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
