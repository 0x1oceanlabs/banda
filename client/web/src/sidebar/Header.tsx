import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { Kbd } from "@banda/ui/components/kbd"
import { useKeyOf } from "@banda/ui/hooks/use-key-of"
import { keyCaps } from "@banda/ui/lib/keys"
import { SearchIcon } from "lucide-react"
import { NewThreadMenu } from "./NewThreadMenu"
import { useOpen } from "./open"

/** The Banda menu's key in force, as its caps, in the Search field. */
function MenuKey() {
  const key = useKeyOf()("menu.open")
  if (!key) return null
  return (
    <Kbd className="h-4.5 px-0.5">{keyCaps(key).join(" ")}</Kbd>
  )
}

/**
 * The sidebar's header (ADR 0098, decision 19): Search, which opens the
 * Banda menu, and ✎, which starts a Thread in the Project whose rows
 * alone the list shows, or else where the Person is, as Alt+Enter starts
 * one (`Here.starts`), or, by its menu, elsewhere. The Flow went to the
 * bar (decision 20): it arranges the desk, not the list.
 */
export function Header({
  engine,
  only,
  projects,
}: {
  /** This machine's engine. */
  engine: Engine
  /** The Project whose rows alone the list shows, if one. */
  only?: ProjectId
  projects: ProjectSummary[]
}) {
  const open = useOpen()
  return (
    <div className="flex items-center gap-0.5 px-2 pt-2 pb-1">
      <button
        type="button"
        onClick={() => open("menu.at")}
        className="mr-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-control border bg-background/60 px-2 text-ui text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Search</span>
        <MenuKey />
      </button>
      {/* S12a (ADR 0098, decision 17) hides ✎ here while the search in
        place has words, as in concept-v7. */}
      <NewThreadMenu engine={engine} only={only} projects={projects} />
    </div>
  )
}
