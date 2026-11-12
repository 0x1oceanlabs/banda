import {
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
  useState,
} from "react"
import type { Engine, ProjectSummary } from "@banda/contract"
import { Kbd } from "@banda/ui/components/kbd"
import { useKeyOf } from "@banda/ui/hooks/use-key-of"
import { keyCaps } from "@banda/ui/lib/keys"
import { cn } from "@banda/ui/lib/utils"
import { SearchIcon } from "lucide-react"
import { NewThreadMenu } from "./NewThreadMenu"
import { type Filter, typing } from "./search"
import { HINT, SearchHint } from "./SearchHint"

/** The list's id, which Search controls, and Search's own. */
export const LIST = "sb-list"
const SEARCH = "sb-search"

/** What Search is given (ADR 0098, decision 17): what it says and how it
 * says more, the field the keys focus, its keys on the list's pick, and
 * what its hint offers after each filter. */
export type SearchField = {
  text: string
  say: (text: string) => void
  field: RefObject<HTMLInputElement | null>
  onFocus: (event: FocusEvent<HTMLInputElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  values: Readonly<Record<Filter, readonly string[]>>
}

/**
 * Alt+Space's way to Search (ADR 0017, decision 1, as ADR 0098's decision
 * 17 amends it): with the sidebar shown, the key focuses its Search; there
 * already with nothing typed, or from a dialog, it is the Banda menu's, as
 * it is with the sidebar hidden. Whether Search took it.
 */
export function toSearch(): boolean {
  const field = document.getElementById(SEARCH)
  if (!(field instanceof HTMLInputElement)) return false
  const at = document.activeElement
  if (at?.closest("[role=dialog], [role=alertdialog]")) return false
  if (at === field && field.value === "") return false
  field.focus()
  return true
}

/** The key that takes the focus to Search, Alt+Space's, as the keymap has
 * it: shown under the pointer, by plain `:hover`, not Tailwind's, which
 * asks for (hover: hover), as the cards' acts. */
function SearchKey() {
  const key = useKeyOf()("menu.open")
  if (!key) return null
  return (
    <Kbd className="h-4.5 px-0.5 opacity-0 transition-opacity group-[:hover]/search:opacity-100">
      {keyCaps(key).join(" ")}
    </Kbd>
  )
}

/**
 * The sidebar's header (ADR 0098, decisions 17 and 19): Search, a quiet
 * field with no frame, its key shown under the pointer, which filters the
 * list in place and moves its pick, a combobox of the list; and ✎, which
 * starts a Thread where the Person is, as Alt+Enter starts one
 * (`Here.starts`), or, by its menu, elsewhere. While a search runs ✎ goes, as in concept-v7. The hint
 * of the filters shows in an empty field and as one is typed. The Flow
 * went to the bar (decision 20): it arranges the desk, not the list.
 */
export function Header({
  engine,
  projects,
  search: { field, ...search },
}: {
  /** This machine's engine. */
  engine: Engine
  projects: ProjectSummary[]
  search: SearchField
}) {
  const [focused, setFocused] = useState(false)
  const searching = search.text.trim() !== ""
  const hinting = focused && (!searching || typing(search.text) !== undefined)
  return (
    <div className="relative flex items-center gap-0.5 px-2 pt-2 pb-1">
      <label
        className={cn(
          "group/search mr-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-control px-2 text-ui text-muted-foreground/70 transition-colors",
          focused || searching
            ? "bg-foreground/8 text-foreground"
            : "hover:bg-foreground/5 hover:text-muted-foreground"
        )}
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <input
          id={SEARCH}
          ref={field}
          type="text"
          role="combobox"
          aria-label="Search"
          aria-controls={LIST}
          aria-expanded
          aria-autocomplete="list"
          aria-describedby={hinting ? HINT : undefined}
          placeholder="Search"
          autoComplete="off"
          spellCheck={false}
          value={search.text}
          onChange={(event) => search.say(event.target.value)}
          onFocus={(event) => {
            setFocused(true)
            search.onFocus(event)
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={search.onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {!focused && !searching && <SearchKey />}
      </label>
      {!searching && <NewThreadMenu engine={engine} projects={projects} />}
      {hinting && <SearchHint search={search} />}
    </div>
  )
}
