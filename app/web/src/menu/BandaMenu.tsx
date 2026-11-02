import { useEffect, useMemo, useRef, useState } from "react"
import type { Engine, SpaceId, SpaceSummary } from "@banda/contract"
import type { Bind } from "@banda/contract/look"
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
import { useWrite } from "@banda/ui/hooks/use-write"
import { type Key, keyToBind, matches, sameKey } from "@banda/ui/lib/keys"
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
import { type Action, KEYS_FILE, keyName, writeBind } from "../actions/actions"
import type { Lists } from "../bar/Watches"
import { useLookSidebar } from "../look"
import type { Shell } from "../shell/actions"
import { SpaceBadge, ThreadMark } from "../sidebar/Row"
import { PRESET_WORDS } from "../sidebar/settings"
import { useIsSettled } from "../sidebar/settled"
import {
  type Act,
  actsOf,
  type Branch,
  branchName,
  type Choice,
  isBranch,
  isKeying,
  type Keying,
  menuOf,
  OPEN,
  type Opening,
  type Sources,
} from "./menu"
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
  engine,
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
  onChoose: (row: Exclude<Choice, Branch | Keying>) => void
  engine: Engine
  /** The Space a new Thread starts in, whose Harnesses it can start on. */
  space: SpaceId
  lists: Lists
  spaces: readonly SpaceSummary[]
  actions: readonly Action<Shell>[]
  /** The Person's keys in force, from keys.toml. */
  binds: readonly Bind[]
}) {
  // Loaded while the menu is shut, so they are there as it opens.
  const all = useHarnesses(engine, space)
  // A Harness turned off starts no new Thread.
  const harnesses = useMemo(() => all.filter((h) => h.enabled), [all])
  // Esc shuts the open act list before the menu.
  const escapeRef = useRef<() => boolean>(() => false)
  return (
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
            opening={opening}
            engine={engine}
            space={space}
            lists={lists}
            spaces={spaces}
            actions={actions}
            binds={binds}
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

/** The menu while it is open: it starts where it is opened, each time. */
function Menu({
  opening,
  engine,
  space,
  lists,
  spaces,
  actions,
  binds,
  harnesses,
  escapeRef,
  onChoose,
}: {
  opening: Opening
  engine: Engine
  space: SpaceId
  lists: Lists
  spaces: readonly SpaceSummary[]
  actions: readonly Action<Shell>[]
  /** The Person's keys in force, from keys.toml. */
  binds: readonly Bind[]
  harnesses: Sources["harnesses"]
  escapeRef: React.RefObject<() => boolean>
  onChoose: (row: Exclude<Choice, Branch | Keying>) => void
}) {
  const { preset, presets } = useLookSidebar()
  const settled = useIsSettled()
  const addressOf = useAddressOf()
  const uses = useOpened()
  const [now] = useState(Date.now)
  const { at } = opening
  const [words, setWords] = useState(opening.words)
  const [path, setPath] = useState<Branch[]>(opening.path)
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
  // The action that waits for a key to bind, and what the last change
  // of the keys did.
  const [taking, setTaking] = useState<Action<Shell>>()
  const [note, setNote] = useState<string>()
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
  // Writes `key` to keys.toml, bound to `action` or freed; the look
  // brings the change back. What it did shows once it is written, and a
  // key refused leaves the action waiting for another.
  const done = useRef("")
  const { refused, write: writing } = useWrite(() => {
    setTaking(undefined)
    setNote(done.current)
  })
  const write = (key: Key, action: string, did: string) => {
    done.current = did
    setNote(undefined)
    writing(writeBind(key, action))
  }
  const keying = (row: Keying) => {
    setActing(undefined)
    if (row.kind === "bind") {
      setTaking(row.action)
      setNote(undefined)
      return
    }
    write(row.key, "none", `${keyName(row.key)} goes to the Pane now`)
  }
  // A branch opens in the menu, and the keys change in it; any other row
  // runs. Each counts for the order next time.
  const choose = (row: Choice) => {
    if (isBranch(row)) restart([...path, row])
    else if (isKeying(row)) keying(row)
    else onChoose(row)
    opened(row.id)
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
      `${keyName(key)} runs “${action.title}” now` +
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
          placeholder={
            taking
              ? `Press the keys for “${taking.title}”…`
              : inside
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
      {(note || refused.length > 0) && (
        <div
          role="status"
          className="border-b px-3 py-1.5 text-xs text-muted-foreground"
        >
          {note ?? refused.join("; ")}
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
              key={keyName(key)}
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
    case "bind":
    case "free":
      return null
  }
}

const NO_PATHS: string[] = []

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
      {keyName(keyOf)
        .split("+")
        .map((part) => (
          <Cap key={part} part={part} mine={!!bind} />
        ))}
    </KbdGroup>
  )
}

/** A family's keys at once: its mods, then each key, `1–9` for a run of
 * digits. None when they differ in their mods. */
function FamilyKeys({ actions }: { actions: readonly Action<Shell>[] }) {
  const keys = actions.map((action) => action.keys?.[0])
  const first = keys[0]
  if (
    !first ||
    keys.some((key) => !key || !sameKey(key, { ...first, code: key.code }))
  )
    return null
  const parts = keyName(first).split("+")
  const mods = parts.slice(0, -1)
  const names = keys.map((key) => (key ? keyName({ code: key.code }) : ""))
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
