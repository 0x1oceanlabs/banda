import { useEffect, useMemo, useState } from "react"
import type { Engine, SpaceId, SpaceSummary } from "@banda/contract"
import type { HarnessView } from "@banda/contract/agents"
import { useHarnesses } from "@banda/agents-pane"
import { MARK_WORDS, waits } from "@banda/ui/components/banda-mark"
import { Dialog, DialogContent, DialogTitle } from "@banda/ui/components/dialog"
import { HarnessLogo } from "@banda/ui/components/harness-logo"
import { Kbd, KbdGroup } from "@banda/ui/components/kbd"
import { Suggestion, SuggestionList } from "@banda/ui/components/suggestions"
import type { Key } from "@banda/ui/lib/keys"
import { CornerDownLeftIcon, SearchIcon, SquarePenIcon } from "lucide-react"
import { type Action, keyName } from "../actions/actions"
import type { Lists } from "../bar/Watches"
import type { Shell } from "../shell/actions"
import { SpaceBadge, ThreadMark } from "../sidebar/Row"
import { type At, type Choice, menuOf } from "./menu"

const OPEN: Key = { code: "Enter" }
const ASK: Key = { code: "Enter", alt: true }

/**
 * The Banda menu (ADR 0017): one window in the middle that finds and runs
 * everything, opened by Alt+Space at its root or by Alt+K at its Actions.
 * It only says what was chosen; the window runs it.
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
  onChoose: (row: Choice) => void
  engine: Engine
  /** The Space a new Thread starts in, whose first Harness it starts on. */
  space: SpaceId
  lists: Lists
  spaces: readonly SpaceSummary[]
  actions: readonly Action<Shell>[]
}) {
  const harness = useHarnesses(engine, space)[0]
  return (
    <Dialog open={at !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Banda menu</DialogTitle>
        {at && (
          <Menu
            at={at}
            harness={harness}
            lists={lists}
            spaces={spaces}
            actions={actions}
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

/** The menu while it is open: it starts empty each time. */
function Menu({
  at,
  harness,
  lists,
  spaces,
  actions,
  onChoose,
}: {
  at: At
  harness?: HarnessView
  lists: Lists
  spaces: readonly SpaceSummary[]
  actions: readonly Action<Shell>[]
  onChoose: (row: Choice) => void
}) {
  const [words, setWords] = useState("")
  const [index, setIndex] = useState(0)
  const groups = useMemo(
    () => menuOf({ words, at, lists, spaces, actions }),
    [words, at, lists, spaces, actions]
  )
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups])
  const active = Math.min(index, rows.length - 1)
  const current = rows[active]
  const optionId = (row: Choice) => `banda-menu-${row.id}`
  useEffect(() => {
    if (current)
      document
        .getElementById(optionId(current))
        ?.scrollIntoView({ block: "nearest" })
  }, [current])

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (step !== undefined && rows.length > 0) {
      event.preventDefault()
      setIndex((active + step + rows.length) % rows.length)
      return
    }
    if (event.key !== "Enter") return
    event.preventDefault()
    // Alt+Enter starts a Thread with the words, whatever row is chosen.
    const ask = words.trim()
    if (event.altKey) {
      if (ask) onChoose({ kind: "ask", id: "ask", words: ask })
    } else if (current) onChoose(current)
  }

  return (
    <div className="flex max-h-[min(32rem,70vh)] flex-col">
      <div className="flex items-center gap-2 border-b px-3">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={words}
          onChange={(event) => {
            setWords(event.currentTarget.value)
            setIndex(0)
          }}
          onKeyDown={onKeyDown}
          placeholder={
            at === "actions"
              ? "Search actions…"
              : "Search actions, Spaces and Threads…"
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
            key={group.label || "fallback"}
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
                onClick={() => onChoose(row)}
                className="h-8 gap-2.5"
              >
                <RowView row={row} spaces={spaces} harness={harness} />
              </Suggestion>
            ))}
          </div>
        ))}
      </SuggestionList>
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
        {at === "root" && (
          <KbdGroup>
            <Keys keyOf={ASK} />
            <span>New Thread</span>
          </KbdGroup>
        )}
        <KbdGroup className="ml-auto">
          <Kbd>Esc</Kbd>
          <span>Close</span>
        </KbdGroup>
      </div>
    </div>
  )
}

/** One row's words: what it is, then where it is or its key. */
function RowView({
  row,
  spaces,
  harness,
}: {
  row: Choice
  spaces: readonly SpaceSummary[]
  harness?: HarnessView
}) {
  switch (row.kind) {
    case "thread": {
      const { listed } = row
      const space = spaces.find((one) => one.id === row.space)
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
          <Detail>New Thread here</Detail>
        </>
      )
    case "action":
      return (
        <>
          <span className="min-w-0 flex-1 truncate">{row.action.title}</span>
          {row.action.key && <Keys keyOf={row.action.key} />}
        </>
      )
    case "ask":
      return (
        <>
          <HarnessLogo
            id={harness?.id}
            name={harness?.name ?? ""}
            className="size-4"
            fallback={<SquarePenIcon className="size-4 shrink-0" />}
          />
          <span className="min-w-0 flex-1 truncate">
            New Thread: “{row.words}”
          </span>
          {harness && <Detail>{harness.name}</Detail>}
          <Keys keyOf={ASK} />
        </>
      )
  }
}

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
