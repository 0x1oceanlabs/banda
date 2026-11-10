/**
 * What Files' Columns and Gallery share (ADR 0073, step F6): a row is
 * named as the tree names its rows (`data-type`, `data-item-path`), so the
 * Pane's menu finds it; it is picked by a click, opened by a double click,
 * dragged out with the rows picked, and a folder's takes a drop; it is
 * renamed in place in a field; git's mark, the turn's dot and the
 * Agent's pulse sit on it as on the tree's. Each view is held by the Pane
 * through the tree's own handle.
 */
import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import type { FolderTreeHandle, Mark } from "@banda/ui/components/file-tree"
import { bringsFiles, droppedPaths } from "@banda/ui/lib/file-drag"
import { cn } from "@banda/ui/lib/utils"
import { ARROWS, moved, parentRow, type View } from "./views"
import "./views.css"

/** What a view tells its Pane, as the tree does. */
export type ViewEvents = {
  onSelect: (row: string) => void
  /** A double click; ↵ is the Pane's, as its other keys. */
  onOpen: (row: string) => void
  onDrag: (rows: string[], event: DragEvent) => void
  /** Banda's files dropped in a folder, `""` the top: copied with Alt
   * (⌥) or Ctrl held. */
  onDrop: (paths: readonly string[], into: string, copy: boolean) => void
  /** A row renamed in place: whether its Pane renamed it. */
  onRename: (from: string, to: string) => Promise<boolean>
}

/** What a view's rows wear: git's marks, the turn's dots, and the
 * Agents' colours on the files they work on. */
export type RowMarks = {
  marks: ReadonlyMap<string, Mark>
  /** The folders that hold git's changes. */
  holds: ReadonlySet<string>
  /** The files the turn changed, and the folders that hold them. */
  turned: ReadonlySet<string>
  turnHolds: ReadonlySet<string>
  pulses: ReadonlyMap<string, string>
}

/** A row being renamed in place, and whether all of its name is picked. */
export type Renaming = { row: string; whole: boolean } | null

/**
 * What Columns and a Gallery do alike. The Pane holds the view by the
 * tree's handle: the keys go to `box`, the row picked is the one, and a
 * row is renamed in its field once it shows, its new name said to the
 * Pane as the keys come back. The arrows move the pick as the view's
 * `moved` says, in `box` itself and with no mod held.
 */
export function useView({
  ref,
  box,
  view,
  picked,
  rows,
  onSelect,
  onRename,
}: {
  ref: Ref<FolderTreeHandle> | undefined
  box: RefObject<HTMLElement | null>
  view: Exclude<View, "list">
  picked: string | null
  rows: (folder: string) => readonly string[]
} & Pick<ViewEvents, "onSelect" | "onRename">) {
  const [renaming, setRenaming] = useState<Renaming>(null)
  useImperativeHandle(
    ref,
    () => ({
      focus: () => box.current?.focus({ preventScroll: true }),
      expand: () => {},
      collapse: () => {},
      add: () => {},
      picked: () => (picked ? [picked] : []),
      rename: (row, whole = false) => {
        setRenaming({ row, whole })
        return true
      },
    }),
    [box, picked]
  )
  const renamed = (name: string | null) => {
    const from = renaming?.row
    setRenaming(null)
    requestAnimationFrame(() => box.current?.focus())
    if (!from || !name) return
    const slash = from.endsWith("/") ? "/" : ""
    void onRename(from, `${parentRow(from)}${name}${slash}`)
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const arrow = ARROWS[event.key]
    if (!arrow || event.target !== event.currentTarget) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const to = moved(view, arrow, picked, rows)
    if (to) onSelect(to)
  }
  return { renaming, renamed, onKeyDown }
}

/** The name a row shows: its last, a folder's without its `/`. */
export function rowName(row: string): string {
  return row.replace(/\/$/, "").split("/").at(-1) ?? row
}

/** Takes Banda's files dropped on an element into `into`; whether one
 * is over it now, to light it. */
export function useDrop(
  into: string,
  onDrop: ViewEvents["onDrop"]
): [boolean, Partial<React.HTMLAttributes<HTMLElement>>] {
  const [over, setOver] = useState(false)
  return [
    over,
    {
      onDragOver: (event) => {
        if (!bringsFiles(event.dataTransfer)) return
        event.preventDefault()
        event.stopPropagation()
        const copy = event.altKey || event.ctrlKey
        event.dataTransfer.dropEffect = copy ? "copy" : "move"
        setOver(true)
      },
      onDragLeave: (event) => {
        const to = event.relatedTarget
        if (!(to instanceof Node) || !event.currentTarget.contains(to))
          setOver(false)
      },
      onDrop: (event) => {
        setOver(false)
        const paths = droppedPaths(event.dataTransfer)
        if (!paths) return
        event.preventDefault()
        event.stopPropagation()
        onDrop(paths, into, event.altKey || event.ctrlKey)
      },
    },
  ]
}

/** A row's own: what names it to the Pane's menu, its pick, its open,
 * and its drag. */
export function rowProps(
  row: string,
  events: Pick<ViewEvents, "onSelect" | "onOpen" | "onDrag">
): React.HTMLAttributes<HTMLElement> & { [data: `data-${string}`]: string } {
  return {
    "data-type": "item",
    "data-item-path": row,
    draggable: true,
    onClick: () => events.onSelect(row),
    onDoubleClick: () => events.onOpen(row),
    // The Pane's menu acts on the row under it.
    onContextMenu: () => events.onSelect(row),
    onDragStart: (event) => events.onDrag([row], event.nativeEvent),
  }
}

/** Where a row's colour pulses, while an Agent works on its file. */
export function pulseStyle(
  colour: string | undefined
): CSSProperties | undefined {
  return colour ? ({ "--banda-pulse": colour } as CSSProperties) : undefined
}

/** git's mark on a row, a letter for a file and a dot for a folder that
 * holds a change, and the turn's quiet dot. */
export function RowMark({
  row,
  marks,
}: {
  row: string
  marks: RowMarks
}): ReactNode {
  const folder = row.endsWith("/")
  const mark = folder ? null : marks.marks.get(row)
  const turn = (folder ? marks.turnHolds : marks.turned).has(row)
  return (
    <>
      {turn && (
        <span
          title="Changed by the Agent's turn"
          className="size-1.5 shrink-0 rounded-full bg-muted-foreground/80"
        />
      )}
      {mark && (
        <span
          title={mark[0].toUpperCase() + mark.slice(1)}
          className={cn(
            "w-2.5 shrink-0 text-center text-[10px] font-semibold",
            mark === "added" || mark === "untracked"
              ? "text-added"
              : mark === "deleted"
                ? "text-removed"
                : "text-warning"
          )}
        >
          {mark === "untracked" ? "U" : mark[0].toUpperCase()}
        </span>
      )}
      {folder && marks.holds.has(row) && (
        <span
          title="Holds changes"
          className="size-1.5 shrink-0 rounded-full bg-warning/70"
        />
      )}
    </>
  )
}

/** A row's name, typed in place: its name before its extension picked,
 * or all of it. ↵ or leaving it renames; Escape keeps the name. */
export function RenameField({
  name,
  whole,
  onDone,
}: {
  name: string
  whole: boolean
  onDone: (name: string | null) => void
}) {
  const field = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const own = field.current
    if (!own) return
    own.focus()
    const dot = whole ? -1 : name.lastIndexOf(".")
    own.setSelectionRange(0, dot > 0 ? dot : name.length)
  }, [name, whole])
  const finish = (to: string | null) => {
    if (done.current) return
    done.current = true
    onDone(to && to !== name ? to : null)
  }
  return (
    <input
      ref={field}
      aria-label="Name"
      defaultValue={name}
      spellCheck={false}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(event.currentTarget.value.trim())
        else if (event.key === "Escape") finish(null)
        else return
        event.preventDefault()
        event.stopPropagation()
      }}
      onBlur={(event) => finish(event.currentTarget.value.trim())}
      className="h-5 min-w-0 flex-1 rounded-small bg-background px-1 text-xs ring-1 ring-ring/70 outline-none"
    />
  )
}
