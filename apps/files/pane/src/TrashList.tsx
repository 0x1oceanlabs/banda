/**
 * The Trash, as a Files Pane shows it (ADR 0073, decisions 1 and 10):
 * what the system's Trash holds, the latest first, each with where it
 * came from and when (`files.trashed`). Put back returns it there; Delete
 * for good and Empty Trash ask first, as only the Trash deletes for good.
 * macOS lets no app list its Trash: there Finder keeps it, and Files says
 * so.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { Trashed } from "@banda/contract/files"
import { Button } from "@banda/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { DropdownMenuItem } from "@banda/ui/components/dropdown-menu"
import { toast } from "@banda/ui/components/sonner"
import { Spinner } from "@banda/ui/components/spinner"
import { openWithSystem } from "@banda/ui/lib/outside"
import { cn } from "@banda/ui/lib/utils"
import { problem } from "@banda/ui/lib/words"
import { clock } from "@banda/core/react"
import {
  FileIcon,
  FolderIcon,
  Trash2Icon,
  TrashIcon,
  Undo2Icon,
} from "lucide-react"
import { hearTrash, said, toldTrash } from "./acts"
import { Card } from "./Facts"
import { HeaderButton } from "./HeaderButton"
import { tilded } from "./where"

type Listed =
  | { state: "loading" }
  | { state: "refused"; message: string }
  | { state: "listed"; items: Trashed[] | null }

/** What asks before it deletes for good. */
type Asking = { items: Trashed[] | "all" } | null

export function TrashList({
  engine,
  project,
  home,
}: {
  engine: Engine
  project: ProjectId
  home: string | null
}) {
  const [listed, setListed] = useState<Listed>({ state: "loading" })
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [asking, setAsking] = useState<Asking>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const rows = useRef(new Map<string, HTMLButtonElement | null>())
  // Listed as it opens, as Files changes the Trash, and as the window
  // comes back, as another app may have.
  const list = useCallback(() => {
    engine.call("files.trashed", {}, { project }).then(
      (can) => setListed({ state: "listed", items: can.items ?? null }),
      (error: unknown) =>
        setListed({ state: "refused", message: problem(error) })
    )
  }, [engine, project])
  useEffect(() => {
    list()
    const stop = hearTrash(list)
    window.addEventListener("focus", list)
    return () => {
      stop()
      window.removeEventListener("focus", list)
    }
  }, [list])

  if (listed.state === "loading")
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    )
  if (listed.state === "refused")
    return (
      <Card
        icon={<TrashIcon />}
        title="The Trash cannot be read"
        note={listed.message}
      />
    )
  const items = listed.items
  if (items === null)
    return (
      <Card
        icon={<TrashIcon />}
        title="Finder keeps the Trash"
        note="macOS lets no app list its Trash or put back from it: open it in Finder. What Files moves there goes back from Finder too."
      >
        {home && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openWithSystem(`${home}/.Trash`)}
          >
            Open the Trash in Finder
          </Button>
        )}
      </Card>
    )
  if (items.length === 0)
    return (
      <Card
        icon={<TrashIcon />}
        title="The Trash is empty"
        note="What Files moves to the Trash shows here, to put back or to delete for good."
      />
    )

  const chosen = items.filter((item) => picked.has(item.id))
  const acting = (item?: Trashed) =>
    item && !picked.has(item.id) ? [item] : chosen
  const putBack = async (some: Trashed[]) => {
    if (some.length === 0) return
    try {
      const done = await engine.command(
        "files.restore",
        { items: some.map((item) => item.id) },
        project
      )
      const what =
        some.length === 1 ? `“${some[0].name}”` : `${some.length} items`
      said({ engine, project }, `Put back ${what}`, done.undo)
      setPicked(new Set())
    } catch (error) {
      toast.error(problem(error))
    }
    toldTrash()
  }
  const deleteForGood = async (what: Trashed[] | "all") => {
    setAsking(null)
    try {
      if (what === "all") await engine.command("files.empty", {}, project)
      else
        await engine.command(
          "files.delete",
          { items: what.map((item) => item.id) },
          project
        )
      setPicked(new Set())
    } catch (error) {
      toast.error(problem(error))
    }
    toldTrash()
  }
  const pick = (item: Trashed, more: boolean) =>
    setPicked((was) => {
      if (!more) return new Set([item.id])
      const next = new Set(was)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
  const move = (from: number, by: number) => {
    const to = items[Math.max(0, Math.min(items.length - 1, from + by))]
    setPicked(new Set([to.id]))
    rows.current.get(to.id)?.focus()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b pr-1 pl-2.5 text-xs">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {chosen.length > 0
            ? `${chosen.length} of ${items.length}`
            : `${items.length} ${items.length === 1 ? "item" : "items"}`}
        </span>
        <HeaderButton
          label="Put back"
          disabled={chosen.length === 0}
          onClick={() => void putBack(chosen)}
        >
          <Undo2Icon />
        </HeaderButton>
        <HeaderButton
          label="Delete for good"
          disabled={chosen.length === 0}
          onClick={() => setAsking({ items: chosen })}
        >
          <Trash2Icon />
        </HeaderButton>
        <Button
          size="xs"
          variant="ghost"
          className="shrink-0 text-destructive"
          onClick={() => setAsking({ items: "all" })}
        >
          Empty Trash
        </Button>
      </div>
      <ContextMenu
        onOpenChangeComplete={(open) => {
          if (!open) setMenu(null)
        }}
      >
        <ContextMenuTrigger
          render={
            <div
              role="listbox"
              aria-label="Trash"
              aria-multiselectable
              className="min-h-0 flex-1 overflow-y-auto p-1"
            />
          }
          onContextMenu={(event) => {
            const row = (event.target as Element).closest<HTMLElement>(
              "[data-trashed]"
            )
            const id = row?.dataset.trashed
            if (!id) return event.preventBaseUIHandler()
            if (!picked.has(id)) setPicked(new Set([id]))
            setMenu(id)
          }}
        >
          {items.map((item, n) => {
            const on = picked.has(item.id)
            const Icon = item.folder ? FolderIcon : FileIcon
            return (
              <button
                key={item.id}
                ref={(row) => {
                  rows.current.set(item.id, row)
                }}
                type="button"
                role="option"
                aria-selected={on}
                aria-label={item.name}
                data-trashed={item.id}
                title={`${item.name}, from ${tilded(item.from, home)}`}
                onClick={(event) => pick(item, event.ctrlKey || event.metaKey)}
                onDoubleClick={() => void putBack([item])}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") move(n, 1)
                  else if (event.key === "ArrowUp") move(n, -1)
                  else if (
                    event.key === "Delete" ||
                    (event.key === "Backspace" &&
                      (event.ctrlKey || event.metaKey))
                  )
                    setAsking({ items: acting(item) })
                  else return
                  event.preventDefault()
                }}
                className={cn(
                  "flex h-6 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none hover:bg-foreground/7 focus-visible:ring-1 focus-visible:ring-ring",
                  on && "bg-foreground/10"
                )}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 truncate">{item.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {tilded(item.from, home)}
                </span>
                <span className="shrink-0 text-[10.5px] text-muted-foreground tabular-nums">
                  {clock(item.when)}
                </span>
              </button>
            )
          })}
        </ContextMenuTrigger>
        <ContextMenuContent aria-label="Trashed" className="min-w-44">
          {menu && (
            <>
              <DropdownMenuItem
                onClick={() =>
                  void putBack(acting(items.find((item) => item.id === menu)))
                }
              >
                <Undo2Icon />
                Put back
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  setAsking({
                    items: acting(items.find((item) => item.id === menu)),
                  })
                }
              >
                <Trash2Icon />
                Delete for good…
              </DropdownMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <Dialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null)
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {asking?.items === "all"
                ? "Empty the Trash?"
                : asking?.items.length === 1
                  ? `Delete “${asking.items[0].name}” for good?`
                  : `Delete ${asking?.items.length ?? 0} items for good?`}
            </DialogTitle>
            <DialogDescription>
              {asking?.items === "all"
                ? `All ${items.length} items in the Trash are deleted for good.`
                : "It is deleted for good."}{" "}
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              autoFocus
              onClick={() => asking && void deleteForGood(asking.items)}
            >
              {asking?.items === "all" ? "Empty Trash" : "Delete for good"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
