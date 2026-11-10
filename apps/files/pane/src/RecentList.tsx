/**
 * Recent, as a Files Pane shows it: the files the Person opened in this
 * Project lately, the latest first (`files.recent`), each with its
 * folder. ↵ or a double click opens one beside; its menu also shows it
 * in Files.
 */
import { useCallback, useRef, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import { Spinner } from "@banda/ui/components/spinner"
import { useRead } from "@banda/ui/hooks/use-read"
import { nameAndFolder } from "@banda/ui/lib/paths"
import { cn } from "@banda/ui/lib/utils"
import { ClockIcon, FileIcon } from "lucide-react"
import { Card } from "./Facts"
import { RowMenu } from "./RowMenu"
import { tilded } from "./where"

/** How many files Recent lists. */
const LISTED = 50

export function RecentList({
  engine,
  project,
  home,
  top,
  onOpen,
  onShow,
  onAttach,
}: {
  engine: Engine
  project: ProjectId
  home: string | null
  /** The Project's folder, whole, as the engine found it. */
  top: string | null
  onOpen: (path: string) => void
  /** Shows the file in its folder, picked. */
  onShow: (path: string) => void
  /** Names the file in a Thread's message. */
  onAttach: (path: string) => void
}) {
  const recent = useRead(
    useCallback(
      () => engine.call("files.recent", { limit: LISTED }, { project }),
      [engine, project]
    )
  )
  const [picked, setPicked] = useState(0)
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  const [menu, setMenu] = useState<string | null>(null)
  if (recent.state === "loading")
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    )
  const files = recent.state === "ready" ? recent.value : []
  if (files.length === 0)
    return (
      <Card
        icon={<ClockIcon />}
        title="Nothing opened yet"
        note="The files you open in this Project show here, the latest first."
      />
    )
  const move = (to: number) => {
    const n = Math.max(0, Math.min(files.length - 1, to))
    setPicked(n)
    rows.current[n]?.focus()
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            role="listbox"
            aria-label="Recent"
            className="h-full overflow-y-auto p-1"
          />
        }
        onContextMenu={(event) => {
          const row = (event.target as Element).closest<HTMLElement>(
            "[data-recent]"
          )
          if (row?.dataset.recent) setMenu(row.dataset.recent)
          else event.preventBaseUIHandler()
        }}
      >
        {files.map((file, n) => {
          const { name, folder } = nameAndFolder(file.path)
          return (
            <button
              key={file.path}
              ref={(row) => {
                rows.current[n] = row
              }}
              type="button"
              role="option"
              aria-selected={n === picked}
              data-recent={file.path}
              tabIndex={n === picked ? 0 : -1}
              title={tilded(file.path, home)}
              onClick={() => setPicked(n)}
              onDoubleClick={() => onOpen(file.path)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") move(n + 1)
                else if (event.key === "ArrowUp") move(n - 1)
                else if (event.key === "Home") move(0)
                else if (event.key === "End") move(files.length - 1)
                else if (event.key === "Enter") onOpen(file.path)
                else return
                event.preventDefault()
              }}
              className={cn(
                "flex h-6 w-full items-center gap-2 rounded-control px-2 text-left text-xs outline-none hover:bg-foreground/7 focus-visible:ring-1 focus-visible:ring-ring",
                n === picked && "bg-foreground/10"
              )}
            >
              <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 truncate">{name}</span>
              <span className="min-w-0 truncate text-muted-foreground">
                {folder ? tilded(folder, home) : ""}
              </span>
            </button>
          )
        })}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label="File" className="min-w-52">
        {menu && (
          <RowMenu
            whole={menu}
            folder={false}
            top={top}
            onOpen={() => onOpen(menu)}
            onShow={() => onShow(menu)}
            onAttach={() => onAttach(menu)}
          />
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
