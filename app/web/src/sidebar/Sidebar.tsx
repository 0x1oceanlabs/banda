import { useState } from "react"
import type { Engine, SpaceId, SpaceSummary } from "@bandaso/contract"
import { Button } from "@bandaso/ui/components/button"
import { ScrollArea } from "@bandaso/ui/components/scroll-area"
import type { PaneState } from "@bandaso/ui/pane"
import { FolderIcon, PlusIcon, SquarePenIcon } from "lucide-react"
import { runs, sidebar } from "../registry"
import { NewSpace } from "../Spaces"

/**
 * The sidebar, docked at the window's left edge (ADR 0005, decision 8):
 * every Space, each with its Threads, and a new Thread in any of them.
 * What each Space lists is a Pane its module offers; the sidebar only
 * places them. For now it groups by Space; the attention order comes next.
 */
export function Sidebar({
  engine,
  modules,
  spaces,
  onOpen,
  onNewThread,
  onCreated,
}: {
  engine: Engine
  modules: readonly string[]
  spaces: SpaceSummary[]
  /**
   * Opens a Pane a list asked for: where a workspace shows it, or in a new
   * column of the current one. The sidebar is no tile, so a place from it
   * means nothing.
   */
  onOpen: (space: SpaceId, pane: PaneState) => void
  onNewThread: (space: SpaceId) => void
  onCreated: (space: SpaceSummary) => void
}) {
  const [creating, setCreating] = useState(false)
  const List = runs(sidebar, modules) ? sidebar.Pane : undefined
  return (
    <aside
      aria-label="Sidebar"
      className="flex w-64 shrink-0 flex-col border-r bg-background/60"
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2">
          {spaces.map((space) => (
            <div key={space.id} role="group" aria-label={space.name}>
              <div className="group/space flex items-center gap-1.5 px-2 pb-1 text-xs font-medium text-muted-foreground">
                <FolderIcon className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate" title={space.folder}>
                  {space.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`New Thread in ${space.name}`}
                  title="New Thread"
                  className="opacity-0 group-hover/space:opacity-100 focus-visible:opacity-100"
                  onClick={() => onNewThread(space.id)}
                >
                  <SquarePenIcon />
                </Button>
              </div>
              {List && (
                <List
                  engine={engine}
                  space={space.id}
                  args={{}}
                  focused={false}
                  open={(pane, _place, other) =>
                    onOpen(other ?? space.id, pane)
                  }
                  update={() => {}}
                  close={() => {}}
                />
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => setCreating(true)}
        >
          <PlusIcon />
          New Space
        </Button>
      </div>
      <NewSpace
        engine={engine}
        open={creating}
        onOpenChange={setCreating}
        onCreated={onCreated}
      />
    </aside>
  )
}
