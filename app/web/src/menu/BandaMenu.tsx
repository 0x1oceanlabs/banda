import { useEffect, useMemo, useRef, useState } from "react"
import type { Engine, SpaceId, SpaceSummary } from "@banda/contract"
import { useHarnesses, useSpaceFiles } from "@banda/agents-pane"
import { useAddressOf } from "@banda/browser-pane"
import { MARK_WORDS, waits } from "@banda/ui/components/banda-mark"
import { Dialog, DialogContent, DialogTitle } from "@banda/ui/components/dialog"
import { HarnessLogo } from "@banda/ui/components/harness-logo"
import { Kbd, KbdGroup } from "@banda/ui/components/kbd"
import {
  Suggestion,
  SuggestionList,
  Suggestions,
} from "@banda/ui/components/suggestions"
import { type Key, matches } from "@banda/ui/lib/keys"
import { nameAndFolder } from "@banda/ui/lib/paths"
import {
  CheckIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
  FileIcon,
  GlobeIcon,
  ListFilterIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react"
import { type Action, keyName } from "../actions/actions"
import type { Lists } from "../bar/Watches"
import { useLookSidebar } from "../look"
import type { Shell } from "../shell/actions"
import { SpaceBadge, ThreadMark } from "../sidebar/Row"
import { PRESET_WORDS } from "../sidebar/settings"
import { useIsSettled } from "../sidebar/settled"
import {
  type Act,
  actsOf,
  type At,
  type Branch,
  branchName,
  type Choice,
  isBranch,
  menuOf,
  OPEN,
  type Sources,
} from "./menu"
import { opened, useOpened, weightOf } from "./opened"

const ASK: Key = { code: "Enter", alt: true }

/**
 * The Banda menu (ADR 0017): one window in the middle that finds and runs
 * everything, opened by Alt+Space at its root or by Alt+K at its Actions.
 * It goes into branches itself; what else is chosen, the window runs.
 */
export function BandaMenu({
  at,
  onClose,
  onChoose,
  engine,
  space,
  lists,
  spaces,
  actions,
}: {
  /** Where it opens; closed when none. */
  at: At | null
  onClose: () => void
  /** Runs a chosen row, once the menu has closed. */
  onChoose: (row: Exclude<Choice, Branch>) => void
  engine: Engine
  /** The Space a new Thread starts in, whose Harnesses it can start on. */
  space: SpaceId
  lists: Lists
  spaces: readonly SpaceSummary[]
  actions: readonly Action<Shell>[]
}) {
  // Loaded while the menu is shut, so they are there as it opens.
  const harnesses = useHarnesses(engine, space)
  // Esc shuts the open act list before the menu.
  const escapeRef = useRef<() => boolean>(() => false)
  return (
    <Dialog
      open={at !== null}
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
        {at && (
          <Menu
            at={at}
            engine={engine}
            space={space}
            lists={lists}
            spaces={spaces}
            actions={actions}
            harnesses={harnesses}
            escapeRef={escapeRef}
            onChoose={(row) => {
              onClose()
              onChoose(row)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The menu while it is open: it starts empty, at its root, each time. */
function Menu({
  at,
  engine,
  space,
  lists,
  spaces,
  actions,
  harnesses,
  escapeRef,
  onChoose,
}: {
  at: At
  engine: Engine
  space: SpaceId
  lists: Lists
  spaces: readonly SpaceSummary[]
  actions: readonly Action<Shell>[]
  harnesses: Sources["harnesses"]
  escapeRef: React.RefObject<() => boolean>
  onChoose: (row: Exclude<Choice, Branch>) => void
}) {
  const { preset, presets } = useLookSidebar()
  const settled = useIsSettled()
  const addressOf = useAddressOf()
  const uses = useOpened()
  const [now] = useState(Date.now)
  const [words, setWords] = useState("")
  const [path, setPath] = useState<Branch[]>([])
  // The focused Space's files that fit the words, as `@` finds them.
  const query = words.trim()
  const lookFiles = at === "root" && path.length === 0 && query !== ""
  const found = useSpaceFiles(engine, space, lookFiles ? query : undefined)
  const paths = (lookFiles && found?.paths) || NO_PATHS
  const sources: Sources = useMemo(
    () => ({
      lists,
      spaces,
      actions,
      presets: { names: presets.map((one) => one.name), current: preset },
      harnesses,
      settled,
      files: { space, paths },
      addressOf,
      weight: (id) => weightOf(uses[id], now),
    }),
    [
      lists,
      spaces,
      actions,
      presets,
      preset,
      harnesses,
      settled,
      space,
      paths,
      addressOf,
      uses,
      now,
    ]
  )
  const [index, setIndex] = useState(0)
  // The row's acts that Tab shows, and the one chosen among them.
  const [acting, setActing] = useState<number>()
  const inside = path.at(-1)
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
    setWords("")
    setIndex(0)
    setActing(undefined)
  }
  // A branch opens in the menu; any other row runs. Either counts for
  // the order next time.
  const choose = (row: Choice) => {
    if (isBranch(row)) restart([...path, row])
    else onChoose(row)
    opened(row.id)
  }

  useEffect(() => {
    escapeRef.current = () => {
      if (acting === undefined) return false
      setActing(undefined)
      return true
    }
  }, [escapeRef, acting])

  const onKeyDown = (event: React.KeyboardEvent) => {
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
          autoFocus
          value={words}
          onChange={(event) => {
            setWords(event.currentTarget.value)
            setIndex(0)
            setActing(undefined)
          }}
          onKeyDown={onKeyDown}
          placeholder={
            inside
              ? "Search…"
              : at === "actions"
                ? "Search actions…"
                : "Search actions, Spaces, Threads and files…"
          }
          aria-label="Search"
          role="combobox"
          aria-expanded
          aria-controls="banda-menu-list"
          aria-activedescendant={current && optionId(current)}
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
      </div>
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
                <RowView row={row} sources={sources} inside={inside} />
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
}: {
  row: Choice
  sources: Sources
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
          {row.action.key && <Keys keyOf={row.action.key} />}
        </>
      )
    case "ask": {
      const harness =
        sources.harnesses.find((one) => one.id === row.harness) ??
        sources.harnesses[0]
      return (
        <>
          <HarnessLogo
            id={harness?.id}
            name={harness?.name ?? ""}
            className="size-4"
            fallback={<SquarePenIcon className="size-4 shrink-0" />}
          />
          <span className="min-w-0 flex-1 truncate">
            {row.words ? `New Thread: “${row.words}”` : "New Thread here"}
          </span>
          {harness && <Detail>{harness.name}</Detail>}
          {!row.space && <Keys keyOf={ASK} />}
        </>
      )
    }
    case "file": {
      const { name, folder } = nameAndFolder(row.path)
      return (
        <>
          <FileIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{name}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {folder}
          </span>
        </>
      )
    }
    case "web":
      return (
        <>
          <GlobeIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {row.address
              ? `Open ${row.words}`
              : `Search the web: “${row.words}”`}
          </span>
        </>
      )
    case "settle":
    case "copy":
      return null
  }
}

const NO_PATHS: string[] = []

function Detail({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 text-xs text-muted-foreground">{children}</span>
  )
}

/** A key as its caps: Alt, Shift, ↵. */
function Keys({ keyOf }: { keyOf: Key }) {
  return (
    <KbdGroup>
      {keyName(keyOf)
        .split("+")
        .map((part) => (
          <Kbd key={part}>
            {part === "Return" ? <CornerDownLeftIcon /> : part}
          </Kbd>
        ))}
    </KbdGroup>
  )
}
