/**
 * The branch row of a Thread's details and its picker (ADR 0034,
 * decision 4), as T3 Code's: the branch with how far it is ahead and
 * behind; pressed, a search over the branches here and on remotes in one
 * list, which switches to the one picked, and Create branch with the
 * words; the keys move the choice. A branch's right click copies its
 * name. Alt+Shift+G opens it in the focused Thread, as T3 Code's
 * Mod+Shift+G.
 */
import { useEffect, useId, useState } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type { Ref, Status } from "@banda/contract/git"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import { DropdownMenuItem } from "@banda/ui/components/dropdown-menu"
import { Input } from "@banda/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import {
  Suggestion,
  SuggestionList,
  SuggestionsEmpty,
} from "@banda/ui/components/suggestions"
import { DetailsRow } from "@banda/ui/components/thread-details"
import { useAct } from "@banda/ui/hooks/use-act"
import { ChevronDownIcon, GitBranchIcon, PlusIcon } from "lucide-react"

/** What Alt+Shift+G asks the focused Thread's card to open. */
export const PICKER = "git.branch"

export function BranchPicker({
  engine,
  space,
  status,
  asked,
  onOpened,
}: {
  engine: Engine
  space: SpaceId
  status: Status
  /** Alt+Shift+G asked for it: open until it closes, then `onOpened`. */
  asked: boolean
  onOpened: () => void
}) {
  const [own, setOwn] = useState(false)
  const open = own || asked
  const setOpen = (open: boolean) => {
    setOwn(open)
    if (!open && asked) onOpened()
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <DetailsRow
            icon={<GitBranchIcon />}
            title={status.upstream && `Follows ${status.upstream}`}
            end={
              <>
                <Distance ahead={status.ahead} behind={status.behind} />
                <ChevronDownIcon className="size-3.5 text-muted-foreground" />
              </>
            }
          >
            {status.branch ?? "Detached HEAD"}
          </DetailsRow>
        }
      />
      <PopoverContent align="start" className="w-72 gap-0 p-1">
        <Branches engine={engine} space={space} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

/** The engine lists at most this many branches of here's and of
 * remotes' each (`REFS`): a list that full may hold back some a search
 * would find, so then the engine searches. */
const LISTED = 100

/** The list, read once as it opens and searched here; drawn while it is
 * open. The keys move the choice from the field, as the Banda menu's. */
function Branches({
  engine,
  space,
  onDone,
}: {
  engine: Engine
  space: SpaceId
  onDone: () => void
}) {
  const [query, setQuery] = useState("")
  const words = query.trim()
  const [all, setAll] = useState<Ref[]>()
  const [found, setFound] = useState<{ words: string; refs: Ref[] }>()
  const [chosen, setChosen] = useState({ words: "", at: 0 })
  const acting = useAct()
  const id = useId()
  useEffect(() => {
    let current = true
    void engine
      .call("git.refs", {}, { space })
      .then((refs) => current && setAll(refs))
      .catch(() => current && setAll([]))
    return () => {
      current = false
    }
  }, [engine, space])
  const full =
    all !== undefined &&
    (all.filter((ref) => !ref.remote).length >= LISTED ||
      all.filter((ref) => ref.remote).length >= LISTED)
  useEffect(() => {
    if (!full || !words) return
    let current = true
    const asking = setTimeout(() => {
      void engine
        .call("git.refs", { query: words }, { space })
        .then((refs) => current && setFound({ words, refs }))
        .catch(() => undefined)
    }, 150)
    return () => {
      current = false
      clearTimeout(asking)
    }
  }, [engine, space, full, words])

  const lower = words.toLowerCase()
  const listed =
    found?.words === words
      ? found.refs
      : (all ?? []).filter((ref) => ref.name.toLowerCase().includes(lower))
  const taken = listed.some((ref) => !ref.remote && ref.name === words)
  const creates = words !== "" && !taken
  // Enter picks the first branch, or makes one of words no branch has.
  const choices = listed.length + (creates ? 1 : 0)
  const at = chosen.words === words ? chosen.at : creates ? listed.length : 0
  const act = async (run: () => Promise<unknown>) => {
    if ((await acting.act(run)) !== undefined) onDone()
  }
  const pick = (ref: Ref) => {
    if (acting.busy) return
    if (ref.current) onDone()
    else
      void act(() => engine.call("git.switch", { name: ref.name }, { space }))
  }
  const create = () => {
    if (!acting.busy)
      void act(() => engine.call("git.branch", { name: words }, { space }))
  }
  const choose = (at: number) => {
    const ref = listed[at]
    if (ref) pick(ref)
    else if (creates) create()
  }
  return (
    <div className="flex flex-col">
      <Input
        autoFocus
        value={query}
        placeholder="Search branches…"
        aria-label="Search branches"
        aria-controls={`${id}-list`}
        aria-activedescendant={choices > 0 ? `${id}-${at}` : undefined}
        className="mb-1 h-8"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
          if (step && choices > 0) {
            event.preventDefault()
            setChosen({ words, at: (at + step + choices) % choices })
          } else if (event.key === "Enter") {
            event.preventDefault()
            choose(at)
          }
        }}
      />
      <SuggestionList
        id={`${id}-list`}
        className="max-h-64 overflow-y-auto aria-busy:opacity-50"
        aria-busy={acting.busy}
      >
        {listed.map((ref, i) => {
          const tag = ref.current
            ? "current"
            : ref.default
              ? "default"
              : ref.remote
                ? "remote"
                : undefined
          return (
            <ContextMenu key={`${ref.remote}:${ref.name}`}>
              <ContextMenuTrigger
                render={
                  <Suggestion
                    id={`${id}-${i}`}
                    selected={i === at}
                    onClick={() => pick(ref)}
                  />
                }
              >
                <span className="min-w-0 flex-1 truncate">{ref.name}</span>
                {tag && (
                  <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                    {tag}
                  </span>
                )}
              </ContextMenuTrigger>
              <ContextMenuContent>
                <DropdownMenuItem
                  onClick={() => void navigator.clipboard.writeText(ref.name)}
                >
                  Copy branch name
                </DropdownMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
        {creates && (
          <Suggestion
            id={`${id}-${listed.length}`}
            selected={at === listed.length}
            className="mt-1 border-t"
            onClick={create}
          >
            <PlusIcon className="size-4 shrink-0" />
            <span className="truncate">Create branch “{words}”</span>
          </Suggestion>
        )}
        {all && choices === 0 && (
          <SuggestionsEmpty>No branches yet.</SuggestionsEmpty>
        )}
      </SuggestionList>
      {acting.problem && (
        <p role="alert" className="px-2 pt-1 text-xs text-destructive">
          {acting.problem}
        </p>
      )}
      <p className="px-2 pt-1.5 pb-0.5 text-[11px] text-muted-foreground">
        {listed.length === 1 ? "1 branch" : `${listed.length} branches`}
      </p>
    </div>
  )
}

/** `↑2 ↓3`: the commits the upstream lacks, and those it has. */
function Distance({ ahead, behind }: { ahead?: number; behind?: number }) {
  if (!ahead && !behind) return null
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {[ahead && `↑${ahead}`, behind && `↓${behind}`].filter(Boolean).join(" ")}
    </span>
  )
}
